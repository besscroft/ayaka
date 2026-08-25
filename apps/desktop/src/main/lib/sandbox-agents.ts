import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile, cp } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  getSandboxSnapshot,
  insertSandboxArtifactAsync as insertSandboxArtifact,
  insertSandboxSnapshotAsync as insertSandboxSnapshot,
  listSandboxArtifacts,
  upsertSandboxSessionAsync as upsertSandboxSession,
} from "./db";
import { getConversationWorkspace } from "./db";
import type { SandboxArtifact, SandboxSession, SandboxSnapshot } from "../../shared/types";

const DATA_DIRNAME = "data";
const SANDBOX_DIRNAME = "sandboxes";
const SNAPSHOT_DIRNAME = ".snapshots";
const DEFAULT_COMMAND_TIMEOUT_MS = 20_000;
const DEFAULT_DOCKER_IMAGE = "node:22-bookworm-slim";
const DOCKER_WORKSPACE_PATH = "/workspace";
const MAX_FILE_READ_BYTES = 512_000;
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
]);

export interface SandboxContext {
  session: SandboxSession;
  dockerAvailable: boolean;
}

export interface SandboxRunCommandInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export async function getOrCreateSandboxSession(input: {
  conversationId?: string | null;
  runId?: string | null;
  agentId?: string | null;
  preferredMode?: "local" | "docker";
}): Promise<SandboxContext> {
  const sessionId = input.runId ? "sandbox-" + safeId(input.runId) : randomUUID();
  const dockerAvailable = await detectDockerAvailable();
  const isolationMode = input.preferredMode === "docker" && dockerAvailable ? "docker" : "local";
  const workspaceRoot = input.conversationId
    ? getConversationWorkspace(input.conversationId)?.root_path
    : undefined;
  if (input.conversationId && !workspaceRoot) {
    throw new Error("A conversation workspace is required before starting a sandbox.");
  }
  const rootPath = workspaceRoot
    ? path.join(workspaceRoot, ".sandbox", sessionId)
    : path.join(resolveSandboxBaseDir(), sessionId);
  await mkdir(rootPath, { recursive: true });
  await mkdir(path.join(rootPath, SNAPSHOT_DIRNAME), { recursive: true });
  const now = Date.now();
  const session = await upsertSandboxSession({
    id: sessionId,
    conversation_id: input.conversationId ?? null,
    run_id: input.runId ?? null,
    agent_id: input.agentId ?? null,
    root_path: rootPath,
    isolation_mode: isolationMode,
    status: "active",
    docker_available: dockerAvailable ? 1 : 0,
    created_at: now,
    updated_at: now,
  });
  return { session, dockerAvailable };
}

export async function listSandboxFiles(
  session: SandboxSession,
  relativePath = ".",
): Promise<{
  path: string;
  entries: Array<{ name: string; path: string; kind: string; size: number | null }>;
}> {
  const directory = resolveSandboxPath(session.root_path, relativePath);
  const directoryStat = await stat(directory);
  if (!directoryStat.isDirectory()) throw new Error("Path is not a directory.");
  const entries = await readdir(directory, { withFileTypes: true });
  const visible = entries.filter((entry) => entry.name !== SNAPSHOT_DIRNAME);
  const rows = await Promise.all(
    visible.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      const itemStat = await stat(fullPath);
      const rel = toSandboxRelativePath(session.root_path, fullPath);
      return {
        name: entry.name,
        path: rel,
        kind: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
        size: entry.isFile() ? itemStat.size : null,
      };
    }),
  );
  return { path: toSandboxRelativePath(session.root_path, directory), entries: rows };
}

