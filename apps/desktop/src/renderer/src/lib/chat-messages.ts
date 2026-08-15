import type { FileUIPart, UIMessage } from "ai";
import type { ChatMessageMetadata, ChatReactionMetadata, MessageRow } from "@shared/types";

const FOLLOWUP_SUGGESTION_LIMIT = 4;
const FOLLOWUP_SUGGESTION_MAX_LENGTH = 60;

export interface FilePartInput {
  type?: string;
  mediaType?: string;
  filename?: string;
  url?: string;
  data?: string;
}

export function toFileUIParts(files: FilePartInput[]): FileUIPart[] {
  return files
    .map((file, index) => ({
      type: "file" as const,
      mediaType: file.mediaType ?? "application/octet-stream",
      filename: file.filename ?? `file-${index + 1}`,
      url: file.url ?? file.data ?? "",
    }))
    .filter((file) => file.url.length > 0);
}

export function buildUserMessage({
  id,
  text,
  files,
}: {
  id: string;
  text: string;
  files: FileUIPart[];
}): UIMessage {
  const trimmedText = text.trim();
  const parts: UIMessage["parts"] = [];

  if (trimmedText) {
    parts.push({ type: "text", text: trimmedText });
  }
  parts.push(...files);

  if (parts.length === 0) {
    throw new Error("Cannot build an empty chat message");
  }

  return { id, role: "user", parts };
}

export function appendOrReplaceMessage(messages: UIMessage[], message: UIMessage): UIMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) return [...messages, message];
  return messages.map((item, index) => (index === existingIndex ? message : item));
}

export function readChatMessageMetadata(message: UIMessage | undefined): ChatMessageMetadata {
  const metadata = message?.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as ChatMessageMetadata)
    : {};
}

export function normalizeFollowupSuggestions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (suggestion): suggestion is string =>
        typeof suggestion === "string" && suggestion.trim().length > 0,
    )
    .map((suggestion) => suggestion.trim())
    .filter((suggestion) => suggestion.length <= FOLLOWUP_SUGGESTION_MAX_LENGTH)
    .slice(0, FOLLOWUP_SUGGESTION_LIMIT);
}

export function readFollowupSuggestions(message: UIMessage | undefined): string[] {
  if (message?.role !== "assistant") return [];
  return normalizeFollowupSuggestions(readChatMessageMetadata(message).followupSuggestions);
}

export function getLatestFollowupSuggestions(messages: UIMessage[]): string[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const suggestions = readFollowupSuggestions(messages[index]);
    if (suggestions.length > 0) return suggestions;
  }
  return [];
}

export function updateFollowupSuggestions({
  messages,
  messageId,
  suggestions,
}: {
  messages: UIMessage[];
  messageId: string;
  suggestions: string[];
}): UIMessage[] {
  const normalized = normalizeFollowupSuggestions(suggestions);
  let updated = false;
  const next = messages.map((message) => {
    if (message.id !== messageId || message.role !== "assistant") return message;
    updated = true;
    const metadata = readChatMessageMetadata(message);
    return {
      ...message,
      metadata: {
        ...metadata,
        followupSuggestions: normalized,
      } satisfies ChatMessageMetadata,
    };
  });
  return updated ? next : messages;
}

export function updateMessageReaction({
  messages,
  messageId,
  reaction,
}: {
  messages: UIMessage[];
  messageId: string;
  reaction: ChatReactionMetadata;
}): UIMessage[] {
  return messages.map((message) => {
    if (message.id !== messageId || message.role !== "assistant") return message;
    const metadata = readChatMessageMetadata(message);
    return {
      ...message,
      metadata: {
        ...metadata,
        reaction,
      } satisfies ChatMessageMetadata,
    };
  });
}

export function hydrateStoredMessage(row: MessageRow): UIMessage {
  try {
    const parsed = JSON.parse(row.content) as unknown;
    if (isUIMessage(parsed)) return parsed;
  } catch {
    // Fall through to plain-text compatibility for legacy rows.
    console.warn("[chat] preserving malformed or legacy stored message", row.id);
  }

  return {
    id: row.id,
    role: normalizeRole(row.role),
    parts: [{ type: "text", text: row.content }],
  };
}

export function isNonEmptyUIMessage(message: UIMessage): boolean {
  return Array.isArray(message.parts) && message.parts.length > 0;
}

export function prepareFailedChatSnapshot(messages: UIMessage[]): {
  messages: UIMessage[];
  deleteIds: string[];
} {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return { messages, deleteIds: [] };
  return { messages: messages.slice(0, -1), deleteIds: [last.id] };
}

export function hasPendingToolApproval(messages: UIMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return (
    lastAssistant?.parts.some(
      (part) => (part as { state?: string }).state === "approval-requested",
    ) ?? false
  );
}

export function getAgentLearningQueueKey(
  conversationId: string,
  messages: UIMessage[],
  isError: boolean,
): string | null {
  if (isError || hasPendingToolApproval(messages)) return null;
  const finalMessage = messages.at(-1);
  if (!finalMessage || finalMessage.role !== "assistant") return null;
  return `${conversationId}:${finalMessage.id}`;
}

export function buildMessageSnapshotRows({
  conversationId,
  messages,
  createdAtById,
  now = Date.now(),
}: {
  conversationId: string;
  messages: UIMessage[];
  createdAtById: ReadonlyMap<string, number>;
  now?: number;
}): MessageRow[] {
  let newMessageIndex = 0;

  return messages.filter(isNonEmptyUIMessage).map((message) => {
    const createdAt = createdAtById.get(message.id) ?? now + newMessageIndex++;
    return {
      id: message.id,
      conversation_id: conversationId,
      role: message.role,
      content: JSON.stringify(message),
      created_at: createdAt,
    };
  });
}

function isUIMessage(value: unknown): value is UIMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<UIMessage>;
  return (
    typeof candidate.id === "string" &&
    normalizeRole(candidate.role) === candidate.role &&
    Array.isArray(candidate.parts)
  );
}

function normalizeRole(role: unknown): UIMessage["role"] {
  return role === "system" || role === "assistant" || role === "user" ? role : "user";
}
