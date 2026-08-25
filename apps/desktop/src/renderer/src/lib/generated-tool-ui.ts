import type { TranslationKey } from "./i18n.messages";
import { sanitizeRichContentUrl } from "../components/ai-elements/rich-content-utils";

export type GeneratedToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

export interface RenderableToolPart {
  type: string;
  toolName?: string;
  title?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: {
    id: string;
    isAutomatic?: boolean;
    approved?: boolean;
    reason?: string;
  };
}

export interface ToolSummary {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

export const SILENT_TOOL_NAME = "complete_task";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebOpenResult {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  description?: string;
  text: string;
  truncated: boolean;
}

export interface MemoryResult {
  id: string;
  title: string;
  content: string;
  scope?: string;
  kind?: string;
  salience?: number;
  pinned?: boolean;
}

export interface SandboxArtifactResult {
  id?: string;
  kind?: string;
  path: string;
  url?: string;
  sizeBytes?: number;
  status?: string;
  authorized?: boolean;
}

export type GeneratedAppPreviewMode = "none" | "source" | "html" | "static" | "localhost";

export function getGeneratedAppPreviewMode(input: {
  kind?: string;
  sourceMode?: boolean;
  previewStatus?: string;
  sizeBytes?: number;
  maxHtmlBytes?: number;
}): GeneratedAppPreviewMode {
  if (input.kind !== "html" && input.kind !== "static") return "none";
  if (
    input.sourceMode ||
    (input.kind === "html" &&
      input.sizeBytes !== undefined &&
      input.sizeBytes > (input.maxHtmlBytes ?? 256 * 1024))
  ) {
    return "source";
  }
  if (input.previewStatus === "running") return "localhost";
  return input.kind === "html" ? "html" : "static";
}

export function protectGeneratedHtml(text: string): string {
  const csp =
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
    `script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; ` +
    `font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; ` +
    `frame-src 'none'; base-uri 'none'; form-action 'none';">`;
  if (/<head\b[^>]*>/i.test(text)) {
    return text.replace(/<head\b[^>]*>/i, (value) => `${value}${csp}`);
  }
  return `<!doctype html><html><head>${csp}</head><body>${text}</body></html>`;
}

export interface SandboxCommandResult {
  command: string;
  args: string[];
  cwd?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
  stdout: string;
  stderr: string;
  durationMs?: number;
}

export interface WorkspaceCommandDisplayInput {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface WorkspaceCommandResult {
  executable: string;
  args: string[];
  cwd: string;
  outcome: "completed" | "failed_to_start" | "timed_out" | "cancelled";
  risk: "read_only" | "write" | "destructive" | "install" | "network" | "process" | "unknown";
  exitCode: number | null;
  signal?: string | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
}

export function getToolPartName(part: RenderableToolPart): string | null {
  if (part.type === "dynamic-tool") return readString(part.toolName) ?? null;
  if (part.type.startsWith("tool-")) return part.type.slice("tool-".length) || null;
  return null;
}

export function isSilentToolPart(part: unknown): boolean {
  return (
    !!part &&
    typeof part === "object" &&
    getToolPartName(part as RenderableToolPart) === SILENT_TOOL_NAME
  );
}

export function normalizeToolState(raw: string | undefined): GeneratedToolState {
  const known: GeneratedToolState[] = [
    "input-streaming",
    "input-available",
    "approval-requested",
    "approval-responded",
    "output-available",
    "output-error",
    "output-denied",
  ];
  return known.includes(raw as GeneratedToolState)
    ? (raw as GeneratedToolState)
    : "input-available";
}

export function isGeneratedToolName(toolName: string | null): boolean {
  return (
    toolName !== null &&
    [
      "web_search",
      "web_open",
      "memory_search",
      "memory_save",
      "memory_update",
      "memory_delete",
      "cron",
      "sandbox_list_files",
      "sandbox_read_file",
      "sandbox_write_file",
      "sandbox_run_command",
      "workspace_run_command",
      "sandbox_snapshot",
      "sandbox_restore",
      "sandbox_list_artifacts",
      "sandbox_preview_port",
      "sandbox_publish_artifact",
      "sandbox_start_preview",
      "file_search",
      "code_interpreter",
      "tool_search",
      "current_time",
      "runtime_snapshot",
      "model_capabilities",
      "conversation_search",
    ].includes(toolName)
  );
}

export function getToolSummary(part: RenderableToolPart): ToolSummary | null {
  const toolName = getToolPartName(part);
  if (!toolName) return null;

  const output = asRecord(part.output);
  const input = asRecord(part.input);
  switch (toolName) {
    case "web_search": {
      const count = readNumber(output?.count) ?? readArray(output?.results).length;
      if (count > 0) return { key: "tool.generated.sources", params: { count } };
      const query = readString(input?.query);
      return query ? { key: "tool.generated.query", params: { value: query } } : null;
    }
    case "web_open": {
      const title = readString(output?.title);
      return title
        ? { key: "tool.generated.page", params: { title: truncateText(title, 80) } }
        : null;
    }
    case "memory_search": {
      const count = readNumber(output?.count) ?? readArray(output?.results).length;
      return { key: "tool.generated.memories", params: { count } };
    }
    case "memory_save":
      return { key: "tool.generated.memorySaved" };
    case "memory_update":
      return { key: "tool.generated.memoryUpdated" };
    case "memory_delete":
      return { key: "tool.generated.memoryDeleted" };
    case "cron": {
      const action = readString(input?.action) ?? "run";
      const status = readString(output?.status);
      return {
        key: "tool.generated.automation",
        params: { action, ...(status ? { status } : {}) },
      };
    }
    case "sandbox_list_files": {
      const files = readArray(output?.files ?? part.output);
      return { key: "tool.generated.files", params: { count: files.length } };
    }
    case "sandbox_read_file": {
      const path = readString(input?.path);
      return path ? { key: "tool.generated.file", params: { path: truncateText(path, 64) } } : null;
    }
    case "sandbox_run_command": {
      const exitCode = readNumber(output?.exitCode);
      return exitCode === undefined
        ? null
        : {
            key: "tool.generated.command",
            params: { status: exitCode === 0 ? "ok" : String(exitCode) },
          };
    }
    case "workspace_run_command": {
      const result = normalizeWorkspaceCommand(output);
      return result
        ? {
            key: "tool.generated.command",
            params: {
              status:
                result.outcome === "completed" && result.exitCode === 0 ? "ok" : result.outcome,
            },
          }
        : null;
    }
    case "sandbox_list_artifacts": {
      const artifacts = readArray(output?.artifacts);
      return { key: "tool.generated.artifacts", params: { count: artifacts.length } };
    }
    case "sandbox_snapshot":
    case "sandbox_restore":
      return { key: "tool.generated.snapshot" };
    case "sandbox_preview_port":
    case "sandbox_publish_artifact":
    case "sandbox_start_preview":
      return { key: "tool.generated.preview" };
    case "current_time": {
      const localDateTime = readString(output?.localDateTime);
      return localDateTime
        ? { key: "tool.generated.time", params: { value: truncateText(localDateTime, 80) } }
        : null;
    }
    case "runtime_snapshot":
      return { key: "tool.generated.runtime" };
    case "model_capabilities": {
      const modelId = readString(output?.modelId);
      return modelId ? { key: "tool.generated.model", params: { value: modelId } } : null;
    }
    case "conversation_search": {
      const count = readNumber(output?.count) ?? readArray(output?.results).length;
      return { key: "tool.generated.matches", params: { count } };
    }
    case "file_search":
    case "code_interpreter":
    case "tool_search": {
      const count = readNumber(output?.count) ?? readArray(output?.results).length;
      return count > 0 ? { key: "tool.generated.items", params: { count } } : null;
    }
    default:
      return null;
  }
}

export function normalizeWebSearchResult(output: unknown): {
  query?: string;
  results: WebSearchResult[];
} {
  const record = asRecord(output);
  const results = readArray(record?.results)
    .map((value) => {
      const item = asRecord(value);
      const url = sanitizeToolUrl(readString(item?.url));
      const title = readString(item?.title);
      if (!url || !title) return null;
      return { title, url, snippet: readString(item?.snippet) ?? "" };
    })
    .filter((value): value is WebSearchResult => value !== null);
  return { query: readString(record?.query), results };
}

export function normalizeWebOpenResult(output: unknown): WebOpenResult | null {
  const record = asRecord(output);
  if (!record) return null;
  const finalUrl = sanitizeToolUrl(readString(record.finalUrl) ?? readString(record.requestedUrl));
  const title = readString(record.title);
  const text = readString(record.text);
  if (!finalUrl || !title || text === undefined) return null;
  return {
    requestedUrl: readString(record.requestedUrl) ?? finalUrl,
    finalUrl,
    title,
    text,
    truncated: readBoolean(record.truncated) ?? false,
    ...(readString(record.description) ? { description: readString(record.description) } : {}),
  };
}

export function normalizeMemoryResults(output: unknown): {
  query?: string;
  results: MemoryResult[];
} {
  const record = asRecord(output);
  const results = readArray(record?.results)
    .map((value) => {
      const item = asRecord(value);
      const id = readString(item?.id);
      const title = readString(item?.title);
      const content = readString(item?.content);
      if (!id || !title || content === undefined) return null;
      return {
        id,
        title,
        content,
        ...(readString(item?.scope) ? { scope: readString(item?.scope) } : {}),
        ...(readString(item?.kind) ? { kind: readString(item?.kind) } : {}),
        ...(readNumber(item?.salience) !== undefined
          ? { salience: readNumber(item?.salience) }
          : {}),
        ...(readBoolean(item?.pinned) !== undefined ? { pinned: readBoolean(item?.pinned) } : {}),
      };
    })
    .filter((value): value is MemoryResult => value !== null);
  return { query: readString(record?.query), results };
}

export function normalizeSandboxArtifacts(output: unknown): SandboxArtifactResult[] {
  const record = asRecord(output);
  return readArray(record?.artifacts)
    .map((value) => {
      const item = asRecord(value);
      const path = readString(item?.path);
      if (!path || !isSafeSandboxRelativePath(path)) return null;
      const id = readString(item?.id);
      const kind = readString(item?.kind);
      const url = sanitizeToolUrl(readString(item?.url));
      const sizeBytes = readNumber(item?.size_bytes) ?? readNumber(item?.sizeBytes);
      const status = readString(item?.status);
      const authorized = readBoolean(item?.authorized);
      return {
        ...(id ? { id } : {}),
        ...(kind ? { kind } : {}),
        path,
        ...(url ? { url } : {}),
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        ...(status ? { status } : {}),
        ...(authorized !== undefined ? { authorized } : {}),
      };
    })
    .filter((value): value is SandboxArtifactResult => value !== null);
}

function isSafeSandboxRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:/.test(normalized) &&
    !normalized.split("/").includes("..") &&
    !normalized.split("/").includes(".snapshots")
  );
}

