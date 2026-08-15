import type { ChatErrorCode, ChatErrorResponse } from "../../shared/types";

type ChatErrorPhase = "request" | "stream";

export interface ChatErrorClassification extends ChatErrorResponse {
  diagnostic: string;
  phase: ChatErrorPhase;
  status: 400 | 401 | 404 | 408 | 409 | 429 | 500 | 503;
}

interface ErrorShape {
  name?: unknown;
  message?: unknown;
  cause?: unknown;
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  responseBody?: unknown;
  body?: unknown;
  errors?: unknown;
  lastError?: unknown;
}

const RETRYABLE_CODES = new Set<ChatErrorCode>([
  "network",
  "rate_limited",
  "timeout",
  "provider",
  "run_not_active",
  "run_not_found",
]);

const RUNTIME_CODES = new Set<ChatErrorCode>([
  "run_conflict",
  "run_not_found",
  "run_not_active",
  "conversation_mismatch",
  "conversation_busy",
]);

const SAFE_MESSAGES: Record<ChatErrorCode, string> = {
  invalid_request: "The chat request is invalid. Check the message and try again.",
  invalid_media_input: "The attached image could not be read. Choose it again and try again.",
  invalid_run_id: "The chat run is invalid. Start the message again.",
  invalid_mode: "The chat run mode is invalid. Start the message again.",
  missing_model: "No available model is selected. Choose or configure a model first.",
  vision_model_unavailable:
    "The selected chat model cannot process image input. Choose a vision model in General settings.",
  unauthorized: "The chat session expired. Restart the app and try again.",
  configuration: "The selected model is not configured correctly. Check its provider settings.",
  network: "Unable to connect to the local chat service. Wait a few seconds and try again.",
  rate_limited: "The model provider is rate limiting requests. Wait a moment and try again.",
  timeout: "The model request timed out. Try again or use a shorter request.",
  provider: "The model provider could not complete the request. Try again shortly.",
  runtime: "The local agent runtime could not complete the request. Try again.",
  run_conflict: "This conversation is already running another request.",
  run_not_found: "The previous chat run is no longer available. Start the message again.",
  run_not_active: "The previous chat run is no longer active. Start the message again.",
  conversation_mismatch: "The chat run belongs to another conversation. Start the message again.",
  conversation_busy: "This conversation is already running another request.",
  cancelled: "The chat request was cancelled.",
  unknown: "The request failed. Please try again later.",
};

export function classifyChatError(
  error: unknown,
  options: { phase?: ChatErrorPhase; abortSignal?: AbortSignal } = {},
): ChatErrorClassification {
  const phase = options.phase ?? "request";
  const diagnostic = redactChatDiagnostic(readErrorMessage(error));
  const status = readStatus(error);
  const explicitCode = readCode(error);

  if (isAbortError(error, options.abortSignal)) {
    return createClassification("cancelled", phase, diagnostic, 409);
  }

  if (explicitCode && RUNTIME_CODES.has(explicitCode)) {
    return createClassification(
      explicitCode,
      phase,
      diagnostic,
      explicitCode === "run_not_found" ? 404 : 409,
    );
  }
  if (explicitCode === "invalid_media_input") {
    return createClassification(explicitCode, phase, "Invalid media input.", 400);
  }
  if (explicitCode === "vision_model_unavailable") {
    return createClassification(explicitCode, phase, diagnostic, 400);
  }

  const lower = diagnostic.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("unauthorized")) {
    return createClassification("unauthorized", phase, diagnostic, 401);
  }
  if (
    lower.includes("api key") ||
    lower.includes("base url") ||
    lower.includes("provider options") ||
    lower.includes("unknown provider") ||
    lower.includes("unknown model") ||
    lower.includes("model is disabled") ||
    lower.includes("not configured")
  ) {
    return createClassification(
      lower.includes("model is required") ? "missing_model" : "configuration",
      phase,
      diagnostic,
      400,
    );
  }
  if (lower.includes("model is required")) {
    return createClassification("missing_model", phase, diagnostic, 400);
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return createClassification("rate_limited", phase, diagnostic, 429);
  }
  if (
    status === 408 ||
    status === 504 ||
    lower.includes("timed out") ||
    lower.includes("timeout")
  ) {
    return createClassification("timeout", phase, diagnostic, 408);
  }
  if (
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower.includes("econnrefused") ||
    lower.includes("enotfound") ||
    lower.includes("network")
  ) {
    return createClassification("network", phase, diagnostic, 503);
  }
  if (status === 400) return createClassification("invalid_request", phase, diagnostic, 400);
  if (status !== undefined && status >= 500) {
    return createClassification("provider", phase, diagnostic, 503);
  }
  if (phase === "stream") return createClassification("runtime", phase, diagnostic, 500);
  return createClassification("unknown", phase, diagnostic, 500);
}

