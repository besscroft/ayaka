import { randomBytes } from "node:crypto";
import { generateText } from "ai";
import {
  createCoreApp,
  startCoreServer,
  type CoreChatInput,
  type CoreRuntime,
  type CoreTextGenerationInput,
} from "@ayaka/core";
import {
  type CoreChatErrorClassification,
  type CoreMediaGenerationErrorResponse,
  type CoreMediaGenerationRequest,
  type CoreServerInfo,
} from "@ayaka/core/contracts";
import type {
  ChatPermissionMode,
  ChatReasoningLevel,
  ChatToolSelectionRequest,
  LocalServerInfo,
  MediaGenerationRequest,
} from "../../shared/types";
import type { ResolvedChatModel } from "../lib/chat-agent";
import {
  classifyMediaGenerationError,
  executeMediaGeneration,
  hasVisionInput,
  mediaErrorStatus,
  resolveConfiguredVisionModelRef,
} from "../lib/media-generation";
import { classifyChatError } from "../lib/chat-errors";
import { normalizeChatMediaInputs } from "../lib/conversation-workspace";

let server: { close(): void } | null = null;
let assignedPort = 0;
const sessionToken = randomBytes(32).toString("hex");

export interface CreateAppOptions {
  sessionToken?: string;
  getAssignedPort?: () => number;
  resolveModel?: (modelRef: string) => ResolvedChatModel;
  resolveConfiguredVisionModelRef?: typeof resolveConfiguredVisionModelRef;
  resolveMediaModel?: typeof import("../lib/providers").resolveMediaModel;
  createRealtimeToken?: typeof import("../lib/providers").createRealtimeToken;
  writeMediaAsset?: typeof import("../lib/media-assets").writeMediaAsset;
  buildAgentSystemPrompt?: (
    agentId?: string | null,
    conversationId?: string,
    options?: { includeMemory?: boolean },
  ) => Promise<string>;
  runAgentChat?: typeof import("../lib/agent-runtime").runAgentChat;
}

/** Create the desktop host's Core app with privileged runtime capabilities injected. */
export function createApp(options: CreateAppOptions = {}) {
  const runtime = createDesktopRuntimeAdapter(options);
  return createCoreApp({
    runtime,
    sessionToken: options.sessionToken ?? sessionToken,
    getAssignedPort: options.getAssignedPort ?? (() => assignedPort),
    corsOrigin: (origin) => {
      if (origin === "null") return origin;
      return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : null;
    },
  });
}