export function normalizeSandboxCommand(output: unknown): SandboxCommandResult | null {
  const record = asRecord(output);
  if (!record) return null;
  const command = readString(record.command);
  if (!command) return null;
  return {
    command,
    args: readArray(record.args).map((value) => String(value)),
    cwd: readString(record.cwd),
    exitCode: readNumber(record.exitCode) ?? null,
    signal: readString(record.signal),
    timedOut: readBoolean(record.timedOut),
    stdout: truncateText(readString(record.stdout) ?? "", 12_000),
    stderr: truncateText(readString(record.stderr) ?? "", 12_000),
    durationMs: readNumber(record.durationMs),
  };
}

export function normalizeWorkspaceCommand(output: unknown): WorkspaceCommandResult | null {
  const record = asRecord(output);
  if (!record) return null;
  const executable = readString(record.executable);
  const outcome = readString(record.outcome);
  const risk = readString(record.risk);
  if (
    !executable ||
    !outcome ||
    !risk ||
    !["completed", "failed_to_start", "timed_out", "cancelled"].includes(outcome) ||
    !["read_only", "write", "destructive", "install", "network", "process", "unknown"].includes(
      risk,
    )
  ) {
    return null;
  }
  return {
    executable,
    args: readArray(record.args).map((value) => String(value)),
    cwd: readString(record.cwd) ?? ".",
    outcome: outcome as WorkspaceCommandResult["outcome"],
    risk: risk as WorkspaceCommandResult["risk"],
    exitCode: readNumber(record.exitCode) ?? null,
    signal: readString(record.signal),
    timedOut: readBoolean(record.timedOut) ?? false,
    aborted: readBoolean(record.aborted) ?? false,
    stdout: redactWorkspaceCommandText(truncateText(readString(record.stdout) ?? "", 16_000)),
    stderr: redactWorkspaceCommandText(truncateText(readString(record.stderr) ?? "", 16_000)),
    stdoutBytes: readNumber(record.stdoutBytes) ?? 0,
    stderrBytes: readNumber(record.stderrBytes) ?? 0,
    stdoutTruncated: readBoolean(record.stdoutTruncated) ?? false,
    stderrTruncated: readBoolean(record.stderrTruncated) ?? false,
    durationMs: readNumber(record.durationMs) ?? 0,
  };
}

