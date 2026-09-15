import type { AppLanguage, ChatErrorCode, ChatErrorResponse } from "@shared/types";
import { translate, type TranslationKey } from "./i18n";

export type ErrorLocale = AppLanguage;

export interface ChatErrorInfo {
  code: ChatErrorCode;
  message: string;
  retryable: boolean;
}

type ErrorLike = Error & {
  cause?: unknown;
  responseBody?: string;
  statusCode?: number;
  status?: number;
  code?: unknown;
  retryable?: unknown;
};

const CHAT_CODES = new Set<ChatErrorCode>([
  "invalid_request",
  "invalid_media_input",
  "invalid_run_id",
  "invalid_mode",
  "missing_model",
  "model_unavailable",
  "vision_model_unavailable",
  "unauthorized",
  "configuration",
  "network",
  "rate_limited",
  "timeout",
  "provider",
  "command_not_found",
  "runtime",
  "run_conflict",
  "run_not_found",
  "run_not_active",
  "conversation_mismatch",
  "conversation_busy",
  "cancelled",
  "unknown",
]);

const RETRYABLE_CHAT_CODES = new Set<ChatErrorCode>([
  "network",
  "rate_limited",
  "timeout",
  "provider",
  "run_not_found",
  "run_not_active",
]);

function normalizeLocale(locale?: string | null): ErrorLocale {
  return locale === "en" ? "en" : "zh-CN";
}

function text(
  locale: ErrorLocale,
  key: TranslationKey,
  params?: Record<string, string | number>,
): string {
  return translate(locale, key, params);
}

