import { appendFile, copyFile, mkdir, readdir, rm, access } from "node:fs/promises";
import { join } from "node:path";
import type {
  ErrorLogError,
  ErrorLogExportResult,
  ErrorLogInput,
  ErrorLogLevel,
  ErrorLogOrigin,
  ErrorLogRecord,
  ErrorLogSource,
} from "../../shared/types";
import { resolveUserDataDir } from "./runtime-paths";

const LOG_FILE_PREFIX = "ayaka-errors-";
const LOG_FILE_SUFFIX = ".jsonl";
const MAX_BUFFERED_EVENTS = 100;
const MAX_DETAIL_DEPTH = 5;
const MAX_DETAIL_ITEMS = 100;
const MAX_STRING_LENGTH = 8_000;
const MAX_LOG_LINE_LENGTH = 256_000;

const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|authorization|password|secret|token)/i;
const INLINE_SECRET_PATTERNS = [
  /(bearer\s+)[a-z0-9._~+/=-]+/gi,
  /((?:api[_-]?key|authorization|password|secret|token)\s*[=:]\s*)[^\s,;]+/gi,
];

export interface ErrorLogSaveDialogOptions {
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}

export interface ErrorLogSaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

export type ErrorLogSaveDialog = (
  options: ErrorLogSaveDialogOptions,
) => Promise<ErrorLogSaveDialogResult>;

export interface ErrorLoggerOptions {
  userDataDir: string;
  now?: () => number;
}

export function getErrorLogDateKey(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getErrorLogFilename(dateKey: string): string {
  return `${LOG_FILE_PREFIX}${dateKey}${LOG_FILE_SUFFIX}`;
}

export function normalizeErrorLogInput(input: ErrorLogInput, now = Date.now()): ErrorLogRecord {
  const error = normalizeError(input.error);
  const details = input.details ?? (input.args && input.args.length > 0 ? input.args : undefined);
  const normalizedDetails = details === undefined ? undefined : safeValueOrFallback(details);
  const message = redactText(
    input.message?.trim() || error?.message || formatArguments(input.args ?? []),
  );
  const timestamp = Number.isFinite(input.timestamp) ? input.timestamp! : now;

  return {
    timestamp: new Date(timestamp).toISOString(),
    source: normalizeSource(input.source),
    level: normalizeLevel(input.level),
    origin: normalizeOrigin(input.origin),
    message: message || "Unknown error",
    ...(normalizedDetails === undefined ? {} : { details: normalizedDetails }),
    ...(error ? { error } : {}),
  };
}

export class ErrorLogger {
  private readonly logsDirectory: string;
  private readonly now: () => number;
  private queue: Promise<void> = Promise.resolve();
  private activeDateKey: string | null = null;

  constructor(options: ErrorLoggerOptions) {
    this.logsDirectory = join(options.userDataDir, "logs");
    this.now = options.now ?? Date.now;
  }

  initialize(): Promise<void> {
    return this.enqueue(() => this.ensureCurrentDate());
  }

  record(input: ErrorLogInput): void {
    let record: ErrorLogRecord;
    try {
      record = normalizeErrorLogInput(input, this.now());
    } catch {
      return;
    }
    void this.enqueue(async () => {
      await this.ensureCurrentDate();
      const filePath = this.getLogPath(this.activeDateKey!);
      await appendFile(filePath, serializeRecord(record), "utf8");
    }).catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.queue.catch(() => undefined);
  }

  async exportCurrent(showSaveDialog: ErrorLogSaveDialog): Promise<ErrorLogExportResult> {
    await this.flush();
    await this.enqueue(() => this.ensureCurrentDate());

    const dateKey = this.activeDateKey ?? getErrorLogDateKey(this.now());
    const sourcePath = this.getLogPath(dateKey);
    if (!(await fileExists(sourcePath))) return "empty";

    const dialogResult = await showSaveDialog({
      defaultPath: getErrorLogFilename(dateKey),
      filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) return "cancelled";

    await this.flush();
    await copyFile(sourcePath, dialogResult.filePath);
    return "saved";
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async ensureCurrentDate(): Promise<void> {
    const dateKey = getErrorLogDateKey(this.now());
    if (this.activeDateKey === dateKey) return;

    await mkdir(this.logsDirectory, { recursive: true });
    await this.removePreviousDays(dateKey);
    this.activeDateKey = dateKey;
  }

  private async removePreviousDays(currentDateKey: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.logsDirectory);
    } catch {
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => {
          return (
            entry.startsWith(LOG_FILE_PREFIX) &&
            entry.endsWith(LOG_FILE_SUFFIX) &&
            entry !== getErrorLogFilename(currentDateKey)
          );
        })
        .map((entry) => rm(join(this.logsDirectory, entry), { force: true })),
    );
  }

  private getLogPath(dateKey: string): string {
    return join(this.logsDirectory, getErrorLogFilename(dateKey));
  }
}

let activeLogger: ErrorLogger | null = null;
let bufferedEvents: ErrorLogInput[] = [];