export function normalizeWorkspaceCommandInput(
  input: unknown,
): WorkspaceCommandDisplayInput | null {
  const record = asRecord(input);
  const executable = readString(record?.executable);
  if (!executable) return null;
  const rawArgs = readArray(record?.args).map((value) => String(value));
  const args = rawArgs.map((arg, index) => {
    const previous = rawArgs[index - 1] ?? "";
    return redactWorkspaceCommandArgument(arg, previous);
  });
  const rawEnv = asRecord(record?.env);
  return {
    executable,
    args,
    cwd: readString(record?.cwd) ?? ".",
    ...(rawEnv
      ? {
          env: Object.fromEntries(Object.keys(rawEnv).map((key) => [key, "[redacted]"])),
        }
      : {}),
    ...(readNumber(record?.timeoutMs) !== undefined
      ? { timeoutMs: readNumber(record?.timeoutMs) }
      : {}),
  };
}

function redactWorkspaceCommandArgument(value: string, previous?: string): string {
  if (previous && isSensitiveArgumentName(previous)) return "[redacted]";
  const separator = value.indexOf("=");
  if (separator > 0 && isSensitiveArgumentName(value.slice(0, separator))) {
    return value.slice(0, separator + 1) + "[redacted]";
  }
  return redactWorkspaceCommandText(value);
}

