import type { UIMessage } from "ai";
import { applyMessagesPatch, getMessagesSnapshot } from "./db";
import type { MessageRow } from "../../shared/types";

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
  const persistableMessages = messages.filter(isPersistableMessage);
  let snapshot = getMessagesSnapshot(conversationId);

  for (let attempt = 0; attempt < MAX_PERSIST_ATTEMPTS; attempt += 1) {
    const createdAtById = new Map(
      snapshot.messages.map((message) => [message.id, message.created_at]),
    );
    const existingById = new Map(snapshot.messages.map((message) => [message.id, message]));
    const nextCreatedAt = Math.max(
      Date.now(),
      ...snapshot.messages.map((message) => message.created_at + 1),
    );
    const upserts = buildRows(
      conversationId,
      persistableMessages.filter(
        (message) => message.role !== "user" || !existingById.has(message.id),
      ),
      createdAtById,
      nextCreatedAt,
    );
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
  createdAtById: Map<string, number>,
  firstNewCreatedAt: number,
): MessageRow[] {
  let newMessageIndex = 0;
  return messages.map((message) => ({
    id: message.id,
    conversation_id: conversationId,
    role: message.role,
    content: JSON.stringify(message),
    created_at: createdAtById.get(message.id) ?? firstNewCreatedAt + newMessageIndex++,
  }));
}
