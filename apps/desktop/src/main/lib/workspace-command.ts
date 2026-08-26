import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { getConversationWorkspace, getRuntimeRun, patchRuntimeRunMetadata } from "./db";
import { resolveWorkspacePath } from "./conversation-workspace";
import type {
  WorkspaceCommandInput,
  WorkspaceCommandResult,
  WorkspaceCommandRisk,
} from "../../shared/types";

export const WORKSPACE_COMMAND_TOOL_ID = "workspace_run_command" as const;
export const DEFAULT_WORKSPACE_COMMAND_TIMEOUT_MS = 20_000;
export const MAX_WORKSPACE_COMMAND_TIMEOUT_MS = 60_000;
export const MAX_WORKSPACE_COMMAND_OUTPUT_BYTES = 64 * 1024;

const MAX_ARGS = 64;
const MAX_ENV_ENTRIES = 32;
const MAX_ENV_VALUE_LENGTH = 4_096;
const MAX_EXECUTABLE_LENGTH = 256;
const MAX_CWD_LENGTH = 2_048;
const PROCESS_TREE_GRACE_MS = 750;

const ENV_ALLOWLIST = new Set([
  "PATH",
  "Path",
  "SystemRoot",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "COMSPEC",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "CI",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "NO_COLOR",
  "FORCE_COLOR",
  "AYAKA_SKILL_ROOT",
  "AYAKA_WORKSPACE_ROOT",
  "AYAKA_SKILL_ID",
  "AYAKA_SKILL_RUN_ID",
]);

const READ_ONLY_EXECUTABLES = new Set([
  "cat",
  "dir",
  "find",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "tail",
  "type",
  "where",
  "which",
  "get-childitem",
]);

const READ_ONLY_GIT_ACTIONS = new Set([
  "branch",
  "check-ignore",
  "diff",
  "log",
  "ls-files",
  "rev-parse",
  "show",
  "status",
]);

const SHELL_EXECUTABLES = new Set([
  "bash",
  "cmd",
  "fish",
  "powershell",
  "pwsh",
  "sh",
  "wsl",
  "zsh",
]);

const SENSITIVE_ARGUMENT_PATTERN = /token|secret|password|authorization|api[-_]?key|cookie/i;

type WorkspaceCommandPolicyDecision =
  | { decision: "allow"; risk: "read_only"; reason: string }
  | { decision: "require_review"; risk: Exclude<WorkspaceCommandRisk, "read_only">; reason: string }
  | { decision: "deny"; risk: WorkspaceCommandRisk; reason: string };

export function shouldRequireWorkspaceCommandApproval(options: {
  approvalEnabled: boolean;
  commandDecision: "allow" | "require_review";
  reviewAll: boolean;
  toolApprovalRequested: boolean;
  agentPolicyRequiresApproval: boolean;
}): boolean {
  if (!options.approvalEnabled) return false;
  return (
    options.commandDecision === "require_review" ||
    options.reviewAll ||
    options.toolApprovalRequested ||
    options.agentPolicyRequiresApproval
  );
}

interface NormalizedWorkspaceCommandInput {
  executable: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  timeoutMs: number;
}

interface WorkspaceCommandSessionOptions {
  runId: string;
  conversationId?: string;
}

export interface WorkspaceCommandSessionHandle {
  execute(
    input: WorkspaceCommandInput,
    signal: AbortSignal,
    options?: { allowedArgumentRoots?: string[]; allowedExecutableRoots?: string[] },
  ): Promise<WorkspaceCommandResult>;
  dispose(): Promise<void>;
}

const sessions = new Map<string, WorkspaceCommandSession>();

