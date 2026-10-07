import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type {
  LocalApplyPatchInput,
  LocalEditFileInput,
  LocalExecutionErrorCode,
  LocalExecutionOperation,
  LocalExecutionResult,
  LocalExecutionRisk,
  LocalReadFileInput,
  LocalRunCommandInput,
  LocalWriteFileInput,
  ChatPermissionMode,
  WorkspaceCommandResult,
} from "../../shared/types";
import { getConversationWorkspace, getRuntimeRun, patchRuntimeRunMetadata } from "./db";
import {
  evaluateLocalCommandPolicy,
  evaluateWorkspaceCommandPolicy,
  normalizeWorkspaceCommandInput,
  redactWorkspaceCommandInput,
  redactWorkspaceCommandText,
  runStructuredCommandProcess,
  terminateProcessTree,
  type NormalizedWorkspaceCommandInput,
} from "./workspace-command";

export const LOCAL_RUN_COMMAND_TOOL_ID = "local_run_command" as const;
export const LOCAL_READ_FILE_TOOL_ID = "local_read_file" as const;
export const LOCAL_WRITE_FILE_TOOL_ID = "local_write_file" as const;
export const LOCAL_EDIT_FILE_TOOL_ID = "local_edit_file" as const;
export const LOCAL_APPLY_PATCH_TOOL_ID = "local_apply_patch" as const;
export const LOCAL_EXECUTION_TOOL_IDS = [
  LOCAL_RUN_COMMAND_TOOL_ID,
  LOCAL_READ_FILE_TOOL_ID,
  LOCAL_WRITE_FILE_TOOL_ID,
  LOCAL_EDIT_FILE_TOOL_ID,
  LOCAL_APPLY_PATCH_TOOL_ID,
] as const;

export const DEFAULT_LOCAL_READ_BYTES = 64 * 1024;
export const MAX_LOCAL_READ_BYTES = 256 * 1024;
export const MAX_LOCAL_EDIT_FILE_BYTES = 1024 * 1024;
export const MAX_LOCAL_PATCH_BYTES = 256 * 1024;
const MAX_LOCAL_READ_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_LOCAL_PATH_LENGTH = 4_096;

const ENGINE_METADATA_KEY = "localExecution";
const engines = new Map<string, Promise<LocalExecutionEngine>>();
const mutationLocks = new Map<string, Promise<void>>();

type LocalFailure = Extract<LocalExecutionResult, { ok: false }>;

interface TargetPath {
  path: string;
  exists: boolean;
  mode?: number;
}

interface LocalReadFileData {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  returnedLines: number;
  bytes: number;
  returnedBytes: number;
  truncated: boolean;
  sha256: string;
}

interface LocalCommandResultData extends Omit<WorkspaceCommandResult, "risk"> {
  risk: LocalExecutionRisk;
}

interface PatchOperation {
  kind: "add" | "update" | "delete";
  path: string;
  moveTo?: string;
  lines: string[];
}

interface PatchHunk {
  oldStart?: number;
  oldCount?: number;
  lines: string[];
}

interface PendingMutation {
  path: string;
  before: Buffer | null;
  beforeHash: string | null;
  after: Buffer | null;
  mode?: number;
  tempPath?: string;
}

class LocalExecutionError extends Error {
  constructor(
    readonly code: LocalExecutionErrorCode,
    message: string,
    readonly retryable = false,
    readonly path?: string,
    readonly partialResult?: unknown,
  ) {
    super(message);
    this.name = "LocalExecutionError";
  }
}

export interface LocalExecutionAssessment {
  operation: LocalExecutionOperation;
  decision: "allow" | "require_review" | "deny";
  risk: LocalExecutionRisk;
  reason: string;
  paths: string[];
  scope?: "local" | "conversation_workspace";
}

type ApprovalResolution = "not_required" | "requested" | "approved" | "changed";

export interface LocalExecutionApprovalSnapshot {
  phase: "pending" | "approved";
  fingerprint: string;
}

export function shouldRequireLocalExecutionApproval(options: {
  permissionMode: ChatPermissionMode;
  risk: LocalExecutionRisk;
  reviewAll: boolean;
  toolRequiresApproval: boolean;
  toolApprovalRequested: boolean;
  agentPolicyRequiresApproval: boolean;
}): boolean {
  if (options.permissionMode === "full_access") return false;
  if (options.permissionMode === "ask") return true;
  return (
    options.risk !== "read_only" ||
    options.reviewAll ||
    options.toolRequiresApproval ||
    options.toolApprovalRequested ||
    options.agentPolicyRequiresApproval
  );
}

export async function getLocalExecutionEngine(options: {
  runId: string;
  conversationId?: string;
}): Promise<LocalExecutionEngine> {
  const existing = engines.get(options.runId);
  if (existing) return existing;
  const pending = createEngine(options);
  engines.set(options.runId, pending);
  try {
    return await pending;
  } catch (error) {
    if (engines.get(options.runId) === pending) engines.delete(options.runId);
    throw error;
  }
}

async function createEngine(options: {
  runId: string;
  conversationId?: string;
}): Promise<LocalExecutionEngine> {
  const workspace = options.conversationId
    ? getConversationWorkspace(options.conversationId)
    : undefined;
  if (!workspace) {
    throw new LocalExecutionError(
      "RUNTIME_ERROR",
      "A conversation workspace is required to start local execution.",
      true,
    );
  }
  const workspaceRoot = await realpath(path.resolve(workspace.root_path));
  const run = getRuntimeRun(options.runId);
  let localMetadata = readPersistedLocalExecutionMetadata(run?.metadata_json);
  const approvalSnapshots = readPersistedApprovalSnapshots(localMetadata.approvalSnapshots);
  let metadataWrite = Promise.resolve();
  const persistLocalMetadata = (
    patch: Record<string, unknown>,
    required = false,
  ): Promise<void> => {
    localMetadata = { ...localMetadata, ...patch };
    const snapshot = { ...localMetadata };
    const next = metadataWrite.then(async () => {
      const persisted = await patchRuntimeRunMetadata(options.runId, {
        [ENGINE_METADATA_KEY]: snapshot,
      });
      if (required && !persisted) {
        throw new LocalExecutionError(
          "RUNTIME_ERROR",
          "Could not persist the local approval state.",
          true,
        );
      }
    });
    metadataWrite = next.catch(() => undefined);
    return next;
  };

  const cwd = readPersistedLocalCwd(run?.metadata_json) ?? workspaceRoot;
  const workspaceCwd = await resolvePersistedWorkspaceCwd(
    workspaceRoot,
    readPersistedWorkspaceCwd(run?.metadata_json),
  );
  let canonicalCwd: string;
  try {
    canonicalCwd = await realpath(path.resolve(cwd));
    if (!(await stat(canonicalCwd)).isDirectory()) canonicalCwd = workspaceRoot;
  } catch {
    canonicalCwd = workspaceRoot;
  }
  return new LocalExecutionEngine({
    runId: options.runId,
    workspaceRoot,
    cwd: canonicalCwd,
    workspaceCwd,
    approvalSnapshots,
    persistCwd: (nextCwd) => persistLocalMetadata({ cwd: nextCwd }),
    persistWorkspaceCwd: async (nextCwd) => {
      await patchRuntimeRunMetadata(options.runId, { workspaceCommand: { cwd: nextCwd } });
    },
    persistApprovalSnapshots: (snapshots) =>
      persistLocalMetadata({ approvalSnapshots: snapshots }, true),
  });
}

export async function disposeLocalExecutionEngine(runId: string): Promise<void> {
  const pending = engines.get(runId);
  if (!pending) return;
  engines.delete(runId);
  try {
    await (await pending).dispose();
  } catch {
    // A workspace may disappear while a run is being finalized.
  }
}

