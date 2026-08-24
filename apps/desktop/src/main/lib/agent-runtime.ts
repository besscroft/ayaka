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
  type WorkspaceCommandInput,
  type WorkspaceCommandResult,
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
import { addRootMemoryTools, ROOT_MEMORY_TOOL_NAMES } from "./root-memory-tools";
import { commandLooksDangerous, inputHasPathEscape } from "./approval-policy";
import { isBuiltinToolName, rootToolRequiresApproval } from "./root-tool-approval";
import { loadAgentGraph } from "./agent-graph";
import type { AgentGraph } from "./agent-graph";
import { AgentCoordinator } from "./agent-coordinator";
import { ContextEngine } from "./context-engine";
import {
  createContextCheckpoint,
  getConversationAgentState,
  getToolRecord,
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
import { publishSandboxArtifact } from "./sandbox-artifact-manager";
import { authorizeSandboxArtifact, isSandboxArtifactAuthorized } from "./sandbox-artifact-manager";
import { startSandboxPreview } from "./sandbox-preview-manager";
import { getSandboxSessionOrThrow } from "./sandbox-runtime";
import { resolveAgentStepDisposition, ROOT_AGENT_STOP_WHEN } from "./agent-run-policy";
import { agentLoopSessions, type AgentLoopMode, type AgentLoopSession } from "./agent-loop-session";
import {
  createToolTurnControl,
  RunToolScheduler,
  scheduleToolSet,
  type ToolTurnControl,
} from "./run-tool-scheduler";
import { buildMediaGenerationToolRequest, executeMediaGeneration } from "./media-generation";
import { addAgentManagementTools } from "./agent-management-tools";
import { classifyChatError } from "./chat-errors";
import { reconcileToolResults, removeIncompleteToolParts } from "./agent-tool-results";
import { getChatSamplingSettings } from "./chat-model-settings";
import { persistChatStreamSnapshot } from "./chat-history";
import {
  disposeWorkspaceCommandSession,
  evaluateWorkspaceCommandPolicy,
  executeWorkspaceCommand,
  redactWorkspaceCommandInput,
  redactWorkspaceCommandText,
  shouldRequireWorkspaceCommandApproval,
  WORKSPACE_COMMAND_TOOL_ID,
} from "./workspace-command";

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
  recovery?: {
    previousRunId: string;
    reason: "run_not_active" | "run_not_found";
  };
  /** Use the request-selected model even when the root agent has a model override. */
  overrideAgentModel?: boolean;
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
  toolTurnControl: ToolTurnControl;
  preparedSteering: ModelMessage[];
}