export async function readSandboxFile(
  session: SandboxSession,
  relativePath: string,
): Promise<{ path: string; text: string; bytes: number; truncated: boolean }> {
  const filePath = resolveSandboxPath(session.root_path, relativePath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Path is not a file.");
  const bytesToRead = Math.min(fileStat.size, MAX_FILE_READ_BYTES);
  const buffer = await readFile(filePath);
  const sliced = buffer.subarray(0, bytesToRead);
  return {
    path: toSandboxRelativePath(session.root_path, filePath),
    text: sliced.toString("utf8"),
    bytes: fileStat.size,
    truncated: fileStat.size > MAX_FILE_READ_BYTES,
  };
}

export async function writeSandboxFile(
  session: SandboxSession,
  relativePath: string,
  content: string,
  options?: { append?: boolean },
): Promise<{ path: string; bytes: number; mode: "write" | "append" }> {
  const filePath = resolveSandboxPath(session.root_path, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  const mode = options?.append ? "append" : "write";
  const data = Buffer.from(content, "utf8");
  await writeFile(filePath, data, { flag: options?.append ? "a" : "w" });
  return { path: toSandboxRelativePath(session.root_path, filePath), bytes: data.byteLength, mode };
}

export async function runSandboxCommand(
  session: SandboxSession,
  input: SandboxRunCommandInput,
): Promise<{
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
}> {
  const command = input.command.trim();
  if (!command) throw new Error("command is required.");
  const args = Array.isArray(input.args) ? input.args.map(String).slice(0, 40) : [];
  const cwd = resolveSandboxPath(session.root_path, input.cwd ?? ".");
  const cwdStat = await stat(cwd);
  if (!cwdStat.isDirectory()) throw new Error("cwd is not a directory.");
  const timeoutMs = clampNumber(input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, 1_000, 60_000);
  if (session.isolation_mode === "docker") {
    return runDockerSandboxCommand(session, input, command, args, cwd, timeoutMs);
  }

  return runLocalSandboxCommand(session, input, command, args, cwd, timeoutMs);
}

async function runLocalSandboxCommand(
  session: SandboxSession,
  input: SandboxRunCommandInput,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof createSandboxCommandResult>>> {
  const env = buildCommandEnv(input.env);
  const started = Date.now();

  return collectSandboxCommand(
    spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    {
      command,
      args,
      cwd: toSandboxRelativePath(session.root_path, cwd),
      timeoutMs,
      started,
    },
  );
}

async function runDockerSandboxCommand(
  session: SandboxSession,
  input: SandboxRunCommandInput,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof createSandboxCommandResult>>> {
  const relativeCwd = toSandboxRelativePath(session.root_path, cwd);
  const containerName = `ayaka-${safeId(session.id)}-${randomUUID().slice(0, 8)}`;
  const dockerArgs = buildSandboxDockerArgs(
    session,
    input,
    command,
    args,
    relativeCwd,
    containerName,
  );
  const started = Date.now();
  return collectSandboxCommand(
    spawn("docker", dockerArgs, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }),
    {
      command,
      args,
      cwd: relativeCwd,
      timeoutMs,
      started,
      onTimeout: () => {
        const cleanup = spawn("docker", ["rm", "-f", containerName], {
          windowsHide: true,
          stdio: "ignore",
        });
        cleanup.on("error", () => undefined);
      },
    },
  );
}

export function buildSandboxDockerArgs(
  session: SandboxSession,
  input: Pick<SandboxRunCommandInput, "env">,
  command: string,
  args: string[],
  relativeCwd: string,
  containerName = "ayaka-sandbox",
): string[] {
  const image = process.env.AYAKA_SANDBOX_DOCKER_IMAGE?.trim() || DEFAULT_DOCKER_IMAGE;
  const containerCwd =
    relativeCwd === "."
      ? DOCKER_WORKSPACE_PATH
      : `${DOCKER_WORKSPACE_PATH}/${relativeCwd.replace(/\\/g, "/")}`;
  const env = buildContainerEnv(input.env);
  const environmentArgs = Object.entries(env).flatMap(([key, value]) => [
    "--env",
    `${key}=${value}`,
  ]);
  return [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "--pids-limit",
    "128",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--mount",
    `type=bind,source=${session.root_path},target=${DOCKER_WORKSPACE_PATH}`,
    "--workdir",
    containerCwd,
    ...environmentArgs,
    image,
    command,
    ...args,
  ];
}

function collectSandboxCommand(
  child: ReturnType<typeof spawn>,
  meta: {
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
    started: number;
    onTimeout?: () => void;
  },
): Promise<Awaited<ReturnType<typeof createSandboxCommandResult>>> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      meta.onTimeout?.();
      child.kill("SIGTERM");
    }, meta.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = truncateOutput(stdout + chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = truncateOutput(stderr + chunk.toString("utf8"));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve(
        createSandboxCommandResult({
          ...meta,
          exitCode,
          signal,
          timedOut,
          stdout,
          stderr,
        }),
      );
    });
  });
}

function createSandboxCommandResult(input: {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  started: number;
}): {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
} {
  return {
    command: input.command,
    args: input.args,
    cwd: input.cwd,
    exitCode: input.exitCode,
    signal: input.signal,
    timedOut: input.timedOut,
    stdout: input.stdout,
    stderr: input.stderr,
    durationMs: Date.now() - input.started,
  };
}

export async function createSandboxSnapshot(
  session: SandboxSession,
  label?: string,
): Promise<SandboxSnapshot> {
  const snapshotId = randomUUID();
  const snapshotPath = path.join(session.root_path, SNAPSHOT_DIRNAME, snapshotId);
  await mkdir(snapshotPath, { recursive: true });
  const manifest = await copySandboxTree(session.root_path, snapshotPath);
  return insertSandboxSnapshot({
    id: snapshotId,
    session_id: session.id,
    label: (label?.trim() || "Snapshot").slice(0, 120),
    manifest_json: JSON.stringify({ files: manifest }),
  });
}

