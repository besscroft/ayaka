import { randomUUID } from "node:crypto";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  jsonSchema,
  toUIMessageStream,
  ToolLoopAgent,
  tool,
} from "ai";
import type {
  FinishReason,
  ModelMessage,
  streamText,
  ToolApprovalConfiguration,
  ToolApprovalStatus,
  ToolSet,
  UIMessage,
  UIMessageStreamOptions,
} from "ai";
import {
  CHAT_TOOL_IDS,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  MEDIA_GENERATION_TOOL_NAME,
  SettingKey,
  isChatToolReference,
  normalizeMaxConcurrentSubagents,
  normalizeChatToolSelection,
  type AgentHandoffConfig,
  type AgentContextPolicy,
  type AgentProfile,
  type AgentRuntimeProtocolEvent,
  type AgentRuntimeConfig,
  type AgentRunOrigin,
  type AgentRuntimeStatus,
  type AgentToolPolicy,
  type ChatMessageMetadata,
  type ChatErrorCode,
  type ChatReasoningLevel,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type MediaGenerationToolInput,
  type ModelCapabilities,
} from "../../shared/types";
import { appendReactionFeedback, type ResolvedChatModel } from "./chat-agent";
import {
  auditChatToolApprovalResponses,
  buildChatToolRuntime,
  createMemoryHostTools,
  mergeSilentRootMemoryTools,
  type ChatToolModelContext,
  type ChatToolRuntimeConfig,
} from "./chat-tools";
import { commandLooksDangerous, inputHasPathEscape } from "./approval-policy";
import { isBuiltinToolName, rootToolRequiresApproval } from "./root-tool-approval";
import { loadAgentGraph } from "./agent-graph";
import type { AgentGraph } from "./agent-graph";
import { AgentCoordinator } from "./agent-coordinator";
import { ContextEngine } from "./context-engine";
import {
  createContextCheckpoint,
  getConversationAgentState,
  getSetting,
  upsertAgentRuntimeState,
  upsertConversationAgentState,
  createRuntimeStep,
  updateRuntimeRun,
  updateRuntimeStep,
  insertRuntimeEvent,
  saveAgentInstance,
  saveCollaborationMessage,
} from "./db";
import {
  createSandboxSnapshot,
  getOrCreateSandboxSession,
  listSandboxFiles,
  listSandboxSessionArtifacts,
  readSandboxFile,
  registerSandboxPreviewPort,
  restoreSandboxSnapshot,
  runSandboxCommand,
  writeSandboxFile,
  type SandboxContext,
} from "./sandbox-agents";
import { getSandboxSessionOrThrow } from "./sandbox-runtime";
import { ROOT_AGENT_STOP_WHEN } from "./agent-run-policy";
import { agentLoopSessions, type AgentLoopMode, type AgentLoopSession } from "./agent-loop-session";
import { RunToolScheduler, scheduleToolSet } from "./run-tool-scheduler";
import { buildMediaGenerationToolRequest, executeMediaGeneration } from "./media-generation";
import { addAgentManagementTools } from "./agent-management-tools";
import { classifyChatError } from "./chat-errors";

type StreamTextOptions = Parameters<typeof streamText>[0];
type MessageMetadataCallback = NonNullable<
  UIMessageStreamOptions<UIMessage<ChatMessageMetadata>>["messageMetadata"]
>;

export interface RunAgentChatOptions {
  messages: UIMessage[];
  modelRef: string;
  resolved: ResolvedChatModel;
  conversationId?: string;
  preferredAgentId?: string | null;
  reasoning?: StreamTextOptions["reasoning"];
  toolSelection?: ChatToolSelectionRequest;
  buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => Promise<string>;
  resolveModel?: (modelRef: string) => ResolvedChatModel;
  abortSignal?: AbortSignal;
  disableCronTools?: boolean;
  runId?: string;
  mode?: AgentLoopMode;
  origin?: AgentRunOrigin;
}

interface RuntimeContext {
  runId: string;
  rootAgent: AgentProfile;
  enabledChildren: AgentProfile[];
  agentGraph: AgentGraph;
  coordinator: AgentCoordinator;
  modelRef: string;
  resolved: ResolvedChatModel;
  modelContext: ChatToolModelContext;
  messages: UIMessage[];
  conversationId?: string;
  preferredAgentId?: string | null;
  reasoning?: StreamTextOptions["reasoning"];
  toolSelection?: ChatToolSelectionRequest;
  buildAgentSystemPrompt: (agentId?: string | null, conversationId?: string) => Promise<string>;
  resolveModel: (modelRef: string) => ResolvedChatModel;
  finalAgentId: string;
  sandbox?: SandboxContext;
  approvalRequested: boolean;
  abortSignal?: AbortSignal;
  disableCronTools: boolean;
  protocolRecorder: (event: AgentRuntimeProtocolEvent) => void;
  session: AgentLoopSession;
  toolScheduler: RunToolScheduler;
  preparedSteering: ModelMessage[];
}

const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

const handoffInputSchema = jsonSchema<{
  reason: string;
  taskSummary: string;
  priority?: "low" | "normal" | "high";
  expectedOutput?: string;
}>({
  type: "object",
  properties: {
    reason: { type: "string", description: "Why ownership should move to this agent." },
    taskSummary: { type: "string", description: "The task and context to hand off." },
    priority: { type: "string", enum: ["low", "normal", "high"] },
    expectedOutput: { type: "string", description: "What the child agent should return." },
  },
  required: ["reason", "taskSummary"],
  additionalProperties: false,
});

const consultInputSchema = jsonSchema<{ task: string; expectedOutput?: string }>({
  type: "object",
  properties: {
    task: { type: "string", description: "Specialist task for the child agent." },
    expectedOutput: { type: "string", description: "Requested response format or focus." },
  },
  required: ["task"],
  additionalProperties: false,
});