export async function assessLocalExecutionInput(options: {
  runId: string;
  conversationId?: string;
  toolName: string;
  input: unknown;
}): Promise<LocalExecutionAssessment> {
  const engine = await getLocalExecutionEngine(options);
  return engine.assess(options.toolName, options.input);
}

export async function assessWorkspaceCommandInput(options: {
  runId: string;
  conversationId?: string;
  input: unknown;
}): Promise<LocalExecutionAssessment> {
  const engine = await getLocalExecutionEngine(options);
  return engine.assessWorkspaceCommand(options.input);
}

export function redactLocalExecutionInput(toolName: string, input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  if (toolName === LOCAL_RUN_COMMAND_TOOL_ID) return redactWorkspaceCommandInput(value);
  if (toolName === LOCAL_READ_FILE_TOOL_ID) {
    return {
      path: value.path,
      startLine: value.startLine,
      endLine: value.endLine,
      maxBytes: value.maxBytes,
    };
  }
  if (toolName === LOCAL_WRITE_FILE_TOOL_ID || toolName === LOCAL_EDIT_FILE_TOOL_ID) {
    return {
      path: value.path,
      expectedHash: value.expectedHash,
      ...(typeof value.replaceAll === "boolean" ? { replaceAll: value.replaceAll } : {}),
      content: {
        redacted: true,
        charCount: typeof value.content === "string" ? value.content.length : undefined,
      },
      oldText: {
        redacted: true,
        charCount: typeof value.oldText === "string" ? value.oldText.length : undefined,
      },
      newText: {
        redacted: true,
        charCount: typeof value.newText === "string" ? value.newText.length : undefined,
      },
    };
  }
  if (toolName === LOCAL_APPLY_PATCH_TOOL_ID) {
    return {
      patch: {
        redacted: true,
        charCount: typeof value.patch === "string" ? value.patch.length : undefined,
      },
    };
  }
  return input;
}

export class LocalExecutionEngine {
  private readonly activeProcesses = new Set<ChildProcess>();
  private readonly approvalSnapshots: Map<string, LocalExecutionApprovalSnapshot>;

  constructor(
    private readonly options: {
      runId: string;
      workspaceRoot: string;
      cwd: string;
      workspaceCwd?: string;
      persistCwd: (cwd: string) => Promise<void>;
      persistWorkspaceCwd?: (cwd: string) => Promise<void>;
      approvalSnapshots?: Record<string, LocalExecutionApprovalSnapshot>;
      persistApprovalSnapshots?: (
        snapshots: Record<string, LocalExecutionApprovalSnapshot>,
      ) => Promise<void>;
      renameForCommit?: typeof rename;
    },
  ) {
    this.approvalSnapshots = new Map(Object.entries(options.approvalSnapshots ?? {}));
  }

  get cwd(): string {
    return this.options.cwd;
  }

