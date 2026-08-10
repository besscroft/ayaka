import type { UIMessage } from "ai";
import type { RunStatus } from "@shared/types";

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.has(status);
}

export function shouldReconcileCompletedRun({
  trackedRunId,
  runId,
  conversationId,
  runConversationId,
  isChatLoading,
  status,
}: {
  trackedRunId: string | null;
  runId: string;
  conversationId: string;
  runConversationId: string | null;
  isChatLoading: boolean;
  status: RunStatus;
}): boolean {
  return (
    isChatLoading &&
    trackedRunId === runId &&
    runConversationId === conversationId &&
    isTerminalRunStatus(status)
  );
}

function messageScore(message: UIMessage): number {
  return (message.parts ?? []).reduce((score, part) => {
    if (part.type === "text" || part.type === "reasoning") {
      return score + 10 + part.text.length;
    }
    return score + 10;
  }, 10);
}

function messagesScore(messages: UIMessage[]): number {
  return messages.reduce((score, message) => score + messageScore(message), 0);
}

function hasAssistantMessage(messages: UIMessage[]): boolean {
  return messages.some((message) => message.role === "assistant" && message.parts.length > 0);
}

/**
 * Prefer the most complete snapshot while preserving the current message order.
 * Persisted messages that appear after the current tail are appended so a final
 * assistant message can be recovered without reviving older deleted messages.
 */
export function reconcileChatMessages(
  current: UIMessage[],
  persisted: UIMessage[],
): UIMessage[] | null {
  if (!hasAssistantMessage(persisted)) return null;

  const currentScore = messagesScore(current);
  const persistedScore = messagesScore(persisted);
  if (persistedScore < currentScore) return null;

  const persistedById = new Map(persisted.map((message) => [message.id, message]));
  const merged = current.map((message) => {
    const persistedMessage = persistedById.get(message.id);
    if (!persistedMessage) return message;
    return messageScore(persistedMessage) >= messageScore(message) ? persistedMessage : message;
  });

  const currentTailId = current.at(-1)?.id;
  const tailIndex = currentTailId
    ? persisted.findIndex((message) => message.id === currentTailId)
    : -1;
  if (tailIndex >= 0) {
    merged.push(...persisted.slice(tailIndex + 1));
  } else if (current.length === 0) {
    merged.push(...persisted);
  }

  return merged;
}
