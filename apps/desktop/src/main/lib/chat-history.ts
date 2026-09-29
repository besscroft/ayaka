import type { UIMessage } from "ai";
import { applyMessagesPatch, getMessagesSnapshot } from "./db";
import type { MessageRow } from "../../shared/types";
import { sanitizeBrowserScreenshotMessage } from "../../shared/browser-message";

const MAX_PERSIST_ATTEMPTS = 3;

export interface ChatSnapshotPersistenceResult {
  revision: number;
  messageCount: number;
}

/**
 * Persist the messages produced by the server-side UI stream.
 *
 * This is deliberately an upsert-only operation. Renderer-side edits and
 * deletes remain authoritative for deletion semantics, while the main
 * process can safely preserve a completed or interrupted stream when the
 * renderer disappears during shutdown.
 */
export async function persistChatStreamSnapshot(
  conversationId: string,
  messages: UIMessage[],
): Promise<ChatSnapshotPersistenceResult> {
  const persistableMessages = messages
    .filter(isPersistableMessage)
    .map(sanitizeBrowserScreenshotMessage);
  let snapshot = getMessagesSnapshot(conversationId);

  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
    const existingById = new Map(snapshot.messages.map((message) => [message.id, message]));
    const createdAtById = assignCreatedAtByMessageOrder(persistableMessages, snapshot.messages);
    const upserts = buildRows(conversationId, persistableMessages, existingById, createdAtById);
    if (upserts.length === 0) {
      return { revision: snapshot.revision, messageCount: 0 };
    }
    const result = await applyMessagesPatch({
      conversationId,
      baseRevision: snapshot.revision,
      upserts,
      deleteIds: [],
    });

    if (result.applied) {
      return { revision: result.revision, messageCount: upserts.length };
    }

    snapshot = getMessagesSnapshot(conversationId);
  }

  throw new Error("Chat stream snapshot changed repeatedly while saving.");
}

function isPersistableMessage(message: UIMessage): boolean {
  return typeof message.id === "string" && Array.isArray(message.parts) && message.parts.length > 0;
}

function buildRows(
  conversationId: string,
  messages: UIMessage[],
  existingById: Map<string, MessageRow>,
  createdAtById: ReadonlyMap<string, number>,
): MessageRow[] {
  return messages
    .filter((message) => message.role !== "user" || !existingById.has(message.id))
    .map((message) => ({
      id: message.id,
      conversation_id: conversationId,
      role: message.role,
      content: JSON.stringify(message),
      created_at: createdAtById.get(message.id) ?? Date.now(),
    }));
}

/**
 * Assign timestamps that follow the stream order while keeping stable history
 * timestamps whenever they do not conflict with a newly inserted message.
 *
 * A queued user message is appended to the runtime trace while the active
 * assistant message may already exist in the database. If we keep that old
 * assistant timestamp, an ORDER BY created_at query renders the assistant
 * before the queued message even though the stream order is correct. Once a
 * message needs a newer slot, subsequent messages are shifted forward.
 */
function assignCreatedAtByMessageOrder(
  messages: UIMessage[],
  existingMessages: MessageRow[],
): Map<string, number> {
  const existingById = new Map(existingMessages.map((message) => [message.id, message]));
  const firstNewCreatedAt = Math.max(
    Date.now(),
    ...existingMessages.map((message) => message.created_at + 1),
  );
  const createdAtById = new Map<string, number>();
  let previousCreatedAt = Number.MIN_SAFE_INTEGER;
  let newMessageIndex = 0;

  for (const message of messages) {
    const existing = existingById.get(message.id);
    const candidate = existing?.created_at ?? firstNewCreatedAt + newMessageIndex++;
    const createdAt =
      message.role === "user" && existing
        ? existing.created_at
        : Math.max(candidate, previousCreatedAt + 1);
    createdAtById.set(message.id, createdAt);
    previousCreatedAt = Math.max(previousCreatedAt, createdAt);
  }

  return createdAtById;
}