  get workspaceCwd(): string {
    return this.options.workspaceCwd ?? this.options.workspaceRoot;
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.activeProcesses].map((child) => terminateProcessTree(child)));
    if (this.approvalSnapshots.size > 0) {
      this.approvalSnapshots.clear();
      await this.persistApprovalSnapshots();
    }
  }

  async assess(toolName: string, input: unknown): Promise<LocalExecutionAssessment> {
    const operation = operationForTool(toolName);
    if (operation === "run_command") return this.assessCommand(input, "local");
    if (operation === "apply_patch") {
      const parsed = parsePatchInput(input);
      const resolved = await Promise.all(
        parsed
          .flatMap((item) => [item.path, ...(item.moveTo ? [item.moveTo] : [])])
          .map((filePath) => this.resolveTarget(filePath, true)),
      );
      const paths = [...new Set(resolved.map((item) => item.path))];
      const sensitive = paths.some((item) => isSensitivePath(item, this.options.workspaceRoot));
      return {
        operation,
        decision: "require_review",
        risk: sensitive ? "sensitive_path" : "write",
        reason: sensitive
          ? "The patch changes a sensitive or out-of-workspace path."
          : "The patch modifies local files.",
        paths,
      };
    }
    const value = requireObject(input);
    const target = await this.resolveTarget(value.path, operation !== "read_file");
    const sensitive = isSensitivePath(target.path, this.options.workspaceRoot);
    const readOnly = operation === "read_file";
    return {
      operation,
      decision: readOnly && !sensitive ? "allow" : "require_review",
      risk: sensitive ? "sensitive_path" : readOnly ? "read_only" : "write",
      reason: sensitive
        ? "The file is in a sensitive or out-of-workspace location."
        : readOnly
          ? "Reading a local text file."
          : "The operation modifies a local file.",
      paths: [target.path],
    };
  }

  async assessWorkspaceCommand(input: unknown): Promise<LocalExecutionAssessment> {
    return this.assessCommand(input, "conversation_workspace");
  }

  private async assessCommand(
    input: unknown,
    scope: "local" | "conversation_workspace",
  ): Promise<LocalExecutionAssessment> {
    const policy =
      scope === "local"
        ? evaluateLocalCommandPolicy(input)
        : evaluateWorkspaceCommandPolicy(input, {
            allowedArgumentRoots: [this.options.workspaceRoot],
            allowedExecutableRoots: [this.options.workspaceRoot],
          });
    const operation: LocalExecutionOperation = "run_command";
    if (policy.decision === "deny") {
      return {
        operation,
        decision: "deny",
        risk: policy.risk,
        reason: policy.reason,
        paths: [],
        scope,
      };
    }
    const normalized = normalizeWorkspaceCommandInput(input);
    const requestedCwd =
      scope === "local"
        ? normalized.cwd
          ? path.resolve(this.options.cwd, normalized.cwd)
          : this.options.cwd
        : normalized.cwd
          ? path.resolve(this.workspaceCwd, normalized.cwd)
          : this.workspaceCwd;
    const canonicalCwd = await realpath(requestedCwd);
    if (!(await stat(canonicalCwd)).isDirectory()) {
      throw new LocalExecutionError(
        "INVALID_PATH",
        "Command cwd must be a directory.",
        false,
        requestedCwd,
      );
    }
    if (
      scope === "conversation_workspace" &&
      !isPathWithin(this.options.workspaceRoot, canonicalCwd)
    ) {
      throw new LocalExecutionError(
        "INVALID_PATH",
        "Workspace command cwd must remain inside the conversation workspace.",
        false,
        canonicalCwd,
      );
    }
    if (scope === "conversation_workspace" && looksLikePath(normalized.executable)) {
      const executable = resolveExecutable(canonicalCwd, normalized.executable);
      const canonicalExecutable = await realpath(executable).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return executable;
        throw error;
      });
      if (!isPathWithin(this.options.workspaceRoot, canonicalExecutable)) {
        throw new LocalExecutionError(
          "INVALID_PATH",
          "Workspace command executable must remain inside the conversation workspace.",
          false,
          canonicalExecutable,
        );
      }
    }
    const paths = await this.commandPaths(normalized, canonicalCwd);
    const sensitive = paths.some((item) => isSensitivePath(item, this.options.workspaceRoot));
    return {
      operation,
      decision: policy.decision,
      risk: sensitive ? "sensitive_path" : policy.risk,
      reason: sensitive
        ? "The command targets a sensitive or out-of-workspace path."
        : policy.reason,
      paths,
      scope,
    };
  }

  async resolveToolApproval(
    toolCallId: string,
    assessment: LocalExecutionAssessment,
    input: unknown,
    requiresReview: boolean,
  ): Promise<ApprovalResolution> {
    const previous = this.approvalSnapshots.get(toolCallId);
    if (previous) {
      const current = await this.approvalFingerprint(assessment, input);
      if (current !== previous.fingerprint) {
        this.approvalSnapshots.delete(toolCallId);
        await this.persistApprovalSnapshots();
        return "changed";
      }
      previous.phase = "approved";
      await this.persistApprovalSnapshots();
      return "approved";
    }
    if (!requiresReview) return "not_required";
    this.approvalSnapshots.set(toolCallId, {
      phase: "pending",
      fingerprint: await this.approvalFingerprint(assessment, input),
    });
    await this.persistApprovalSnapshots();
    return "requested";
  }

  async validateApprovalBeforeExecution(
    toolCallId: string,
    assessment: LocalExecutionAssessment | undefined,
    input: unknown,
    requiresReview: boolean,
  ): Promise<boolean> {
    const snapshot = this.approvalSnapshots.get(toolCallId);
    if (!snapshot) return !requiresReview;
    this.approvalSnapshots.delete(toolCallId);
    await this.persistApprovalSnapshots();
    if (snapshot.phase !== "approved" || !assessment) return false;
    return (await this.approvalFingerprint(assessment, input)) === snapshot.fingerprint;
  }

  async runCommand(
    input: LocalRunCommandInput,
    signal: AbortSignal,
    scope: "local" | "conversation_workspace" = "local",
  ): Promise<LocalExecutionResult<LocalCommandResultData>> {
    const operation: LocalExecutionOperation = "run_command";
    let normalized: NormalizedWorkspaceCommandInput;
    try {
      normalized = normalizeWorkspaceCommandInput(input);
    } catch (error) {
      return toFailure(operation, error, "INVALID_INPUT");
    }
    const policy =
      scope === "local"
        ? evaluateLocalCommandPolicy(input)
        : evaluateWorkspaceCommandPolicy(input, {
            allowedArgumentRoots: [this.options.workspaceRoot],
            allowedExecutableRoots: [this.options.workspaceRoot],
          });
    if (policy.decision === "deny") return failure(operation, "INVALID_INPUT", policy.reason);
    try {
      const currentCwd = scope === "local" ? this.options.cwd : this.workspaceCwd;
      const requestedCwd = normalized.cwd ? path.resolve(currentCwd, normalized.cwd) : currentCwd;
      const canonicalCwd = await realpath(requestedCwd);
      if (!(await stat(canonicalCwd)).isDirectory()) {
        throw new LocalExecutionError(
          "INVALID_PATH",
          "Command cwd must be a directory.",
          false,
          requestedCwd,
        );
      }
      if (
        scope === "conversation_workspace" &&
        !isPathWithin(this.options.workspaceRoot, canonicalCwd)
      ) {
        throw new LocalExecutionError(
          "INVALID_PATH",
          "Workspace command cwd must remain inside the conversation workspace.",
          false,
          canonicalCwd,
        );
      }
      let executable = resolveExecutable(canonicalCwd, normalized.executable);
      if (scope === "conversation_workspace" && looksLikePath(normalized.executable)) {
        const canonicalExecutable = await realpath(executable).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return executable;
          throw error;
        });
        if (!isPathWithin(this.options.workspaceRoot, canonicalExecutable)) {
          throw new LocalExecutionError(
            "INVALID_PATH",
            "Workspace command executable must remain inside the conversation workspace.",
            false,
            canonicalExecutable,
          );
        }
        executable = canonicalExecutable;
      }
      const sensitivePaths = await this.commandPaths(normalized, canonicalCwd);
      const sensitive = sensitivePaths.some((item) =>
        isSensitivePath(item, this.options.workspaceRoot),
      );
      const risk: LocalExecutionRisk = sensitive ? "sensitive_path" : policy.risk;
      if (signal.aborted) {
        return failure(
          operation,
          "CANCELLED",
          "Command execution was cancelled.",
          canonicalCwd,
          false,
        );
      }
      const command = await runStructuredCommandProcess({
        input: normalized,
        executable,
        cwd: canonicalCwd,
        displayCwd:
          scope === "local"
            ? canonicalCwd
            : path.relative(this.options.workspaceRoot, canonicalCwd) || ".",
        risk: risk === "sensitive_path" ? "unknown" : risk,
        signal,
        activeProcesses: this.activeProcesses,
      });
      if (command.outcome === "completed") {
        if (scope === "local") {
          this.options.cwd = canonicalCwd;
          await this.options.persistCwd(canonicalCwd);
        } else {
          this.options.workspaceCwd = canonicalCwd;
          await this.options.persistWorkspaceCwd?.(
            path.relative(this.options.workspaceRoot, canonicalCwd) || ".",
          );
        }
      }
      const data = { ...command, risk };
      if (command.outcome === "cancelled") {
        return failure(
          operation,
          "CANCELLED",
          "Command execution was cancelled.",
          canonicalCwd,
          true,
          data,
        );
      }
      if (command.outcome === "timed_out") {
        return failure(
          operation,
          "TIMED_OUT",
          "Command execution exceeded its time limit.",
          canonicalCwd,
          true,
          data,
        );
      }
      if (command.outcome === "failed_to_start") {
        const code = command.error?.includes("ENOENT") ? "COMMAND_NOT_FOUND" : "COMMAND_FAILED";
        return failure(
          operation,
          code,
          command.error ?? "Command could not be started.",
          canonicalCwd,
          code === "COMMAND_NOT_FOUND",
          data,
        );
      }
      return success(operation, data);
    } catch (error) {
      return toFailure(operation, error, "RUNTIME_ERROR");
    }
  }

  async readFile(input: LocalReadFileInput): Promise<LocalExecutionResult<LocalReadFileData>> {
    const operation: LocalExecutionOperation = "read_file";
    try {
      const value = validateReadInput(input);
      const target = await this.resolveTarget(value.path, false);
      const fileInfo = await stat(target.path);
      if (fileInfo.size > MAX_LOCAL_READ_SOURCE_BYTES) {
        throw new LocalExecutionError(
          "SIZE_LIMIT",
          "Source file exceeds the local read limit.",
          false,
          target.path,
        );
      }
      const bytes = await readFile(target.path);
      if (bytes.byteLength > MAX_LOCAL_READ_SOURCE_BYTES) {
        throw new LocalExecutionError(
          "SIZE_LIMIT",
          "Source file exceeds the local read limit.",
          false,
          target.path,
        );
      }
      const text = decodeUtf8(bytes, target.path);
      const allLines = splitLines(text);
      const startLine = value.startLine ?? 1;
      const endLine = value.endLine ?? allLines.lines.length;
      if (startLine > Math.max(1, allLines.lines.length)) {
        throw new LocalExecutionError(
          "INVALID_INPUT",
          "startLine is past the end of the file.",
          false,
          target.path,
        );
      }
      const selectedLines = allLines.lines.slice(startLine - 1, endLine);
      let content = selectedLines.join(allLines.eol);
      if (endLine < allLines.lines.length || allLines.trailingNewline) content += allLines.eol;
      const limit = value.maxBytes ?? DEFAULT_LOCAL_READ_BYTES;
      const truncatedContent = truncateUtf8(content, limit);
      const truncated = truncatedContent !== content;
      const returnedLineCount = countLines(truncatedContent);
      return success(operation, {
        path: target.path,
        content: truncatedContent,
        startLine,
        endLine: Math.min(endLine, startLine + returnedLineCount - 1),
        totalLines: allLines.lines.length,
        returnedLines: returnedLineCount,
        bytes: bytes.byteLength,
        returnedBytes: Buffer.byteLength(truncatedContent, "utf8"),
        truncated,
        sha256: sha256(Buffer.from(truncatedContent, "utf8")),
      });
    } catch (error) {
      return toFailure(operation, error);
    }
  }

  async writeFile(
    input: LocalWriteFileInput,
  ): Promise<LocalExecutionResult<Record<string, unknown>>> {
    const operation: LocalExecutionOperation = "write_file";
    try {
      const value = validateWriteInput(input);
      const target = await this.resolveTarget(value.path, true);
      return await this.withMutationLocks([target.path], async () => {
        const current = await this.readCurrentTarget(target.path);
        verifyExpectedHash(current, value.expectedHash, target.path);
        const beforeText = current ? decodeUtf8(current, target.path) : "";
        const eol = current ? splitLines(beforeText).eol : detectPreferredEol(value.content);
        const afterText = normalizeEol(value.content, eol);
        const afterBytes = encodeWithBom(afterText, current);
        this.assertMutationSize(afterBytes.byteLength, target.path);
        await this.atomicReplace(target.path, afterBytes, target.mode);
        return success(
          operation,
          mutationSummary(target.path, beforeText, afterText, current, afterBytes),
        );
      });
    } catch (error) {
      return toFailure(operation, error);
    }
  }

  async editFile(
    input: LocalEditFileInput,
  ): Promise<LocalExecutionResult<Record<string, unknown>>> {
    const operation: LocalExecutionOperation = "edit_file";
    try {
      const value = validateEditInput(input);
      const target = await this.resolveTarget(value.path, false);
      return await this.withMutationLocks([target.path], async () => {
        const current = await this.readCurrentTarget(target.path);
        if (!current)
          throw new LocalExecutionError(
            "PATH_NOT_FOUND",
            "File does not exist.",
            true,
            target.path,
          );
        verifyExpectedHash(current, value.expectedHash, target.path);
        const beforeText = decodeUtf8(current, target.path);
        const eol = splitLines(beforeText).eol;
        const oldText = normalizeEol(value.oldText, eol);
        const newText = normalizeEol(value.newText, eol);
        const matches = countMatches(beforeText, oldText);
        if (matches === 0)
          throw new LocalExecutionError(
            "MATCH_NOT_FOUND",
            "The requested text was not found.",
            true,
            target.path,
          );
        if (!value.replaceAll && matches !== 1) {
          throw new LocalExecutionError(
            "MATCH_AMBIGUOUS",
            `The requested text matched ${matches} locations.`,
            true,
            target.path,
          );
        }
        const afterText = value.replaceAll
          ? beforeText.split(oldText).join(newText)
          : beforeText.replace(oldText, newText);
        const afterBytes = encodeWithBom(afterText, current);
        this.assertMutationSize(afterBytes.byteLength, target.path);
        await this.atomicReplace(target.path, afterBytes, target.mode);
        return success(operation, {
          ...mutationSummary(target.path, beforeText, afterText, current, afterBytes),
          matches,
        });
      });
    } catch (error) {
      return toFailure(operation, error);
    }
  }

  async applyPatch(
    input: LocalApplyPatchInput,
  ): Promise<LocalExecutionResult<Record<string, unknown>>> {
    const operation: LocalExecutionOperation = "apply_patch";
    let parsed: PatchOperation[];
    try {
      parsed = parsePatchInput(input);
    } catch (error) {
      return toFailure(operation, error, "PATCH_INVALID");
    }
    try {
      const sourceAndTarget = parsed.flatMap((item) => [
        item.path,
        ...(item.moveTo ? [item.moveTo] : []),
      ]);
      const resolved = await Promise.all(
        sourceAndTarget.map((item) => this.resolveTarget(item, true)),
      );
      const resolvedByInput = new Map(
        sourceAndTarget.map((item, index) => [item, resolved[index]!]),
      );
      const paths = [...new Set(resolved.map((item) => item.path))];
      if (paths.length > 64)
        throw new LocalExecutionError("SIZE_LIMIT", "A patch may touch at most 64 files.");
      return await this.withMutationLocks(paths, async () => {
        const pending = new Map<string, PendingMutation>();
        const summaries: Array<Record<string, unknown>> = [];
        let totalOutputBytes = 0;

        const canonicalTargets = new Set<string>();
        for (const item of parsed) {
          const source = resolvedByInput.get(item.path)!;
          if (canonicalTargets.has(source.path)) {
            throw new LocalExecutionError(
              "PATCH_INVALID",
              "Multiple patch operations resolve to the same file.",
              false,
              source.path,
            );
          }
          canonicalTargets.add(source.path);
          const original = await this.readCurrentTarget(source.path);
          if (item.kind === "add") {
            if (original)
              throw new LocalExecutionError(
                "PATCH_CONFLICT",
                "Patch add target already exists.",
                true,
                source.path,
              );
            const content = addPatchContent(item.lines);
            const after = Buffer.from(content, "utf8");
            this.assertMutationSize(after.byteLength, source.path);
            pending.set(source.path, {
              path: source.path,
              before: null,
              beforeHash: null,
              after,
              mode: undefined,
            });
            summaries.push(mutationSummary(source.path, "", content, null, after));
            totalOutputBytes += after.byteLength;
            continue;
          }
          if (!original)
            throw new LocalExecutionError(
              "PATCH_CONFLICT",
              "Patch source file does not exist.",
              true,
              source.path,
            );
          if (original.byteLength > MAX_LOCAL_EDIT_FILE_BYTES) {
            throw new LocalExecutionError(
              "SIZE_LIMIT",
              "Patch source file exceeds the edit limit.",
              false,
              source.path,
            );
          }
          const beforeText = decodeUtf8(original, source.path);
          if (item.kind === "delete") {
            pending.set(source.path, {
              path: source.path,
              before: original,
              beforeHash: sha256(original),
              after: null,
              mode: source.mode,
            });
            summaries.push(mutationSummary(source.path, beforeText, "", original, null));
            continue;
          }
          const afterText = applyUpdateHunks(beforeText, item.lines, source.path);
          const afterBytes = encodeWithBom(afterText, original);
          this.assertMutationSize(afterBytes.byteLength, source.path);
          const destination = item.moveTo ? resolvedByInput.get(item.moveTo)! : source;
          if (item.moveTo) {
            if (canonicalTargets.has(destination.path)) {
              throw new LocalExecutionError(
                "PATCH_INVALID",
                "Multiple patch operations resolve to the same file.",
                false,
                destination.path,
              );
            }
            canonicalTargets.add(destination.path);
            if (destination.exists || (await this.readCurrentTarget(destination.path))) {
              throw new LocalExecutionError(
                "PATCH_CONFLICT",
                "Patch move target already exists.",
                true,
                destination.path,
              );
            }
            pending.set(destination.path, {
              path: destination.path,
              before: null,
              beforeHash: null,
              after: afterBytes,
              mode: source.mode,
            });
            pending.set(source.path, {
              path: source.path,
              before: original,
              beforeHash: sha256(original),
              after: null,
              mode: source.mode,
            });
            summaries.push(mutationSummary(destination.path, "", afterText, null, afterBytes));
            summaries.push(mutationSummary(source.path, beforeText, "", original, null));
          } else {
            pending.set(source.path, {
              path: source.path,
              before: original,
              beforeHash: sha256(original),
              after: afterBytes,
              mode: source.mode,
            });
            summaries.push(
              mutationSummary(source.path, beforeText, afterText, original, afterBytes),
            );
          }
          totalOutputBytes += afterBytes.byteLength;
        }

        if (totalOutputBytes > MAX_LOCAL_PATCH_BYTES) {
          throw new LocalExecutionError("SIZE_LIMIT", "Patch output exceeds the patch size limit.");
        }
        validatePatchMutationSet(pending);
        await this.revalidateBeforeCommit(pending);
        await this.stageMutations(pending);
        const committedPaths = new Set<string>();
        try {
          const mutations = [...pending.values()].sort((a, b) => a.path.localeCompare(b.path));
          for (const item of mutations.filter((entry) => entry.after !== null)) {
            await (this.options.renameForCommit ?? rename)(item.tempPath!, item.path);
            item.tempPath = undefined;
            committedPaths.add(item.path);
          }
          for (const item of mutations.filter((entry) => entry.after === null)) {
            await rm(item.path, { force: true });
            committedPaths.add(item.path);
          }
        } catch (error) {
          const affected = await this.rollbackMutations(pending, committedPaths);
          if (affected.length > 0) {
            throw new LocalExecutionError(
              "PARTIAL_COMMIT",
              "Patch commit failed and rollback could not restore every affected file.",
              false,
              undefined,
              { affectedPaths: affected },
            );
          }
          throw mapFsError(error, "PATCH_CONFLICT");
        } finally {
          await this.cleanupStaged(pending);
        }
        return success(operation, {
          paths: [...pending.keys()],
          files: summaries,
          addedLines: summaries.reduce((sum, item) => sum + Number(item.addedLines ?? 0), 0),
          removedLines: summaries.reduce((sum, item) => sum + Number(item.removedLines ?? 0), 0),
          diffPreview: capDiffPreview(
            summaries.map((item) => String(item.diffPreview ?? "")).join("\n"),
          ),
          bytes: totalOutputBytes,
        });
      });
    } catch (error) {
      return toFailure(operation, error, "PATCH_CONFLICT");
    }
  }

  private async commandPaths(
    input: NormalizedWorkspaceCommandInput,
    cwd = this.options.cwd,
  ): Promise<string[]> {
    const candidates: string[] = [cwd];
    if (looksLikePath(input.executable)) candidates.push(resolveExecutable(cwd, input.executable));
    for (const value of input.args) {
      if (looksLikePath(value)) candidates.push(path.resolve(cwd, value));
    }
    const resolved = await Promise.all(
      [...new Set(candidates.map((item) => path.resolve(item)))].map(async (item) =>
        realpath(item).catch(() => item),
      ),
    );
    return [...new Set(resolved)];
  }

  private async approvalFingerprint(
    assessment: LocalExecutionAssessment,
    input: unknown,
  ): Promise<string> {
    const paths = [...new Set(assessment.paths)].sort();
    const states = await Promise.all(
      paths.map(async (filePath) => [filePath, await readPathState(filePath)] as const),
    );
    const serialized = JSON.stringify({
      operation: assessment.operation,
      risk: assessment.risk,
      scope: assessment.scope,
      paths,
      states,
      input: normalizeFingerprintValue(input),
    });
    return sha256(Buffer.from(serialized, "utf8"));
  }

  private async persistApprovalSnapshots(): Promise<void> {
    await this.options.persistApprovalSnapshots?.(Object.fromEntries(this.approvalSnapshots));
  }

  private async resolveTarget(rawPath: unknown, allowMissing: boolean): Promise<TargetPath> {
    if (
      typeof rawPath !== "string" ||
      !rawPath.trim() ||
      rawPath.length > MAX_LOCAL_PATH_LENGTH ||
      rawPath.includes("\0")
    ) {
      throw new LocalExecutionError("INVALID_PATH", "A valid local file path is required.");
    }
    const candidate = path.resolve(this.options.cwd, rawPath);
    try {
      const info = await lstat(candidate);
      let canonical: string;
      try {
        canonical = await realpath(candidate);
      } catch (error) {
        throw mapFsError(error, "PATH_NOT_FOUND", candidate);
      }
      const targetInfo = await stat(canonical);
      if (!targetInfo.isFile())
        throw new LocalExecutionError(
          "NOT_A_FILE",
          "The target is not a regular file.",
          false,
          canonical,
        );
      return { path: canonical, exists: true, mode: info.mode & 0o777 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT")
        throw mapFsError(error, "PATH_NOT_FOUND", candidate);
      if (!allowMissing)
        throw new LocalExecutionError("PATH_NOT_FOUND", "File does not exist.", true, candidate);
    }

    let ancestor = candidate;
    const remaining: string[] = [];
    let canonicalParent = "";
    for (;;) {
      try {
        canonicalParent = await realpath(ancestor);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT" && code !== "ENOTDIR")
          throw mapFsError(error, "INVALID_PATH", candidate);
        const parent = path.dirname(ancestor);
        if (parent === ancestor)
          throw new LocalExecutionError(
            "INVALID_PATH",
            "Could not resolve a parent directory.",
            false,
            candidate,
          );
        remaining.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
    if (!(await stat(canonicalParent)).isDirectory()) {
      throw new LocalExecutionError(
        "INVALID_PATH",
        "The nearest existing parent is not a directory.",
        false,
        canonicalParent,
      );
    }
    if (remaining.length === 0)
      throw new LocalExecutionError(
        "NOT_A_FILE",
        "The target is not a regular file.",
        false,
        candidate,
      );
    if (!allowMissing)
      throw new LocalExecutionError("PATH_NOT_FOUND", "File does not exist.", true, candidate);
    return { path: path.join(canonicalParent, ...remaining), exists: false };
  }

  private async readCurrentTarget(targetPath: string): Promise<Buffer | null> {
    try {
      const info = await lstat(targetPath);
      if (info.isSymbolicLink()) {
        const real = await realpath(targetPath);
        if (path.resolve(real) !== path.resolve(targetPath)) {
          throw new LocalExecutionError(
            "PATCH_CONFLICT",
            "Target path changed while the operation was running.",
            true,
            targetPath,
          );
        }
      }
      const targetInfo = await stat(targetPath);
      if (!targetInfo.isFile())
        throw new LocalExecutionError(
          "NOT_A_FILE",
          "The target is not a regular file.",
          false,
          targetPath,
        );
      return await readFile(targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw mapFsError(error, "PATH_NOT_FOUND", targetPath);
    }
  }

  private async atomicReplace(targetPath: string, bytes: Buffer, mode?: number): Promise<void> {
    const parent = path.dirname(targetPath);
    const parentInfo = await stat(parent).catch((error) => {
      throw mapFsError(error, "PATH_NOT_FOUND", parent);
    });
    if (!parentInfo.isDirectory())
      throw new LocalExecutionError(
        "INVALID_PATH",
        "Parent path is not a directory.",
        false,
        parent,
      );
    const tempPath = path.join(parent, `.ayaka-${randomUUID()}.tmp`);
    try {
      await writeFile(tempPath, bytes, { flag: "wx", ...(mode !== undefined ? { mode } : {}) });
      const currentReal = await realpath(targetPath).catch(() => targetPath);
      if (path.resolve(currentReal) !== path.resolve(targetPath)) {
        throw new LocalExecutionError(
          "PATCH_CONFLICT",
          "Target path changed before replacement.",
          true,
          targetPath,
        );
      }
      await rename(tempPath, targetPath);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw mapFsError(error, "ACCESS_DENIED", targetPath);
    }
  }

  private assertMutationSize(byteLength: number, targetPath: string): void {
    if (byteLength > MAX_LOCAL_EDIT_FILE_BYTES) {
      throw new LocalExecutionError(
        "SIZE_LIMIT",
        "Edited files may not exceed 1 MiB.",
        false,
        targetPath,
      );
    }
  }

  private async withMutationLocks<T>(paths: string[], action: () => Promise<T>): Promise<T> {
    const releases: Array<() => void> = [];
    const keys = [...new Set(paths)].sort((a, b) =>
      lockKey(this.options.runId, a).localeCompare(lockKey(this.options.runId, b)),
    );
    try {
      for (const item of keys)
        releases.push(await acquireMutationLock(lockKey(this.options.runId, item)));
      return await action();
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  private async revalidateBeforeCommit(pending: Map<string, PendingMutation>): Promise<void> {
    for (const item of pending.values()) {
      const now = await this.readCurrentTarget(item.path);
      if (item.before === null) {
        if (now)
          throw new LocalExecutionError(
            "PATCH_CONFLICT",
            "A patch target appeared before commit.",
            true,
            item.path,
          );
      } else if (!now || sha256(now) !== item.beforeHash) {
        throw new LocalExecutionError(
          "PATCH_CONFLICT",
          "A patch target changed before commit.",
          true,
          item.path,
        );
      }
    }
  }

  private async stageMutations(pending: Map<string, PendingMutation>): Promise<void> {
    try {
      for (const item of pending.values()) {
        if (item.after === null) continue;
        const parent = path.dirname(item.path);
        const parentInfo = await stat(parent).catch((error) => {
          throw mapFsError(error, "PATH_NOT_FOUND", parent);
        });
        if (!parentInfo.isDirectory())
          throw new LocalExecutionError(
            "INVALID_PATH",
            "Patch parent path is not a directory.",
            false,
            parent,
          );
        item.tempPath = path.join(parent, `.ayaka-${randomUUID()}.tmp`);
        await writeFile(item.tempPath, item.after, {
          flag: "wx",
          ...(item.mode !== undefined ? { mode: item.mode } : {}),
        });
      }
    } catch (error) {
      await this.cleanupStaged(pending);
      throw error;
    }
  }

  private async rollbackMutations(
    pending: Map<string, PendingMutation>,
    committedPaths: Set<string>,
  ): Promise<string[]> {
    const failed: string[] = [];
    for (const item of [...pending.values()]
      .filter((entry) => committedPaths.has(entry.path))
      .reverse()) {
      try {
        if (item.before === null) {
          await rm(item.path, { force: true });
        } else {
          await this.atomicReplace(item.path, item.before, item.mode);
        }
      } catch {
        failed.push(item.path);
      }
    }
    return failed;
  }

  private async cleanupStaged(pending: Map<string, PendingMutation>): Promise<void> {
    await Promise.all(
      [...pending.values()]
        .map((item) => item.tempPath)
        .filter((item): item is string => !!item)
        .map((item) => rm(item, { force: true }).catch(() => undefined)),
    );
  }
}

function operationForTool(toolName: string): LocalExecutionOperation {
  switch (toolName) {
    case LOCAL_RUN_COMMAND_TOOL_ID:
      return "run_command";
    case LOCAL_READ_FILE_TOOL_ID:
      return "read_file";
    case LOCAL_WRITE_FILE_TOOL_ID:
      return "write_file";
    case LOCAL_EDIT_FILE_TOOL_ID:
      return "edit_file";
    case LOCAL_APPLY_PATCH_TOOL_ID:
      return "apply_patch";
    default:
      throw new LocalExecutionError("INVALID_INPUT", "Unsupported local execution tool.");
  }
}

function parsePatchInput(input: unknown): PatchOperation[] {
  const value = requireObject(input);
  if (typeof value.patch !== "string" || !value.patch.trim()) {
    throw new LocalExecutionError("PATCH_INVALID", "Patch text is required.");
  }
  if (Buffer.byteLength(value.patch, "utf8") > MAX_LOCAL_PATCH_BYTES) {
    throw new LocalExecutionError("SIZE_LIMIT", "Patch input exceeds 256 KiB.");
  }
  const lines = value.patch.replace(/\r\n/g, "\n").split("\n");
  while (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "*** Begin Patch" || lines.at(-1) !== "*** End Patch") {
    throw new LocalExecutionError(
      "PATCH_INVALID",
      "Patch must include Begin Patch and End Patch markers.",
    );
  }
  const operations: PatchOperation[] = [];
  let index = 1;
  while (index < lines.length - 1) {
    const header = lines[index++]!;
    const match = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(header);
    if (!match)
      throw new LocalExecutionError("PATCH_INVALID", `Unexpected patch directive: ${header}`);
    const kind = match[1]!.toLowerCase() as PatchOperation["kind"];
    const operation: PatchOperation = { kind, path: match[2]!.trim(), lines: [] };
    if (!operation.path)
      throw new LocalExecutionError("PATCH_INVALID", "Patch paths cannot be empty.");
    if (kind === "update" && lines[index]?.startsWith("*** Move to: ")) {
      operation.moveTo = lines[index++]!.slice("*** Move to: ".length).trim();
      if (!operation.moveTo)
        throw new LocalExecutionError("PATCH_INVALID", "Move destination cannot be empty.");
    }
    while (index < lines.length - 1 && !lines[index]!.startsWith("*** ")) {
      operation.lines.push(lines[index++]!);
    }
    while (kind === "update" && lines[index] === "*** End of File") {
      index += 1;
    }
    if (kind === "delete" && operation.lines.length > 0) {
      throw new LocalExecutionError("PATCH_INVALID", "Delete operations cannot contain hunks.");
    }
    if (kind === "update" && operation.lines.length === 0) {
      throw new LocalExecutionError(
        "PATCH_INVALID",
        "Update operations require at least one hunk.",
      );
    }
    if (kind === "add" && operation.lines.some((line) => !line.startsWith("+"))) {
      throw new LocalExecutionError("PATCH_INVALID", "Added file lines must start with '+'.");
    }
    operations.push(operation);
  }
  if (operations.length === 0 || operations.length > 64) {
    throw new LocalExecutionError(
      "PATCH_INVALID",
      "Patch must contain between 1 and 64 file operations.",
    );
  }
  const names = operations.flatMap((item) => [item.path, ...(item.moveTo ? [item.moveTo] : [])]);
  if (new Set(names).size !== names.length) {
    throw new LocalExecutionError(
      "PATCH_INVALID",
      "A patch cannot target the same path more than once.",
    );
  }
  return operations;
}

function parseHunks(lines: string[], filePath: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = lines[index++]!;
    const match = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(header);
    if (!header.startsWith("@@"))
      throw new LocalExecutionError("PATCH_INVALID", `Expected hunk header in ${filePath}.`);
    const hunk: PatchHunk = {
      ...(match ? { oldStart: Number(match[1]), oldCount: Number(match[2] ?? 1) } : {}),
      lines: [],
    };
    while (index < lines.length && !lines[index]!.startsWith("@@")) {
      const line = lines[index++]!;
      if (line === "\\ No newline at end of file") continue;
      if (!line.startsWith(" ") && !line.startsWith("+") && !line.startsWith("-")) {
        throw new LocalExecutionError("PATCH_INVALID", `Invalid hunk line in ${filePath}.`);
      }
      hunk.lines.push(line);
    }
    hunks.push(hunk);
  }
  return hunks;
}

function applyUpdateHunks(text: string, patchLines: string[], filePath: string): string {
  const original = splitLines(text);
  let lines = [...original.lines];
  const hunks = parseHunks(patchLines, filePath);
  if (hunks.length === 0)
    throw new LocalExecutionError("PATCH_INVALID", `No hunks found for ${filePath}.`);
  for (const hunk of hunks) {
    const oldLines = hunk.lines
      .filter((line) => !line.startsWith("+"))
      .map((line) => line.slice(1));
    const newLines = hunk.lines
      .filter((line) => !line.startsWith("-"))
      .map((line) => line.slice(1));
    let start: number;
    if (oldLines.length > 0) {
      const matches = findLineSequence(lines, oldLines);
      if (matches.length === 0)
        throw new LocalExecutionError(
          "PATCH_CONFLICT",
          `Patch context did not match ${filePath}.`,
          true,
          filePath,
        );
      if (matches.length > 1)
        throw new LocalExecutionError(
          "PATCH_CONFLICT",
          `Patch context is ambiguous in ${filePath}.`,
          true,
          filePath,
        );
      start = matches[0]!;
    } else if (hunk.oldStart !== undefined) {
      start = hunk.oldCount === 0 ? hunk.oldStart : hunk.oldStart - 1;
      if (start < 0 || start > lines.length)
        throw new LocalExecutionError(
          "PATCH_CONFLICT",
          `Patch insertion point is outside ${filePath}.`,
          true,
          filePath,
        );
    } else {
      throw new LocalExecutionError(
        "PATCH_INVALID",
        `An insertion-only hunk in ${filePath} needs line numbers.`,
        false,
        filePath,
      );
    }
    lines.splice(start, oldLines.length, ...newLines);
  }
  let result = lines.join(original.eol);
  if (original.trailingNewline && lines.length > 0) result += original.eol;
  return result;
}

function findLineSequence(source: string[], pattern: string[]): number[] {
  if (pattern.length === 0) return [];
  const matches: number[] = [];
  for (let start = 0; start <= source.length - pattern.length; start += 1) {
    if (pattern.every((line, offset) => source[start + offset] === line)) matches.push(start);
  }
  return matches;
}

function addPatchContent(lines: string[]): string {
  const content = lines.map((line) => line.slice(1)).join("\n");
  return lines.length > 0 ? content + "\n" : "";
}

function validatePatchMutationSet(pending: Map<string, PendingMutation>): void {
  for (const item of pending.values()) {
    if (item.path === path.dirname(item.path)) {
      throw new LocalExecutionError(
        "INVALID_PATH",
        "A patch target must be a file path.",
        false,
        item.path,
      );
    }
    if (item.after !== null && item.before !== null && item.beforeHash === null) {
      throw new LocalExecutionError("RUNTIME_ERROR", "Patch state is incomplete.");
    }
  }
}

function validateReadInput(input: unknown): LocalReadFileInput {
  const value = requireObject(input);
  if (typeof value.path !== "string")
    throw new LocalExecutionError("INVALID_INPUT", "path must be a string.");
  const startLine = optionalInteger(value.startLine, "startLine", 1, Number.MAX_SAFE_INTEGER);
  const endLine = optionalInteger(value.endLine, "endLine", 1, Number.MAX_SAFE_INTEGER);
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    throw new LocalExecutionError(
      "INVALID_INPUT",
      "endLine must be greater than or equal to startLine.",
    );
  }
  const maxBytes = optionalInteger(value.maxBytes, "maxBytes", 1, MAX_LOCAL_READ_BYTES);
  return {
    path: value.path,
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
  };
}

function validateWriteInput(input: unknown): LocalWriteFileInput {
  const value = requireObject(input);
  if (typeof value.path !== "string" || typeof value.content !== "string") {
    throw new LocalExecutionError("INVALID_INPUT", "path and content must be strings.");
  }
  if (Buffer.byteLength(value.content, "utf8") > MAX_LOCAL_EDIT_FILE_BYTES) {
    throw new LocalExecutionError("SIZE_LIMIT", "File content exceeds 1 MiB.");
  }
  return {
    path: value.path,
    content: value.content,
    expectedHash: optionalHash(value.expectedHash),
  };
}

function validateEditInput(input: unknown): LocalEditFileInput {
  const value = requireObject(input);
  if (
    typeof value.path !== "string" ||
    typeof value.oldText !== "string" ||
    typeof value.newText !== "string" ||
    !value.oldText
  ) {
    throw new LocalExecutionError(
      "INVALID_INPUT",
      "path, oldText, and newText are required strings; oldText cannot be empty.",
    );
  }
  if (typeof value.replaceAll !== "undefined" && typeof value.replaceAll !== "boolean") {
    throw new LocalExecutionError("INVALID_INPUT", "replaceAll must be a boolean.");
  }
  if (
    Buffer.byteLength(value.oldText, "utf8") > MAX_LOCAL_EDIT_FILE_BYTES ||
    Buffer.byteLength(value.newText, "utf8") > MAX_LOCAL_EDIT_FILE_BYTES
  ) {
    throw new LocalExecutionError("SIZE_LIMIT", "Edit text exceeds 1 MiB.");
  }
  return {
    path: value.path,
    oldText: value.oldText,
    newText: value.newText,
    ...(typeof value.replaceAll === "boolean" ? { replaceAll: value.replaceAll } : {}),
    expectedHash: optionalHash(value.expectedHash),
  };
}

function optionalHash(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new LocalExecutionError("INVALID_INPUT", "expectedHash must be a SHA-256 hex digest.");
  }
  return value.toLowerCase();
}

function optionalInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new LocalExecutionError(
      "INVALID_INPUT",
      `${name} must be an integer between ${min} and ${max}.`,
    );
  }
  return value;
}

function requireObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new LocalExecutionError("INVALID_INPUT", "Tool input must be an object.");
  }
  return input as Record<string, unknown>;
}

function success<T>(operation: LocalExecutionOperation, data: T): LocalExecutionResult<T> {
  return { ok: true, operation, data };
}

function failure(
  operation: LocalExecutionOperation,
  code: LocalExecutionErrorCode,
  message: string,
  targetPath?: string,
  retryable = false,
  partialResult?: unknown,
): LocalFailure {
  return {
    ok: false,
    operation,
    error: {
      code,
      ...(targetPath ? { path: targetPath } : {}),
      retryable,
      message: redactWorkspaceCommandText(message),
    },
    ...(partialResult !== undefined ? { partialResult } : {}),
  };
}

function toFailure(
  operation: LocalExecutionOperation,
  error: unknown,
  fallback: LocalExecutionErrorCode = "RUNTIME_ERROR",
): LocalFailure {
  if (error instanceof LocalExecutionError) {
    return failure(
      operation,
      error.code,
      error.message,
      error.path,
      error.retryable,
      error.partialResult,
    );
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT")
      return failure(
        operation,
        "PATH_NOT_FOUND",
        "The requested path does not exist.",
        undefined,
        true,
      );
    if (code === "EACCES" || code === "EPERM")
      return failure(operation, "ACCESS_DENIED", "Permission was denied.");
    if (code === "EISDIR" || code === "ENOTDIR")
      return failure(operation, "NOT_A_FILE", "The target is not a regular file.");
  }
  const safeMessage = error instanceof Error ? error.message : String(error);
  return failure(operation, fallback, redactWorkspaceCommandText(safeMessage));
}

