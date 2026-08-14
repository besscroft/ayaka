import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";

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

/**
 * OpenAI Chat Completions accepts a URL in image_url.url. AI SDK's Chat
 * serializer treats string data as already-encoded URL content, so normalize
 * binary file parts immediately before that serializer runs.
 */
export function wrapOpenAICompatibleChatModel(model: LanguageModel): LanguageModel {
  type WrappableModel = Parameters<typeof wrapLanguageModel>[0]["model"];
  return wrapLanguageModel({
    model: model as unknown as WrappableModel,
    middleware: imageDataMiddleware,
  }) as unknown as LanguageModel;
}

/** Exposed for focused tests without making a provider request. */
export const openAICompatibleImageMiddleware = imageDataMiddleware;