export async function runAgentChat(options: RunAgentChatOptions): Promise<Response> {
  const resolveModel = options.resolveModel ?? (await import("./providers")).resolveModel;
  const agentGraph = loadAgentGraph(DEFAULT_AGENT_ID);
  const { rootAgent, enabledChildren } = agentGraph;
  const resolvedPreferredAgentId =
    options.preferredAgentId ??
    (options.conversationId
      ? getConversationAgentState(options.conversationId)?.active_agent_id
      : null);
  const preferredAgentId =
    resolvedPreferredAgentId && resolvedPreferredAgentId !== DEFAULT_AGENT_ID
      ? resolvedPreferredAgentId
      : null;

  const rootModelRef = rootAgent.model_ref || options.modelRef;
  const rootResolved =
    rootModelRef === options.modelRef ? options.resolved : resolveModel(rootModelRef);
  const rootRuntimeConfig = readRuntimeConfig(rootAgent.runtime_config_json);
  const maxConcurrentSubagents = normalizeMaxConcurrentSubagents(
    getSetting(SettingKey.MaxConcurrentSubagents),
    rootRuntimeConfig.maxConcurrentSubagents,
  );
  const resolved = applyRuntimeConfig(rootResolved, rootRuntimeConfig);
  const modelContext = toChatToolModelContext(rootModelRef, resolved);
  const runId = options.runId ?? randomUUID();
  const session = agentLoopSessions.start({
    runId,
    conversationId: options.conversationId,
    rootAgentId: DEFAULT_AGENT_ID,
    modelRef: rootModelRef,
    origin: options.origin ?? "chat",
    mode: options.mode ?? "start",
    runtimeConfig: rootRuntimeConfig,
    inputSummary: summarizeText(extractTranscript(options.messages, 6), 1_000),
    messages: options.messages,
  });
  if (options.abortSignal) {
    if (options.abortSignal.aborted) session.cancel("request_aborted");
    else {
      options.abortSignal.addEventListener(
        "abort",
        () => session.cancel(String(options.abortSignal?.reason ?? "request_aborted")),
        { once: true },
      );
    }
  }
  const toolScheduler = new RunToolScheduler();
  const protocolRecorder = createProtocolRecorder(runId, options.conversationId);
  const coordinator = new AgentCoordinator({
    runId,
    maxConcurrentSubagents,
    onEvent: protocolRecorder,
  });
  session.attachRuntime({ coordinator, recorder: protocolRecorder });
  options.abortSignal?.addEventListener(
    "abort",
    () => {
      coordinator.interruptAll();
      session.cancel("request_aborted");
    },
    { once: true },
  );
  if ((options.mode ?? "start") === "start") {
    recordState({
      agentId: DEFAULT_AGENT_ID,
      status: "running",
      runId,
      conversationId: options.conversationId,
      summary: rootAgent.name + " is planning",
    });
    createRuntimeStep({
      run_id: runId,
      agent_id: DEFAULT_AGENT_ID,
      kind: "guardrail",
      status: "succeeded",
      title: "Input guardrails passed",
      detail: { conversationId: options.conversationId, messageCount: options.messages.length },
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      runId,
      kind: "agent",
      title: rootAgent.name + " orchestration started",
      status: "running",
      detail: {
        runId,
        modelRef: rootModelRef,
        providerKind: resolved.providerKind,
        enabledChildAgents: enabledChildren.map((agent) => agent.id),
      },
    });
  }

  auditChatToolApprovalResponses({
    messages: options.messages,
    model: modelContext,
    conversationId: options.conversationId,
    agentId: DEFAULT_AGENT_ID,
  });

  const context: RuntimeContext = {
    runId,
    rootAgent,
    enabledChildren,
    agentGraph,
    coordinator,
    modelRef: rootModelRef,
    resolved,
    modelContext,
    messages: options.messages,
    conversationId: options.conversationId,
    preferredAgentId,
    reasoning: rootRuntimeConfig.reasoning
      ? normalizeRuntimeReasoning(rootRuntimeConfig.reasoning)
      : options.reasoning !== undefined
        ? options.reasoning
        : normalizeRuntimeReasoning(resolved.reasoningDefault),
    toolSelection: applyAgentToolPolicy(
      options.toolSelection,
      readToolPolicy(rootAgent.tool_policy_json),
    ),
    buildAgentSystemPrompt: options.buildAgentSystemPrompt,
    resolveModel,
    finalAgentId: DEFAULT_AGENT_ID,
    approvalRequested: false,
    abortSignal: options.abortSignal,
    disableCronTools: options.disableCronTools === true,
    protocolRecorder,
    session,
    toolScheduler,
    preparedSteering: [],
  };
  emitProtocol(context, "agent.lifecycle", "/root", null, "start", { status: "running" });

  try {
    const toolRuntime = await buildRootToolRuntime(context);
    const rootInstructions = await createRootInstructions(context, toolRuntime.instructions);
    const contextEngine = createContextManager(context, {
      agentPath: "/root",
      modelRef: rootModelRef,
      resolved,
      runtimeConfig: rootRuntimeConfig,
      staticInstructions: rootInstructions,
      toolSchemas: toolRuntime.activeTools,
    });
    const tracker = createExecutionTracker({
      runId,
      modelRef: rootModelRef,
      agentId: DEFAULT_AGENT_ID,
      context,
      contextEngine,
    });
    const agent = createToolLoopAgent({
      id: DEFAULT_AGENT_ID,
      modelRef: rootModelRef,
      resolved,
      instructions: rootInstructions,
      messages: options.messages,
      runtimeConfig: rootRuntimeConfig,
      reasoning: context.reasoning,
      toolRuntime,
      messageStepRecorder: tracker.recordModelStep,
      contextManager: contextEngine,
      protocol: { context, agentPath: "/root", parentAgentPath: null },
      singleStep: true,
      injectSteering: true,
    });
    const finalAgent = createToolLoopAgent({
      id: DEFAULT_AGENT_ID + "-finalize",
      modelRef: rootModelRef,
      resolved,
      instructions:
        rootInstructions +
        "\n\nThe run budget is exhausted. Do not call tools. Summarize completed work, unresolved items, and the reason execution stopped.",
      messages: options.messages,
      runtimeConfig: rootRuntimeConfig,
      reasoning: context.reasoning,
      toolRuntime: {
        ...toolRuntime,
        tools: {},
        activeTools: [],
        toolChoice: "none",
        toolApproval: undefined,
      },
      messageStepRecorder: tracker.recordModelStep,
      contextManager: contextEngine,
      protocol: { context, agentPath: "/root", parentAgentPath: null },
      singleStep: true,
    });

    return await streamRootAgentLoop({
      agent,
      finalAgent,
      toolRuntime,
      context,
      tracker,
      contextEngine,
      initialMessages: options.messages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRun(context, "failed", { error: message });
    throw error;
  }
}

async function streamRootAgentLoop({
  agent,
  finalAgent,
  context,
  tracker,
  initialMessages,
}: {
  agent: ToolLoopAgent<never, ToolSet>;
  finalAgent: ToolLoopAgent<never, ToolSet>;
  toolRuntime: ChatToolRuntimeConfig;
  context: RuntimeContext;
  tracker: ReturnType<typeof createExecutionTracker>;
  contextEngine?: ContextEngine;
  initialMessages: UIMessage[];
}): Promise<Response> {
  let modelMessages = await convertToModelMessages(initialMessages, { tools: agent.tools });
  let firstEpoch = true;
  let lastFinishReason: FinishReason = "stop";
  let lastText = "";
  let lastUsage: unknown;

  const stream = createUIMessageStream<UIMessage<ChatMessageMetadata>>({
    originalMessages: initialMessages as UIMessage<ChatMessageMetadata>[],
    execute: async ({ writer }) => {
      try {
        const finalizeBudget = async (budgetReason: string): Promise<void> => {
          const finalizationPrompt: ModelMessage = {
            role: "user",
            content: `Execution budget exhausted (${budgetReason}). Provide the final status now.`,
          };
          const finalResult = await finalAgent.stream({
            prompt: [...modelMessages, finalizationPrompt],
            abortSignal: context.session.signal,
          });
          const finalUiStream = toUIMessageStream<ToolSet, UIMessage<ChatMessageMetadata>>({
            stream: finalResult.stream,
            tools: finalAgent.tools,
            sendStart: firstEpoch,
            sendFinish: false,
            sendReasoning: true,
            sendSources: true,
            originalMessages: firstEpoch
              ? (initialMessages as UIMessage<ChatMessageMetadata>[])
              : undefined,
            messageMetadata: tracker.messageMetadata,
            onError: (error) =>
              classifyChatError(error, {
                phase: "stream",
                abortSignal: context.session.signal,
              }).error,
          });
          for await (const chunk of finalUiStream) writer.write(chunk);
          lastFinishReason = await finalResult.finishReason;
          lastText = await finalResult.text;
          lastUsage = await finalResult.usage;
          firstEpoch = false;
          finishRun(context, "succeeded", {
            execution: tracker.finalize(lastFinishReason, lastUsage),
            outputSummary: lastText,
          });
        };

        while (context.session.isActive) {
          const existingBudgetReason = context.session.budgetExceededReason;
          if (existingBudgetReason) {
            await finalizeBudget(existingBudgetReason);
            break;
          }
          modelMessages = await appendQueuedMessages(
            modelMessages,
            context.session.drain("steering"),
            agent.tools,
          );
          let result: Awaited<ReturnType<typeof agent.stream>>;
          try {
            result = await agent.stream({
              prompt: modelMessages,
              abortSignal: context.session.signal,
              timeout: { totalMs: context.session.remainingDurationMs },
            });
          } catch (error) {
            if (context.session.budgetExceededReason === "max_duration") {
              await finalizeBudget("max_duration");
              break;
            }
            throw error;
          }
          const uiStream = toUIMessageStream<ToolSet, UIMessage<ChatMessageMetadata>>({
            stream: result.stream,
            tools: agent.tools,
            sendStart: firstEpoch,
            sendFinish: false,
            sendReasoning: true,
            sendSources: true,
            originalMessages: firstEpoch
              ? (initialMessages as UIMessage<ChatMessageMetadata>[])
              : undefined,
            messageMetadata: tracker.messageMetadata,
            onError: (error) =>
              classifyChatError(error, {
                phase: "stream",
                abortSignal: context.session.signal,
              }).error,
          });
          for await (const chunk of uiStream) writer.write(chunk);

          modelMessages.push(
            ...context.preparedSteering.splice(0),
            ...((await result.responseMessages) as ModelMessage[]),
          );
          const toolCalls = await result.toolCalls;
          lastFinishReason = await result.finishReason;
          lastText = await result.text;
          lastUsage = await result.usage;
          const budgetReason = context.session.recordStep();
          firstEpoch = false;

          if (context.approvalRequested) {
            finishRun(context, "succeeded");
            break;
          }
          if (budgetReason) {
            await finalizeBudget(budgetReason);
            break;
          }
          if (toolCalls.length > 0) continue;

          const steering = context.session.drain("steering");
          if (steering.length > 0) {
            context.messages.push(...steering);
            modelMessages = await appendQueuedMessages(modelMessages, steering, agent.tools);
            continue;
          }
          const followUps = context.session.drain("follow_up");
          if (followUps.length > 0) {
            modelMessages = await appendQueuedMessages(modelMessages, followUps, agent.tools);
            continue;
          }

          finishRun(context, "succeeded", {
            execution: tracker.finalize(lastFinishReason, lastUsage),
            outputSummary: lastText,
          });
          break;
        }

        if (context.session.signal.aborted) {
          writer.write({
            type: "abort",
            reason: String(context.session.signal.reason ?? "cancelled"),
          });
        } else {
          writer.write({ type: "finish", finishReason: lastFinishReason });
        }
      } catch (error) {
        const classification = classifyChatError(error, {
          phase: "stream",
          abortSignal: context.session.signal,
        });
        if (classification.code === "cancelled") {
          if (context.session.isActive) finishRun(context, "cancelled");
          writer.write({
            type: "abort",
            reason: String(context.session.signal.reason ?? "cancelled"),
          });
          return;
        }
        if (context.session.isActive) {
          finishRun(context, "failed", {
            error: classification.error,
            errorCode: classification.code,
            diagnostic: classification.diagnostic,
          });
        }
        console.error(
          "[agent-runtime] stream failed:",
          classification.code,
          classification.diagnostic,
        );
        writer.write({ type: "error", errorText: classification.error });
        writer.write({ type: "finish", finishReason: "error" });
      }
    },
    onError: (error) =>
      classifyChatError(error, {
        phase: "stream",
        abortSignal: context.session.signal,
      }).error,
  });

  return createUIMessageStreamResponse({ stream });
}

async function appendQueuedMessages(
  current: ModelMessage[],
  queued: UIMessage[],
  tools: ToolSet,
): Promise<ModelMessage[]> {
  if (queued.length === 0) return current;
  const converted = await convertToModelMessages(queued, { tools });
  return [...current, ...converted];
}

async function buildRootToolRuntime(context: RuntimeContext): Promise<ChatToolRuntimeConfig> {
  const base = buildChatToolRuntime({
    selection: context.toolSelection,
    model: context.modelContext,
    conversationId: context.conversationId,
    agentId: DEFAULT_AGENT_ID,
  });

  if (!context.modelContext.capabilities.toolCalling) {
    return base;
  }

  // The root agent (Paimon) always has the memory tools available, independent of
  // the user's chat tool selection. They remain hidden from the chat page UI.
  const memoryHostTools = createMemoryHostTools({
    model: context.modelContext,
    conversationId: context.conversationId,
    agentId: DEFAULT_AGENT_ID,
  });
  const silentMemoryRuntime = mergeSilentRootMemoryTools(base, memoryHostTools);
  const tools = silentMemoryRuntime.tools;
  const activeTools = new Set<string>(silentMemoryRuntime.activeTools);
  const builtinToolNames = new Set<string>(silentMemoryRuntime.builtinToolNames ?? []);
  assignTool(tools, MEDIA_GENERATION_TOOL_NAME, createMediaGenerationTool(context));
  activeTools.add(MEDIA_GENERATION_TOOL_NAME);
  builtinToolNames.add(MEDIA_GENERATION_TOOL_NAME);
  addAgentManagementTools(tools, activeTools, {
    actorAgentId: DEFAULT_AGENT_ID,
    runId: context.runId,
    conversationId: context.conversationId,
  });
  builtinToolNames.add("agent_create");
  builtinToolNames.add("agent_update");

  // The remaining orchestration tools follow the user's selection as before.
  // When the user turns chat tools off, only the silently-enabled memory tools
  // above remain available to the root agent.
  if (base.toolChoice !== "none") {
    if (context.disableCronTools) {
      delete tools.cron;
      activeTools.delete("cron");
    }
    const policy = readToolPolicy(context.rootAgent.tool_policy_json);

    const sandboxToolIds = selectedSandboxToolIds(context, policy);
    if (sandboxToolIds.length > 0) {
      context.sandbox = await getOrCreateSandboxSession({
        conversationId: context.conversationId,
        runId: context.runId,
        agentId: DEFAULT_AGENT_ID,
        preferredMode:
          readRuntimeConfig(context.rootAgent.runtime_config_json).sandboxPolicy === "docker"
            ? "docker"
            : "local",
      });
      for (const [toolName, value] of Object.entries(createSandboxTools(context, sandboxToolIds))) {
        assignTool(tools, toolName, value);
        activeTools.add(toolName);
        builtinToolNames.add(toolName);
      }
    }

    for (const child of context.enabledChildren) {
      const handoff = readHandoffConfig(child.handoff_config_json);
      const slug = toolSlug(child);
      if (handoff.mode === "consult" || handoff.mode === "both") {
        const toolName = "consult_" + slug;
        assignTool(tools, toolName, createConsultTool(context, child, "/root"));
        activeTools.add(toolName);
      }
      if (handoff.mode === "handoff" || handoff.mode === "both") {
        const toolName = "handoff_" + slug;
        assignTool(tools, toolName, createHandoffTool(context, child, "/root"));
        activeTools.add(toolName);
      }
    }
  }

  const names = [...activeTools];
  return {
    ...base,
    tools,
    activeTools: names,
    toolChoice: names.length ? "auto" : "none",
    builtinToolNames: [...builtinToolNames],
    toolApproval: createGuardrailApproval(
      context,
      new Set(base.approvalToolNames ?? []),
      builtinToolNames,
    ),
    stopWhen: ROOT_AGENT_STOP_WHEN,
    onStepEnd: (event) => {
      base.onStepEnd?.(event);
      return undefined;
    },
    instructions: [base.instructions, createSandboxIsolationNote(context)]
      .filter(Boolean)
      .join("\n"),
  };
}

function createMediaGenerationTool(context: RuntimeContext): ToolSet[string] {
  return tool({
    description:
      "Generate an image, speech audio, transcription, or video only when the user explicitly requests that media output. Choose the media kind from the conversation. Do not call this tool merely because media is mentioned. For transcription, use the most recent user audio attachment and provide sourceFilename only to disambiguate multiple audio files.",
    inputSchema: jsonSchema<MediaGenerationToolInput>({
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["image", "speech", "transcription", "video"],
          description: "The output type required by the user's request.",
        },
        content: {
          type: "string",
          description:
            "Image/video prompt or exact text to synthesize as speech. Omit for transcription.",
        },
        sourceFilename: {
          type: "string",
          description: "Audio attachment filename when transcription needs disambiguation.",
        },
        options: {
          type: "object",
          properties: {
            size: { type: "string", description: "Image dimensions such as 1024x1024." },
            aspectRatio: { type: "string", description: "Aspect ratio such as 16:9." },
            count: { type: "number", description: "Number of outputs." },
            seed: { type: "number", description: "Deterministic generation seed." },
            voice: { type: "string", description: "Speech voice name." },
            outputFormat: { type: "string", description: "Speech audio format." },
            speed: { type: "number", description: "Speech speed from 0.25 to 4." },
            language: { type: "string", description: "Speech or transcription language." },
            instructions: { type: "string", description: "Speech delivery instructions." },
            resolution: { type: "string", description: "Video resolution such as 1920x1080." },
            duration: { type: "number", description: "Video duration in seconds." },
            fps: { type: "number", description: "Video frames per second." },
            generateAudio: { type: "boolean", description: "Whether video should include audio." },
          },
          additionalProperties: false,
        },
      },
      required: ["kind"],
      additionalProperties: false,
    }),
    execute: async (input) =>
      executeMediaGeneration(await buildMediaGenerationToolRequest(input, context.messages)),
  });
}

