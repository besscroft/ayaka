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
 * AI SDK keeps unchanged message objects stable, while replacing the message
 * whose parts changed. Reuse the previous object whenever its shallow message
 * structure is unchanged so memoized rows do not render again.
 */
export function areUIMessagePartsStable(previous: UIMessage, next: UIMessage): boolean {
  if (previous === next) return true;
  if (previous.id !== next.id || previous.role !== next.role) return false;
  if (previous.metadata !== next.metadata || previous.parts.length !== next.parts.length) {
    return false;
  }
  return previous.parts.every((part, index) => part === next.parts[index]);
}

function reconcileMessageReference(previous: UIMessage | undefined, next: UIMessage): UIMessage {
  return previous && areUIMessagePartsStable(previous, next) ? previous : snapshotUIMessage(next);
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
  if (liveMessages.length === 0) return fallbackMessages;
  if (fallbackMessages.length === 0) return snapshotUIMessages(liveMessages);

  const fallbackById = new Map(fallbackMessages.map((message) => [message.id, message]));
  let changed = liveMessages.length !== fallbackMessages.length;
  const selected = liveMessages.map((message, index) => {
    const previous =
      fallbackMessages[index]?.id === message.id
        ? fallbackMessages[index]
        : fallbackById.get(message.id);
    const resolved = reconcileMessageReference(previous, message);
    if (resolved !== previous) changed = true;
    return resolved;
  });
  return changed ? selected : fallbackMessages;
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

  let changed = current.length !== incoming.length;
  const merged = current.map((message) => {
    const incomingMessage = incomingById.get(message.id);
    // User messages are locally authoritative: persisted stream snapshots can
    // still contain the pre-edit text while a regenerated run is finishing.
    if (message.role === "user" || !incomingMessage) return message;
    const resolved = reconcileMessageReference(message, incomingMessage);
    if (resolved !== message) changed = true;
    return resolved;
  });
  const appended = incoming.slice(tailIndex + 1).map((message) => snapshotUIMessage(message));
  if (appended.length > 0) changed = true;
  merged.push(...appended);
  return changed ? merged : current;
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
