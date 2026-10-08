import type { UIMessage } from "ai";

const PLACEHOLDER_CONVERSATION_TITLES = new Set([
  "新会话",
  "新建会话",
  "新建对话",
  "新建任务",
  "New chat",
  "New conversation",
  "New task",
]);

export const CONVERSATION_TITLE_RETRY_DELAYS_MS = [250, 750] as const;
export const CONVERSATION_TITLE_MAX_LENGTH = 40;

/** 判断当前标题是否已经是“真实标题”。 */
export function hasMeaningfulConversationTitle(title: string | null | undefined): boolean {
  const normalized = title?.trim();
  if (!normalized) return false;
  return !PLACEHOLDER_CONVERSATION_TITLES.has(normalized);
}

/** 清洗模型或用户文本生成的会话标题。 */
export function sanitizeConversationTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/^[\s"'`“”‘’「」『』]+|[\s"'`“”‘’「」『』]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!text) return null;
  return Array.from(text).slice(0, CONVERSATION_TITLE_MAX_LENGTH).join("") || null;
}

/** 提取第一条用户消息中的可读文本；纯附件消息返回 null。 */
export function getFirstUserMessageText(messages: UIMessage[]): string | null {
  const message = messages.find((item) => item.role === "user");
  if (!message) return null;
  const text = (message.parts ?? [])
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => {
      return part.type === "text";
    })
    .map((part) => part.text)
    .join(" ");
  return sanitizeConversationTitle(text);
}

/** 取第一轮 user + assistant 对话作为标题生成上下文。 */
export function getConversationTitleExcerpt(messages: UIMessage[]): UIMessage[] {
  let userMessage: UIMessage | undefined;
  for (const message of messages) {
    if (!userMessage && message.role === "user") {
      userMessage = message;
      continue;
    }
    if (userMessage && message.role === "assistant") return [userMessage, message];
  }
  return userMessage ? [userMessage] : [];
}

/** 在模型标题失败后从首条用户文本生成本地兜底标题。 */
export function deriveFallbackConversationTitle(messages: UIMessage[]): string | null {
  return getFirstUserMessageText(messages);
}

export interface GenerateConversationTitleOptions {
  messages: UIMessage[];
  generate: (excerpt: UIMessage[]) => Promise<string | null>;
  sleep?: (delayMs: number) => Promise<void>;
}

export type ConversationTitlePersistenceResult =
  | { status: "saved"; title: string }
  | { status: "existing" }
  | { status: "failed" };

export interface PersistConversationTitleOptions {
  title: string;
  readCurrentTitle: () => Promise<string | null | undefined>;
  writeTitle: (title: string) => Promise<void>;
  sleep?: (delayMs: number) => Promise<void>;
}

/**
 * Generate a title with bounded retries. A local title is returned when the
 * model is unavailable or keeps returning an empty/invalid result.
 */
export async function generateConversationTitleWithFallback({
  messages,
  generate,
  sleep = defaultSleep,
}: GenerateConversationTitleOptions): Promise<string | null> {
  const excerpt = getConversationTitleExcerpt(messages);
  if (excerpt.length === 0 || !getFirstUserMessageText(excerpt)) return null;

  for (let attempt = 0; attempt <= CONVERSATION_TITLE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const generated = sanitizeConversationTitle(await generate(excerpt));
      if (generated) return generated;
    } catch (error) {
      console.error("[chat] title generation attempt failed:", error);
    }

    const delay = CONVERSATION_TITLE_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }

  return deriveFallbackConversationTitle(messages);
}

/** Persist a title without overwriting a title written by the user meanwhile. */
export async function persistConversationTitleWithRetry({
  title,
  readCurrentTitle,
  writeTitle,
  sleep = defaultSleep,
}: PersistConversationTitleOptions): Promise<ConversationTitlePersistenceResult> {
  for (let attempt = 0; attempt <= CONVERSATION_TITLE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      if (hasMeaningfulConversationTitle(await readCurrentTitle())) return { status: "existing" };
      await writeTitle(title);
      return { status: "saved", title };
    } catch (error) {
      console.error("[chat] title persistence attempt failed:", error);
    }

    const delay = CONVERSATION_TITLE_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) await sleep(delay);
  }
  return { status: "failed" };
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, delayMs));
}
