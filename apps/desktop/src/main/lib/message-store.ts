import { and, asc, eq } from "drizzle-orm";
import type { DbInstance } from "./db";
import { conversations, messages } from "./schema";
import type {
  MessagePatch,
  MessagePatchResult,
  MessageRow,
  MessageSnapshot,
} from "../../shared/types";

export type MessageDbRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content_json: string;
  metadata_json: string;
  created_at: number;
};

function normalizeMessage(msg: MessageRow, index?: number): MessageDbRow {
  const label = index === undefined ? "Message" : `Message at index ${index}`;
  if (!msg || typeof msg !== "object") throw new Error(`${label} is invalid.`);
  if (typeof msg.id !== "string" || msg.id.trim().length === 0) {
    throw new Error(`${label} id is required.`);
  }
  if (typeof msg.conversation_id !== "string" || msg.conversation_id.trim().length === 0) {
    throw new Error(`${label} conversation_id is required.`);
  }
  if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "system") {
    throw new Error(`${label} role is invalid.`);
  }
  const content = msg.content_json ?? msg.content;
  if (typeof content !== "string") throw new Error(`${label} content is required.`);
  if (msg.metadata_json !== undefined && typeof msg.metadata_json !== "string") {
    throw new Error(`${label} metadata_json is invalid.`);
  }
  if (!Number.isSafeInteger(msg.created_at) || msg.created_at < 0) {
    throw new Error(`${label} created_at is invalid.`);
  }
  return {
    id: msg.id,
    conversation_id: msg.conversation_id,
    role: msg.role,
    content_json: content,
    metadata_json: msg.metadata_json ?? "{}",
    created_at: msg.created_at,
  };
}

function assertMessageOwnership(
  tx: Parameters<DbInstance["transaction"]>[0] extends (tx: infer T) => unknown ? T : never,
  rows: MessageDbRow[],
): void {
  for (const row of rows) {
    const existing = tx
      .select({ conversationId: messages.conversation_id })
      .from(messages)
      .where(eq(messages.id, row.id))
      .get();
    if (existing && existing.conversationId !== row.conversation_id) {
      throw new Error(`Message ${row.id} belongs to another conversation.`);
    }
  }
}

function upsertMessage(
  tx: Parameters<DbInstance["transaction"]>[0] extends (tx: infer T) => unknown ? T : never,
  row: MessageDbRow,
): void {
  tx.insert(messages)
    .values(row)
    .onConflictDoUpdate({
      target: messages.id,
      set: {
        conversation_id: row.conversation_id,
        role: row.role,
        content_json: row.content_json,
        metadata_json: row.metadata_json,
        created_at: row.created_at,
      },
    })
    .run();
}

export function saveMessage(db: DbInstance, msg: MessageRow): void {
  const row = normalizeMessage(msg);
  db.transaction((tx) => {
    const conversation = tx
      .select({ revision: conversations.message_revision })
      .from(conversations)
      .where(eq(conversations.id, row.conversation_id))
      .get();
    if (!conversation) throw new Error("Conversation does not exist.");
    assertMessageOwnership(tx, [row]);
    upsertMessage(tx, row);
    tx.update(conversations)
      .set({ message_revision: conversation.revision + 1, updated_at: Date.now() })
      .where(eq(conversations.id, row.conversation_id))
      .run();
  });
}

/**
 * Persist one conversation's messages atomically. A batch never spans conversations and
 * advances the conversation revision exactly once.
 */
export function saveMessagesBatch(db: DbInstance, rows: MessageRow[]): void {
  if (rows.length === 0) return;
  const normalized = rows.map((row, index) => normalizeMessage(row, index));
  const conversationId = normalized[0]!.conversation_id;
  if (normalized.some((row) => row.conversation_id !== conversationId)) {
    throw new Error("Message batch must contain one conversation only.");
  }

  db.transaction((tx) => {
    const conversation = tx
      .select({ revision: conversations.message_revision })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
    if (!conversation) throw new Error("Conversation does not exist.");
    // Complete all checks before the first insert so a rejected batch leaves no partial data.
    assertMessageOwnership(tx, normalized);
    for (const row of normalized) upsertMessage(tx, row);
    tx.update(conversations)
      .set({ message_revision: conversation.revision + 1, updated_at: Date.now() })
      .where(eq(conversations.id, conversationId))
      .run();
  });
}

export function applyMessagesPatch(db: DbInstance, patch: MessagePatch): MessagePatchResult {
  const { conversationId, baseRevision, upserts, deleteIds } = patch;
  const normalized = upserts.map((row, index) => normalizeMessage(row, index));
  if (normalized.some((row) => row.conversation_id !== conversationId)) {
    throw new Error("Message patch contains rows from another conversation.");
  }
  if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) {
    throw new Error("Message patch base revision is invalid.");
  }

  return db.transaction((tx) => {
    const conversation = tx
      .select({ revision: conversations.message_revision })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
    if (!conversation) throw new Error("Conversation does not exist.");
    if (conversation.revision !== baseRevision) {
      return { applied: false, revision: conversation.revision };
    }

    assertMessageOwnership(tx, normalized);
    for (const id of new Set(deleteIds.filter(Boolean))) {
      tx.delete(messages)
        .where(and(eq(messages.conversation_id, conversationId), eq(messages.id, id)))
        .run();
    }
    for (const row of normalized) upsertMessage(tx, row);
    const revision = baseRevision + 1;
    tx.update(conversations)
      .set({ message_revision: revision, updated_at: Date.now() })
      .where(
        and(eq(conversations.id, conversationId), eq(conversations.message_revision, baseRevision)),
      )
      .run();
    return { applied: true, revision };
  });
}

export function listMessages(db: DbInstance, conversationId: string): MessageRow[] {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(asc(messages.created_at))
    .all()
    .map(dbMessageToShared);
}

export function getMessagesSnapshot(db: DbInstance, conversationId: string): MessageSnapshot {
  return db.transaction((tx) => {
    const conversation = tx
      .select({ revision: conversations.message_revision })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get();
    if (!conversation) throw new Error("Conversation does not exist.");
    const rows = tx
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, conversationId))
      .orderBy(asc(messages.created_at))
      .all();
    return { messages: rows.map(dbMessageToShared), revision: conversation.revision };
  });
}

export function dbMessageToShared(row: MessageDbRow): MessageRow {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role,
    content: row.content_json,
    content_json: row.content_json,
    metadata_json: row.metadata_json,
    created_at: row.created_at,
  };
}