function isSensitiveArgumentName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("-") && !trimmed.includes("="))) return false;
  return /token|secret|password|authorization|api[-_]?key|cookie/i.test(
    trimmed.split("=", 1)[0] ?? "",
  );
}

function redactWorkspaceCommandText(value: string): string {
  return value
    .replace(
      /(["']?(?:api[-_ ]?key|access[-_ ]?token|authorization|password|secret)["']?\s*[:=]\s*["']?)[^,]+/gi,
      "$1[redacted]",
    )
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|key|token|secret)[-_][a-z0-9_-]{8,}\b/gi, "[redacted]");
}

export function estimateWorkspaceCommandRisk(
  input: WorkspaceCommandDisplayInput,
): WorkspaceCommandResult["risk"] {
  const executable =
    input.executable
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(cmd|bat|exe)$/i, "")
      .toLowerCase() ?? "";
  const text = [executable, ...input.args].join(" ").toLowerCase();
  if (
    [
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
    ].includes(executable)
  )
    return "read_only";
  if (
    executable === "git" &&
    ["branch", "diff", "log", "ls-files", "rev-parse", "show", "status"].some((action) =>
      input.args.includes(action),
    )
  )
    return "read_only";
  if (
    /\b(rm|del|erase|rmdir|format|mkfs|shutdown|reboot|git\s+(reset|clean|checkout))\b/.test(text)
  )
    return "destructive";
  if (
    /\b(npm|pnpm|yarn|pip|pip3|uv|brew|apt|apt-get|choco|winget|install|uninstall|update|upgrade)\b/.test(
      text,
    )
  )
    return "install";
  if (/\b(curl|wget|invoke-webrequest|clone|fetch|pull|push)\b|https?:\/\//.test(text))
    return "network";
  if (/\b(start|kill|systemctl|launchctl|service|docker|run|serve|dev|watch|daemon)\b/.test(text))
    return "process";
  if (/\b(mkdir|touch|cp|copy|mv|move|ren|rename|tee|git\s+(add|commit))\b/.test(text))
    return "write";
  return "unknown";
}

export function normalizeStringList(output: unknown): string[] {
  const record = asRecord(output);
  const values = record?.files ?? record?.paths ?? output;
  return readArray(values)
    .map((value) => (typeof value === "string" ? value : readString(asRecord(value)?.path)))
    .filter((value): value is string => Boolean(value));
}

export function sanitizeToolUrl(value: string | undefined): string | null {
  return value ? sanitizeRichContentUrl(value, "link") : null;
}

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, Math.max(0, maxLength - 3)) + "...";
}

export function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
