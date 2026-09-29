import type { UIMessage } from "ai";
import type { MessageRow } from "@shared/types";
import { api } from "./api";
import { sanitizeBrowserScreenshotMessage } from "@shared/browser-message";

export interface MessagePersistenceRequest {
  messages: UIMessage[];
  deleteIds?: string[];
}

export interface RevisionRef {
  current: number;
  persisted?: Map<string, PersistedMessageRef>;
}

export interface PersistedMessageRef {
  message: UIMessage;
  content: string;
}

export interface SnapshotPersistenceQueue<T> {
  request: (snapshot: T) => void;
  flush: (snapshot?: T) => Promise<void>;
}

export function createSnapshotPersistenceQueue<T>(
  persist: (snapshot: T) => Promise<void>,
  onError?: (error: unknown) => void,
  mergePending?: (pending: T, incoming: T) => T,
): SnapshotPersistenceQueue<T> {
  let pending: T | undefined;
  let running: Promise<void> | null = null;

  const start = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      while (pending !== undefined) {
        const snapshot = pending;
        pending = undefined;
        await persist(snapshot);
      }
    })().finally(() => {
      running = null;
      if (pending !== undefined) void start();
    });
    return running;
  };

  return {
    request(snapshot) {
      pending = pending !== undefined && mergePending ? mergePending(pending, snapshot) : snapshot;
      void start().catch((error) => onError?.(error));
    },
    flush(snapshot) {
      if (snapshot !== undefined) {
        pending =
          pending !== undefined && mergePending ? mergePending(pending, snapshot) : snapshot;
      }
      return start();
    },
  };
}

export function mergeMessagePersistenceRequests(
  pending: MessagePersistenceRequest,
  incoming: MessagePersistenceRequest,
): MessagePersistenceRequest {
  return {
    messages: incoming.messages,
    deleteIds: [...new Set([...(pending.deleteIds ?? []), ...(incoming.deleteIds ?? [])])],
  };
}

export async function persistMessagesPatch(
  conversationId: string,
  request: MessagePersistenceRequest,
  createdAtById: Map<string, number>,
  revision: RevisionRef,
): Promise<void> {
  const persisted = revision.persisted ?? (revision.persisted = new Map());
  const deleteIds = [...new Set(request.deleteIds ?? [])];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const rows = buildChangedMessageSnapshotRows({
      conversationId,
      messages: request.messages,
      createdAtById,
      persisted,
    });
    if (rows.length === 0 && deleteIds.length === 0) return;

    const result = await api.messages.applyPatch({
      conversationId,
      baseRevision: revision.current,
      upserts: rows,
      deleteIds,
    });
    if (result.applied) {
      revision.current = result.revision;
      const messagesById = new Map(request.messages.map((message) => [message.id, message]));
      for (const row of rows) {
        createdAtById.set(row.id, row.created_at);
        const message = messagesById.get(row.id);
        if (message) persisted.set(row.id, { message, content: row.content });
      }
      for (const id of deleteIds) {
        createdAtById.delete(id);
        persisted.delete(id);
      }
      return;
    }

    const snapshot = await api.messages.list(conversationId);
    revision.current = snapshot.revision;
    for (const row of snapshot.messages) {
      createdAtById.set(row.id, row.created_at);
    }
  }
  throw new Error("Message history changed repeatedly while saving. Please retry.");
}

function buildChangedMessageSnapshotRows({
  conversationId,
  messages,
  createdAtById,
  persisted,
  now = Date.now(),
}: {
  conversationId: string;
  messages: UIMessage[];
  createdAtById: Map<string, number>;
  persisted: Map<string, PersistedMessageRef>;
  now?: number;
}): MessageRow[] {
  const persistableMessages = messages.filter(
    (message) => Array.isArray(message.parts) && message.parts.length > 0,
  );
  const assignedCreatedAt = assignMessageCreatedAtByOrder(persistableMessages, createdAtById, now);
  const rows: MessageRow[] = [];

  for (const message of persistableMessages) {
    const previousCreatedAt = createdAtById.get(message.id);
    const createdAt = assignedCreatedAt.get(message.id) ?? now;
    createdAtById.set(message.id, createdAt);
    const previous = persisted.get(message.id);
    const createdAtChanged = previousCreatedAt !== createdAt;
    if (previous?.message === message && !createdAtChanged) continue;

    const content = JSON.stringify(sanitizeBrowserScreenshotMessage(message));
    if (previous?.content === content && !createdAtChanged) {
      // A new wrapper with identical content is still safe to remember without
      // paying for another IPC upsert.
      persisted.set(message.id, { message, content });
      continue;
    }

    rows.push({
      id: message.id,
      conversation_id: conversationId,
      role: message.role,
      content,
      created_at: createdAt,
    });
  }

  return rows;
}

function assignMessageCreatedAtByOrder(
  messages: UIMessage[],
  existingCreatedAtById: ReadonlyMap<string, number>,
  now: number,
): Map<string, number> {
  const firstNewCreatedAt = Math.max(
    now,
    ...[...existingCreatedAtById.values()].map((value) => value + 1),
  );
  const assignedCreatedAt = new Map<string, number>();
  let previousCreatedAt = Number.MIN_SAFE_INTEGER;
  let newMessageIndex = 0;

  for (const message of messages) {
    const existingCreatedAt = existingCreatedAtById.get(message.id);
    const candidate = existingCreatedAt ?? firstNewCreatedAt + newMessageIndex++;
    const createdAt =
      message.role === "user" && existingCreatedAt !== undefined
        ? existingCreatedAt
        : Math.max(candidate, previousCreatedAt + 1);
    assignedCreatedAt.set(message.id, createdAt);
    previousCreatedAt = Math.max(previousCreatedAt, createdAt);
  }

  return assignedCreatedAt;
}