function createToolLoopAgent({
  id,
  resolved,
  instructions,
  messages,
  runtimeConfig,
  reasoning,
  toolRuntime,
  messageStepRecorder,
  contextManager,
  protocol,
  singleStep = false,
  injectSteering = false,
}: {
  id: string;
  modelRef: string;
  resolved: ResolvedChatModel;
  instructions: string;
  messages: UIMessage[];
  runtimeConfig: AgentRuntimeConfig;
  reasoning?: StreamTextOptions["reasoning"];
  toolRuntime: ChatToolRuntimeConfig;
  messageStepRecorder?: () => void;
  contextManager?: ContextEngine;
  singleStep?: boolean;
  injectSteering?: boolean;
  protocol?: {
    context: RuntimeContext;
    agentPath: string;
    parentAgentPath: string | null;
  };
}): ToolLoopAgent<never, ToolSet> {
  const agentTools = protocol
    ? scheduleToolSet(
        toolRuntime.tools ?? {},
        protocol.context.toolScheduler,
        protocol.context.session.signal,
        () => protocol.context.session.beginToolCall(),
      )
    : (toolRuntime.tools ?? {});
  return new ToolLoopAgent<never, ToolSet>({
    id,
    model: resolved.model,
    instructions: appendReactionFeedback(instructions, messages),
    tools: agentTools,
    activeTools: toolRuntime.activeTools,
    toolChoice: toolRuntime.toolChoice,
    toolApproval: toolRuntime.toolApproval,
    stopWhen: singleStep
      ? isStepCount(1)
      : (toolRuntime.stopWhen ?? isStepCount(runtimeConfig.maxTurns)),
    temperature: runtimeConfig.temperature ?? resolved.temperature,
    topP: runtimeConfig.topP ?? resolved.topP,
    maxOutputTokens: runtimeConfig.maxOutputTokens ?? resolved.maxOutputTokens,
    providerOptions: contextManager
      ? (contextManager.withProviderOptions(
          resolved.providerOptions as Record<string, unknown> | undefined,
        ) as StreamTextOptions["providerOptions"])
      : resolved.providerOptions,
    reasoning,
    prepareStep:
      contextManager || (injectSteering && protocol)
        ? async ({ messages: stepMessages }) => {
            let messages = stepMessages;
            if (injectSteering && protocol) {
              const steering = protocol.context.session.drain("steering");
              if (steering.length > 0) {
                protocol.context.messages.push(...steering);
                const converted = await convertToModelMessages(steering, { tools: agentTools });
                protocol.context.preparedSteering.push(...converted);
                messages = [...messages, ...converted];
              }
            }
            const prepared = contextManager ? await contextManager.prepare(messages) : messages;
            return prepared ? { messages: prepared } : undefined;
          }
        : undefined,
    onToolExecutionStart: protocol
      ? ({ toolCall }) => {
          emitProtocol(
            protocol.context,
            "tool.call",
            protocol.agentPath,
            protocol.parentAgentPath,
            "progress",
            { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName },
          );
        }
      : undefined,
    onToolExecutionEnd: protocol
      ? ({ toolCall, toolExecutionMs, toolOutput }) => {
          emitProtocol(
            protocol.context,
            "tool.result",
            protocol.agentPath,
            protocol.parentAgentPath,
            toolOutput.type === "tool-error" ? "error" : "end",
            {
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              durationMs: toolExecutionMs,
              outcome: toolOutput.type,
            },
          );
        }
      : undefined,
    onStepEnd: (event) => {
      messageStepRecorder?.();
      return toolRuntime.onStepEnd?.(event);
    },
  });
}