export function initializeErrorLogger(userDataDir = resolveUserDataDir()): Promise<void> {
  if (activeLogger) return activeLogger.initialize();

  const logger = new ErrorLogger({ userDataDir });
  activeLogger = logger;
  const buffered = bufferedEvents;
  bufferedEvents = [];

  const initialized = logger.initialize();
  for (const event of buffered) logger.record(event);
  return initialized.then(() => logger.flush());
}

export function recordErrorLog(input: ErrorLogInput): void {
  const event = { ...input, timestamp: input.timestamp ?? Date.now() };
  if (activeLogger) {
    try {
      activeLogger.record(event);
    } catch {
      // Logging must never affect the application that is being observed.
    }
    return;
  }
  if (bufferedEvents.length >= MAX_BUFFERED_EVENTS) bufferedEvents.shift();
  bufferedEvents.push(event);
}

export async function flushErrorLogs(): Promise<void> {
  await activeLogger?.flush();
}

export async function exportCurrentErrorLog(
  showSaveDialog: ErrorLogSaveDialog,
): Promise<ErrorLogExportResult> {
  if (!activeLogger) return "empty";
  return activeLogger.exportCurrent(showSaveDialog);
}

export function installProcessErrorCapture(): void {
  const state = globalThis as typeof globalThis & {
    __ayakaErrorCaptureInstalled?: boolean;
  };
  if (state.__ayakaErrorCaptureInstalled) return;
  state.__ayakaErrorCaptureInstalled = true;

  const originalConsoleError = console.error.bind(console);
  const originalConsoleWarn = console.warn.bind(console);

  console.error = (...args: unknown[]): void => {
    originalConsoleError(...args);
    recordErrorLog({
      source: "main",
      level: "error",
      origin: "console",
      args,
    });
  };
  console.warn = (...args: unknown[]): void => {
    originalConsoleWarn(...args);
    recordErrorLog({
      source: "main",
      level: "warning",
      origin: "console",
      args,
    });
  };

  process.on("uncaughtExceptionMonitor", (error) => {
    recordErrorLog({
      source: "main",
      level: "error",
      origin: "uncaughtException",
      error,
    });
  });
  process.on("unhandledRejection", (reason) => {
    originalConsoleError("Unhandled promise rejection:", reason);
    recordErrorLog({
      source: "main",
      level: "error",
      origin: "unhandledrejection",
      error: reason,
      args: [reason],
    });
  });
}

function normalizeSource(value: ErrorLogSource): ErrorLogSource {
  return value === "renderer" ? "renderer" : "main";
}

function normalizeLevel(value: ErrorLogLevel): ErrorLogLevel {
  return value === "warning" ? "warning" : "error";
}

function normalizeOrigin(value: ErrorLogOrigin): ErrorLogOrigin {
  if (value === "window-error" || value === "unhandledrejection" || value === "uncaughtException") {
    return value;
  }
  return "console";
}

function normalizeError(value: unknown): ErrorLogError | undefined {
  if (value == null) return undefined;
  if (value instanceof Error) {
    return {
      name: redactText(value.name || "Error"),
      message: redactText(value.message),
      ...(value.stack ? { stack: redactText(value.stack) } : {}),
    };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : formatValue(value);
    const name = typeof record.name === "string" ? record.name : "Error";
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    return {
      name: redactText(name),
      message: redactText(message),
      ...(stack ? { stack: redactText(stack) } : {}),
    };
  }
  return { name: "Error", message: redactText(String(value)) };
}

function safeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DETAIL_DEPTH) return "[truncated]";
  if (value === null || typeof value === "string" || typeof value === "number") {
    return typeof value === "string" ? redactText(value.slice(0, MAX_STRING_LENGTH)) : value;
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return String(value);
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function" || typeof value === "symbol") return `[${typeof value}]`;
  if (value instanceof Error) return normalizeError(value);
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_DETAIL_ITEMS).map((item) => safeValue(item, depth + 1, seen));
  }

  const object = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object).slice(0, MAX_DETAIL_ITEMS)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[redacted]" : safeValue(item, depth + 1, seen);
  }
  return result;
}

function safeValueOrFallback(value: unknown): unknown {
  try {
    return safeValue(value);
  } catch {
    return "[unavailable]";
  }
}

function formatArguments(args: unknown[]): string {
  return args.map(formatValue).join(" ").trim();
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return value.message || value.name || "Error";
  if (typeof value === "string") return redactText(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(safeValue(value)) ?? "[object]";
    } catch {
      return "[object]";
    }
  }
  return String(value);
}

function redactText(value: string): string {
  return INLINE_SECRET_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, "$1[redacted]"),
    value,
  ).slice(0, MAX_STRING_LENGTH);
}

function serializeRecord(record: ErrorLogRecord): string {
  const encoded = JSON.stringify(record);
  if (encoded.length <= MAX_LOG_LINE_LENGTH) return `${encoded}\n`;

  const compact: ErrorLogRecord = {
    ...record,
    message: record.message.slice(0, 4_096),
    details: "[truncated]",
    ...(record.error
      ? {
          error: {
            name: record.error.name.slice(0, 256),
            message: record.error.message.slice(0, 4_096),
          },
        }
      : {}),
  };
  return `${JSON.stringify(compact)}\n`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
