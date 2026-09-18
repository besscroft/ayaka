import type {
  CoreChatErrorClassification,
  CoreChatErrorCode,
  CoreChatErrorResponse,
} from "./contracts.js";

const RETRYABLE_CODES = new Set<CoreChatErrorCode>([
  "network",
  "rate_limited",
  "timeout",
  "provider",
  "run_not_active",
  "run_not_found",
]);

const SAFE_MESSAGES: Record<CoreChatErrorCode, string> = {
  invalid_request: "The chat request is invalid. Check the message and try again.",
  invalid_media_input: "The attached image could not be read. Choose it again and try again.",
  invalid_run_id: "The chat run is invalid. Start the message again.",
  invalid_mode: "The chat run mode is invalid. Start the message again.",
  missing_model: "No available model is selected. Choose or configure a model first.",
  model_unavailable:
    "The selected model may be unavailable. Refresh the model list or choose another model.",
  vision_model_unavailable:
    "The selected chat model cannot process image input. Choose a vision model in General settings.",
  unauthorized:
    "The anonymous model service or chat session rejected the request. Try again later.",
  configuration: "The selected model is not configured correctly. Check its provider settings.",
  network: "Unable to connect to the model service. Check your network and try again.",
  rate_limited: "The model service limit was reached. Wait and try again later.",
  timeout: "The model request timed out. Try again later.",
  provider: "The model provider could not complete the request. Try again shortly.",
  command_not_found: "Command not found. Use an installed executable and try again.",
  runtime: "The local agent runtime could not complete the request. Try again.",
  run_conflict: "This conversation is already running another request.",
  run_not_found: "The previous chat run is no longer available. Start the message again.",
  run_not_active: "The previous chat run is no longer active. Start the message again.",
  conversation_mismatch: "The chat run belongs to another conversation. Start the message again.",
  conversation_busy: "This conversation is already running another request.",
  cancelled: "The chat request was cancelled.",
  unknown: "The request failed. Please try again later.",
};

export function chatErrorResponse(code: CoreChatErrorCode): CoreChatErrorResponse {
  return { error: SAFE_MESSAGES[code], code, retryable: RETRYABLE_CODES.has(code) };
}

export function classifyCoreChatError(
  error: unknown,
  options: { phase?: "request" | "stream"; abortSignal?: AbortSignal } = {},
): CoreChatErrorClassification {
  const phase = options.phase ?? "request";
  const diagnostic = redactDiagnostic(readMessage(error));
  if (options.abortSignal?.aborted || isAbortError(error)) {
    return makeClassification("cancelled", phase, diagnostic, 409);
  }

  const shape = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const explicitCode = typeof shape.code === "string" ? shape.code : undefined;
  if (isCoreChatErrorCode(explicitCode)) {
    const status =
      explicitCode === "run_not_found" ? 404 : explicitCode === "unauthorized" ? 401 : 400;
    return makeClassification(explicitCode, phase, diagnostic, status);
  }

  const status = typeof shape.status === "number" ? shape.status : undefined;
  const lower = diagnostic.toLowerCase();
  if (status === 401 || status === 403 || lower.includes("unauthorized")) {
    return makeClassification("unauthorized", phase, diagnostic, 401);
  }
  if (status === 429 || lower.includes("rate limit")) {
    return makeClassification("rate_limited", phase, diagnostic, 429);
  }
  if (status === 408 || lower.includes("timeout") || lower.includes("timed out")) {
    return makeClassification("timeout", phase, diagnostic, 408);
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("econn")) {
    return makeClassification("network", phase, diagnostic, 503);
  }
  return makeClassification(phase === "stream" ? "runtime" : "unknown", phase, diagnostic, 500);
}

function isCoreChatErrorCode(value: string | undefined): value is CoreChatErrorCode {
  return value !== undefined && value in SAFE_MESSAGES;
}

function makeClassification(
  code: CoreChatErrorCode,
  phase: "request" | "stream",
  diagnostic: string,
  status: CoreChatErrorClassification["status"],
): CoreChatErrorClassification {
  return { ...chatErrorResponse(code), diagnostic, phase, status };
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const shape = error as Record<string, unknown>;
  return typeof shape.name === "string" && shape.name.toLowerCase() === "aborterror";
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return "Unknown chat error";
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk|pk|key|token|secret)[-_][a-z0-9_-]{8,}\b/gi, "[redacted]")
    .slice(0, 2_000);
}
