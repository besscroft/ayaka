import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { UIMessage } from "ai";
import {
  CHAT_RUN_ID_HEADER,
  CHAT_SESSION_HEADER,
  type CoreAppOptions,
  type CoreChatErrorClassification,
  type CoreChatInput,
  type CoreMediaGenerationErrorResponse,
  type CoreMediaGenerationRequest,
  type CoreRuntime,
} from "./contracts.js";
import { chatErrorResponse, classifyCoreChatError } from "./errors.js";

const DEFAULT_ALLOWED_ORIGIN = (origin: string): string | null => {
  if (origin === "null") return origin;
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : null;
};

export function createCoreApp(options: CoreAppOptions): Hono {
  const app = new Hono();
  const runtime = options.runtime;
  const allowOrigin = options.corsOrigin ?? DEFAULT_ALLOWED_ORIGIN;
  const getAssignedPort = options.getAssignedPort ?? (() => 0);

  app.use(
    "/api/*",
    cors({
      origin: allowOrigin,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", CHAT_SESSION_HEADER],
      exposeHeaders: [CHAT_RUN_ID_HEADER],
      maxAge: 600,
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true, port: getAssignedPort() }));

  app.get("/api/models", async (c) => c.json({ providers: await runtime.listModels() }));

  app.post("/api/realtime/setup", async (c) => {
    if (!(await isRealtimeSetupAuthorized(c.req.raw, options)))
      return c.json({ error: "unauthorized" }, 401);
    if (!runtime.createRealtimeToken) return c.json({ error: "realtime_unavailable" }, 404);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const model = c.req.query("model") ?? "";
    if (!isRealtimeSetupRequest(model, body)) return c.json({ error: "invalid_request" }, 400);

    try {
      const setup = body as { sessionConfig: Record<string, unknown> };
      const result = await runtime.createRealtimeToken(model, setup.sessionConfig);
      return c.json({ ...result, tools: [] });
    } catch {
      console.error("[core] realtime setup failed.");
      return c.json({ error: "realtime_setup_failed" }, 502);
    }
  });

  app.post("/api/media/generate", async (c) => {
    if (!(await isAuthorized(c.req.raw, options))) return unauthorizedMediaResponse(c);

    let body: Partial<CoreMediaGenerationRequest>;
    try {
      body = (await c.req.json()) as Partial<CoreMediaGenerationRequest>;
    } catch {
      return c.json<CoreMediaGenerationErrorResponse>(
        { error: "request body is required", code: "invalid_request" },
        400,
      );
    }

    const validationError = validateMediaGenerationRequest(body);
    if (validationError) {
      return c.json<CoreMediaGenerationErrorResponse>(
        { error: validationError, code: "invalid_request" },
        400,
      );
    }

    const request = body as CoreMediaGenerationRequest;
    try {
      return c.json(await runtime.generateMedia(request));
    } catch (error) {
      const classified =
        runtime.classifyMediaError?.(error, request) ?? classifyCoreMediaError(error, request);
      const status =
        runtime.mediaErrorStatus?.(classified.code, error) ?? mediaErrorStatus(classified);
      return c.json(classified, status as 400 | 401 | 403 | 500);
    }
  });

  app.post("/api/chat", async (c) => {
    if (!(await isAuthorized(c.req.raw, options))) {
      return c.json(chatErrorResponse("unauthorized"), 401);
    }

    let body: Omit<CoreChatInput, "abortSignal"> & { messages?: UIMessage[] };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json(chatErrorResponse("invalid_request"), 400);
    }

    const messages = body.messages?.filter(
      (message) => Array.isArray(message.parts) && message.parts.length > 0,
    );
    if (!messages?.length) return c.json(chatErrorResponse("invalid_request"), 400);
    if (!body.model) return c.json(chatErrorResponse("missing_model"), 400);
    if (body.runId !== undefined && !isUuid(body.runId)) {
      return c.json(chatErrorResponse("invalid_run_id"), 400);
    }
    if (body.mode !== undefined && body.mode !== "start" && body.mode !== "resume") {
      return c.json(chatErrorResponse("invalid_mode"), 400);
    }
    if (body.reasoning !== undefined && !isReasoningLevel(body.reasoning)) {
      return c.json(chatErrorResponse("invalid_request"), 400);
    }
    if (body.permissionMode !== undefined && !isPermissionMode(body.permissionMode)) {
      return c.json(chatErrorResponse("invalid_request"), 400);
    }

    const runId = body.runId ?? randomUUID();
    const mode = body.mode === "resume" && body.runId ? "resume" : "start";
    const input: CoreChatInput = {
      ...body,
      messages,
      runId,
      mode,
      abortSignal: c.req.raw.signal,
    };

    try {
      return withChatRunId(await runtime.chat(input), runId);
    } catch (error) {
      const classification = classifyRuntimeChatError(runtime, error, c.req.raw.signal);
      if (
        mode === "resume" &&
        (classification.code === "run_not_active" || classification.code === "run_not_found")
      ) {
        const recoveryRunId = randomUUID();
        try {
          const response = await runtime.chat({
            ...input,
            runId: recoveryRunId,
            mode: "start",
            recovery: { previousRunId: runId, reason: classification.code },
          });
          return withChatRunId(response, recoveryRunId);
        } catch (recoveryError) {
          const recoveryClassification = classifyRuntimeChatError(
            runtime,
            recoveryError,
            c.req.raw.signal,
          );
          console.error(
            "[core] /api/chat recovery failed:",
            recoveryClassification.code,
            recoveryClassification.diagnostic,
          );
          return c.json(
            {
              error: recoveryClassification.error,
              code: recoveryClassification.code,
              retryable: recoveryClassification.retryable,
            },
            recoveryClassification.status,
          );
        }
      }

      console.error("[core] /api/chat failed:", classification.code, classification.diagnostic);
      return c.json(
        {
          error: classification.error,
          code: classification.code,
          retryable: classification.retryable,
        },
        classification.status,
      );
    }
  });

  app.post("/api/title", async (c) => {
    if (!(await isAuthorized(c.req.raw, options)))
      return c.json({ error: "Unauthorized chat session" }, 401);
    const body = await readJson<{ messages?: UIMessage[]; model?: string }>(c.req.raw);
    if (!body?.messages?.length) return c.json({ error: "messages cannot be empty" }, 400);
    if (!body.model) return c.json({ error: "model is required in provider/model format" }, 400);

    try {
      const promptText = formatMessages(body.messages.slice(0, 4));
      const result = await runtime.generateText({
        model: body.model,
        system:
          "你是一名对话标题生成助手。根据用户与助手的一两轮对话，生成一个不超过 20 个汉字（或 8 个英文单词）的简洁标题。" +
          "要求：1) 直接给出标题文本，不要加引号、不要加前缀；2) 反映对话核心主题；3) 使用对话使用的语言；4) 只输出标题本身，不要解释。",
        prompt: promptText,
        temperature: 0.4,
        maxOutputTokens: 64,
      });
      const title = sanitizeTitle(result.text);
      return title ? c.json({ title }) : c.json({ error: "Empty title from model" }, 500);
    } catch (error) {
      return c.json({ error: readErrorMessage(error) }, 500);
    }
  });

  app.post("/api/followups", async (c) => {
    if (!(await isAuthorized(c.req.raw, options)))
      return c.json({ error: "Unauthorized chat session" }, 401);
    const body = await readJson<{
      messages?: UIMessage[];
      model?: string;
      generationId?: string;
      previousSuggestions?: unknown;
    }>(c.req.raw);
    if (!body?.messages?.length) return c.json({ error: "messages cannot be empty" }, 400);
    if (!body.model) return c.json({ error: "model is required in provider/model format" }, 400);

    try {
      const previousSuggestions = normalizePreviousSuggestions(body.previousSuggestions);
      const result = await runtime.generateText({
        model: body.model,
        system:
          "你是一名对话助手。根据用户与助手的最近对话，生成 2~4 个用户可能想继续追问的简短问题建议。" +
          "要求：1) 每个问题简洁有力（不超过 20 字），自然口语化；2) 问题必须与当前对话主题紧密相关、有实际价值；" +
          "3) 不要泛泛而谈；4) 使用对话所使用的语言；5) 每次请求都要重新生成；" +
          '6) 仅输出 JSON 数组，格式：["问题1","问题2","问题3"]，不要输出其他内容。',
        prompt:
          `${formatMessages(body.messages.slice(-6))}\n\n这是一次新的建议生成请求（编号：${body.generationId?.trim() || randomUUID()}），请换一个切入角度重新生成。` +
          (previousSuggestions.length > 0
            ? `\n上一轮已经展示过这些建议，请不要重复：${JSON.stringify(previousSuggestions)}`
            : ""),
        temperature: 0.7,
        maxOutputTokens: 256,
      });
      return c.json({ suggestions: parseSuggestions(result.text, previousSuggestions) });
    } catch (error) {
      return c.json({ error: readErrorMessage(error) }, 500);
    }
  });

  app.post("/api/suggestions", async (c) => {
    if (!(await isAuthorized(c.req.raw, options)))
      return c.json({ error: "Unauthorized chat session" }, 401);
    const body = await readJson<{ model?: string; locale?: string }>(c.req.raw);
    if (!body?.model) return c.json({ error: "model is required in provider/model format" }, 400);

    try {
      const langName = body.locale?.toLowerCase().startsWith("zh") ? "中文" : "English";
      const result = await runtime.generateText({
        model: body.model,
        system:
          "你是一名富有创意的对话助手。请为用户随机生成 4 个适合在新对话中开场的有趣问题或任务建议。" +
          "要求：1) 每个建议简洁有力（不超过 20 字），自然口语化；2) 主题尽量多样化；" +
          `3) 使用${langName}输出；4) 仅输出 JSON 数组，格式：["建议1","建议2","建议3","建议4"]，不要输出其他内容。`,
        prompt: "请生成 4 个随机的开场建议。",
        temperature: 1,
        maxOutputTokens: 256,
      });
      return c.json({ suggestions: parseSuggestions(result.text, []).slice(0, 4) });
    } catch (error) {
      return c.json({ error: readErrorMessage(error) }, 500);
    }
  });

  return app;
}

