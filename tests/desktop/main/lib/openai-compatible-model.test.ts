import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readUIMessageStream,
  streamText,
  toUIMessageStream,
  type LanguageModel,
  type UIMessage,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { normalizeOpenAICompatibleProviderOptions } from "@desktop-main/lib/providers";

const encoder = new TextEncoder();

function sseResponse(events: unknown[], delayMs = 0): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const event of events) {
          if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createTestModel(response: Response | (() => Response)): LanguageModel {
  const provider = createOpenAICompatible<string, string, string, string>({
    apiKey: "test-key",
    baseURL: "https://compatible.example/v1",
    name: "compatible-test",
    includeUsage: true,
    fetch: async () => (typeof response === "function" ? response() : response),
  });
  return provider.chatModel("test-model");
}

function chatChunk(delta: Record<string, unknown>, finishReason: string | null = null) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion.chunk",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

void describe("OpenAI-compatible provider", () => {
  void it("maps legacy openai options without changing persisted settings", () => {
    const options = {
      openai: { reasoningEffort: "low", vendorFlag: true },
      openaiCompatible: { textVerbosity: "high" },
      "my-provider": { endpointMode: "native" },
    };

    assert.deepEqual(normalizeOpenAICompatibleProviderOptions("my-provider", options), {
      openai: { reasoningEffort: "low", vendorFlag: true },
      openaiCompatible: {
        reasoningEffort: "low",
        vendorFlag: true,
        textVerbosity: "high",
      },
      "my-provider": {
        reasoningEffort: "low",
        vendorFlag: true,
        endpointMode: "native",
      },
    });
  });

  void it("converts reasoning content from doGenerate", async () => {
    const model = createTestModel(
      new Response(
        JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion",
          created: 1,
          model: "test-model",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "answer",
                reasoning_content: "plan first",
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 3,
            total_tokens: 4,
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });

    assert.deepEqual(result.content, [
      { type: "text", text: "answer" },
      { type: "reasoning", text: "plan first" },
    ]);
    assert.equal(result.finishReason.unified, "stop");
  });

  void it("emits reasoning deltas before a delayed stream produces text or finish", async () => {
    const model = createTestModel(() =>
      sseResponse(
        [
          chatChunk({ reasoning_content: "first" }),
          chatChunk({ reasoning_content: " second" }),
          chatChunk({ content: "answer" }),
          {
            ...chatChunk({}, "stop"),
            usage: {
              prompt_tokens: 1,
              completion_tokens: 3,
              total_tokens: 4,
              completion_tokens_details: { reasoning_tokens: 2 },
            },
          },
        ],
        20,
      ),
    );
    const result = streamText({ model, prompt: "hello", maxRetries: 0 });
    const uiStream = toUIMessageStream({
      stream: result.stream,
      sendReasoning: true,
      sendStart: true,
      sendFinish: true,
    });
    const states: UIMessage[] = [];
    let streamFinished = false;
    const finishPromise = result.finishReason.then(() => {
      streamFinished = true;
    });

    for await (const state of readUIMessageStream({ stream: uiStream })) {
      states.push(state);
      const reasoning = state.parts.find((part) => part.type === "reasoning");
      if (
        reasoning?.type === "reasoning" &&
        ["", "first", "first second"].includes(reasoning.text)
      ) {
        assert.equal(streamFinished, false);
      }
    }
    await finishPromise;

    const reasoningTexts = states
      .map((state) => state.parts.find((part) => part.type === "reasoning"))
      .filter(
        (part): part is Extract<UIMessage["parts"][number], { type: "reasoning" }> =>
          part?.type === "reasoning",
      )
      .map((part) => part.text);
    assert.deepEqual(reasoningTexts.slice(0, 3), ["", "first", "first second"]);
    assert.equal(
      states.at(-1)?.parts.some((part) => part.type === "text"),
      true,
    );
  });

  void it("keeps reasoning ahead of a streamed tool call", async () => {
    const model = createTestModel(() =>
      sseResponse([
        chatChunk({ reasoning: "choose a tool" }),
        chatChunk({
          tool_calls: [
            {
              index: 0,
              id: "call-0",
              type: "function",
              function: { name: "search", arguments: "{}" },
            },
          ],
        }),
        {
          ...chatChunk({}, "tool_calls"),
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        },
      ]),
    );
    const result = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "search" }] }],
    });

    const parts: string[] = [];
    for await (const chunk of result.stream) {
      if (chunk.type === "reasoning-start") parts.push("reasoning-start");
      if (chunk.type === "reasoning-delta") parts.push(`reasoning:${chunk.delta}`);
      if (chunk.type === "tool-call") parts.push("tool-call");
    }

    assert.deepEqual(parts, ["reasoning-start", "reasoning:choose a tool", "tool-call"]);
  });
});
