import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { generateText, type UIMessage } from "ai";
import {
  CHAT_SESSION_HEADER,
  type ChatErrorResponse,
  isChatReasoningLevel,
  type ChatReasoningLevel,
  type ChatToolSelectionRequest,
  type LocalServerInfo,
  type MediaGenerationErrorResponse,
  type MediaGenerationRequest,
} from "../../shared/types";
import type { ResolvedChatModel } from "../lib/chat-agent";
import {
  classifyMediaGenerationError,
  executeMediaGeneration,
  hasVisionInput,
  resolveConfiguredVisionModelRef,
  mediaErrorStatus,
  validateMediaGenerationRequest,
} from "../lib/media-generation";
import { chatErrorResponse, chatErrorStatus, classifyChatError } from "../lib/chat-errors";

const ALLOWED_ORIGIN_PATTERNS = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

let server: ReturnType<typeof serve> | null = null;
let assignedPort = 0;
const sessionToken = randomBytes(32).toString("hex");

interface CreateAppOptions {
  sessionToken?: string;
  getAssignedPort?: () => number;
  resolveModel?: (modelRef: string) => ResolvedChatModel;
  resolveConfiguredVisionModelRef?: typeof resolveConfiguredVisionModelRef;
  resolveMediaModel?: typeof import("../lib/providers").resolveMediaModel;
  writeMediaAsset?: typeof import("../lib/media-assets").writeMediaAsset;
  buildAgentSystemPrompt?: (agentId?: string | null, conversationId?: string) => Promise<string>;
  runAgentChat?: typeof import("../lib/agent-runtime").runAgentChat;
}

function allowRendererOrigin(origin: string): string | null {
  if (origin === "null") return origin;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin)) ? origin : null;
}

function isAuthorized(
  c: { req: { header: (name: string) => string | undefined } },
  token: string,
): boolean {
  return c.req.header(CHAT_SESSION_HEADER) === token;
}

function parseChatReasoningLevel(raw: unknown): {
  ok: boolean;
  value?: ChatReasoningLevel;
} {
  if (raw === undefined) return { ok: true };
  if (!isChatReasoningLevel(raw)) return { ok: false };
  return { ok: true, value: raw };
}

