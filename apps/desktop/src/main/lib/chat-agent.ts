import { ToolLoopAgent } from "ai";
import type {
  LanguageModel,
  streamText,
  ToolLoopAgentSettings,
  ToolSet,
  UIMessage,
  UIMessageStreamOptions,
} from "ai";
import type {
  ChatMessageMetadata,
  ChatReactionMetadata,
  ChatReasoningLevel,
  ModelCapabilities,
  ModelProviderKind,
} from "../../shared/types";
import type { ChatToolRuntimeConfig } from "./chat-tools";
import type { NativeChatTool } from "./providers";
import type { ExactTokenCountInput } from "./context-engine";
import { getChatSamplingSettings } from "./chat-model-settings";

type StreamTextOptions = Parameters<typeof streamText>[0];
type MessageMetadataCallback = NonNullable<
  UIMessageStreamOptions<UIMessage<ChatMessageMetadata>>["messageMetadata"]
>;

export interface ResolvedChatModel {
  model: LanguageModel;
  providerId?: string;
  providerKind?: ModelProviderKind;
  modelId?: string;
  capabilities?: ModelCapabilities;
  reasoningDefault?: ChatReasoningLevel;
  reasoningLevels?: ChatReasoningLevel[];
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow?: number;
  providerOptions?: StreamTextOptions["providerOptions"];
  nativeTools?: NativeChatTool[];
  countInputTokens?: (input: ExactTokenCountInput) => Promise<number>;
}

export interface BuildChatAgentOptions {
  modelRef: string;
  resolved: ResolvedChatModel;
  instructions: string;
  messages: UIMessage[];
  agentId?: string | null;
  reasoning?: StreamTextOptions["reasoning"];
  toolRuntime: ChatToolRuntimeConfig;
}

export interface BuiltChatAgent {
  agent: ToolLoopAgent<never, ToolSet>;
  messageMetadata: MessageMetadataCallback;
}

export function buildChatAgent({
  modelRef,
  resolved,
  instructions,
  messages,
  agentId,
  reasoning,
  toolRuntime,
}: BuildChatAgentOptions): BuiltChatAgent {
  const tracker = createExecutionTracker({ modelRef, agentId });
  const agentSettings: ToolLoopAgentSettings<never, ToolSet> = {
    id: agentId ?? undefined,
    model: resolved.model,
    instructions: appendReactionFeedback(instructions, messages),
    tools: toolRuntime.tools ?? {},
    ...getChatSamplingSettings({
      reasoningModel: resolved.capabilities?.reasoning === true,
      temperature: resolved.temperature,
      topP: resolved.topP,
    }),
    maxOutputTokens: resolved.maxOutputTokens,
    providerOptions: resolved.providerOptions,
    onStepEnd: (event) => {
      tracker.recordStep();
      return toolRuntime.onStepEnd?.(event);
    },
  };

  if (reasoning !== undefined) agentSettings.reasoning = reasoning;
  if (toolRuntime.activeTools?.length) agentSettings.activeTools = toolRuntime.activeTools;
  if (toolRuntime.toolChoice) agentSettings.toolChoice = toolRuntime.toolChoice;
  if (toolRuntime.toolApproval) agentSettings.toolApproval = toolRuntime.toolApproval;
  if (toolRuntime.stopWhen) agentSettings.stopWhen = toolRuntime.stopWhen;

  return {
    agent: new ToolLoopAgent<never, ToolSet>(agentSettings),
    messageMetadata: tracker.messageMetadata,
  };
}

export function appendReactionFeedback(instructions: string, messages: UIMessage[]): string {
  const feedback = buildReactionFeedbackBlock(messages);
  if (!feedback) return instructions;
  return [instructions.trim(), feedback].filter(Boolean).join("\n\n");
}

export function buildReactionFeedbackBlock(messages: UIMessage[]): string | undefined {
  const entries = messages
    .filter((message) => message.role === "assistant")
    .map((message) => {
      const reaction = readReactionMetadata(message.metadata);
      if (!reaction) return null;
      const excerpt = extractMessageText(message).replace(/\s+/g, " ").trim().slice(0, 180);
      return {
        reaction,
        excerpt: excerpt || "[non-text assistant response]",
      };
    })
    .filter((entry): entry is { reaction: ChatReactionMetadata; excerpt: string } => entry !== null)
    .slice(-8);

  if (entries.length === 0) return undefined;

  const lines = entries.map(({ reaction, excerpt }) => {
    const label = reaction.label ? ` (${reaction.label})` : "";
    return `- ${reaction.emoji}${label}: ${excerpt}`;
  });

  return [
    "Private user feedback from earlier assistant responses. Use it only to adjust future answers; do not mention this block unless the user asks about feedback.",
    ...lines,
  ].join("\n");
}

function createExecutionTracker({
  modelRef,
  agentId,
}: {
  modelRef: string;
  agentId?: string | null;
}): {
  messageMetadata: MessageMetadataCallback;
  recordStep: () => void;
} {
  const startedAt = Date.now();
  let stepCount = 0;
  let toolCallCount = 0;

  const messageMetadata: MessageMetadataCallback = ({ part }) => {
    if (part.type === "tool-call") {
      toolCallCount += 1;
      return undefined;
    }

    if (part.type === "start") {
      return {
        execution: {
          startedAt,
          model: modelRef,
          agentId: agentId ?? null,
        },
      } satisfies ChatMessageMetadata;
    }

    if (part.type !== "finish") return undefined;

    const finishedAt = Date.now();
    const inputTokens = readTokenTotal(part.totalUsage, "inputTokens");
    const outputTokens = readTokenTotal(part.totalUsage, "outputTokens");
    const textOutputTokens = readUsageDetail(part.totalUsage, "outputTokenDetails", "textTokens");
    const reasoningTokens = readUsageDetail(
      part.totalUsage,
      "outputTokenDetails",
      "reasoningTokens",
    );
    const cacheReadTokens = readUsageDetail(
      part.totalUsage,
      "inputTokenDetails",
      "cacheReadTokens",
    );
    const cacheWriteTokens = readUsageDetail(
      part.totalUsage,
      "inputTokenDetails",
      "cacheWriteTokens",
    );
    const totalTokens =
      inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined;

    return {
      execution: {
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        model: modelRef,
        agentId: agentId ?? null,
        finishReason: String(part.finishReason),
        inputTokens,
        outputTokens,
        textOutputTokens,
        reasoningTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens,
        stepCount: stepCount || undefined,
        toolCallCount: toolCallCount || undefined,
      },
    } satisfies ChatMessageMetadata;
  };

  return {
    messageMetadata,
    recordStep: () => {
      stepCount += 1;
    },
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

function readReactionMetadata(metadata: unknown): ChatReactionMetadata | null {
  if (!metadata || typeof metadata !== "object") return null;
  const reaction = (metadata as { reaction?: unknown }).reaction;
  if (!reaction || typeof reaction !== "object") return null;
  const record = reaction as Record<string, unknown>;
  if (typeof record.emoji !== "string" || typeof record.label !== "string") return null;
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
  return { emoji: record.emoji, label: record.label, createdAt };
}

function extractMessageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n");
}