export function evaluateWorkspaceCommandPolicy(
  input: unknown,
  options?: { allowedArgumentRoots?: string[]; allowedExecutableRoots?: string[] },
): WorkspaceCommandPolicyDecision {
  let normalized: NormalizedWorkspaceCommandInput;
  try {
    normalized = normalizeWorkspaceCommandInput(input);
  } catch (error) {
    return {
      decision: "deny",
      risk: "unknown",
      reason: error instanceof Error ? error.message : "Invalid workspace command input.",
    };
  }

  if (
    looksLikePathEscape(normalized.executable) &&
    !isAllowedArgumentPath(normalized.executable, options?.allowedExecutableRoots ?? [])
  ) {
    return {
      decision: "deny",
      risk: "unknown",
      reason:
        "The command executable must be resolved by name or remain inside the conversation workspace.",
    };
  }
  if (normalized.cwd && looksLikePathEscape(normalized.cwd)) {
    return {
      decision: "deny",
      risk: "unknown",
      reason: "The command cwd must remain inside the conversation workspace.",
    };
  }
  if (
    normalized.args.some(
      (value) =>
        looksLikePathEscape(value) &&
        !isAllowedArgumentPath(value, options?.allowedArgumentRoots ?? []),
    )
  ) {
    return {
      decision: "deny",
      risk: "unknown",
      reason: "Explicit command paths must remain inside the conversation workspace.",
    };
  }

  const executable = executableBaseName(normalized.executable);
  const args = normalized.args.map((value) => value.toLowerCase());
  if (SHELL_EXECUTABLES.has(executable)) {
    return {
      decision: "require_review",
      risk: "unknown",
      reason: "Shell interpreters can perform actions outside structured argv semantics.",
    };
  }
  if (isReadOnlyInvocation(executable, args)) {
    return { decision: "allow", risk: "read_only", reason: "Known read-only command." };
  }

  const text = [executable, ...args].join(" ");
  if (matchesAny(text, /\b(rm|del|erase|rmdir|format|mkfs|shutdown|reboot)\b/)) {
    return {
      decision: "require_review",
      risk: "destructive",
      reason: "The command may delete data, format storage, or change system power state.",
    };
  }
  if (
    matchesAny(text, /\b(git\s+(reset|clean|checkout)|remove-item|drop-database)\b/) ||
    matchesAny(text, /\b(sed|perl)\b.*\s(-i|--in-place)\b/)
  ) {
    return {
      decision: "require_review",
      risk: "destructive",
      reason: "The command may change or remove workspace data.",
    };
  }
  if (
    matchesAny(text, /\b(npm|pnpm|yarn|pip|pip3|uv|brew|apt|apt-get|choco|winget)\b/) ||
    matchesAny(text, /\b(install|uninstall|update|upgrade)\b/)
  ) {
    return {
      decision: "require_review",
      risk: "install",
      reason: "The command may install packages or execute package lifecycle scripts.",
    };
  }
  if (
    matchesAny(text, /\b(curl|wget|invoke-webrequest|git\s+(clone|fetch|pull|push))\b/) ||
    normalized.args.some((value) => /^https?:\/\//i.test(value))
  ) {
    return {
      decision: "require_review",
      risk: "network",
      reason: "The command may access or modify network resources.",
    };
  }
  if (
    matchesAny(
      text,
      /\b(start|start-process|taskkill|kill|pkill|systemctl|launchctl|service|docker)\b/,
    ) ||
    matchesAny(text, /\b(run|serve|dev|watch|daemon)\b/)
  ) {
    return {
      decision: "require_review",
      risk: "process",
      reason: "The command may start, stop, or manage a long-running process.",
    };
  }
  if (
    matchesAny(text, /\b(mkdir|touch|cp|copy|mv|move|ren|rename|tee|git\s+(add|commit))\b/) ||
    matchesAny(text, /\b(write|output|target|destination)\b/)
  ) {
    return {
      decision: "require_review",
      risk: "write",
      reason: "The command may write or modify workspace files.",
    };
  }
  return {
    decision: "require_review",
    risk: "unknown",
    reason: "The command could not be proven read-only.",
  };
}

export function redactWorkspaceCommandInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  const args = Array.isArray(value.args) ? value.args.map(String) : [];
  const redactedArgs = args.map((arg, index) => {
    const previous = args[index - 1] ?? "";
    return isSensitiveArgumentName(previous) || isSensitiveArgumentName(arg.split("=")[0] ?? "")
      ? redactArgumentValue(arg, previous)
      : redactCommandText(arg);
  });
  const env =
    value.env && typeof value.env === "object" && !Array.isArray(value.env)
      ? Object.fromEntries(
          Object.keys(value.env as Record<string, unknown>).map((key) => [key, "[redacted]"]),
        )
      : undefined;
  const { env: _env, ...withoutEnv } = value;
  return {
    ...withoutEnv,
    ...(Array.isArray(value.args) ? { args: redactedArgs } : {}),
    ...(env ? { env } : {}),
  };
}

