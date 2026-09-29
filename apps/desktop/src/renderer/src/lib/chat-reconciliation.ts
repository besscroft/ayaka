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
  isExternalRun = false,
  status,
}: {
  trackedRunId: string | null;
  runId: string;
  conversationId: string;
  runConversationId: string | null;
  isChatLoading: boolean;
  isExternalRun?: boolean;
  status: RunStatus;
}): boolean {
  return (
    (isChatLoading || isExternalRun) &&
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
  return dedupeMessages(messages).map(snapshotUIMessage);
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
  if (liveMessages.length === 0) return dedupeMessages(fallbackMessages);
  if (fallbackMessages.length === 0) return snapshotUIMessages(liveMessages);
  return reconcilePersistedOrder(liveMessages, fallbackMessages);
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
  current = dedupeMessages(current);
  incoming = dedupeMessages(incoming);
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
 * Queued user messages persisted before the final assistant response use that
 * order; messages after the current tail are appended to recover final output.
 */
export function reconcileChatMessages(
  current: UIMessage[],
  persisted: UIMessage[],
): UIMessage[] | null {
  current = dedupeMessages(current);
  persisted = dedupeMessages(persisted);
  if (!hasAssistantMessage(persisted)) return null;
  if (hasQueuedInputBeforeAssistant(current, persisted) || hasOrderMismatch(current, persisted)) {
    return reconcilePersistedOrder(current, persisted);
  }
  return mergeChatMessages(current, persisted);
}

function hasQueuedInputBeforeAssistant(current: UIMessage[], persisted: UIMessage[]): boolean {
  const currentIds = new Set(current.map((message) => message.id));
  let hasAssistantAfter = false;
  for (let index = persisted.length - 1; index >= 0; index -= 1) {
    const message = persisted[index];
    if (!message) continue;
    if (message.role === "assistant") hasAssistantAfter = true;
    if (message.role === "user" && !currentIds.has(message.id) && hasAssistantAfter) return true;
  }
  return false;
}

function hasOrderMismatch(current: UIMessage[], persisted: UIMessage[]): boolean {
  const persistedIndexById = new Map(persisted.map((message, index) => [message.id, index]));
  let lastPersistedIndex = -1;
  for (const message of current) {
    const persistedIndex = persistedIndexById.get(message.id);
    if (persistedIndex === undefined) continue;
    if (persistedIndex < lastPersistedIndex) return true;
    lastPersistedIndex = persistedIndex;
  }
  return false;
}

function reconcilePersistedOrder(current: UIMessage[], persisted: UIMessage[]): UIMessage[] {
  current = dedupeMessages(current);
  persisted = dedupeMessages(persisted);
  const currentById = new Map(current.map((message) => [message.id, message]));
  const persistedIds = new Set<string>();
  const ordered = persisted.map((message) => {
    persistedIds.add(message.id);
    const currentMessage = currentById.get(message.id);
    if (!currentMessage) return snapshotUIMessage(message);
    if (currentMessage.role === "user" || messageScore(message) < messageScore(currentMessage)) {
      return currentMessage;
    }
    return reconcileMessageReference(currentMessage, message);
  });
  for (const message of current) {
    if (!persistedIds.has(message.id)) ordered.push(message);
  }
  return ordered;
}

function dedupeMessages(messages: UIMessage[]): UIMessage[] {
  const seen = new Set<string>();
  let hasDuplicate = false;
  for (const message of messages) {
    if (seen.has(message.id)) hasDuplicate = true;
    seen.add(message.id);
  }
  if (!hasDuplicate) return messages;

  const byId = new Map<string, UIMessage>();
  for (const message of messages) byId.set(message.id, message);
  return [...byId.values()];
}
