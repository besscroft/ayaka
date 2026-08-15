import { randomUUID } from "node:crypto";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

type JsonRecord = Record<string, unknown>;
type CompatibleStreamResult = Awaited<
  ReturnType<NonNullable<LanguageModelMiddleware["wrapStream"]>>
>;
type CompatibleStreamPart =
  CompatibleStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

const COMPATIBLE_REASONING_DELTA_KEYS = [
  "reasoning_content",
  "reasoningContent",
  "thinking_content",
  "thinkingContent",
  "reasoning",
  "thinking",
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read reasoning text from the raw OpenAI Chat Completions delta used by a
 * number of compatible providers (DeepSeek, relays, and local gateways).
 *
 * This intentionally accepts only known string fields. Token counts or other
 * metadata are never turned into synthetic reasoning text.
 */
export function readOpenAICompatibleReasoningDelta(rawValue: unknown): string | null {
  if (!isRecord(rawValue) || !Array.isArray(rawValue.choices)) return null;
  const firstChoice = rawValue.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) return null;

  for (const key of COMPATIBLE_REASONING_DELTA_KEYS) {
    const value = firstChoice.delta[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

const imageDataMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const prompt = params.prompt.map((message) => {
      if (!Array.isArray(message.content)) return message;
      const content = message.content.map((part) => {
        if (
          typeof part !== "object" ||
          part === null ||
          part.type !== "file" ||
          part.data.type !== "data" ||
          !(part.mediaType === "image" || part.mediaType.startsWith("image/"))
        ) {
          return part;
        }
        const base64 =
          typeof part.data.data === "string"
            ? part.data.data
            : Buffer.from(part.data.data).toString("base64");
        const url = base64.startsWith("data:") ? base64 : `data:${part.mediaType};base64,${base64}`;
        return { ...part, data: { type: "url" as const, url: new URL(url) } };
      });
      return { ...message, content };
    });
    return { ...params, prompt } as typeof params;
  },
};

const reasoningContentMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params, type }) =>
    type === "stream" ? { ...params, includeRawChunks: true } : params,
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream();
    let reasoningId: string | undefined;

    const closeReasoning = (controller: TransformStreamDefaultController<CompatibleStreamPart>) => {
      if (!reasoningId) return;
      controller.enqueue({ type: "reasoning-end", id: reasoningId });
      reasoningId = undefined;
    };

    const transformedStream = stream.pipeThrough(
      new TransformStream<CompatibleStreamPart, CompatibleStreamPart>({
        transform(chunk, controller) {
          if (chunk.type === "raw") {
            const delta = readOpenAICompatibleReasoningDelta(chunk.rawValue);
            if (delta) {
              const wasActive = reasoningId !== undefined;
              reasoningId ??= `openai-compatible-reasoning-${randomUUID()}`;
              if (!wasActive) controller.enqueue({ type: "reasoning-start", id: reasoningId });
              controller.enqueue({ type: "reasoning-delta", id: reasoningId, delta });
            }
          }

          if (
            chunk.type === "text-start" ||
            chunk.type === "tool-input-start" ||
            chunk.type === "tool-call" ||
            chunk.type === "source" ||
            chunk.type === "file" ||
            chunk.type === "reasoning-file" ||
            chunk.type === "finish" ||
            chunk.type === "error"
          ) {
            closeReasoning(controller);
          }

          controller.enqueue(chunk);
        },
        flush(controller) {
          closeReasoning(controller);
        },
      }),
    );

    return { ...rest, stream: transformedStream };
  },
};

/**
 * OpenAI Chat Completions accepts a URL in image_url.url. AI SDK's Chat
 * serializer treats string data as already-encoded URL content, so normalize
 * binary file parts immediately before that serializer runs.
 */
export function wrapOpenAICompatibleChatModel(model: LanguageModel): LanguageModel {
  type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];
  return wrapLanguageModel({
    model: model as unknown as WrappableModel,
    middleware: [imageDataMiddleware, reasoningContentMiddleware],
  }) as unknown as LanguageModel;
}

/** Exposed for focused tests without making a provider request. */
export const openAICompatibleImageMiddleware = imageDataMiddleware;

/** Exposed for focused tests without making a provider request. */
export const openAICompatibleReasoningMiddleware = reasoningContentMiddleware;