export function chatErrorResponse(code: ChatErrorCode): ChatErrorResponse {
  return {
    error: SAFE_MESSAGES[code],
    code,
    retryable: RETRYABLE_CODES.has(code),
  };
}

export function chatErrorStatus(
  classification: ChatErrorClassification,
): ChatErrorClassification["status"] {
  return classification.status;
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (!error || typeof error !== "object") return false;
  const shape = error as ErrorShape;
  const name = typeof shape.name === "string" ? shape.name.toLowerCase() : "";
  const code = typeof shape.code === "string" ? shape.code.toLowerCase() : "";
  const message = typeof shape.message === "string" ? shape.message.toLowerCase() : "";
  return (
    name === "aborterror" ||
    code === "aborted" ||
    code === "err_abort" ||
    message.includes("aborted")
  );
}

export function redactChatDiagnostic(error: string): string {
  const redacted = error
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|key|token|secret)[-_][a-z0-9_-]{8,}\b/gi, "[redacted]")
    .replace(
      /(["']?(?:api[-_ ]?key|access[-_ ]?token|authorization|password|secret)["']?\s*[:=]\s*["']?)[^,\s"'}]+/gi,
      "$1[redacted]",
    );
  return redacted.slice(0, 2_000) || "Unknown chat error";
}

function createClassification(
  code: ChatErrorCode,
  phase: ChatErrorPhase,
  diagnostic: string,
  status: ChatErrorClassification["status"],
): ChatErrorClassification {
  const response = chatErrorResponse(code);
  return { ...response, diagnostic, phase, status };
}

function readErrorMessage(error: unknown): string {
  if (error == null) return "Unknown chat error";
  if (typeof error === "string") return parseMessage(error) ?? error;
  if (error instanceof Error) {
    const shape = error as ErrorShape;
    const responseBody = readString(shape.responseBody) ?? readString(shape.body);
    return parseMessage(responseBody) ?? error.message ?? error.name ?? "Unknown chat error";
  }
  if (typeof error === "object") {
    const shape = error as ErrorShape;
    const message = readString(shape.message);
    const responseBody = readString(shape.responseBody) ?? readString(shape.body);
    return parseMessage(responseBody) ?? parseMessage(message) ?? message ?? "Unknown chat error";
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return String(error);
  }
  if (typeof error === "symbol") return error.toString();
  return "Unknown chat error";
}

function parseMessage(value: string | undefined): string | null {
  if (!value?.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as { error?: unknown; message?: unknown };
    const nested = parsed.error ?? parsed.message;
    if (typeof nested === "string") return nested;
    if (nested && typeof nested === "object" && "message" in nested) {
      const nestedMessage = (nested as { message?: unknown }).message;
      return typeof nestedMessage === "string" ? nestedMessage : null;
    }
  } catch {
    return null;
  }
  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readStatus(error: unknown): number | undefined {
  return findNestedErrorValue(error, (value) => {
    const shape = value as ErrorShape;
    const status = typeof shape.statusCode === "number" ? shape.statusCode : shape.status;
    return typeof status === "number" ? status : undefined;
  });
}

function findNestedErrorValue<T>(
  error: unknown,
  read: (value: Record<string, unknown>) => T | undefined,
  seen = new Set<object>(),
): T | undefined {
  if (!error || typeof error !== "object") return undefined;
  if (seen.has(error)) return undefined;
  seen.add(error);

  const value = error as Record<string, unknown>;
  const direct = read(value);
  if (direct !== undefined) return direct;

  for (const nested of [value.cause, value.lastError, value.errors]) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const result = findNestedErrorValue(item, read, seen);
        if (result !== undefined) return result;
      }
      continue;
    }
    const result = findNestedErrorValue(nested, read, seen);
    if (result !== undefined) return result;
  }
  return undefined;
}

function readCode(error: unknown): ChatErrorCode | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as ErrorShape).code;
  return typeof value === "string" && isChatErrorCode(value) ? value : undefined;
}

function isChatErrorCode(value: string): value is ChatErrorCode {
  return value in SAFE_MESSAGES;
}