function parseJsonPayload(value: string | undefined): Record<string, unknown> | null {
  if (!value?.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function parseJsonMessage(value: string): string | null {
  const parsed = parseJsonPayload(value);
  const inner = parsed?.error ?? parsed?.message;
  return typeof inner === "string" && inner.trim() ? inner : null;
}

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const e = error as { statusCode?: unknown; status?: unknown };
  const value = typeof e.statusCode === "number" ? e.statusCode : e.status;
  return typeof value === "number" ? value : undefined;
}

function withStatus(status: number | undefined, message: string): string {
  return status !== undefined ? `[${status}] ${message}` : message;
}

function stripStatusPrefix(message: string): string {
  return message.replace(/^\[\d+\]\s*/, "");
}

function getRawErrorMessage(error: unknown, locale: ErrorLocale): string {
  const unknown = text(locale, "error.unknown");
  if (error == null) return unknown;
  if (typeof error === "string") return parseJsonMessage(error) ?? (error.trim() || unknown);

  if (error instanceof Error) {
    const e = error as ErrorLike;
    if (e.responseBody?.trim()) {
      const inner = parseJsonMessage(e.responseBody);
      return withStatus(e.statusCode, inner ?? e.responseBody);
    }
    if (error.message.trim()) return parseJsonMessage(error.message) ?? error.message;
    if (e.cause != null) {
      const cause = getRawErrorMessage(e.cause, locale);
      if (cause !== unknown) return cause;
    }
    return error.name !== "Error" ? error.name : unknown;
  }

  if (typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return parseJsonMessage(message) ?? message;
    try {
      return JSON.stringify(error);
    } catch {
      return unknown;
    }
  }
  if (typeof error === "number" || typeof error === "boolean") return String(error);
  if (typeof error === "bigint" || typeof error === "symbol") return error.toString();
  if (typeof error === "function") return text(locale, "error.function");
  return unknown;
}

function mapKnownError(rawMessage: string, locale: ErrorLocale, status?: number): string | null {
  const raw = stripStatusPrefix(rawMessage).trim();
  const lower = raw.toLowerCase();

  if (lower.includes("base url must start with"))
    return text(locale, "error.provider.baseUrlProtocol");
  if (lower === "provider id is required") return text(locale, "error.provider.providerIdRequired");
  if (lower === "built-in providers cannot be overwritten")
    return text(locale, "error.provider.builtinOverwrite");
  if (lower === "provider label is required") return text(locale, "error.provider.labelRequired");
  if (lower === "base url is required") return text(locale, "error.provider.baseUrlRequired");
  if (lower === "failed to save provider") return text(locale, "error.provider.saveFailed");
  if (lower === "custom provider not found")
    return text(locale, "error.provider.customProviderNotFound");
  if (lower === "model id is required") return text(locale, "error.provider.modelIdRequired");
  if (lower === "failed to save model") return text(locale, "error.provider.modelSaveFailed");
  if (lower.includes("provider options must be") && lower.includes("json")) {
    return text(locale, "error.providerOptions.json");
  }
  if (lower === "api key is required") return text(locale, "error.provider.apiKeyRequired");
  if (lower === "custom model not found") return text(locale, "error.provider.customModelNotFound");
  if (lower.includes("invalid model reference") && lower.includes("expected provider/model")) {
    return text(locale, "error.provider.invalidModelReference");
  }

  const unknownProvider = raw.match(/^Unknown provider:\s*(.+)$/i);
  if (unknownProvider)
    return text(locale, "error.provider.unknownProvider", { provider: unknownProvider[1] });
  const unknownModel = raw.match(/^Unknown model:\s*(.+)$/i);
  if (unknownModel) return text(locale, "error.provider.unknownModel", { model: unknownModel[1] });
  const disabledModel = raw.match(/^(.+?)\s+is disabled\.?$/i);
  if (disabledModel)
    return text(locale, "error.provider.modelDisabled", { model: disabledModel[1] });
  const apiKeyMissing = raw.match(/^(.+?)\s+API key is not configured\./i);
  if (apiKeyMissing)
    return text(locale, "error.provider.modelApiKeyMissing", { model: apiKeyMissing[1] });
  const baseUrlMissing = raw.match(/^(.+?)\s+base URL is not configured\./i);
  if (baseUrlMissing)
    return text(locale, "error.provider.baseUrlMissing", { provider: baseUrlMissing[1] });
  if (status === 400) return text(locale, "error.chat.badRequest");
  return null;
}

function readChatEnvelope(error: unknown): ChatErrorResponse | null {
  const values: string[] = [];
  if (typeof error === "string") values.push(error);
  if (error instanceof Error) {
    const e = error as ErrorLike;
    values.push(e.responseBody ?? "", e.message);
  } else if (error && typeof error === "object") {
    const e = error as ErrorLike;
    if (typeof e.responseBody === "string") values.push(e.responseBody);
    if (typeof e.message === "string") values.push(e.message);
  }

  for (const value of values) {
    const parsed = parseJsonPayload(value);
    if (!parsed) continue;
    const code = parsed?.code;
    const response = parsed?.error;
    if (
      typeof code !== "string" ||
      !CHAT_CODES.has(code as ChatErrorCode) ||
      typeof response !== "string"
    ) {
      continue;
    }
    return {
      error: response,
      code: code as ChatErrorCode,
      retryable: parsed.retryable === true,
    };
  }
  return null;
}

function messageForChatCode(code: ChatErrorCode, locale: ErrorLocale): string {
  switch (code) {
    case "missing_model":
      return text(locale, "error.chat.missingModel");
    case "model_unavailable":
      return text(locale, "error.chat.modelUnavailable");
    case "vision_model_unavailable":
      return text(locale, "error.chat.visionModelUnavailable");
    case "invalid_media_input":
      return text(locale, "error.chat.invalidMediaInput");
    case "unauthorized":
      return text(locale, "error.chat.unauthorized");
    case "configuration":
      return text(locale, "error.chat.configuration");
    case "network":
      return text(locale, "error.chat.network");
    case "rate_limited":
      return text(locale, "error.chat.rateLimited");
    case "timeout":
      return text(locale, "error.chat.timeout");
    case "provider":
      return text(locale, "error.chat.provider");
    case "command_not_found":
      return text(locale, "error.chat.commandNotFound");
    case "runtime":
    case "run_conflict":
    case "run_not_found":
    case "run_not_active":
    case "conversation_mismatch":
    case "conversation_busy":
      return text(locale, "error.chat.runtime");
    case "cancelled":
      return text(locale, "error.chat.cancelled");
    case "invalid_request":
    case "invalid_run_id":
    case "invalid_mode":
      return text(locale, "error.chat.badRequest");
    default:
      return text(locale, "error.chat.unknown");
  }
}

function classifyUnstructuredChatError(error: unknown, locale: ErrorLocale): ChatErrorInfo {
  const raw = stripStatusPrefix(getRawErrorMessage(error, locale));
  const lower = raw.toLowerCase();
  const status = getStatusCode(error);
  let code: ChatErrorCode = "unknown";

  if (lower.includes("command not found") || /\bspawn\s+[\s\S]*\benoent\b/.test(lower)) {
    code = "command_not_found";
  } else if (
    lower.includes("failed to fetch") ||
    lower.includes("load failed") ||
    lower === "typeerror" ||
    lower.includes("unable to connect to the local chat service")
  ) {
    code = "network";
  } else if (
    status === 401 ||
    status === 403 ||
    lower.includes("unauthorized") ||
    lower.includes("chat session expired")
  ) {
    code = "unauthorized";
  } else if (lower.includes("no available model") || lower.includes("model is required")) {
    code = "missing_model";
  } else if (status === 404 || lower.includes("model may be unavailable")) {
    code = "model_unavailable";
  } else if (lower.includes("cannot process image input") || lower.includes("vision model")) {
    code = "vision_model_unavailable";
  } else if (
    lower.includes("attached image could not be read") ||
    lower.includes("invalid media input")
  ) {
    code = "invalid_media_input";
  } else if (lower.includes("rate limiting") || lower.includes("rate limit") || status === 429) {
    code = "rate_limited";
  } else if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    status === 408 ||
    status === 504
  ) {
    code = "timeout";
  } else if (
    lower.includes("not configured") ||
    lower.includes("api key") ||
    lower.includes("unknown provider") ||
    lower.includes("unknown model")
  ) {
    code = "configuration";
  } else if (
    lower.includes("model provider could not") ||
    (status !== undefined && status >= 500)
  ) {
    code = "provider";
  } else if (lower.includes("previous chat run is no longer active")) {
    code = "run_not_active";
  } else if (lower.includes("previous chat run is no longer available")) {
    code = "run_not_found";
  } else if (lower.includes("local agent runtime could not complete")) {
    code = "runtime";
  } else if (status === 400 || lower.includes("request is invalid")) {
    code = "invalid_request";
  }

  return {
    code,
    message: messageForChatCode(code, locale),
    retryable: RETRYABLE_CHAT_CODES.has(code),
  };
}

/** Extract a displayable detail from arbitrary errors without depending on UI libraries. */
export function getErrorMessage(error: unknown, locale?: string | null): string {
  const resolvedLocale = normalizeLocale(locale);
  const raw = getRawErrorMessage(error, resolvedLocale);
  return mapKnownError(raw, resolvedLocale, getStatusCode(error)) ?? raw;
}

/** Convert a chat transport or stream failure into safe, localized display state. */
export function getChatErrorInfo(error: unknown, locale?: string | null): ChatErrorInfo {
  const resolvedLocale = normalizeLocale(locale);
  const envelope = readChatEnvelope(error);
  if (envelope) {
    return {
      code: envelope.code,
      message: messageForChatCode(envelope.code, resolvedLocale),
      retryable: envelope.retryable || RETRYABLE_CHAT_CODES.has(envelope.code),
    };
  }
  return classifyUnstructuredChatError(error, resolvedLocale);
}

export function getChatErrorMessage(error: unknown, locale?: string | null): string {
  return getChatErrorInfo(error, locale).message;
}

export function isChatErrorRetryable(error: unknown, locale?: string | null): boolean {
  return getChatErrorInfo(error, locale).retryable;
}