async function isAuthorized(request: Request, options: CoreAppOptions): Promise<boolean> {
  if (options.authorize) return options.authorize(request);
  if (options.sessionToken === undefined) return true;
  return request.headers.get(CHAT_SESSION_HEADER) === options.sessionToken;
}

async function isRealtimeSetupAuthorized(
  request: Request,
  options: CoreAppOptions,
): Promise<boolean> {
  if (options.authorize) return options.authorize(request);
  if (options.sessionToken === undefined) return true;
  const provided = new URL(request.url).searchParams.get("session") ?? "";
  return constantTimeEqual(provided, options.sessionToken);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index++)
    difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function isRealtimeSetupRequest(
  model: string,
  value: unknown,
): value is { sessionConfig: Record<string, unknown> } {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "sessionConfig")) return false;
  if (!/^[a-z0-9._-]{1,48}\/[a-zA-Z0-9._-]{1,128}$/.test(model)) return false;
  if (
    record.sessionConfig === null ||
    typeof record.sessionConfig !== "object" ||
    Array.isArray(record.sessionConfig)
  )
    return false;
  const config = record.sessionConfig as Record<string, unknown>;
  const allowedKeys = new Set([
    "instructions",
    "voice",
    "inputAudioTranscription",
    "outputAudioTranscription",
    "turnDetection",
    "outputModalities",
  ]);
  if (Object.keys(config).some((key) => !allowedKeys.has(key))) return false;
  return (
    typeof config.instructions === "string" &&
    config.instructions.length <= 16_000 &&
    (config.voice === undefined ||
      (typeof config.voice === "string" && config.voice.length > 0 && config.voice.length <= 64)) &&
    isEmptyRecord(config.inputAudioTranscription) &&
    isEmptyRecord(config.outputAudioTranscription) &&
    (config.outputModalities === undefined ||
      (Array.isArray(config.outputModalities) &&
        config.outputModalities.length <= 2 &&
        config.outputModalities.every(
          (modality) => modality === "text" || modality === "audio",
        ))) &&
    (config.turnDetection === undefined ||
      (config.turnDetection !== null &&
        typeof config.turnDetection === "object" &&
        (config.turnDetection as Record<string, unknown>).type === "server-vad"))
  );
}