export function redactWorkspaceCommandText(value: string): string {
  return redactCommandText(value);
}

export async function executeWorkspaceCommand(options: {
  runId: string;
  conversationId?: string;
  signal: AbortSignal;
  input: WorkspaceCommandInput;
  allowedArgumentRoots?: string[];
  allowedExecutableRoots?: string[];
}): Promise<WorkspaceCommandResult> {
  const session = await getWorkspaceCommandSession({
    runId: options.runId,
    conversationId: options.conversationId,
  });
  return session.execute(options.input, options.signal, {
    allowedArgumentRoots: options.allowedArgumentRoots,
    allowedExecutableRoots: options.allowedExecutableRoots,
  });
}

export async function disposeWorkspaceCommandSession(runId: string): Promise<void> {
  const session = sessions.get(runId);
  if (!session) return;
  sessions.delete(runId);
  await session.dispose();
}

async function getWorkspaceCommandSession(
  options: WorkspaceCommandSessionOptions,
): Promise<WorkspaceCommandSession> {
  const workspace = options.conversationId
    ? getConversationWorkspace(options.conversationId)
    : undefined;
  if (!workspace) {
    throw new Error("A conversation workspace is required before running a local command.");
  }
  const rootPath = path.resolve(workspace.root_path);
  const existing = sessions.get(options.runId);
  if (existing) {
    if (existing.rootPath !== rootPath) {
      throw new Error("The Agent run is bound to a different conversation workspace.");
    }
    return existing;
  }

  const run = getRuntimeRun(options.runId);
  const cwd = readPersistedCwd(run?.metadata_json);
  const session = new WorkspaceCommandSession(options.runId, rootPath, cwd, async (nextCwd) => {
    await patchRuntimeRunMetadata(options.runId, {
      workspaceCommand: { cwd: nextCwd },
    });
  });
  sessions.set(options.runId, session);
  return session;
}

export function createWorkspaceCommandSession(options: {
  runId: string;
  rootPath: string;
  cwd?: string;
  persistCwd?: (cwd: string) => Promise<void>;
}): WorkspaceCommandSessionHandle {
  return new WorkspaceCommandSession(
    options.runId,
    path.resolve(options.rootPath),
    options.cwd ?? ".",
    options.persistCwd ?? (async () => undefined),
  );
}

class WorkspaceCommandSession {
  private readonly activeProcesses = new Set<ChildProcess>();

  constructor(
    readonly runId: string,
    readonly rootPath: string,
    private currentCwd: string,
    private readonly persistCwd: (cwd: string) => Promise<void>,
  ) {}