/** Create the local loopback HTTP app used by the renderer chat transport. */
export function createApp(options: CreateAppOptions = {}): Hono {
  const token = options.sessionToken ?? sessionToken;
  const getAssignedPort = options.getAssignedPort ?? (() => assignedPort);
  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: (origin) => allowRendererOrigin(origin),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", CHAT_SESSION_HEADER],
      maxAge: 600,
    }),
  );

  app.get("/api/health", (c) => c.json({ ok: true, port: getAssignedPort() }));

  app.get("/api/models", async (c) => {
    const { listProviders } = await import("../lib/providers");
    const providers = listProviders()
      .map((p) => ({
        id: p.id,
        label: p.label,
        models: p.models.filter((model) => model.enabled),
        helpUrl: p.helpUrl,
      }))
      .filter((provider) => provider.models.length > 0);
    return c.json({ providers });
  });

  app.post("/api/media/generate", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json(
        {
          error: "Unauthorized chat session",
          code: "unauthorized",
        } satisfies MediaGenerationErrorResponse,
        401,
      );
    }

    const body = (await c.req.json()) as Partial<MediaGenerationRequest>;
    const validationError = validateMediaGenerationRequest(body);
    if (validationError) {
      return c.json(
        { error: validationError, code: "invalid_request" } satisfies MediaGenerationErrorResponse,
        400,
      );
    }
    const request = body as MediaGenerationRequest;

    try {
      return c.json(
        await executeMediaGeneration(request, {
          resolveMediaModel: options.resolveMediaModel,
          writeMediaAsset: options.writeMediaAsset,
          conversationId: request.conversationId,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/media/generate failed:", message);
      const error = classifyMediaGenerationError(message, request);
      return c.json(error, mediaErrorStatus(error.code, err));
    }
  });
  app.post("/api/chat", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json(chatErrorResponse("unauthorized"), 401);
    }

    let body: {
      messages: UIMessage[];
      /** Formatted as "provider/model". */
      model?: string;
      system?: string;
      agentId?: string;
      conversationId?: string;
      reasoning?: unknown;
      toolSelection?: ChatToolSelectionRequest;
      cronRun?: boolean;
      runId?: string;
      mode?: "start" | "resume";
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json(chatErrorResponse("invalid_request"), 400);
    }

    const messages = body.messages?.filter(
      (message) => Array.isArray(message.parts) && message.parts.length > 0,
    );
    if (!messages?.length) {
      return c.json(chatErrorResponse("invalid_request"), 400);
    }
    if (!body.model) {
      return c.json(chatErrorResponse("missing_model"), 400);
    }
    if (body.runId !== undefined && !isUuid(body.runId)) {
      return c.json(chatErrorResponse("invalid_run_id"), 400);
    }
    if (body.mode !== undefined && body.mode !== "start" && body.mode !== "resume") {
      return c.json(chatErrorResponse("invalid_mode"), 400);
    }
    const parsedReasoning = parseChatReasoningLevel(body.reasoning);
    if (!parsedReasoning.ok) {
      return c.json(chatErrorResponse("invalid_request"), 400);
    }

    try {
      const materializedMessages = await (
        await import("../lib/conversation-workspace")
      ).normalizeChatMediaInputs(body.conversationId, messages);
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const buildAgentSystemPrompt =
        options.buildAgentSystemPrompt ?? (await import("../lib/db")).buildAgentSystemPrompt;
      const configuredVisionModel = await (options.resolveConfiguredVisionModelRef
        ? options.resolveConfiguredVisionModelRef(materializedMessages)
        : options.resolveModel
          ? null
          : resolveConfiguredVisionModelRef(materializedMessages));
      const requestedModel = configuredVisionModel ?? body.model;
      const resolved = resolveModel(requestedModel);
      if (hasVisionInput(materializedMessages) && !resolved.capabilities?.vision) {
        const error = Object.assign(
          new Error("The selected chat model cannot process image input."),
          { code: "vision_model_unavailable" },
        );
        throw error;
      }
      const reasoning = parsedReasoning;
      const runAgentChat =
        options.runAgentChat ?? (await import("../lib/agent-runtime")).runAgentChat;
      return await runAgentChat({
        messages: materializedMessages,
        modelRef: requestedModel,
        overrideAgentModel: hasVisionInput(materializedMessages),
        resolved,
        conversationId: body.conversationId,
        preferredAgentId: body.agentId,
        reasoning: reasoning.value,
        toolSelection: body.toolSelection,
        disableCronTools: body.cronRun === true,
        runId: body.runId,
        mode: body.mode ?? "start",
        origin: body.cronRun === true ? "automation" : "chat",
        buildAgentSystemPrompt: async (agentId, conversationId) =>
          body.system ?? (await buildAgentSystemPrompt(agentId, conversationId)),
        resolveModel,
        abortSignal: c.req.raw.signal,
      });
    } catch (err) {
      const classification = classifyChatError(err, {
        phase: "request",
        abortSignal: c.req.raw.signal,
      });
      console.error("[server] /api/chat failed:", classification.code, classification.diagnostic);
      return c.json(
        {
          error: classification.error,
          code: classification.code,
          retryable: classification.retryable,
        } satisfies ChatErrorResponse,
        chatErrorStatus(classification),
      );
    }
  });

  /**
   * POST /api/title
   *
   * 用 LLM 给一段对话起一个简短的标题
   *  - 入参：{ model, messages: UIMessage[] }
   *  - 出参：{ title: string }
   *
   * 使用非流式 generateText，温度 0.4 偏向稳定。
   * 标题清洗：去除前后空白、引号、换行，长度上限 40 字。
   */
  app.post("/api/title", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json({ error: "Unauthorized chat session" }, 401);
    }

    const body = (await c.req.json()) as {
      messages?: UIMessage[];
      model?: string;
    };

    if (!body.messages?.length) {
      return c.json({ error: "messages cannot be empty" }, 400);
    }
    if (!body.model) {
      return c.json({ error: "model is required in provider/model format" }, 400);
    }

    try {
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const resolved = resolveModel(body.model);

      // 取前 2 轮（user + assistant）作为标题生成上下文，避免长对话打爆 prompt
      const excerpt = body.messages.slice(0, 4);
      const promptText = excerpt
        .map((m) => {
          const text = (m.parts ?? [])
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join(" ")
            .trim();
          return `${m.role === "user" ? "用户" : "助手"}：${text}`;
        })
        .filter((line) => line.length > 2)
        .join("\n");

      const result = await generateText({
        model: resolved.model,
        system:
          "你是一名对话标题生成助手。根据用户与助手的一两轮对话，生成一个不超过 20 个汉字（或 8 个英文单词）的简洁标题。" +
          "要求：1) 直接给出标题文本，不要加引号、不要加前缀；2) 反映对话核心主题；3) 使用对话使用的语言；" +
          "4) 只输出标题本身，不要解释。",
        prompt: promptText,
        temperature: 0.4,
        maxOutputTokens: 64,
        providerOptions: resolved.providerOptions,
      });

      const title = sanitizeTitle(result.text);
      if (!title) {
        return c.json({ error: "Empty title from model" }, 500);
      }
      return c.json({ title });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/title failed:", message);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * POST /api/followups
   *
   * 用 LLM 基于对话上下文生成追问建议（2-4 条）。
   *  - 入参：{ model, messages: UIMessage[] }
   *  - 出参：{ suggestions: string[] }
   *
   * 取最近几轮对话作为上下文，使用非流式 generateText。
   */
  app.post("/api/followups", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json({ error: "Unauthorized chat session" }, 401);
    }

    const body = (await c.req.json()) as {
      messages?: UIMessage[];
      model?: string;
    };

    if (!body.messages?.length) {
      return c.json({ error: "messages cannot be empty" }, 400);
    }
    if (!body.model) {
      return c.json({ error: "model is required in provider/model format" }, 400);
    }

    try {
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const resolved = resolveModel(body.model);

      // 取最近 6 条消息（约 3 轮）作为上下文
      const excerpt = body.messages.slice(-6);
      const promptText = excerpt
        .map((m) => {
          const text = (m.parts ?? [])
            .filter((p) => p.type === "text")
            .map((p) => (p as { text: string }).text)
            .join(" ")
            .trim();
          return `${m.role === "user" ? "用户" : "助手"}：${text}`;
        })
        .filter((line) => line.length > 2)
        .join("\n");

      const result = await generateText({
        model: resolved.model,
        system:
          "你是一名对话助手。根据用户与助手的最近对话，生成 2~4 个用户可能想继续追问的简短问题建议。" +
          "要求：" +
          "1) 每个问题简洁有力（不超过 20 字），自然口语化；" +
          "2) 问题必须与当前对话主题紧密相关、有实际价值；" +
          "3) 不要泛泛而谈（如「请详细说明」），要具体到对话内容；" +
          "4) 使用对话所使用的语言；" +
          '5) 仅输出 JSON 数组，格式：["问题1","问题2","问题3"]，不要输出其他内容。',
        prompt: promptText,
        temperature: 0.7,
        maxOutputTokens: 256,
        providerOptions: resolved.providerOptions,
      });

      const raw = result.text.trim();
      // 尝试从输出中提取 JSON 数组
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return c.json({ suggestions: [] });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return c.json({ suggestions: [] });
      }
      if (!Array.isArray(parsed)) {
        return c.json({ suggestions: [] });
      }
      const suggestions = parsed
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 60)
        .map((s) => s.trim())
        .slice(0, 4);
      return c.json({ suggestions });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/followups failed:", message);
      return c.json({ error: message }, 500);
    }
  });

  /**
   * POST /api/suggestions
   *
   * 用 LLM 随机生成「新建对话」的 4 个建议开场问题 / 任务。
   *  - 入参：{ model, locale? }
   *  - 出参：{ suggestions: string[] }
   *
   * 不依赖任何上下文，强调多样性与随机性，使用非流式 generateText。
   */
  app.post("/api/suggestions", async (c) => {
    if (!isAuthorized(c, token)) {
      return c.json({ error: "Unauthorized chat session" }, 401);
    }

    const body = (await c.req.json()) as {
      model?: string;
      locale?: string;
    };

    if (!body.model) {
      return c.json({ error: "model is required in provider/model format" }, 400);
    }

    try {
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const resolved = resolveModel(body.model);
      const langName = body.locale?.toLowerCase().startsWith("zh") ? "中文" : "English";

      const result = await generateText({
        model: resolved.model,
        system:
          "你是一名富有创意的对话助手。请为用户随机生成 4 个适合在新对话中开场的有趣问题或任务建议。" +
          "要求：" +
          "1) 每个建议简洁有力（不超过 20 字），自然口语化；" +
          "2) 主题尽量多样化，覆盖不同领域（如写作、编程、学习、生活、创意、分析等），彼此不要雷同；" +
          "3) 要有实际可操作性，能直接作为一条用户消息发起对话；" +
          `4) 使用${langName}输出；` +
          '5) 仅输出 JSON 数组，格式：["建议1","建议2","建议3","建议4"]，不要输出其他内容。',
        prompt: "请生成 4 个随机的开场建议。",
        temperature: 1,
        maxOutputTokens: 256,
        providerOptions: resolved.providerOptions,
      });

      const raw = result.text.trim();
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return c.json({ suggestions: [] });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return c.json({ suggestions: [] });
      }
      if (!Array.isArray(parsed)) {
        return c.json({ suggestions: [] });
      }
      const suggestions = parsed
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 60)
        .map((s) => s.trim())
        .slice(0, 4);
      return c.json({ suggestions });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[server] /api/suggestions failed:", message);
      return c.json({ error: message }, 500);
    }
  });

  // ---------- 工作流编排端点 ----------
  // 工作流不再对外暴露 HTTP 端点：侧栏入口已下线，widget 直接走 IPC 与主进程内的 engine/cancellation 交互。
  // 底层 db schema、engine、cancellation、dispatcher（handoff/approval）保留作为核心模块。

  return app;
}