function mapFsError(
  error: unknown,
  fallback: LocalExecutionErrorCode,
  targetPath?: string,
): LocalExecutionError {
  if (error instanceof LocalExecutionError) return error;
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as NodeJS.ErrnoException).code)
      : "";
  if (code === "ENOENT")
    return new LocalExecutionError(
      "PATH_NOT_FOUND",
      "The requested path does not exist.",
      true,
      targetPath,
    );
  if (code === "EACCES" || code === "EPERM")
    return new LocalExecutionError("ACCESS_DENIED", "Permission was denied.", false, targetPath);
  if (code === "EISDIR" || code === "ENOTDIR")
    return new LocalExecutionError(
      "NOT_A_FILE",
      "The target is not a regular file.",
      false,
      targetPath,
    );
  if (code === "EEXIST")
    return new LocalExecutionError(
      "PATCH_CONFLICT",
      "The target already exists.",
      true,
      targetPath,
    );
  return new LocalExecutionError(
    fallback,
    error instanceof Error ? error.message : String(error),
    fallback === "PATCH_CONFLICT",
    targetPath,
  );
}

function decodeUtf8(bytes: Buffer, filePath: string): string {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
  } catch {
    throw new LocalExecutionError(
      "UNSUPPORTED_ENCODING",
      "Only valid UTF-8 text files are supported.",
      false,
      filePath,
    );
  }
}

