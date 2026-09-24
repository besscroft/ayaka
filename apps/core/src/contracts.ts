import type { UIMessage } from "ai";

export const CHAT_SESSION_HEADER = "x-ayaka-session";
export const CHAT_RUN_ID_HEADER = "x-ayaka-run-id";

export type CoreChatReasoningLevel =
  | "provider-default"
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";
export type CoreChatPermissionMode = "ask" | "approve_risky" | "full_access";

export type CoreChatErrorCode =
  | "invalid_request"
  | "invalid_media_input"
  | "invalid_run_id"
  | "invalid_mode"
  | "missing_model"
  | "model_unavailable"
  | "vision_model_unavailable"
  | "unauthorized"
  | "configuration"
  | "network"
  | "rate_limited"
  | "timeout"
  | "provider"
  | "command_not_found"
  | "runtime"
  | "run_conflict"
  | "run_not_found"
  | "run_not_active"
  | "conversation_mismatch"
  | "conversation_busy"
  | "cancelled"
  | "unknown";

export interface CoreChatErrorResponse {
  error: string;
  code: CoreChatErrorCode;
  retryable: boolean;
}

export interface CoreChatErrorClassification extends CoreChatErrorResponse {
  diagnostic: string;
  phase: "request" | "stream";
  status: 400 | 401 | 404 | 408 | 409 | 429 | 500 | 503;
}

export interface CoreModelProvider {
  id: string;
  label: string;
  models: readonly Record<string, unknown>[];
  helpUrl?: string;
}

export type CoreMediaGenerationKind = "image" | "speech" | "transcription";

export interface CoreMediaGenerationFile {
  type: "file";
  mediaType: string;
  filename: string;
  url: string;
  size?: number;
}

export interface CoreMediaGenerationRequest {
  kind: CoreMediaGenerationKind;
  model: string;
  prompt?: string;
  text?: string;
  audio?: { url: string; mediaType?: string; filename?: string };
  options?: Record<string, unknown>;
  conversationId?: string;
}

export interface CoreMediaGenerationResponse {
  kind: CoreMediaGenerationKind;
  text: string;
  files: CoreMediaGenerationFile[];
  metadata?: Record<string, unknown>;
}

export type CoreMediaGenerationErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "no_model"
  | "unsupported_model"
  | "permission_denied"
  | "upstream_error";

export interface CoreMediaGenerationErrorResponse {
  error: string;
  code: CoreMediaGenerationErrorCode;
  kind?: CoreMediaGenerationKind;
  model?: string;
}

export interface CoreChatInput {
  messages: UIMessage[];
  model?: string;
  system?: string;
  agentId?: string;
  conversationId?: string;
  reasoning?: CoreChatReasoningLevel;
  toolSelection?: unknown;
  permissionMode?: CoreChatPermissionMode;
  cronRun?: boolean;
  runId?: string;
  mode?: "start" | "resume";
  recovery?: { previousRunId: string; reason: string };
  abortSignal: AbortSignal;
}

export interface CoreTextGenerationInput {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  providerOptions?: unknown;
}

export interface CoreRuntime {
  listModels(): CoreModelProvider[] | Promise<CoreModelProvider[]>;
  chat(input: CoreChatInput): Promise<Response>;
  generateText(input: CoreTextGenerationInput): Promise<{ text: string }>;
  generateMedia(input: CoreMediaGenerationRequest): Promise<CoreMediaGenerationResponse>;
  createRealtimeToken?: (
    modelRef: string,
    sessionConfig: Record<string, unknown>,
  ) => Promise<{
    token: string;
    url: string;
    expiresAt?: number;
    transport: "websocket";
    protocol: "openai" | "openai-compatible";
    authMode: "ephemeral-token";
  }>;
  classifyChatError?: (
    error: unknown,
    options?: { phase?: "request" | "stream"; abortSignal?: AbortSignal },
  ) => CoreChatErrorClassification;
  classifyMediaError?: (
    error: unknown,
    request: CoreMediaGenerationRequest,
  ) => CoreMediaGenerationErrorResponse;
  mediaErrorStatus?: (code: CoreMediaGenerationErrorCode, error: unknown) => number;
}

export interface CoreAppOptions {
  runtime: CoreRuntime;
  sessionToken?: string;
  authorize?: (request: Request) => boolean | Promise<boolean>;
  getAssignedPort?: () => number;
  corsOrigin?: (origin: string) => string | null;
}

export interface CoreServerInfo {
  port: number;
  token: string;
}