/** Start the local HTTP server bound to loopback on a random free port. */
export function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(assignedPort);
      return;
    }
    try {
      const instance = serve({
        fetch: createApp().fetch,
        hostname: "127.0.0.1",
        port: 0,
        overrideGlobalObjects: false,
      });
      server = instance;

      instance.on?.("listening", () => {
        const addr = instance.address();
        if (addr && typeof addr === "object" && "port" in addr) {
          assignedPort = addr.port;
          void import("../lib/db")
            .then(({ insertRuntimeEvent }) => {
              insertRuntimeEvent({
                kind: "diagnostic",
                status: "succeeded",
                severity: "info",
                title: "Local AI server started",
                detail_json: JSON.stringify({
                  url: "http://127.0.0.1:" + assignedPort,
                  capabilities: [
                    "chat-stream",
                    "agent-context",
                    "memory-injection",
                    "media-generation",
                  ],
                }),
              });
            })
            .catch((err) => {
              console.error("[server] failed to record local server diagnostic:", err);
            });
          console.log(`[server] Local AI server started: http://127.0.0.1:${assignedPort}`);
          resolve(assignedPort);
        }
      });

      instance.on?.("error", (err: NodeJS.ErrnoException) => {
        console.error("[server] failed to start:", err);
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function stopServer(): void {
  if (server) {
    server.close?.();
    server = null;
    assignedPort = 0;
  }
}

export function getServerPort(): number {
  return assignedPort;
}

export function getServerInfo(): LocalServerInfo {
  return { port: assignedPort, token: sessionToken };
}

/**
 * 清洗模型返回的标题：
 *  - 去除前后空白
 *  - 去掉成对引号 / 书名号 / 反引号
 *  - 折叠换行
 *  - 截断到 40 字
 */
function sanitizeTitle(raw: string): string {
  let text = raw.trim();
  // 去掉成对包裹的引号
  text = text.replace(/^["'`“”‘’「」『』《》]+|["'`“”‘’「」『』《》]+$/g, "");
  // 折叠多行
  text = text.replace(/\s*\n+\s*/g, " ");
  // 截断到 40 字
  if (text.length > 40) text = text.slice(0, 40);
  return text.trim();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