  async execute(
    input: WorkspaceCommandInput,
    signal: AbortSignal,
    options?: { allowedArgumentRoots?: string[]; allowedExecutableRoots?: string[] },
  ): Promise<WorkspaceCommandResult> {
    const normalized = normalizeWorkspaceCommandInput(input);
    const policy = evaluateWorkspaceCommandPolicy(normalized, options);
    if (policy.decision === "deny") throw new Error(policy.reason);

    const cwd = normalized.cwd === undefined ? this.currentCwd : normalized.cwd || ".";
    const resolvedCwd = resolveWorkspacePath(this.rootPath, cwd);
    const cwdRelative = toWorkspaceRelativePath(this.rootPath, resolvedCwd);
    const resolved = await statDirectory(resolvedCwd);
    if (!resolved) throw new Error("The workspace command cwd is not a directory.");
    const executable = resolveWorkspaceExecutable(
      this.rootPath,
      cwdRelative,
      normalized.executable,
    );
    this.currentCwd = cwdRelative;
    await this.persistCwd(this.currentCwd);
    if (signal.aborted) {
      return createCancelledResult(normalized, cwdRelative, policy.risk);
    }

    return await this.spawnAndCollect(normalized, executable, cwdRelative, policy.risk, signal);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.activeProcesses].map((child) => terminateProcessTree(child)));
  }

  private async spawnAndCollect(
    input: NormalizedWorkspaceCommandInput,
    executable: string,
    cwd: string,
    risk: WorkspaceCommandRisk,
    signal: AbortSignal,
  ): Promise<WorkspaceCommandResult> {
    const startedAt = Date.now();
    const resolvedCwd = resolveWorkspacePath(this.rootPath, cwd);
    let child: ChildProcess;
    try {
      child = spawn(executable, input.args, {
        cwd: resolvedCwd,
        env: buildCommandEnv(input.env),
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return createResult({
        input,
        cwd,
        risk,
        outcome: "failed_to_start",
        exitCode: null,
        signal: null,
        timedOut: false,
        aborted: signal.aborted,
        stdout: createCapture(),
        stderr: createCapture(),
        startedAt,
        error: redactCommandText(error instanceof Error ? error.message : String(error)),
      });
    }
    this.activeProcesses.add(child);

    try {
      return await collectProcessOutput({
        child,
        input,
        cwd,
        risk,
        signal,
        timeoutMs: input.timeoutMs,
        startedAt,
      });
    } finally {
      this.activeProcesses.delete(child);
    }
  }
}

async function collectProcessOutput(options: {
  child: ChildProcess;
  input: NormalizedWorkspaceCommandInput;
  cwd: string;
  risk: WorkspaceCommandRisk;
  signal: AbortSignal;
  timeoutMs: number;
  startedAt: number;
}): Promise<WorkspaceCommandResult> {
  const { child, input, cwd, risk, signal, timeoutMs, startedAt } = options;
  const stdout = createCapture();
  const stderr = createCapture();
  let timedOut = false;
  let aborted = signal.aborted;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let killPromise: Promise<void> | undefined;

  const terminate = (): void => {
    killPromise ??= terminateProcessTree(child);
  };

  const finish = (
    result: WorkspaceCommandResult,
    resolve: (value: WorkspaceCommandResult) => void,
  ) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
    resolve(result);
  };

  const onAbort = (): void => {
    aborted = true;
    terminate();
  };

  return await new Promise<WorkspaceCommandResult>((resolve) => {
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      finish(
        createResult({
          input,
          cwd,
          risk,
          outcome: aborted ? "cancelled" : timedOut ? "timed_out" : "failed_to_start",
          exitCode: null,
          signal: null,
          timedOut,
          aborted,
          stdout,
          stderr,
          startedAt,
          error: redactCommandText(error.message),
        }),
        resolve,
      );
    });

    child.once("close", (exitCode, closeSignal) => {
      finish(
        createResult({
          input,
          cwd,
          risk,
          outcome: aborted ? "cancelled" : timedOut ? "timed_out" : "completed",
          exitCode,
          signal: closeSignal,
          timedOut,
          aborted,
          stdout,
          stderr,
          startedAt,
        }),
        resolve,
      );
    });

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    } else {
      timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
    }
  });
}