function isEmptyRecord(value: unknown): boolean {
  return (
    value === undefined ||
    (value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0)
  );
}

function unauthorizedMediaResponse(c: Context) {
  return c.json<CoreMediaGenerationErrorResponse>(
    { error: "Unauthorized chat session", code: "unauthorized" },
    401,
  );
}

function classifyRuntimeChatError(
  runtime: CoreRuntime,
  error: unknown,
  abortSignal: AbortSignal,
): CoreChatErrorClassification {
  return (
    runtime.classifyChatError?.(error, { phase: "request", abortSignal }) ??
    classifyCoreChatError(error, { phase: "request", abortSignal })
  );
}

function validateMediaGenerationRequest(body: Partial<CoreMediaGenerationRequest>): string | null {
  if (!body || typeof body !== "object") return "request body is required";
  if (!body.kind) return "kind is required";
  if (!(["image", "speech", "transcription"] as const).includes(body.kind)) {
    return "kind must be one of: image, speech, transcription";
  }
  if (!body.model || typeof body.model !== "string") {
    return "model is required in provider/model format";
  }
  if (body.kind === "image" && !(typeof body.prompt === "string" && body.prompt.trim())) {
    return "prompt is required";
  }
  if (body.kind === "speech" && !(typeof body.text === "string" && body.text.trim())) {
    return "text is required";
  }
  if (body.kind === "transcription" && !(body.audio?.url && body.audio.url.trim())) {
    return "audio.url is required";
  }
  return null;
}