function encodeWithBom(text: string, current: Buffer | null): Buffer {
  const data = Buffer.from(text, "utf8");
  return current &&
    current.length >= 3 &&
    current[0] === 0xef &&
    current[1] === 0xbb &&
    current[2] === 0xbf
    ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), data])
    : data;
}

function splitLines(text: string): { lines: string[]; eol: string; trailingNewline: boolean } {
  const eol = detectPreferredEol(text);
  const trailingNewline = text.endsWith("\n");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (trailingNewline) lines.pop();
  return { lines, eol, trailingNewline };
}

function detectPreferredEol(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeEol(text: string, eol: string): string {
  return text.replace(/\r\n|\r|\n/g, "\n").replace(/\n/g, eol);
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let result = "";
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

function countMatches(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  while ((index = text.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

function verifyExpectedHash(
  current: Buffer | null,
  expectedHash: string | undefined,
  targetPath: string,
): void {
  if (expectedHash === undefined) return;
  if (!current || sha256(Buffer.from(decodeUtf8(current, targetPath), "utf8")) !== expectedHash) {
    throw new LocalExecutionError(
      "HASH_CONFLICT",
      "File changed since it was last read.",
      true,
      targetPath,
    );
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function readPathState(targetPath: string): Promise<string> {
  try {
    const info = await stat(targetPath);
    if (info.isFile()) {
      if (info.size > MAX_LOCAL_READ_SOURCE_BYTES) {
        return `large-file:${info.size}:${info.mtimeMs}:${info.ino}`;
      }
      return `file:${sha256(await readFile(targetPath))}`;
    }
    if (info.isDirectory()) return `directory:${info.dev}:${info.ino}:${info.mtimeMs}`;
    return `other:${info.dev}:${info.ino}:${info.mode}:${info.mtimeMs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "missing";
    throw mapFsError(error, "ACCESS_DENIED", targetPath);
  }
}

function mutationSummary(
  targetPath: string,
  before: string,
  after: string,
  beforeBytes: Buffer | null,
  afterBytes: Buffer | null,
): Record<string, unknown> {
  const beforeLines = splitLines(before).lines;
  const afterLines = splitLines(after).lines;
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  )
    suffix += 1;
  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  const diff = [
    `--- ${targetPath}`,
    `+++ ${targetPath}`,
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...removed.map((line) => `-${line}`),
    ...added.map((line) => `+${line}`),
  ].join("\n");
  return {
    path: targetPath,
    beforeBytes: beforeBytes?.byteLength ?? 0,
    afterBytes: afterBytes?.byteLength ?? 0,
    beforeLines: beforeLines.length,
    afterLines: afterLines.length,
    beforeSha256: beforeBytes ? sha256(beforeBytes) : null,
    afterSha256: afterBytes ? sha256(afterBytes) : null,
    addedLines: added.length,
    removedLines: removed.length,
    diffPreview: capDiffPreview(diff),
  };
}

function capDiffPreview(value: string): string {
  return truncateUtf8(value, 16 * 1024);
}

function resolveExecutable(cwd: string, executable: string): string {
  if (path.isAbsolute(executable)) return executable;
  if (executable.startsWith(".") || executable.includes("/") || executable.includes("\\")) {
    return path.resolve(cwd, executable);
  }
  return executable;
}

function looksLikePath(value: string): boolean {
  return (
    path.isAbsolute(value) || value.startsWith(".") || value.includes("/") || value.includes("\\")
  );
}

function isSensitivePath(filePath: string, workspaceRoot: string): boolean {
  const normalized = path.resolve(filePath);
  const relative = path.relative(path.resolve(workspaceRoot), normalized);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
    return true;
  const parts = normalized.split(/[\\/]+/).filter(Boolean);
  return parts.some((part) => {
    const lower = part.toLowerCase();
    return (
      /^\.env(?:\..*)?$/.test(lower) ||
      [
        ".ssh",
        ".gnupg",
        ".aws",
        ".azure",
        ".npm",
        ".config",
        "appdata",
        "programdata",
        "system32",
        "windows",
        "etc",
        "keychains",
      ].includes(lower) ||
      [
        ".npmrc",
        ".pypirc",
        "credentials",
        "credentials.json",
        "secrets.json",
        "id_rsa",
        "id_ed25519",
      ].includes(lower) ||
      /^id_.+/.test(lower)
    );
  });
}

function readPersistedLocalCwd(metadataJson: string | undefined): string | undefined {
  const localExecution = readPersistedLocalExecutionMetadata(metadataJson);
  const cwd = localExecution.cwd;
  if (typeof cwd === "string" && path.isAbsolute(cwd)) return cwd;
  return undefined;
}

function readPersistedLocalExecutionMetadata(
  metadataJson: string | undefined,
): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const localExecution = metadata[ENGINE_METADATA_KEY];
    if (localExecution && typeof localExecution === "object") {
      return localExecution as Record<string, unknown>;
    }
  } catch {
    // An invalid optional execution hint starts from the conversation workspace.
  }
  return {};
}

function readPersistedWorkspaceCwd(metadataJson: string | undefined): string {
  if (!metadataJson) return ".";
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const workspaceCommand = metadata.workspaceCommand;
    if (workspaceCommand && typeof workspaceCommand === "object") {
      const cwd = (workspaceCommand as Record<string, unknown>).cwd;
      if (typeof cwd === "string" && cwd.trim() && !path.isAbsolute(cwd)) return cwd;
    }
  } catch {
    // Corrupt optional workspace state starts at the conversation workspace root.
  }
  return ".";
}

async function resolvePersistedWorkspaceCwd(root: string, cwd: string): Promise<string> {
  try {
    const resolved = await realpath(path.resolve(root, cwd));
    if (isPathWithin(root, resolved) && (await stat(resolved)).isDirectory()) return resolved;
  } catch {
    // A missing or inaccessible saved directory falls back to the workspace root.
  }
  return root;
}

function isPathWithin(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative === "" ||
    (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function readPersistedApprovalSnapshots(
  value: unknown,
): Record<string, LocalExecutionApprovalSnapshot> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const snapshots: Record<string, LocalExecutionApprovalSnapshot> = {};
  for (const [toolCallId, raw] of Object.entries(value).slice(0, 128)) {
    if (
      !toolCallId ||
      toolCallId.length > 512 ||
      !raw ||
      typeof raw !== "object" ||
      Array.isArray(raw)
    ) {
      continue;
    }
    const snapshot = raw as Record<string, unknown>;
    if (
      (snapshot.phase !== "pending" && snapshot.phase !== "approved") ||
      typeof snapshot.fingerprint !== "string" ||
      !/^[a-f0-9]{64}$/i.test(snapshot.fingerprint)
    ) {
      continue;
    }
    snapshots[toolCallId] = {
      phase: snapshot.phase,
      fingerprint: snapshot.fingerprint.toLowerCase(),
    };
  }
  return snapshots;
}

function normalizeFingerprintValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeFingerprintValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeFingerprintValue(item)]),
    );
  }
  return value;
}

function lockKey(runId: string, filePath: string): string {
  const normalized = path.resolve(filePath);
  return `${runId}\0${process.platform === "win32" ? normalized.toLowerCase() : normalized}`;
}

async function acquireMutationLock(key: string): Promise<() => void> {
  const previous = mutationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => held);
  mutationLocks.set(key, current);
  await previous;
  return () => {
    release();
    if (mutationLocks.get(key) === current) mutationLocks.delete(key);
  };
}