function normalizeWorkspaceCommandInput(input: unknown): NormalizedWorkspaceCommandInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Workspace command input must be an object.");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.executable !== "string" || !value.executable.trim()) {
    throw new Error("Workspace command executable is required.");
  }
  const executable = value.executable.trim();
  if (executable.length > MAX_EXECUTABLE_LENGTH || executable.includes("\0")) {
    throw new Error("Workspace command executable is invalid or too long.");
  }
  const args = value.args === undefined ? [] : value.args;
  if (
    !Array.isArray(args) ||
    args.length > MAX_ARGS ||
    args.some((arg) => typeof arg !== "string")
  ) {
    throw new Error("Workspace command args must be a string array with at most 64 items.");
  }
  const normalizedArgs = args.map((arg) => {
    if (arg.includes("\0")) {
      throw new Error("Workspace command arguments must not contain NUL characters.");
    }
    return arg;
  });
  const cwd = value.cwd === undefined ? undefined : value.cwd;
  if (
    cwd !== undefined &&
    (typeof cwd !== "string" || cwd.length > MAX_CWD_LENGTH || cwd.includes("\0"))
  ) {
    throw new Error("Workspace command cwd is invalid or too long.");
  }
  const rawEnv = value.env === undefined ? {} : value.env;
  if (!rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) {
    throw new Error("Workspace command env must be an object.");
  }
  const envEntries = Object.entries(rawEnv as Record<string, unknown>);
  if (envEntries.length > MAX_ENV_ENTRIES)
    throw new Error("Workspace command env has too many entries.");
  const env: Record<string, string> = {};
  for (const [key, rawValue] of envEntries) {
    if (!ENV_ALLOWLIST.has(key)) throw new Error(`Environment variable '${key}' is not allowed.`);
    if (
      typeof rawValue !== "string" ||
      rawValue.length > MAX_ENV_VALUE_LENGTH ||
      rawValue.includes("\0")
    ) {
      throw new Error(`Environment variable '${key}' is invalid or too long.`);
    }
    env[key] = rawValue;
  }
  const timeoutMs = clampTimeout(value.timeoutMs);
  return { executable, args: normalizedArgs, cwd, env, timeoutMs };
}

function isReadOnlyInvocation(executable: string, args: string[]): boolean {
  if (READ_ONLY_EXECUTABLES.has(executable)) return true;
  if (executable === "git") {
    const action = args.find((arg) => !arg.startsWith("-"));
    return action !== undefined && READ_ONLY_GIT_ACTIONS.has(action);
  }
  if (
    ["node", "nodejs", "npm", "pnpm", "yarn", "python", "python3", "py", "go", "java"].includes(
      executable,
    )
  ) {
    return (
      args.length > 0 &&
      args.every((arg) => ["--version", "-v", "-version", "version"].includes(arg))
    );
  }
  return false;
}

function executableBaseName(executable: string): string {
  return path
    .basename(executable)
    .replace(/\.(cmd|bat|exe)$/i, "")
    .toLowerCase();
}

function resolveWorkspaceExecutable(rootPath: string, cwd: string, executable: string): string {
  if (!isRelativeExecutablePath(executable)) return executable;
  return resolveWorkspacePath(rootPath, path.join(cwd, executable));
}

function isRelativeExecutablePath(executable: string): boolean {
  return executable.startsWith(".") || executable.includes("/") || executable.includes("\\");
}

function looksLikePathEscape(value: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(value) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value);
}

function isAllowedArgumentPath(value: string, roots: string[]): boolean {
  if (!path.isAbsolute(value) || roots.length === 0) return false;
  const candidate = path.resolve(value);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    const relative = path.relative(resolvedRoot, candidate);
    return (
      relative === "" ||
      (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
    );
  });
}

function matchesAny(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

function buildCommandEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

function readPersistedCwd(metadataJson: string | undefined): string {
  if (!metadataJson) return ".";
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const workspaceCommand = metadata.workspaceCommand;
    if (workspaceCommand && typeof workspaceCommand === "object") {
      const cwd = (workspaceCommand as Record<string, unknown>).cwd;
      if (typeof cwd === "string" && cwd.trim()) return cwd;
    }
  } catch {
    // Corrupt optional metadata must not prevent a run from starting.
  }
  return ".";
}