const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
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
  const initialMessages = removeIncompleteToolParts(options.messages);
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

  const rootModelRef = options.overrideAgentModel
    ? options.modelRef
    : rootAgent.model_ref || options.modelRef;
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
  const session = await agentLoopSessions.start({
    runId,
    conversationId: options.conversationId,
    rootAgentId: DEFAULT_AGENT_ID,
    modelRef: rootModelRef,
    origin: options.origin ?? "chat",
    mode: options.mode ?? "start",
    runtimeConfig: rootRuntimeConfig,
    inputSummary: summarizeText(extractTranscript(initialMessages, 6), 1_000),
    messages: initialMessages,
  });
  if (options.abortSignal) {
    if (options.abortSignal.aborted) void session.cancel("request_aborted");
    else {
      options.abortSignal.addEventListener(
        "abort",
        () => void session.cancel(String(options.abortSignal?.reason ?? "request_aborted")),
        { once: true },
      );
    }
  }
  const toolScheduler = new RunToolScheduler();
  const toolTurnControl = createToolTurnControl();
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
      void session.cancel("request_aborted");
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
    void createRuntimeStep({
      run_id: runId,
      agent_id: DEFAULT_AGENT_ID,
      kind: "guardrail",
      status: "succeeded",
      title: "Input guardrails passed",
      detail: { conversationId: options.conversationId, messageCount: initialMessages.length },
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
    if (options.recovery) {
      insertRuntimeEvent({
        runId,
        conversationId: options.conversationId,
        kind: "diagnostic",
        title: "Stale chat run recovered",
        status: "succeeded",
        detail: {
          previousRunId: options.recovery.previousRunId,
          runId,
          reason: options.recovery.reason,
        },
      });
    }
  }

  auditChatToolApprovalResponses({
    messages: initialMessages,
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
    messages: initialMessages,
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
    toolTurnControl,
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
      messages: initialMessages,
      runtimeConfig: rootRuntimeConfig,
      reasoning: context.reasoning,
      toolRuntime,
      messageStepRecorder: tracker.recordModelStep,
      contextManager: contextEngine,
      protocol: { context, agentPath: "/root", parentAgentPath: null },
      singleStep: true,
      injectSteering: true,
      turnControl: context.toolTurnControl,
    });
    return await streamRootAgentLoop({
      agent,
      toolRuntime,
      context,
      tracker,
      contextEngine,
      initialMessages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(context, "failed", { error: message });
    throw error;
  }
}

async function streamRootAgentLoop({
  agent,
  context,
  tracker,
  initialMessages,
}: {
  agent: ToolLoopAgent<never, ToolSet>;
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
  let finalExecution: ChatMessageMetadata["execution"];
  const releaseStream = context.session.registerStreamCompletion();
  let streamReleased = false;
  const releaseStreamOnce = (): void => {
    if (streamReleased) return;
    streamReleased = true;
    releaseStream();
  };

  const stream = createUIMessageStream<UIMessage<ChatMessageMetadata>>({
    originalMessages: initialMessages as UIMessage<ChatMessageMetadata>[],
    execute: async ({ writer }) => {
      try {
        const completeRun = async (outputSummary?: string): Promise<void> => {
          finalExecution ??= tracker.finalize(lastFinishReason, lastUsage);
          await finishRun(context, "succeeded", {
            execution: finalExecution,
            outputSummary,
          });
        };

        while (context.session.isActive) {
          if (context.session.absoluteLimitExceededReason) {
            await blockRun(context, "The absolute agent safety limit was reached.");
            break;
          }
          const existingBudgetReason = context.session.budgetExceededReason;
          if (existingBudgetReason) {
            if (context.session.absoluteLimitExceededReason) {
              await blockRun(context, "The absolute agent safety limit was reached.");
              break;
            }
            context.session.beginNextWindow();
          }
          modelMessages = await appendQueuedMessages(
            modelMessages,
            await context.session.drain("steering"),
            agent.tools,
          );
          context.toolTurnControl.reset();
          let result: Awaited<ReturnType<typeof agent.stream>>;
          try {
            result = await agent.stream({
              prompt: modelMessages,
              abortSignal: context.session.signal,
              timeout: { totalMs: context.session.remainingDurationMs },
            });
          } catch (error) {
            if (context.session.absoluteLimitExceededReason) {
              await blockRun(context, "The absolute agent safety limit was reached.");
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
          writer.merge(uiStream);

          const responseMessages = (await result.responseMessages) as ModelMessage[];
          modelMessages.push(
            ...context.preparedSteering.splice(0),
            ...reconcileToolResults(responseMessages, await result.toolResults),
          );
          const toolCalls = await result.toolCalls;
          const toolResults = await result.toolResults;
          lastFinishReason = await result.finishReason;
          lastText = await result.text;
          lastUsage = await result.usage;
          const budgetReason = context.session.recordStep();
          const hasToolError = toolResults.some((toolResult) => {
            const value = toolResult as unknown as Record<string, unknown>;
            return value.type === "tool-error" || value.isError === true || value.error != null;
          });
          if (toolCalls.length > 0 && !hasToolError) {
            context.session.recordProgress();
          }
          firstEpoch = false;

          if (context.session.absoluteLimitExceededReason) {
            await blockRun(context, "The absolute agent safety limit was reached.");
            break;
          }
          if (context.approvalRequested) {
            await finishRun(context, "succeeded");
            break;
          }
          const steering = await context.session.drain("steering");
          if (steering.length > 0) {
            context.messages.push(...steering);
            modelMessages = await appendQueuedMessages(modelMessages, steering, agent.tools);
            if (budgetReason) context.session.beginNextWindow();
            continue;
          }
          const followUps = await context.session.drain("follow_up");
          if (followUps.length > 0) {
            modelMessages = await appendQueuedMessages(modelMessages, followUps, agent.tools);
            if (budgetReason) context.session.beginNextWindow();
            continue;
          }

          const disposition = resolveAgentStepDisposition({
            finishReason: lastFinishReason,
            toolCallCount: toolCalls.length,
            concludesTurn: context.toolTurnControl.concluded,
          });

          if (disposition === "complete") {
            await completeRun(lastText.trim() || undefined);
            break;
          }

          if (budgetReason) {
            if (context.session.absoluteLimitExceededReason) {
              await blockRun(context, "The absolute agent safety limit was reached.");
              break;
            }
            context.session.beginNextWindow();
          }
          if (context.session.noProgressExceeded) {
            await blockRun(context, "No progress was made across the configured number of rounds.");
            break;
          }
        }

        if (context.session.signal.aborted) {
          writer.write({
            type: "abort",
            reason: String(context.session.signal.reason ?? "cancelled"),
          });
        } else {
          if (finalExecution) {
            writer.write({
              type: "message-metadata",
              messageMetadata: { execution: finalExecution },
            });
          }
          writer.write({ type: "finish", finishReason: lastFinishReason });
        }
      } catch (error) {
        const classification = classifyChatError(error, {
          phase: "stream",
          abortSignal: context.session.signal,
        });
        if (classification.code === "cancelled") {
          if (context.session.isActive) await finishRun(context, "cancelled");
          writer.write({
            type: "abort",
            reason: String(context.session.signal.reason ?? "cancelled"),
          });
          return;
        }
        if (context.session.isActive) {
          await finishRun(context, "failed", {
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
    onEnd: async ({ messages, isAborted }) => {
      try {
        if (context.conversationId) {
          const snapshotMessages = mergeStreamMessages(messages, context.session.messageTrace);
          const result = await persistChatStreamSnapshot(context.conversationId, snapshotMessages);
          console.info("[agent-runtime] persisted chat stream snapshot", {
            runId: context.runId,
            conversationId: context.conversationId,
            messageCount: result.messageCount,
            aborted: isAborted,
            revision: result.revision,
          });
        }
      } catch (error) {
        console.error("[agent-runtime] failed to persist chat stream snapshot", {
          runId: context.runId,
          conversationId: context.conversationId,
          aborted: isAborted,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        releaseStreamOnce();
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

function mergeStreamMessages(
  messages: UIMessage<ChatMessageMetadata>[],
  tracedMessages: UIMessage[],
): UIMessage<ChatMessageMetadata>[] {
  const merged = new Map<string, UIMessage<ChatMessageMetadata>>();
  for (const message of messages) merged.set(message.id, message);
  for (const message of tracedMessages) {
    if (!merged.has(message.id)) merged.set(message.id, message as UIMessage<ChatMessageMetadata>);
  }
  return [...merged.values()];
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

async function blockRun(context: RuntimeContext, reason: string): Promise<void> {
  await finishRun(context, "blocked", {
    error: reason,
  });
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

  // The root agent (Ayaka) always has the memory tools available, independent of
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
  addRootMemoryTools(tools, activeTools, {
    actorAgentId: DEFAULT_AGENT_ID,
    runId: context.runId,
    conversationId: context.conversationId,
  });
  for (const toolName of ROOT_MEMORY_TOOL_NAMES) builtinToolNames.add(toolName);
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
  const workspaceCommandSelected = isWorkspaceCommandSelected(context);
  if (workspaceCommandSelected) {
    assignTool(tools, WORKSPACE_COMMAND_TOOL_ID, createWorkspaceCommandTool(context));
    activeTools.add(WORKSPACE_COMMAND_TOOL_ID);
  }

  if (base.toolChoice !== "none" || workspaceCommandSelected) {
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
    instructions: [
      base.instructions,
      createSandboxIsolationNote(context),
      createWorkspaceCommandNote(context, workspaceCommandSelected),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function isWorkspaceCommandSelected(context: RuntimeContext): boolean {
  if (!context.modelContext.capabilities.toolCalling) return false;
  const selection = normalizeChatToolSelection(context.toolSelection);
  return (
    selection.mode === "auto" ||
    (selection.mode === "manual" && selection.selectedToolIds.includes(WORKSPACE_COMMAND_TOOL_ID))
  );
}

function createWorkspaceCommandNote(
  context: RuntimeContext,
  selected: boolean,
): string | undefined {
  if (!selected || !context.modelContext.capabilities.toolCalling) return undefined;
  return [
    "Workspace command execution:",
    "- Use workspace_run_command only when the user explicitly needs a local command run.",
    "- Always provide a structured executable and string argv array; never compose a shell command string.",
    "- cwd is relative to the conversation workspace and persists for this Agent run; env applies only to this call.",
    "- Approval for this tool is configurable in the Tools settings. When enabled, writes, deletion, installation, network, process, and unknown commands require approval.",
    "- The workspace cwd is not an OS security sandbox. A program can still access external files, use the network, or start other processes.",
  ].join("\n");
}

function createWorkspaceCommandTool(context: RuntimeContext): ToolSet[string] {
  return tool({
    description:
      "Run one structured executable with string argv in the current conversation workspace. cwd is relative and persists for this Agent run; env is per-call only. Approval is controlled by the workspace command tool setting. This is controlled local execution, not an OS sandbox.",
    inputSchema: jsonSchema<WorkspaceCommandInput>({
      type: "object",
      properties: {
        executable: {
          type: "string",
          description: "Executable name or path relative to the current workspace cwd.",
        },
        args: { type: "array", items: { type: "string" }, description: "Structured argv values." },
        cwd: { type: "string", description: "Workspace-relative working directory." },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Allowlisted environment overrides for this call only.",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds from 1,000 to 60,000; default 20,000.",
        },
      },
      required: ["executable"],
      additionalProperties: false,
    }),
    execute: (input) => runWorkspaceCommandStep(context, input),
  });
}

async function runWorkspaceCommandStep(
  context: RuntimeContext,
  input: WorkspaceCommandInput,
): Promise<WorkspaceCommandResult> {
  const decision = evaluateWorkspaceCommandPolicy(input);
  const auditInput = redactWorkspaceCommandInput(input);
  const step = await createRuntimeStep({
    run_id: context.runId,
    agent_id: DEFAULT_AGENT_ID,
    tool_id: WORKSPACE_COMMAND_TOOL_ID,
    kind: "tool",
    status: "running",
    title: "Run workspace command",
    detail: {
      toolId: WORKSPACE_COMMAND_TOOL_ID,
      input: auditInput,
      risk: decision.risk,
      approval: decision.decision,
    },
  });
  try {
    const result = await executeWorkspaceCommand({
      runId: context.runId,
      conversationId: context.conversationId,
      signal: context.session.signal,
      input,
    });
    const summary = summarizeWorkspaceCommandResult(result);
    const status =
      result.outcome === "cancelled"
        ? "cancelled"
        : result.outcome === "failed_to_start" ||
            result.outcome === "timed_out" ||
            result.exitCode !== 0
          ? "failed"
          : "succeeded";
    await updateRuntimeStep(step.id, {
      status,
      detail: { toolId: WORKSPACE_COMMAND_TOOL_ID, input: auditInput, ...summary },
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      runId: context.runId,
      conversationId: context.conversationId,
      agentId: DEFAULT_AGENT_ID,
      kind: "tool",
      title: "Workspace command " + result.outcome,
      status,
      detail: { toolId: WORKSPACE_COMMAND_TOOL_ID, ...summary },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = redactWorkspaceCommandText(message);
    await updateRuntimeStep(step.id, {
      status: "failed",
      error: safeMessage,
      detail: {
        toolId: WORKSPACE_COMMAND_TOOL_ID,
        input: auditInput,
        risk: decision.risk,
        error: safeMessage,
      },
      finished_at: Date.now(),
    });
    insertRuntimeEvent({
      runId: context.runId,
      conversationId: context.conversationId,
      agentId: DEFAULT_AGENT_ID,
      kind: "tool",
      title: "Workspace command failed",
      status: "failed",
      detail: { toolId: WORKSPACE_COMMAND_TOOL_ID, risk: decision.risk, error: safeMessage },
    });
    throw error;
  }
}

function summarizeWorkspaceCommandResult(result: WorkspaceCommandResult): Record<string, unknown> {
  return {
    executable: result.executable,
    args: result.args,
    cwd: result.cwd,
    outcome: result.outcome,
    risk: result.risk,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    durationMs: result.durationMs,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
  };
}

function createMediaGenerationTool(context: RuntimeContext): ToolSet[string] {
  return tool({
    description:
      "Generate an image, speech audio, or transcription only when the user explicitly requests that media output. Choose the media kind from the conversation. Do not call this tool merely because media is mentioned. For transcription, use the most recent user audio attachment and provide sourceFilename only to disambiguate multiple audio files.",
    inputSchema: jsonSchema<MediaGenerationToolInput>({
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["image", "speech", "transcription"],
          description: "The output type required by the user's request.",
        },
        content: {
          type: "string",
          description:
            "Image prompt or exact text to synthesize as speech. Omit for transcription.",
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
          },
          additionalProperties: false,
        },
      },
      required: ["kind"],
      additionalProperties: false,
    }),
    execute: async (input) =>
      executeMediaGeneration(await buildMediaGenerationToolRequest(input, context.messages), {
        conversationId: context.conversationId,
      }),
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
  turnControl,
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
  turnControl?: ToolTurnControl;
  protocol?: {
    context: RuntimeContext;
    agentPath: string;
    parentAgentPath: string | null;
  };
}): ToolLoopAgent<never, ToolSet> {
  const baseTools = { ...toolRuntime.tools } as ToolSet;
  const agentTools = protocol
    ? scheduleToolSet(
        baseTools,
        protocol.context.toolScheduler,
        protocol.context.session.signal,
        () => protocol.context.session.beginToolCall(),
        turnControl,
      )
    : (toolRuntime.tools ?? {});
  const turnConclusionStopWhen: StreamTextOptions["stopWhen"] = () =>
    turnControl?.concluded === true;
  const configuredStopWhen = toolRuntime.stopWhen
    ? Array.isArray(toolRuntime.stopWhen)
      ? toolRuntime.stopWhen
      : [toolRuntime.stopWhen]
    : [isStepCount(runtimeConfig.maxTurns)];
  return new ToolLoopAgent<never, ToolSet>({
    id,
    model: resolved.model,
    instructions: appendReactionFeedback(instructions, messages),
    tools: agentTools,
    activeTools: toolRuntime.activeTools,
    toolChoice: toolRuntime.toolChoice,
    toolApproval: toolRuntime.toolApproval,
    stopWhen: singleStep ? isStepCount(1) : [turnConclusionStopWhen, ...configuredStopWhen],
    ...getChatSamplingSettings({
      reasoningModel: resolved.capabilities?.reasoning === true,
      temperature: runtimeConfig.temperature ?? resolved.temperature,
      topP: runtimeConfig.topP ?? resolved.topP,
    }),
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
              const steering = await protocol.context.session.drain("steering");
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
  const step = await createRuntimeStep({
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
      void saveAgentInstance(runningInstance);
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
      const childTurnControl = createToolTurnControl();
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
        turnControl: childTurnControl,
      });
      const childResult = await childAgent.generate({
        prompt: createChildPrompt(context, child, mode, input),
        abortSignal,
        timeout: { totalMs: childConfig.totalTimeoutMs },
      });
      return summarizeText(childResult.text, 6_000);
    },
  });
  void saveAgentInstance(instance);
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
    await updateRuntimeStep(step.id, {
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
    await updateRuntimeStep(step.id, {
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
  if (enabled.has("sandbox_publish_artifact")) {
    assignTool(
      tools,
      "sandbox_publish_artifact",
      tool({
        description:
          "Publish a sandbox HTML file or static directory as a previewable artifact. Paths are sandbox-relative. Always call this after writing HTML or a static app; chat Markdown alone does not create an interactive preview.",
        inputSchema: jsonSchema<{ path: string; kind?: "html" | "static"; entryPath?: string }>({
          type: "object",
          properties: {
            path: { type: "string" },
            kind: { type: "string", enum: ["html", "static"] },
            entryPath: { type: "string" },
          },
          required: ["path"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Publish sandbox artifact", async (sandbox) => {
            const artifact = await publishSandboxArtifact(sandbox.session, input);
            return {
              artifactId: artifact.id,
              path: artifact.path,
              entryPath: artifact.entry_path,
              kind: artifact.kind,
              sizeBytes: artifact.size_bytes,
              sha256: artifact.sha256,
              status: artifact.status,
              requiresAuthorization: !isSandboxArtifactAuthorized(artifact.id),
            };
          }),
      }),
    );
  }
  if (enabled.has("sandbox_start_preview")) {
    assignTool(
      tools,
      "sandbox_start_preview",
      tool({
        description:
          "Start a long-running localhost preview process using structured executable and args. Use this only for Vite, React, or another server-backed app; standalone HTML does not need it. The artifact must be authorized first.",
        inputSchema: jsonSchema<{
          artifactId: string;
          executable: string;
          args?: string[];
          cwd?: string;
          port?: number;
          env?: Record<string, string>;
        }>({
          type: "object",
          properties: {
            artifactId: { type: "string" },
            executable: { type: "string" },
            args: { type: "array", items: { type: "string" } },
            cwd: { type: "string" },
            port: { type: "number" },
            env: { type: "object", additionalProperties: { type: "string" } },
          },
          required: ["artifactId", "executable"],
          additionalProperties: false,
        }),
        execute: (input) =>
          runSandboxStep(context, "Start sandbox preview", async (sandbox) => {
            const artifact = authorizeSandboxArtifact(
              context.conversationId ?? "",
              input.artifactId,
            );
            const preview = await startSandboxPreview(sandbox.session, input);
            return {
              previewId: preview.id,
              artifactId: artifact.id,
              port: preview.port,
              url: preview.url,
              status: preview.status,
            };
          }),
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
  const step = await createRuntimeStep({
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
    await updateRuntimeStep(step.id, {
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
    await updateRuntimeStep(step.id, {
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
  return async ({ toolCall }) => {
    const toolName = String(toolCall.toolName);
    const input = (toolCall as { input?: unknown }).input;
    const auditInput =
      toolName === WORKSPACE_COMMAND_TOOL_ID
        ? redactWorkspaceCommandInput(input)
        : toolName === "sandbox_start_preview"
          ? redactSandboxPreviewInput(input)
          : redactMemoryContentForAudit(toolName, input);
    const decision = evaluateToolGuardrail(
      context,
      toolName,
      input,
      toolApprovalToolNames,
      builtinToolNames,
    );
    const step = await createRuntimeStep({
      run_id: context.runId,
      agent_id: DEFAULT_AGENT_ID,
      tool_id: toolName,
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
      detail: { toolName, input: auditInput, decision },
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
      detail: { runId: context.runId, toolName, input: auditInput, decision },
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

function redactMemoryContentForAudit(toolName: string, input: unknown): unknown {
  if (
    !["soul_write", "memory_file_write", "memory_save", "memory_update"].includes(toolName) ||
    !input ||
    typeof input !== "object"
  ) {
    return input;
  }
  const value = input as Record<string, unknown>;
  if (typeof value.content !== "string") return input;
  return {
    ...value,
    content: { redacted: true, charCount: value.content.length },
  };
}

function redactSandboxPreviewInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = input as Record<string, unknown>;
  const env = value.env;
  return {
    artifactId: typeof value.artifactId === "string" ? value.artifactId : undefined,
    executable: typeof value.executable === "string" ? value.executable : undefined,
    args: Array.isArray(value.args) ? { redacted: true, count: value.args.length } : undefined,
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    port: typeof value.port === "number" ? value.port : undefined,
    env:
      env && typeof env === "object" && !Array.isArray(env)
        ? { redacted: true, keys: Object.keys(env).slice(0, 32) }
        : undefined,
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
  if (toolName === "sandbox_start_preview") {
    if (inputHasPathEscape(input)) {
      return { decision: "deny", risk: "high", reason: "Preview path escapes the sandbox root." };
    }
    return {
      decision: "require_review",
      risk: "high",
      reason:
        "Starting a localhost preview launches a long-running process and opens a local network port.",
    };
  }
  if (toolName === WORKSPACE_COMMAND_TOOL_ID) {
    const commandPolicy = evaluateWorkspaceCommandPolicy(input);
    if (commandPolicy.decision === "deny") {
      return { decision: "deny", risk: "high", reason: commandPolicy.reason };
    }
    const agentPolicy = readToolPolicy(context.rootAgent.tool_policy_json);
    const reviewAll =
      readRuntimeConfig(context.rootAgent.runtime_config_json).reviewPolicy === "review_all";
    const approvalEnabled = getToolRecord(WORKSPACE_COMMAND_TOOL_ID)?.requires_approval !== 0;
    const requiresReview = shouldRequireWorkspaceCommandApproval({
      approvalEnabled,
      commandDecision: commandPolicy.decision,
      reviewAll,
      toolApprovalRequested: toolApprovalToolNames.has(toolName),
      agentPolicyRequiresApproval:
        agentPolicy.requireApprovalToolIds.includes(WORKSPACE_COMMAND_TOOL_ID),
    });
    if (requiresReview) {
      return {
        decision: "require_review",
        risk: commandPolicy.risk === "read_only" ? "medium" : "high",
        reason:
          commandPolicy.decision === "require_review"
            ? commandPolicy.reason
            : reviewAll
              ? "Agent review policy requires approval for every tool call."
              : "Agent tool policy requires chat approval.",
      };
    }
    return { decision: "allow", risk: "low", reason: commandPolicy.reason };
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

async function finishRun(
  context: RuntimeContext,
  status: "succeeded" | "failed" | "cancelled" | "blocked",
  extra: {
    error?: string;
    errorCode?: ChatErrorCode;
    diagnostic?: string;
    execution?: ChatMessageMetadata["execution"];
    outputSummary?: string;
  } = {},
): Promise<void> {
  const finishedAt = Date.now();
  const failed = status === "failed";
  const finalStatus =
    context.approvalRequested && status === "succeeded" ? "waiting_approval" : status;
  const approvalPending = finalStatus === "waiting_approval";
  try {
    await disposeWorkspaceCommandSession(context.runId);
  } catch (error) {
    console.warn("[agent-runtime] failed to dispose workspace command session:", error);
  }
  if (finalStatus === "waiting_approval") {
    await context.session.markWaitingApproval();
    await updateRuntimeRun(context.runId, { final_agent_id: context.finalAgentId });
  } else if (status === "failed") {
    await context.session.fail(extra.error ?? "Agent run failed");
  } else if (status === "cancelled") {
    await context.session.cancel(extra.error ?? "cancelled");
  } else if (status === "blocked") {
    await context.session.block(extra.error ?? "Agent run blocked", extra.outputSummary);
  } else {
    await context.session.complete(extra.outputSummary, extra.execution);
    await updateRuntimeRun(context.runId, { final_agent_id: context.finalAgentId });
  }
  await createRuntimeStep({
    run_id: context.runId,
    agent_id: context.finalAgentId,
    kind: failed ? "error" : status === "cancelled" ? "diagnostic" : "output_guardrail",
    status: failed ? "failed" : status === "cancelled" ? "cancelled" : "succeeded",
    title: failed
      ? "Agent run failed"
      : status === "cancelled"
        ? "Agent run cancelled"
        : status === "blocked"
          ? "Agent run blocked"
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
      status: approvalPending
        ? "reviewing"
        : status === "blocked"
          ? "blocked"
          : isFinalHandoffAgent
            ? "idle"
            : "idle",
      current_run_id: approvalPending ? context.runId : null,
      last_error: extra.error ?? null,
    });
  }
  if (context.conversationId) {
    upsertConversationAgentState({
      conversation_id: context.conversationId,
      active_agent_id: context.finalAgentId,
      current_run_id: approvalPending ? context.runId : null,
      current_step_id: null,
      status: approvalPending
        ? "reviewing"
        : status === "blocked"
          ? "blocked"
          : failed
            ? "failed"
            : "idle",
      summary: approvalPending
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
  const startedAt = context.session.startedAt;
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
    return undefined;
  };
  return {
    messageMetadata,
    recordModelStep: () => {
      stepCount += 1;
      void createRuntimeStep({
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
    "A normal final text response completes the current task. After a tool result, continue only when more work is required; do not call another tool merely to prove completion.",
    "After a successful handoff, return the handoff result's output verbatim as the final answer. Do not summarize it, add a preface, or continue using tools.",
    context.modelContext.capabilities.toolCalling
      ? "When the user explicitly requests an image, speech audio, or transcription, decide the appropriate output and call generate_media. After it succeeds, briefly confirm the result without repeating the raw tool output."
      : "This chat model cannot call tools or generate media through the app. If the user asks for an image, speech audio, or transcription, explain that limitation and ask them to switch to a tool-calling chat model.",
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
    "Generated HTML and small-app previews:",
    "- Do not place generated HTML only in the chat response and expect it to render as an app.",
    "- After writing a standalone .html file, call sandbox_publish_artifact with kind html.",
    "- After writing a multi-file static app, call sandbox_publish_artifact for its directory with entryPath index.html.",
    "- For Vite or React apps, publish the project first, then use sandbox_start_preview with structured executable and args after authorization.",
    "- Use sandbox_start_preview only for long-running localhost services; standalone HTML does not need a server.",
    "- If the sandbox artifact tools are unavailable, state that the app cannot be published for preview; never pretend that a preview exists.",
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
  return [
    "sandbox_list_files",
    "sandbox_read_file",
    "sandbox_snapshot",
    "sandbox_list_artifacts",
    "sandbox_publish_artifact",
    "sandbox_start_preview",
  ];
}

function readToolPolicy(raw: string): AgentToolPolicy {
  return readJsonObject(raw, DEFAULT_AGENT_TOOL_POLICY, (value) => ({
    mode: value.mode === "custom" ? "custom" : "inherit",
    allowedToolIds: Array.isArray(value.allowedToolIds)
      ? value.allowedToolIds.filter(isChatToolReference)
      : [],
    requireApprovalToolIds: Array.isArray(value.requireApprovalToolIds)
      ? value.requireApprovalToolIds.filter(isChatToolReference)
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
    languageModel: resolved.model,
    providerOptions: resolved.providerOptions,
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
  for (const instance of context.coordinator.listAgents()) void saveAgentInstance(instance);
  for (const message of context.coordinator.listMessages()) void saveCollaborationMessage(message);
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