function createConsultTool(
  context: RuntimeContext,
  child: AgentProfile,
  parentPath: string,
): ToolSet[string] {
  return tool({
    description:
      "Consult " +
      child.name +
      " while " +
      context.rootAgent.name +
      " keeps ownership of the response.",
    inputSchema: consultInputSchema,
    execute: async function* (input) {
      yield { mode: "consult", agentId: child.id, agentName: child.name, status: "running" };
      yield await runChildAgent(context, child, "consult", input, parentPath);
    },
  });
}

function createHandoffTool(
  context: RuntimeContext,
  child: AgentProfile,
  parentPath: string,
): ToolSet[string] {
  return tool({
    description: "Transfer task ownership to " + child.name + " and run that child agent.",
    inputSchema: handoffInputSchema,
    execute: async function* (input) {
      yield { mode: "handoff", agentId: child.id, agentName: child.name, status: "running" };
      yield await runChildAgent(context, child, "handoff", input, parentPath);
    },
  });
}

async function runChildAgent(
  context: RuntimeContext,
  child: AgentProfile,
  mode: "consult" | "handoff",
  input: { task?: string; taskSummary?: string; expectedOutput?: string; reason?: string },
  parentPath = "/root",
): Promise<Record<string, unknown>> {
  const started = Date.now();
  const task = input.taskSummary ?? input.task ?? "";
  const step = createRuntimeStep({
    run_id: context.runId,
    agent_id: child.id,
    kind: mode,
    status: "running",
    title: (mode === "handoff" ? "Handoff to " : "Consult ") + child.name,
    detail: { input },
  });
  const instance = context.coordinator.spawnAgent({
    agentId: child.id,
    parentPath,
    taskName: child.name,
    message: task,
    execute: async ({ instance: runningInstance, abortSignal }) => {
      saveAgentInstance(runningInstance);
      const childModelRef = child.model_ref || context.modelRef;
      const childResolved = applyRuntimeConfig(
        child.model_ref ? context.resolveModel(childModelRef) : context.resolved,
        readRuntimeConfig(child.runtime_config_json),
      );
      const childModelContext = toChatToolModelContext(childModelRef, childResolved);
      const childConfig = readRuntimeConfig(child.runtime_config_json);
      const childRuntime = buildSafeChildToolRuntime(
        context,
        child,
        childModelContext,
        runningInstance.agent_path,
      );
      const childAgent = createToolLoopAgent({
        id: runningInstance.agent_path,
        modelRef: childModelRef,
        resolved: childResolved,
        instructions: await createChildInstructions(context, child, mode),
        messages: [],
        runtimeConfig: childConfig,
        reasoning:
          childConfig.reasoning !== undefined
            ? normalizeRuntimeReasoning(childConfig.reasoning)
            : normalizeRuntimeReasoning(childResolved.reasoningDefault),
        toolRuntime: childRuntime,
        contextManager: createContextManager(context, {
          agentPath: runningInstance.agent_path,
          agentInstanceId: runningInstance.id,
          modelRef: childModelRef,
          resolved: childResolved,
          runtimeConfig: childConfig,
        }),
        protocol: {
          context,
          agentPath: runningInstance.agent_path,
          parentAgentPath: runningInstance.parent_agent_path,
        },
      });
      const result = await childAgent.generate({
        prompt: createChildPrompt(context, child, mode, input),
        abortSignal,
        timeout: { totalMs: childConfig.totalTimeoutMs },
      });
      return summarizeText(result.text, 6_000);
    },
  });
  saveAgentInstance(instance);
  if (mode === "handoff") {
    context.finalAgentId = child.id;
    context.coordinator.transferOwnership(instance.agent_path);
    recordState({
      agentId: DEFAULT_AGENT_ID,
      status: "handoff",
      runId: context.runId,
      conversationId: context.conversationId,
      summary: context.rootAgent.name + " handed off to " + child.name,
      stepId: step.id,
    });
  }
  recordState({
    agentId: child.id,
    status: "running",
    runId: context.runId,
    conversationId: context.conversationId,
    summary: child.name + (mode === "handoff" ? " is handling the task" : " is consulting"),
    stepId: step.id,
  });

  try {
    const output = await context.coordinator.waitAgent(instance.agent_path);
    persistCoordinatorState(context);
    updateRuntimeStep(step.id, {
      status: "succeeded",
      detail: { input, output, durationMs: Date.now() - started },
      finished_at: Date.now(),
    });
    recordState({
      agentId: child.id,
      status: mode === "handoff" ? "running" : "idle",
      runId: mode === "handoff" ? context.runId : null,
      conversationId: context.conversationId,
      summary: child.name + " completed " + mode,
      stepId: step.id,
    });
    insertRuntimeEvent({
      kind: "handoff",
      title: (mode === "handoff" ? "Handoff" : "Consult") + " completed: " + child.name,
      status: "succeeded",
      detail: { runId: context.runId, agentId: child.id, durationMs: Date.now() - started },
    });
    return {
      mode,
      agentId: child.id,
      agentName: child.name,
      agentPath: instance.agent_path,
      ownerPath: context.coordinator.currentOwnerPath(),
      output,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    persistCoordinatorState(context);
    const message = error instanceof Error ? error.message : String(error);
    updateRuntimeStep(step.id, {
      status: "failed",
      error: message,
      detail: { input, error: message },
      finished_at: Date.now(),
    });
    recordState({
      agentId: child.id,
      status: "failed",
      runId: context.runId,
      conversationId: context.conversationId,
      summary: child.name + " failed",
      error: message,
      stepId: step.id,
    });
    throw error;
  }
}

function buildSafeChildToolRuntime(
  context: RuntimeContext,
  child: AgentProfile,
  model: ChatToolModelContext,
  agentPath: string,
): ChatToolRuntimeConfig {
  if (!model.capabilities.toolCalling) {
    return { descriptors: [], toolChoice: "none" };
  }
  const policy = readToolPolicy(child.tool_policy_json);
  const allowed = selectedBaseToolIds(context.toolSelection, policy).filter((id) => id !== "cron");
  const base = buildChatToolRuntime({
    selection: { mode: allowed.length ? "manual" : "off", selectedToolIds: allowed },
    model,
    conversationId: context.conversationId,
    agentId: child.id,
  });
  const tools: ToolSet = { ...base.tools };
  const activeTools = new Set(base.activeTools ?? []);
  for (const descendant of context.agentGraph.childrenOf(child.id)) {
    const handoff = readHandoffConfig(descendant.handoff_config_json);
    const slug = toolSlug(descendant);
    if (handoff.mode === "consult" || handoff.mode === "both") {
      const name = "consult_" + slug;
      assignTool(tools, name, createConsultTool(context, descendant, agentPath));
      activeTools.add(name);
    }
    if (handoff.mode === "handoff" || handoff.mode === "both") {
      const name = "handoff_" + slug;
      assignTool(tools, name, createHandoffTool(context, descendant, agentPath));
      activeTools.add(name);
    }
  }
  return {
    ...base,
    tools,
    activeTools: [...activeTools],
    toolChoice: activeTools.size > 0 ? "auto" : "none",
  };
}

function createSandboxTools(context: RuntimeContext, enabledIds: ChatToolId[]): ToolSet {
  const enabled = new Set(enabledIds);
  const tools: ToolSet = {};
  if (enabled.has("sandbox_list_files")) {
    assignTool(
      tools,
      "sandbox_list_files",
      tool({
        description: "List files inside the sandbox.",
        inputSchema: jsonSchema<{ path?: string }>({
          type: "object",
          properties: { path: { type: "string" } },
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "List sandbox files", async (sandbox) =>
            listSandboxFiles(sandbox.session, input.path ?? "."),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_read_file")) {
    assignTool(
      tools,
      "sandbox_read_file",
      tool({
        description: "Read a UTF-8 text file inside the sandbox.",
        inputSchema: jsonSchema<{ path: string }>({
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Read sandbox file", async (sandbox) =>
            readSandboxFile(sandbox.session, input.path),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_write_file")) {
    assignTool(
      tools,
      "sandbox_write_file",
      tool({
        description: "Write or append a UTF-8 file inside the sandbox.",
        inputSchema: jsonSchema<{ path: string; content: string; append?: boolean }>({
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            append: { type: "boolean" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Write sandbox file", async (sandbox) =>
            writeSandboxFile(sandbox.session, input.path, input.content, { append: input.append }),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_run_command")) {
    assignTool(
      tools,
      "sandbox_run_command",
      tool({
        description: "Run a command in the sandbox cwd with a timeout.",
        inputSchema: jsonSchema<{
          command: string;
          args?: string[];
          cwd?: string;
          env?: Record<string, string>;
          timeoutMs?: number;
        }>({
          type: "object",
          properties: {
            command: { type: "string" },
            args: { type: "array", items: { type: "string" } },
            cwd: { type: "string" },
            env: { type: "object", additionalProperties: { type: "string" } },
            timeoutMs: { type: "number" },
          },
          required: ["command"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Run sandbox command", async (sandbox) =>
            runSandboxCommand(sandbox.session, input),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_snapshot")) {
    assignTool(
      tools,
      "sandbox_snapshot",
      tool({
        description: "Create a restorable sandbox snapshot.",
        inputSchema: jsonSchema<{ label?: string }>({
          type: "object",
          properties: { label: { type: "string" } },
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Create sandbox snapshot", async (sandbox) =>
            createSandboxSnapshot(sandbox.session, input.label),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_restore")) {
    assignTool(
      tools,
      "sandbox_restore",
      tool({
        description: "Restore a sandbox snapshot.",
        inputSchema: jsonSchema<{ snapshotId: string }>({
          type: "object",
          properties: { snapshotId: { type: "string" } },
          required: ["snapshotId"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Restore sandbox snapshot", async (sandbox) =>
            restoreSandboxSnapshot(sandbox.session, input.snapshotId),
          ),
      }),
    );
  }
  if (enabled.has("sandbox_list_artifacts")) {
    assignTool(
      tools,
      "sandbox_list_artifacts",
      tool({
        description: "List sandbox artifacts and preview links.",
        inputSchema: jsonSchema<Record<string, never>>({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        execute: () =>
          runSandboxStep(context, "List sandbox artifacts", async (sandbox) => ({
            artifacts: listSandboxSessionArtifacts(sandbox.session),
          })),
      }),
    );
  }
  if (enabled.has("sandbox_preview_port")) {
    assignTool(
      tools,
      "sandbox_preview_port",
      tool({
        description: "Register a localhost preview port for the sandbox.",
        inputSchema: jsonSchema<{ port: number; label?: string }>({
          type: "object",
          properties: { port: { type: "number" }, label: { type: "string" } },
          required: ["port"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Register sandbox preview", async (sandbox) =>
            registerSandboxPreviewPort(sandbox.session, input),
          ),
      }),
    );
  }
  return tools;
}

async function runSandboxStep<T>(
  context: RuntimeContext,
  title: string,
  action: (sandbox: SandboxContext) => Promise<T> | T,
): Promise<T> {
  const sandbox = getSandboxSessionOrThrow(context.sandbox);
  const step = createRuntimeStep({
    run_id: context.runId,
    agent_id: DEFAULT_AGENT_ID,
    kind: "sandbox",
    status: "running",
    title,
    detail: {
      sessionId: sandbox.session.id,
      isolationMode: sandbox.session.isolation_mode,
    },
  });
  recordState({
    agentId: DEFAULT_AGENT_ID,
    status: "sandbox",
    runId: context.runId,
    conversationId: context.conversationId,
    summary: title,
    stepId: step.id,
  });
  try {
    const result = await action(sandbox);
    updateRuntimeStep(step.id, {
      status: "succeeded",
      detail: {
        sessionId: sandbox.session.id,
        isolationMode: sandbox.session.isolation_mode,
        result: summarizeUnknown(result),
      },
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      kind: "sandbox",
      title,
      status: "succeeded",
      detail: {
        runId: context.runId,
        sessionId: sandbox.session.id,
        isolationMode: sandbox.session.isolation_mode,
      },
    });
    recordState({
      agentId: DEFAULT_AGENT_ID,
      status: "running",
      runId: context.runId,
      conversationId: context.conversationId,
      summary: context.rootAgent.name + " is continuing after sandbox action",
      stepId: step.id,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRuntimeStep(step.id, {
      status: "failed",
      error: message,
      detail: { error: message },
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      kind: "sandbox",
      title,
      status: "failed",
      detail: { runId: context.runId, error: message },
    });
    throw error;
  }
}

function createGuardrailApproval(
  context: RuntimeContext,
  toolApprovalToolNames = new Set<string>(),
  builtinToolNames = new Set<string>(),
): ToolApprovalConfiguration<ToolSet, unknown> {
  return ({ toolCall }) => {
    const toolName = String(toolCall.toolName);
    const input = (toolCall as { input?: unknown }).input;
    const decision = evaluateToolGuardrail(
      context,
      toolName,
      input,
      toolApprovalToolNames,
      builtinToolNames,
    );
    const step = createRuntimeStep({
      run_id: context.runId,
      agent_id: DEFAULT_AGENT_ID,
      kind: decision.decision === "require_review" ? "approval" : "tool",
      status:
        decision.decision === "deny"
          ? "cancelled"
          : decision.decision === "require_review"
            ? "queued"
            : "succeeded",
      title:
        decision.decision === "require_review"
          ? "Approval requested: " + toolName
          : "Guardrail " + decision.decision + ": " + toolName,
      detail: { toolName, input, decision },
      finished_at: decision.decision === "require_review" ? null : Date.now(),
    });
    insertRuntimeEvent({
      kind: decision.decision === "require_review" ? "approval" : "guardrail",
      title:
        decision.decision === "require_review"
          ? "Approval requested: " + toolName
          : "Guardrail " + decision.decision + ": " + toolName,
      status:
        decision.decision === "deny"
          ? "cancelled"
          : decision.decision === "require_review"
            ? "queued"
            : "succeeded",
      detail: { runId: context.runId, toolName, input, decision },
    });
    if (decision.decision === "require_review") {
      context.approvalRequested = true;
      recordState({
        agentId: DEFAULT_AGENT_ID,
        status: "reviewing",
        runId: context.runId,
        conversationId: context.conversationId,
        summary: "Waiting for user approval: " + toolName,
        stepId: step.id,
      });
      return "user-approval";
    }
    if (decision.decision === "deny") {
      return { type: "denied", reason: decision.reason } satisfies ToolApprovalStatus;
    }
    return "not-applicable";
  };
}

function evaluateToolGuardrail(
  context: RuntimeContext,
  toolName: string,
  input: unknown,
  toolApprovalToolNames = new Set<string>(),
  builtinToolNames = new Set<string>(),
): {
  decision: "allow" | "deny" | "require_review";
  risk: "low" | "medium" | "high";
  reason: string;
} {
  if (toolName.startsWith("handoff_") || toolName.startsWith("consult_")) {
    return { decision: "allow", risk: "low", reason: "Agent orchestration tool." };
  }
  if (toolName.startsWith("sandbox_") && inputHasPathEscape(input)) {
    return { decision: "deny", risk: "high", reason: "Sandbox path escapes the session root." };
  }
  if (isBuiltinToolName(toolName) || builtinToolNames.has(toolName)) {
    return { decision: "allow", risk: "low", reason: "Built-in tool approval is disabled." };
  }
  if (toolName === "sandbox_run_command" && commandLooksDangerous(input)) {
    return {
      decision: "require_review",
      risk: "high",
      reason: "Command may modify files, install dependencies, or start processes.",
    };
  }
  const policy = readToolPolicy(context.rootAgent.tool_policy_json);
  const mappedTool = toolNameToChatToolId(toolName);
  const reviewAll =
    readRuntimeConfig(context.rootAgent.runtime_config_json).reviewPolicy === "review_all";
  if (
    rootToolRequiresApproval({
      toolName,
      toolInput: input,
      reviewAll,
      dynamicallyRequiresApproval: toolApprovalToolNames.has(toolName),
      policyRequiresApproval: !!mappedTool && policy.requireApprovalToolIds.includes(mappedTool),
      builtinToolNames,
    })
  ) {
    return {
      decision: "require_review",
      risk: toolName.startsWith("sandbox_") ? "high" : "medium",
      reason: "Policy requires chat approval.",
    };
  }
  return { decision: "allow", risk: "low", reason: "Allowed by policy." };
}

function finishRun(
  context: RuntimeContext,
  status: "succeeded" | "failed" | "cancelled",
  extra: {
    error?: string;
    errorCode?: ChatErrorCode;
    diagnostic?: string;
    execution?: ChatMessageMetadata["execution"];
    outputSummary?: string;
  } = {},
): void {
  const finishedAt = Date.now();
  const failed = status === "failed";
  const finalStatus =
    context.approvalRequested && status === "succeeded" ? "waiting_approval" : status;
  if (finalStatus === "waiting_approval") {
    context.session.markWaitingApproval();
    updateRuntimeRun(context.runId, { final_agent_id: context.finalAgentId });
  } else if (status === "failed") {
    context.session.fail(extra.error ?? "Agent run failed");
  } else if (status === "cancelled") {
    context.session.cancel(extra.error ?? "cancelled");
  } else {
    context.session.complete(extra.outputSummary, extra.execution);
    updateRuntimeRun(context.runId, { final_agent_id: context.finalAgentId });
  }
  createRuntimeStep({
    run_id: context.runId,
    agent_id: context.finalAgentId,
    kind: failed ? "error" : status === "cancelled" ? "diagnostic" : "output_guardrail",
    status: failed ? "failed" : status === "cancelled" ? "cancelled" : "succeeded",
    title: failed
      ? "Agent run failed"
      : status === "cancelled"
        ? "Agent run cancelled"
        : "Output guardrails passed",
    detail: extra,
    finished_at: finishedAt,
    error: failed ? (extra.error ?? "Agent run failed") : null,
  });
  for (const agent of [context.rootAgent, ...context.enabledChildren]) {
    const isFinalHandoffAgent =
      agent.id === context.finalAgentId && context.finalAgentId !== DEFAULT_AGENT_ID;
    upsertAgentRuntimeState({
      agent_id: agent.id,
      status: context.approvalRequested ? "reviewing" : isFinalHandoffAgent ? "idle" : "idle",
      current_run_id: context.approvalRequested ? context.runId : null,
      last_error: extra.error ?? null,
    });
  }
  if (context.conversationId) {
    upsertConversationAgentState({
      conversation_id: context.conversationId,
      active_agent_id: context.finalAgentId,
      current_run_id: context.approvalRequested ? context.runId : null,
      current_step_id: null,
      status: context.approvalRequested ? "reviewing" : failed ? "failed" : "idle",
      summary: context.approvalRequested
        ? "Waiting for user approval"
        : failed
          ? extra.error
          : "Agent run finished",
    });
  }
  insertRuntimeEvent({
    kind: "agent",
    title: failed
      ? context.rootAgent.name + " orchestration failed"
      : context.rootAgent.name + " orchestration finished",
    status: failed ? "failed" : finalStatus === "waiting_approval" ? "queued" : status,
    detail: { runId: context.runId, finalAgentId: context.finalAgentId, ...extra },
  });
  context.protocolRecorder({
    id: randomUUID(),
    runId: context.runId,
    sequence: 0,
    type: failed ? "run.failed" : "run.completed",
    agentPath: context.coordinator.currentOwnerPath(),
    parentAgentPath: null,
    phase: failed ? "error" : "end",
    createdAt: finishedAt,
    payload: {
      finalAgentId: context.finalAgentId,
      error: extra.error ?? null,
      errorCode: extra.errorCode ?? null,
    },
  });
}

function createExecutionTracker({
  runId,
  modelRef,
  agentId,
  context,
  contextEngine,
}: {
  runId: string;
  modelRef: string;
  agentId: string;
  context: RuntimeContext;
  contextEngine?: ContextEngine;
}): {
  messageMetadata: MessageMetadataCallback;
  recordModelStep: () => void;
  finalize: (finishReason: FinishReason, usage: unknown) => ChatMessageMetadata["execution"];
} {
  const startedAt = Date.now();
  let stepCount = 0;
  let toolCallCount = 0;
  const buildExecution = (
    finishReason: FinishReason,
    usage: unknown,
  ): NonNullable<ChatMessageMetadata["execution"]> => {
    const finishedAt = Date.now();
    const execution = {
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      model: modelRef,
      agentId: context.finalAgentId || agentId,
      agentPath: context.coordinator.currentOwnerPath(),
      finishReason: String(finishReason),
      inputTokens: readTokenTotal(usage, "inputTokens"),
      outputTokens: readTokenTotal(usage, "outputTokens"),
      textOutputTokens: readUsageDetail(usage, "outputTokenDetails", "textTokens"),
      reasoningTokens: readUsageDetail(usage, "outputTokenDetails", "reasoningTokens"),
      cacheReadTokens: readUsageDetail(usage, "inputTokenDetails", "cacheReadTokens"),
      cacheWriteTokens: readUsageDetail(usage, "inputTokenDetails", "cacheWriteTokens"),
      totalTokens: undefined as number | undefined,
      stepCount: stepCount || undefined,
      toolCallCount: toolCallCount || undefined,
      contextUtilization: contextEngine?.usage.utilization,
      contextWindow: contextEngine?.usage.contextWindow,
      compactionCount: contextEngine?.usage.compactionCount,
      tokenCountAccuracy: contextEngine?.usage.accuracy,
      reasoningLevel: isChatReasoningLevel(context.reasoning) ? context.reasoning : undefined,
      reasoningOverridden: hasProviderReasoningOverride(context.resolved.providerOptions),
    };
    execution.totalTokens =
      execution.inputTokens !== undefined || execution.outputTokens !== undefined
        ? (execution.inputTokens ?? 0) + (execution.outputTokens ?? 0)
        : undefined;
    return execution;
  };
  const messageMetadata: MessageMetadataCallback = ({ part }) => {
    if (part.type === "tool-call") {
      toolCallCount += 1;
      return undefined;
    }
    if (part.type === "start") {
      return { execution: { startedAt, model: modelRef, agentId } };
    }
    if (part.type !== "finish") return undefined;
    const execution = buildExecution(part.finishReason, part.totalUsage);
    return { execution };
  };
  return {
    messageMetadata,
    recordModelStep: () => {
      stepCount += 1;
      createRuntimeStep({
        run_id: runId,
        agent_id: agentId,
        kind: "model",
        status: "succeeded",
        title: "Model step " + stepCount,
        detail: { modelRef, stepCount },
        finished_at: Date.now(),
      });
    },
    finalize: buildExecution,
  };
}

function readUsageDetail(
  usage: unknown,
  group: "inputTokenDetails" | "outputTokenDetails",
  key: string,
): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const details = (usage as Record<string, unknown>)[group];
  if (!details || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasProviderReasoningOverride(providerOptions: unknown): boolean {
  if (!providerOptions || typeof providerOptions !== "object" || Array.isArray(providerOptions)) {
    return false;
  }
  for (const [key, value] of Object.entries(providerOptions)) {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    if (
      normalized === "reasoningeffort" ||
      normalized === "thinkingbudget" ||
      normalized === "budgettokens"
    ) {
      return value !== undefined && value !== null;
    }
    if (normalized === "thinking" && value && typeof value === "object") {
      const type = (value as Record<string, unknown>).type;
      if (type === "enabled" || type === "adaptive") return true;
    }
    if (hasProviderReasoningOverride(value)) return true;
  }
  return false;
}

async function createRootInstructions(
  context: RuntimeContext,
  toolInstructions?: string,
): Promise<string> {
  const childLines = context.enabledChildren.map((agent) => {
    const handoff = readHandoffConfig(agent.handoff_config_json);
    return [
      "- " + agent.name + " [" + handoff.mode + "]: " + agent.role,
      agent.description,
      handoff.accepts.length ? "Best for: " + handoff.accepts.join(", ") : "",
      "Expected output: " + handoff.expectedOutput,
      agent.model_ref ? "Model: " + agent.model_ref : "Model: inherit",
    ]
      .filter(Boolean)
      .join(" ");
  });
  const basePrompt = await context.buildAgentSystemPrompt(DEFAULT_AGENT_ID, context.conversationId);
  return [
    basePrompt,
    `You are ${context.rootAgent.name}, the root orchestrator. Every chat request enters through you, regardless of provider.`,
    "You can handle any task, but prefer delegating work to a suitable child agent whenever one can do it.",
    "Decide whether to answer directly, consult a child agent, or hand off ownership to a child agent.",
    "When a child agent is disabled, draft, archived, or locked, it is not available and must not be used.",
    "Use consult tools for specialist advice while you keep ownership. Use handoff tools when the child agent should own the result.",
    "Keep working until the task is complete or the user explicitly stops the run. Do not stop merely because you have used many model or tool steps.",
    "After a successful handoff, return the handoff result's output verbatim as the final answer. Do not summarize it, add a preface, or continue using tools.",
    context.modelContext.capabilities.toolCalling
      ? "When the user explicitly requests an image, speech audio, transcription, or video, decide the appropriate output and call generate_media. After it succeeds, briefly confirm the result without repeating the raw tool output."
      : "This chat model cannot call tools or generate media through the app. If the user asks for an image, speech audio, transcription, or video, explain that limitation and ask them to switch to a tool-calling chat model.",
    context.preferredAgentId
      ? "The conversation is currently owned by " +
        context.preferredAgentId +
        ". Continue with that agent using handoff unless the current task explicitly requires root ownership."
      : "",
    childLines.length
      ? "Enabled child agents:\n" + childLines.join("\n")
      : "No child agents are currently enabled.",
    toolInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function createChildInstructions(
  context: RuntimeContext,
  child: AgentProfile,
  mode: "consult" | "handoff",
): Promise<string> {
  const handoff = readHandoffConfig(child.handoff_config_json);
  const basePrompt = await context.buildAgentSystemPrompt(child.id, context.conversationId);
  return [
    basePrompt,
    `You are a child agent under ${context.rootAgent.name}. Stay inside your specialty and be concise.`,
    mode === "handoff"
      ? "Ownership has been transferred to you for this task."
      : `You are being consulted; ${context.rootAgent.name} will synthesize your output.`,
    "Expected output: " + handoff.expectedOutput,
  ].join("\n\n");
}

function createChildPrompt(
  context: RuntimeContext,
  child: AgentProfile,
  mode: "consult" | "handoff",
  input: { task?: string; taskSummary?: string; expectedOutput?: string; reason?: string },
): string {
  return [
    "Mode: " + mode,
    "Agent: " + child.name + " (" + child.role + ")",
    input.reason ? "Reason: " + input.reason : "",
    "Task: " + (input.taskSummary ?? input.task ?? ""),
    input.expectedOutput ? "Expected output: " + input.expectedOutput : "",
    "Recent conversation:\n" + extractTranscript(context.messages, 12),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function createSandboxIsolationNote(context: RuntimeContext): string | undefined {
  if (!context.sandbox) return undefined;
  return [
    "Sandbox isolation:",
    "- Session: " + context.sandbox.session.id,
    "- Mode: " + context.sandbox.session.isolation_mode,
    context.sandbox.session.isolation_mode === "local"
      ? "- Docker was unavailable or not selected; commands are restricted to a local sandbox directory."
      : "- Docker was detected; this session records docker-capable isolation.",
    "- All file paths must be relative to the sandbox root.",
  ].join("\n");
}

function recordState(input: {
  agentId: string;
  status: AgentRuntimeStatus;
  runId: string | null;
  conversationId?: string;
  summary?: string;
  error?: string | null;
  stepId?: string | null;
}): void {
  upsertAgentRuntimeState({
    agent_id: input.agentId,
    status: input.status,
    current_run_id: input.runId,
    last_error: input.error ?? null,
    last_handoff_at: input.status === "handoff" ? Date.now() : undefined,
    last_tool_at:
      input.status === "tool_calling" || input.status === "sandbox" ? Date.now() : undefined,
  });
  if (input.conversationId) {
    upsertConversationAgentState({
      conversation_id: input.conversationId,
      active_agent_id: input.agentId,
      current_run_id: input.runId,
      current_step_id: input.stepId ?? null,
      status: input.status,
      summary: input.summary ?? null,
    });
  }
}

function applyRuntimeConfig(
  resolved: ResolvedChatModel,
  config: AgentRuntimeConfig,
): ResolvedChatModel {
  return {
    ...resolved,
    temperature: config.temperature ?? resolved.temperature,
    topP: config.topP ?? resolved.topP,
    maxOutputTokens: config.maxOutputTokens ?? resolved.maxOutputTokens,
  };
}

function applyAgentToolPolicy(
  rawSelection: ChatToolSelectionRequest | undefined,
  policy: AgentToolPolicy,
): ChatToolSelectionRequest | undefined {
  if (policy.mode !== "custom" || policy.allowedToolIds.length === 0) return rawSelection;
  const selection = normalizeChatToolSelection(rawSelection);
  if (selection.mode === "off") return selection;
  if (selection.mode === "manual") {
    return {
      mode: "manual",
      selectedToolIds: selection.selectedToolIds.filter((id) => policy.allowedToolIds.includes(id)),
    };
  }
  return { mode: "manual", selectedToolIds: policy.allowedToolIds };
}

function selectedBaseToolIds(
  rawSelection: ChatToolSelectionRequest | undefined,
  policy: AgentToolPolicy,
): ChatToolId[] {
  const selection = normalizeChatToolSelection(applyAgentToolPolicy(rawSelection, policy));
  if (selection.mode === "off") return [];
  if (selection.mode === "manual") return selection.selectedToolIds.filter(isBaseChatTool);
  return ["web_search", "web_open", "current_time", "runtime_snapshot", "model_capabilities"];
}

function selectedSandboxToolIds(context: RuntimeContext, policy: AgentToolPolicy): ChatToolId[] {
  const selection = normalizeChatToolSelection(applyAgentToolPolicy(context.toolSelection, policy));
  if (readRuntimeConfig(context.rootAgent.runtime_config_json).sandboxPolicy === "disabled") {
    return [];
  }
  if (selection.mode === "off") return [];
  if (selection.mode === "manual") return selection.selectedToolIds.filter(isSandboxToolId);
  return ["sandbox_list_files", "sandbox_read_file", "sandbox_snapshot", "sandbox_list_artifacts"];
}

function readToolPolicy(raw: string): AgentToolPolicy {
  return readJsonObject(raw, DEFAULT_AGENT_TOOL_POLICY, (value) => ({
    mode: value.mode === "custom" ? "custom" : "inherit",
    allowedToolIds: Array.isArray(value.allowedToolIds)
      ? value.allowedToolIds.filter(isChatToolReference)
      : [],
    requireApprovalToolIds: Array.isArray(value.requireApprovalToolIds)
      ? value.requireApprovalToolIds.filter((id) => isChatToolReference(id) && !isChatToolId(id))
      : DEFAULT_AGENT_TOOL_POLICY.requireApprovalToolIds,
  }));
}

function readHandoffConfig(raw: string): AgentHandoffConfig {
  return readJsonObject(raw, DEFAULT_AGENT_HANDOFF_CONFIG, (value) => ({
    mode:
      value.mode === "handoff" || value.mode === "both" || value.mode === "consult"
        ? value.mode
        : DEFAULT_AGENT_HANDOFF_CONFIG.mode,
    priority:
      value.priority === "low" || value.priority === "high" || value.priority === "normal"
        ? value.priority
        : "normal",
    accepts: Array.isArray(value.accepts)
      ? value.accepts.map(String).filter(Boolean).slice(0, 8)
      : [],
    expectedOutput:
      typeof value.expectedOutput === "string" && value.expectedOutput.trim()
        ? value.expectedOutput.trim()
        : DEFAULT_AGENT_HANDOFF_CONFIG.expectedOutput,
  }));
}

function readRuntimeConfig(raw: string): AgentRuntimeConfig {
  return readJsonObject(raw, DEFAULT_AGENT_RUNTIME_CONFIG, (value) => ({
    maxTurns: clampNumber(value.maxTurns, DEFAULT_AGENT_RUNTIME_CONFIG.maxTurns, 1, 20),
    temperature:
      typeof value.temperature === "number" ? clampNumber(value.temperature, 0.7, 0, 2) : undefined,
    topP: typeof value.topP === "number" ? clampNumber(value.topP, 1, 0, 1) : undefined,
    maxOutputTokens:
      typeof value.maxOutputTokens === "number"
        ? Math.floor(clampNumber(value.maxOutputTokens, 4096, 1, 32768))
        : undefined,
    reasoning: isChatReasoningLevel(value.reasoning) ? value.reasoning : undefined,
    reviewPolicy:
      value.reviewPolicy === "auto" ||
      value.reviewPolicy === "review_sensitive" ||
      value.reviewPolicy === "review_all" ||
      value.reviewPolicy === "inherit"
        ? value.reviewPolicy
        : DEFAULT_AGENT_RUNTIME_CONFIG.reviewPolicy,
    sandboxPolicy:
      value.sandboxPolicy === "disabled" ||
      value.sandboxPolicy === "local" ||
      value.sandboxPolicy === "docker" ||
      value.sandboxPolicy === "inherit"
        ? value.sandboxPolicy
        : DEFAULT_AGENT_RUNTIME_CONFIG.sandboxPolicy,
    notes: typeof value.notes === "string" ? value.notes : undefined,
  }));
}

function readJsonObject<T>(
  raw: string,
  fallback: T,
  normalize: (value: Record<string, unknown>) => T,
): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return normalize(parsed as Record<string, unknown>);
    }
  } catch {
    // Use fallback below.
  }
  return fallback;
}

function toChatToolModelContext(
  modelRef: string,
  resolved: ResolvedChatModel,
): ChatToolModelContext {
  const slashIdx = modelRef.indexOf("/");
  const providerId =
    resolved.providerId ?? (slashIdx > 0 ? modelRef.slice(0, slashIdx) : "unknown");
  const modelId = resolved.modelId ?? (slashIdx > 0 ? modelRef.slice(slashIdx + 1) : modelRef);
  return {
    providerId,
    providerKind: resolved.providerKind ?? "openai-compatible",
    modelId,
    capabilities: resolved.capabilities ?? DEFAULT_MODEL_CAPABILITIES,
    nativeTools: resolved.nativeTools ?? [],
  };
}

function normalizeRuntimeReasoning(
  value: ChatReasoningLevel | StreamTextOptions["reasoning"] | undefined,
): StreamTextOptions["reasoning"] | undefined {
  if (!value || value === "provider-default") return undefined;
  return value as StreamTextOptions["reasoning"];
}

function toolSlug(profile: AgentProfile): string {
  return profile.id
    .replace(/^agent-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isBaseChatTool(value: unknown): value is ChatToolId {
  return isChatToolId(value) && !isSandboxToolId(value);
}

function isSandboxToolId(value: unknown): value is ChatToolId {
  return isChatToolId(value) && value.startsWith("sandbox_");
}

function isChatToolId(value: unknown): value is ChatToolId {
  return typeof value === "string" && (CHAT_TOOL_IDS as readonly string[]).includes(value);
}

function isChatReasoningLevel(value: unknown): value is ChatReasoningLevel {
  return (
    typeof value === "string" &&
    ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"].includes(value)
  );
}

function toolNameToChatToolId(toolName: string): ChatToolId | null {
  return isChatToolId(toolName) ? toolName : null;
}

function assignTool(toolSet: ToolSet, name: string, value: unknown): void {
  (toolSet as Record<string, ToolSet[string]>)[name] = value as ToolSet[string];
}

function createContextManager(
  context: RuntimeContext,
  input: {
    agentPath: string;
    agentInstanceId?: string;
    modelRef: string;
    resolved: ResolvedChatModel;
    runtimeConfig: AgentRuntimeConfig;
    staticInstructions?: string;
    toolSchemas?: unknown;
  },
): ContextEngine | undefined {
  const policy: AgentContextPolicy =
    input.runtimeConfig.contextPolicy ?? DEFAULT_AGENT_RUNTIME_CONFIG.contextPolicy!;
  if (policy.mode === "off") return undefined;
  let compactionModel = input.resolved.model;
  if (input.runtimeConfig.compactionModelRef) {
    try {
      compactionModel = context.resolveModel(input.runtimeConfig.compactionModelRef).model;
    } catch (error) {
      console.warn("[agent-runtime] compaction model unavailable, using active model:", error);
    }
  }
  return new ContextEngine({
    runId: context.runId,
    conversationId: context.conversationId,
    agentInstanceId: input.agentInstanceId,
    agentPath: input.agentPath,
    modelRef: input.modelRef,
    model: input.resolved.model,
    providerKind: input.resolved.providerKind,
    compactionModel,
    contextWindow: input.resolved.contextWindow ?? 32_000,
    maxOutputTokens: input.runtimeConfig.maxOutputTokens ?? input.resolved.maxOutputTokens,
    policy,
    staticInstructions: input.staticInstructions,
    toolSchemas: input.toolSchemas,
    countInputTokens: input.resolved.countInputTokens,
    onCheckpoint: createContextCheckpoint,
    onEvent: context.protocolRecorder,
  });
}

function persistCoordinatorState(context: RuntimeContext): void {
  for (const instance of context.coordinator.listAgents()) saveAgentInstance(instance);
  for (const message of context.coordinator.listMessages()) saveCollaborationMessage(message);
}

function createProtocolRecorder(
  runId: string,
  conversationId?: string,
): (event: AgentRuntimeProtocolEvent) => void {
  let sequence = 0;
  return (event) => {
    const assignedSequence = ++sequence;
    insertRuntimeEvent({
      runId,
      conversationId: conversationId ?? null,
      eventType: event.type,
      agentPath: event.agentPath,
      parentAgentPath: event.parentAgentPath,
      sequence: assignedSequence,
      kind: protocolEventKind(event.type),
      status:
        event.phase === "error"
          ? "failed"
          : event.phase === "start" || event.phase === "progress"
            ? "running"
            : "succeeded",
      severity: event.phase === "error" ? "error" : "info",
      title: event.type,
      detail: { ...event.payload, phase: event.phase, sourceEventId: event.id },
      created_at: event.createdAt,
    });
  };
}

function emitProtocol(
  context: RuntimeContext,
  type: AgentRuntimeProtocolEvent["type"],
  agentPath: string,
  parentAgentPath: string | null,
  phase: AgentRuntimeProtocolEvent["phase"],
  payload: AgentRuntimeProtocolEvent["payload"],
): void {
  context.protocolRecorder({
    id: randomUUID(),
    runId: context.runId,
    sequence: 0,
    type,
    agentPath,
    parentAgentPath,
    phase,
    createdAt: Date.now(),
    payload,
  });
}

function protocolEventKind(type: AgentRuntimeProtocolEvent["type"]): string {
  if (type.startsWith("tool.")) return "tool";
  if (type === "ownership.changed") return "handoff";
  if (type === "context.compacted") return "memory";
  if (type === "run.failed") return "error";
  return "diagnostic";
}

function extractTranscript(messages: UIMessage[], limit: number): string {
  return messages
    .slice(limit > 0 ? -limit : 0)
    .map((message) => {
      const text = (message.parts ?? [])
        .filter(
          (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
            part.type === "text",
        )
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (!text) return "";
      return (
        (message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "System") +
        ": " +
        text
      );
    })
    .filter(Boolean)
    .join("\n\n");
}

function summarizeText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? compact.slice(0, maxLength - 3) + "..." : compact;
}

function summarizeUnknown(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { type: "array", count: value.length };
  if (!value || typeof value !== "object") return { type: typeof value };
  const record = value as Record<string, unknown>;
  return {
    type: "object",
    keys: Object.keys(record).slice(0, 12),
    count: typeof record.count === "number" ? record.count : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    id: typeof record.id === "string" ? record.id : undefined,
  };
}

function readTokenTotal(usage: unknown, key: "inputTokens" | "outputTokens"): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const value = (usage as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return undefined;
  const total = (value as Record<string, unknown>).total;
  return typeof total === "number" && Number.isFinite(total) ? total : undefined;
}

function clampNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
