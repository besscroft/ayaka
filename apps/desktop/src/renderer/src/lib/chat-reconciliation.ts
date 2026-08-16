import type { UIMessage } from "ai";
import type { RunStatus } from "@shared/types";

const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  "succeeded",
  "failed",
  "blocked",
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

function hasAssistantMessage(messages: UIMessage[]): boolean {
  return messages.some((message) => message.role === "assistant" && message.parts.length > 0);
}

/**
 * Keep a renderer-owned message snapshot. Some stream implementations update
 * a message object in place, which would otherwise make memoized message rows
 * miss a reasoning/text delta because the object reference stayed the same.
 */
export function snapshotUIMessage(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => ({ ...part })),
  };
}

export function snapshotUIMessages(messages: UIMessage[]): UIMessage[] {
  return messages.map(snapshotUIMessage);
}

/**
 * Prefer the live useChat state while a response is streaming. A transient
 * empty state can occur while the transport is catching up, so keep the last
 * non-empty renderer snapshot in that case.
 */
export function selectLiveChatMessages(
  liveMessages: UIMessage[],
  fallbackMessages: UIMessage[],
): UIMessage[] {
  return liveMessages.length > 0 ? snapshotUIMessages(liveMessages) : fallbackMessages;
}

/**
 * Merge an automatically received snapshot into the current client state.
 *
 * A stream can briefly expose an empty or older snapshot while the transport
 * catches up. Such a snapshot must never erase the current output. Messages
 * explicitly changed by the user bypass this helper and call setMessages
 * directly, so deletion and edit semantics remain intact.
 */
export function mergeChatMessages(current: UIMessage[], incoming: UIMessage[]): UIMessage[] | null {
  if (incoming.length === 0) return current.length === 0 ? [] : null;
  if (current.length === 0) return snapshotUIMessages(incoming);

  const incomingById = new Map(incoming.map((message) => [message.id, message]));
  for (const message of current) {
    const incomingMessage = incomingById.get(message.id);
    if (!incomingMessage || messageScore(incomingMessage) < messageScore(message)) return null;
  }

  const currentTailId = current.at(-1)?.id;
  const tailIndex = currentTailId
    ? incoming.findIndex((message) => message.id === currentTailId)
    : -1;
  if (tailIndex < 0) return null;

  const merged = current.map((message) => {
    const incomingMessage = incomingById.get(message.id);
    // User messages are locally authoritative: persisted stream snapshots can
    // still contain the pre-edit text while a regenerated run is finishing.
    return message.role === "user" || !incomingMessage
      ? message
      : snapshotUIMessage(incomingMessage);
  });
  merged.push(...incoming.slice(tailIndex + 1).map(snapshotUIMessage));
  return merged;
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
  return mergeChatMessages(current, persisted);
}