export async function restoreSandboxSnapshot(
  session: SandboxSession,
  snapshotId: string,
): Promise<{ snapshotId: string; restored: number }> {
  const snapshot = getSandboxSnapshot(snapshotId);
  if (!snapshot || snapshot.session_id !== session.id) throw new Error("Snapshot not found.");
  const snapshotPath = path.join(session.root_path, SNAPSHOT_DIRNAME, snapshotId);
  if (!existsSync(snapshotPath)) throw new Error("Snapshot files are missing.");
  const existingEntries = await readdir(session.root_path, { withFileTypes: true });
  for (const entry of existingEntries) {
    if (entry.name === SNAPSHOT_DIRNAME) continue;
    await rm(path.join(session.root_path, entry.name), { recursive: true, force: true });
  }
  const restored = await copySandboxTree(snapshotPath, session.root_path);
  return { snapshotId, restored: restored.length };
}

export function listSandboxSessionArtifacts(session: SandboxSession): SandboxArtifact[] {
  return listSandboxArtifacts().filter((artifact) => artifact.session_id === session.id);
}

export async function registerSandboxPreviewPort(
  session: SandboxSession,
  input: { port: number; label?: string },
): Promise<SandboxArtifact> {
  const port = Math.floor(input.port);
  if (!Number.isFinite(port) || port < 1 || port > 65_535) throw new Error("Invalid port.");
  const { isSandboxPreviewPortManaged } = await import("./sandbox-preview-manager");
  if (!isSandboxPreviewPortManaged(session.id, port)) {
    throw new Error("Preview ports must be created by sandbox_start_preview.");
  }
  return insertSandboxArtifact({
    session_id: session.id,
    kind: "preview",
    path: input.label?.trim() || "Preview " + port,
    url: "http://127.0.0.1:" + port,
    size_bytes: null,
  });
}

export function resolveSandboxPath(rootPath: string, relativePath = "."): string {
  const raw = String(relativePath || ".").trim() || ".";
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) {
    throw new Error("Sandbox paths must be relative.");
  }
  const resolved = path.resolve(rootPath, raw);
  const relative = path.relative(rootPath, resolved);
  if (relative === "") return resolved;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Sandbox path escapes the sandbox root.");
  }
  if (relative.split(path.sep).includes(SNAPSHOT_DIRNAME)) {
    throw new Error("Snapshot internals are not directly accessible.");
  }
  assertSandboxRealPath(rootPath, resolved);
  return resolved;
}

function assertSandboxRealPath(rootPath: string, resolvedPath: string): void {
  const rootRealPath = existingRealPath(rootPath);
  let cursor = resolvedPath;
  const suffix: string[] = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const candidateRealPath = path.resolve(existingRealPath(cursor), ...suffix);
  const relative = path.relative(rootRealPath, candidateRealPath);
  if (
    relative &&
    (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
  ) {
    throw new Error("Sandbox path escapes the sandbox root.");
  }
}

function existingRealPath(value: string): string {
  return existsSync(value) ? realpathSync.native(value) : path.resolve(value);
}

async function detectDockerAvailable(): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn("docker", ["--version"], { windowsHide: true, stdio: "ignore" });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(false);
    }, 1_500);
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve(code === 0);
    });
  });
}

async function copySandboxTree(sourceRoot: string, targetRoot: string): Promise<string[]> {
  const copied: string[] = [];
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === SNAPSHOT_DIRNAME) continue;
    const source = path.join(sourceRoot, entry.name);
    const target = path.join(targetRoot, entry.name);
    if (entry.isDirectory()) {
      await mkdir(target, { recursive: true });
      const children = await copySandboxTree(source, target);
      copied.push(...children.map((child) => path.join(entry.name, child)));
    } else if (entry.isFile()) {
      await mkdir(path.dirname(target), { recursive: true });
      await cp(source, target, { force: true });
      copied.push(entry.name);
    }
  }
  return copied;
}

function resolveSandboxBaseDir(): string {
  const userDataDir = process.env.AYAKA_USER_DATA_DIR || app.getPath("userData");
  return path.join(userDataDir, DATA_DIRNAME, SANDBOX_DIRNAME);
}

function toSandboxRelativePath(rootPath: string, fullPath: string): string {
  const relative = path.relative(rootPath, fullPath);
  return relative ? relative.split(path.sep).join("/") : ".";
}

function buildCommandEnv(extraEnv: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (ENV_ALLOWLIST.has(key)) env[key] = String(value);
    }
  }
  return env;
}

function buildContainerEnv(extraEnv: Record<string, string> | undefined): Record<string, string> {
  const hostEnv = buildCommandEnv(extraEnv);
  return Object.fromEntries(
    Object.entries(hostEnv).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        !["PATH", "Path", "SystemRoot", "COMSPEC"].includes(entry[0]),
    ),
  );
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || randomUUID();
}

function truncateOutput(value: string): string {
  return value.length > 16_000 ? value.slice(value.length - 16_000) : value;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