export function createDesktopRuntimeAdapter(options: CreateAppOptions = {}): CoreRuntime {
  return {
    async listModels() {
      const { listProviders } = await import("../lib/providers");
      return listProviders()
        .map((provider) => ({
          id: provider.id,
          label: provider.label,
          models: provider.models.filter((model) => model.enabled) as unknown as readonly Record<
            string,
            unknown
          >[],
          helpUrl: provider.helpUrl,
        }))
        .filter((provider) => provider.models.length > 0);
    },

    async chat(input: CoreChatInput) {
      const body = input as CoreChatInput & {
        toolSelection?: ChatToolSelectionRequest;
        permissionMode?: ChatPermissionMode;
        recovery?: { previousRunId: string; reason: "run_not_active" | "run_not_found" };
      };
      const materializedMessages = await normalizeChatMediaInputs(
        body.conversationId,
        body.messages,
      );
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const buildAgentSystemPrompt =
        options.buildAgentSystemPrompt ?? (await import("../lib/db")).buildAgentSystemPrompt;
      const configuredVisionModel = await (options.resolveConfiguredVisionModelRef
        ? options.resolveConfiguredVisionModelRef(materializedMessages)
        : options.resolveModel
          ? null
          : resolveConfiguredVisionModelRef(materializedMessages));
      const requestedModel = configuredVisionModel ?? body.model;
      if (!requestedModel)
        throw Object.assign(new Error("model is required"), { code: "missing_model" });
      const resolved = resolveModel(requestedModel);
      if (hasVisionInput(materializedMessages) && !resolved.capabilities?.vision) {
        throw Object.assign(new Error("The selected chat model cannot process image input."), {
          code: "vision_model_unavailable",
        });
      }

      const runAgentChat =
        options.runAgentChat ?? (await import("../lib/agent-runtime")).runAgentChat;
      const runOptions = {
        messages: materializedMessages,
        modelRef: requestedModel,
        overrideAgentModel: hasVisionInput(materializedMessages),
        resolved,
        conversationId: body.conversationId,
        preferredAgentId: body.agentId,
        reasoning: body.reasoning as ChatReasoningLevel | undefined,
        toolSelection: body.toolSelection,
        permissionMode: body.permissionMode,
        disableCronTools: body.cronRun === true,
        origin: body.cronRun === true ? "automation" : "chat",
        buildAgentSystemPrompt: async (
          agentId: string | null | undefined,
          conversationId: string | undefined,
          promptOptions: { includeMemory?: boolean } | undefined,
        ) => body.system ?? (await buildAgentSystemPrompt(agentId, conversationId, promptOptions)),
        resolveModel,
        abortSignal: body.abortSignal,
      } satisfies Omit<Parameters<typeof runAgentChat>[0], "mode" | "recovery" | "runId">;

      return runAgentChat({
        ...runOptions,
        runId: body.runId,
        mode: body.mode,
        recovery: body.recovery,
      });
    },

    async generateText(input: CoreTextGenerationInput) {
      const resolveModel = options.resolveModel ?? (await import("../lib/providers")).resolveModel;
      const resolved = resolveModel(input.model);
      const result = await generateText({
        model: resolved.model,
        system: input.system,
        prompt: input.prompt,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        providerOptions: resolved.providerOptions,
      });
      return { text: result.text };
    },

    async generateMedia(input: CoreMediaGenerationRequest) {
      return executeMediaGeneration(input as MediaGenerationRequest, {
        resolveMediaModel: options.resolveMediaModel,
        writeMediaAsset: options.writeMediaAsset,
        conversationId: input.conversationId,
      });
    },

    async createRealtimeToken(modelRef, sessionConfig) {
      const createToken =
        options.createRealtimeToken ?? (await import("../lib/providers")).createRealtimeToken;
      return createToken(
        modelRef,
        sessionConfig as import("ai").Experimental_RealtimeSessionConfig,
      );
    },

    classifyChatError(error, errorOptions): CoreChatErrorClassification {
      return classifyChatError(error, errorOptions);
    },

    classifyMediaError(error, request): CoreMediaGenerationErrorResponse {
      return classifyMediaGenerationError(
        error instanceof Error ? error.message : String(error),
        request as MediaGenerationRequest,
      );
    },

    mediaErrorStatus(code, error) {
      return mediaErrorStatus(code as Parameters<typeof mediaErrorStatus>[0], error);
    },
  };
}

/** Start the local HTTP server bound to loopback on a random free port. */
export async function startServer(): Promise<number> {
  if (server) return assignedPort;

  const handle = await startCoreServer(createApp(), { hostname: "127.0.0.1", port: 0 });
  server = handle;
  assignedPort = handle.port;
  void import("../lib/db")
    .then(({ insertRuntimeEvent }) => {
      insertRuntimeEvent({
        kind: "diagnostic",
        status: "succeeded",
        severity: "info",
        title: "Local AI server started",
        detail_json: JSON.stringify({
          url: `http://127.0.0.1:${assignedPort}`,
          capabilities: ["chat-stream", "agent-context", "memory-injection", "media-generation"],
        }),
      });
    })
    .catch((error) => console.error("[server] failed to record local server diagnostic:", error));
  console.log(`[server] Local AI server started: http://127.0.0.1:${assignedPort}`);
  return assignedPort;
}

export function stopServer(): void {
  server?.close();
  server = null;
  assignedPort = 0;
}

export function getServerPort(): number {
  return assignedPort;
}

export function getServerInfo(): LocalServerInfo {
  const info: CoreServerInfo = { port: assignedPort, token: sessionToken };
  return info;
}