async function statDirectory(directory: string): Promise<boolean> {
  try {
    const { stat } = await import("node:fs/promises");
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

function toWorkspaceRelativePath(rootPath: string, fullPath: string): string {
  const relative = path.relative(rootPath, fullPath);
  return relative ? relative.split(path.sep).join("/") : ".";
}

interface Capture {
  buffer: Buffer;
  bytes: number;
  truncated: boolean;
  push(chunk: Buffer): void;
}

function createCapture(): Capture {
  const capture: Capture = {
    buffer: Buffer.alloc(0),
    bytes: 0,
    truncated: false,
    push(chunk) {
      capture.bytes += chunk.byteLength;
      capture.buffer = Buffer.concat([capture.buffer, chunk]);
      if (capture.buffer.byteLength > MAX_WORKSPACE_COMMAND_OUTPUT_BYTES) {
        capture.buffer = capture.buffer.subarray(-MAX_WORKSPACE_COMMAND_OUTPUT_BYTES);
        capture.truncated = true;
      }
    },
  };
  return capture;
}

function createResult(input: {
  input: NormalizedWorkspaceCommandInput;
  cwd: string;
  risk: WorkspaceCommandRisk;
  outcome: WorkspaceCommandResult["outcome"];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: Capture;
  stderr: Capture;
  startedAt: number;
  error?: string;
}): WorkspaceCommandResult {
  return {
    executable: input.input.executable,
    args: input.input.args.map((arg, index) =>
      redactArgumentValue(arg, input.input.args[index - 1]),
    ),
    cwd: input.cwd,
    outcome: input.outcome,
    risk: input.risk,
    exitCode: input.exitCode,
    signal: input.signal,
    timedOut: input.timedOut,
    aborted: input.aborted,
    stdout: redactCommandText(decodeCapture(input.stdout.buffer)),
    stderr: redactCommandText(decodeCapture(input.stderr.buffer)),
    stdoutBytes: input.stdout.bytes,
    stderrBytes: input.stderr.bytes,
    stdoutTruncated: input.stdout.truncated,
    stderrTruncated: input.stderr.truncated,
    durationMs: Math.max(0, Date.now() - input.startedAt),
    ...(input.error ? { error: input.error } : {}),
  };
}

function createCancelledResult(
  input: NormalizedWorkspaceCommandInput,
  cwd: string,
  risk: WorkspaceCommandRisk,
): WorkspaceCommandResult {
  return createResult({
    input,
    cwd,
    risk,
    outcome: "cancelled",
    exitCode: null,
    signal: null,
    timedOut: false,
    aborted: true,
    stdout: createCapture(),
    stderr: createCapture(),
    startedAt: Date.now(),
  });
}

function decodeCapture(buffer: Buffer): string {
  const utf8 = buffer.toString("utf8");
  if (process.platform !== "win32" || !utf8.includes("\ufffd")) return utf8;
  try {
    return new TextDecoder("gb18030").decode(buffer);
  } catch {
    return utf8;
  }
}

function redactArgumentValue(value: string, previous?: string): string {
  if (previous && isSensitiveArgumentName(previous)) return "[redacted]";
  const separator = value.indexOf("=");
  if (separator > 0 && isSensitiveArgumentName(value.slice(0, separator))) {
    return value.slice(0, separator + 1) + "[redacted]";
  }
  return redactCommandText(value);
}

function isSensitiveArgumentName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("-") && !trimmed.includes("="))) return false;
  return SENSITIVE_ARGUMENT_PATTERN.test(trimmed.split("=", 1)[0] ?? "");
}

function redactCommandText(value: string): string {
  return value
    .replace(
      /(["']?(?:api[-_ ]?key|access[-_ ]?token|authorization|password|secret)["']?\s*[:=]\s*["']?)[^,]+/gi,
      "$1[redacted]",
    )
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|key|token|secret)[-_][a-z0-9_-]{8,}\b/gi, "[redacted]");
}

function clampTimeout(value: unknown): number {
  if (value === undefined) return DEFAULT_WORKSPACE_COMMAND_TIMEOUT_MS;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 1_000 ||
    value > MAX_WORKSPACE_COMMAND_TIMEOUT_MS
  ) {
    throw new Error("Workspace command timeout must be between 1000 and 60000 milliseconds.");
  }
  return Math.floor(value);
}

export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (!pid) {
    child.kill("SIGTERM");
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => {
        child.kill("SIGTERM");
        resolve();
      });
      killer.once("close", () => resolve());
    });
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise((resolve) => setTimeout(resolve, PROCESS_TREE_GRACE_MS));
  // `child.killed` only means that Node accepted the signal; it does not mean
  // the process has exited. Check the exit fields before escalating so a
  // child that ignores SIGTERM cannot leave its process group behind.
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}