function classifyCoreMediaError(
  error: unknown,
  request: CoreMediaGenerationRequest,
): CoreMediaGenerationErrorResponse {
  const message = readErrorMessage(error);
  const lower = message.toLowerCase();
  const base = { error: message, kind: request.kind, model: request.model };
  if (
    lower.includes("api key") ||
    lower.includes("not configured") ||
    lower.includes("unknown model")
  ) {
    return { ...base, code: "no_model" };
  }
  if (lower.includes("does not support")) return { ...base, code: "unsupported_model" };
  if (
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("unauthorized")
  ) {
    return { ...base, code: "permission_denied" };
  }
  return { ...base, code: "upstream_error" };
}

function mediaErrorStatus(error: CoreMediaGenerationErrorResponse): 400 | 401 | 403 | 500 {
  if (error.code === "unauthorized") return 401;
  if (error.code === "permission_denied") return 403;
  if (["invalid_request", "no_model", "unsupported_model"].includes(error.code)) return 400;
  return 500;
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.clone().json()) as T;
  } catch {
    return null;
  }
}

function formatMessages(messages: UIMessage[]): string {
  return messages
    .map((message) => {
      const text = message.parts
        .filter((part) => part.type === "text")
        .map((part) => (part as { text: string }).text)
        .join(" ")
        .trim();
      return `${message.role === "user" ? "用户" : "助手"}：${text}`;
    })
    .filter((line) => line.length > 2)
    .join("\n");
}

function normalizePreviousSuggestions(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 60)
        .slice(0, 4)
    : [];
}

function parseSuggestions(raw: string, previous: string[]): string[] {
  const match = raw.trim().match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    const previousSet = new Set(previous.map((item) => item.toLocaleLowerCase()));
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim())
      .filter((item) => item.length <= 60 && !previousSet.has(item.toLocaleLowerCase()))
      .slice(0, 4);
  } catch {
    return [];
  }
}

function sanitizeTitle(raw: string): string {
  let text = raw.trim().replace(/^["'`“”‘’「」『』《》]+|["'`“”‘’「」『』《》]+$/g, "");
  text = text.replace(/\s*\n+\s*/g, " ");
  return (text.length > 40 ? text.slice(0, 40) : text).trim();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isReasoningLevel(value: unknown): boolean {
  return ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"].includes(
    String(value),
  );
}

function isPermissionMode(value: unknown): boolean {
  return ["ask", "approve_risky", "full_access"].includes(String(value));
}

function withChatRunId(response: Response, runId: string): Response {
  const headers = new Headers(response.headers);
  headers.set(CHAT_RUN_ID_HEADER, runId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
