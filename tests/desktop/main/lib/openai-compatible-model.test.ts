import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readUIMessageStream, streamText, toUIMessageStream, type UIMessage } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import {
  openAICompatibleImageMiddleware,
  openAICompatibleReasoningMiddleware,
  readOpenAICompatibleReasoningDelta,
  wrapOpenAICompatibleChatModel,
} from "@desktop-main/lib/openai-compatible-model";

void describe("OpenAI-compatible image middleware", () => {
  void it("turns inline image data into a complete data URL", async () => {
    const model = new MockLanguageModelV4({});
    const params = {
      prompt: [
        {
          role: "user" as const,
          content: [
            {
              type: "file" as const,
              mediaType: "image/png",
              data: { type: "data" as const, data: "AA==" },
            },
          ],
        },
      ],
    } as Parameters<typeof model.doGenerate>[0];

    const transformed = await openAICompatibleImageMiddleware.transformParams?.({
      params,
      type: "generate",
      model,
    });
    const part = transformed?.prompt[0]?.content[0] as
      | { type?: string; data?: { type?: string; url?: URL } }
      | undefined;
    assert.equal(part?.type, "file");
    assert.equal(
      part?.data?.type === "url" && part.data.url?.toString(),
      "data:image/png;base64,AA==",
    );
  });

  void it("base64-encodes binary image data", async () => {
    const model = new MockLanguageModelV4({});
    const params = {
      prompt: [
        {
          role: "user" as const,
          content: [
            {
              type: "file" as const,
              mediaType: "image/jpeg",
              data: { type: "data" as const, data: new Uint8Array([255, 216]) },
            },
          ],
        },
      ],
    } as Parameters<typeof model.doGenerate>[0];
    const transformed = await openAICompatibleImageMiddleware.transformParams?.({
      params,
      type: "stream",
      model,
    });
    const part = transformed?.prompt[0]?.content[0] as
      | { data?: { type?: string; url?: URL } }
      | undefined;
    assert.equal(
      part?.data?.type === "url" && part.data.url?.toString(),
      "data:image/jpeg;base64,/9g=",
    );
  });
});

async function collectReasoningMiddlewareStream(
  chunks: unknown[],
): Promise<Array<{ type: string; id?: string; delta?: string; rawValue?: unknown }>> {
  const model = new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({ chunks: chunks as never[] }),
    },
  });
  const params = {
    prompt: [],
  } as Parameters<typeof model.doStream>[0];
  const transformedParams = await openAICompatibleReasoningMiddleware.transformParams?.({
    params,
    type: "stream",
    model,
  });
  assert.equal(transformedParams?.includeRawChunks, true);
  const result = await openAICompatibleReasoningMiddleware.wrapStream!({
    params: transformedParams ?? params,
    model,
    doGenerate: async () => {
      throw new Error("doGenerate should not be called");
    },
    doStream: () => model.doStream(transformedParams ?? params),
  });
  const collected: Array<{
    type: string;
    id?: string;
    delta?: string;
    rawValue?: unknown;
  }> = [];
  for await (const chunk of result.stream) {
    collected.push(chunk as (typeof collected)[number]);
  }
  return collected;
}

void describe("OpenAI-compatible reasoning middleware", () => {
  void it("reads known reasoning delta fields without using token metadata", () => {
    assert.equal(
      readOpenAICompatibleReasoningDelta({
        choices: [{ delta: { reasoning_content: "first" } }],
      }),
      "first",
    );
    assert.equal(
      readOpenAICompatibleReasoningDelta({
        choices: [{ delta: { thinkingContent: "second" } }],
      }),
      "second",
    );
    assert.equal(
      readOpenAICompatibleReasoningDelta({
        choices: [{ delta: { content: "answer" } }],
        usage: { completion_tokens_details: { reasoning_tokens: 99 } },
      }),
      null,
    );
  });

  void it("converts reasoning_content into a reasoning stream before text", async () => {
    const chunks = await collectReasoningMiddlewareStream([
      {
        type: "stream-start",
        warnings: [],
      },
      {
        type: "raw",
        rawValue: { choices: [{ delta: { reasoning_content: "think " } }] },
      },
      {
        type: "raw",
        rawValue: { choices: [{ delta: { reasoning_content: "carefully" } }] },
      },
      {
        type: "text-start",
        id: "0",
      },
      {
        type: "text-delta",
        id: "0",
        delta: "answer",
      },
      {
        type: "text-end",
        id: "0",
      },
      {
        type: "finish",
        finishReason: { unified: "stop" },
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 3, text: 2, reasoning: 1 },
        },
      },
    ]);

    const visible = chunks.filter((chunk) => chunk.type !== "raw");
    assert.deepEqual(
      visible.map((chunk) => chunk.type),
      [
        "stream-start",
        "reasoning-start",
        "reasoning-delta",
        "reasoning-delta",
        "reasoning-end",
        "text-start",
        "text-delta",
        "text-end",
        "finish",
      ],
    );
    assert.deepEqual(
      visible.filter((chunk) => chunk.type === "reasoning-delta").map((chunk) => chunk.delta),
      ["think ", "carefully"],
    );
    assert.equal(visible.filter((chunk) => chunk.type === "text-delta")[0]?.delta, "answer");
  });

  void it("closes each reasoning segment and gives segments unique IDs", async () => {
    const chunks = await collectReasoningMiddlewareStream([
      {
        type: "raw",
        rawValue: { choices: [{ delta: { reasoning_content: "first" } }] },
      },
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", delta: "middle" },
      {
        type: "raw",
        rawValue: { choices: [{ delta: { thinking_content: "second" } }] },
      },
      {
        type: "finish",
        finishReason: { unified: "stop" },
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 3, text: 1, reasoning: 2 },
        },
      },
    ]);
    const starts = chunks.filter((chunk) => chunk.type === "reasoning-start");
    const ends = chunks.filter((chunk) => chunk.type === "reasoning-end");
    assert.equal(starts.length, 2);
    assert.equal(ends.length, 2);
    assert.notEqual(starts[0]?.id, starts[1]?.id);
    assert.deepEqual(
      chunks.filter((chunk) => chunk.type === "reasoning-delta").map((chunk) => chunk.delta),
      ["first", "second"],
    );
  });

  void it("does not create a reasoning part from usage-only raw chunks", async () => {
    const chunks = await collectReasoningMiddlewareStream([
      {
        type: "raw",
        rawValue: {
          choices: [{ delta: { content: "answer" } }],
          usage: { completion_tokens_details: { reasoning_tokens: 42 } },
        },
      },
      { type: "text-start", id: "0" },
      { type: "text-delta", id: "0", delta: "answer" },
      { type: "text-end", id: "0" },
      {
        type: "finish",
        finishReason: { unified: "stop" },
        usage: {
          inputTokens: { total: 1 },
          outputTokens: { total: 2, text: 2, reasoning: 0 },
        },
      },
    ]);
    assert.equal(
      chunks.some((chunk) => chunk.type.startsWith("reasoning-")),
      false,
    );
  });

  void it("closes reasoning before a tool call", async () => {
    const toolChunks = await collectReasoningMiddlewareStream([
      { type: "stream-start", warnings: [] },
      { type: "raw", rawValue: { choices: [{ delta: { reasoning_content: "plan" } }] } },
      {
        type: "tool-input-start",
        id: "tool-0",
        toolCallId: "call-0",
        toolName: "search",
      },
    ]);
    assert.deepEqual(
      toolChunks.filter((chunk) => chunk.type !== "raw").map((chunk) => chunk.type),
      ["stream-start", "reasoning-start", "reasoning-delta", "reasoning-end", "tool-input-start"],
    );
  });

  void it("preserves multiple reasoning segments through the AI SDK UI message stream", async () => {
    const baseModel = new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "raw",
              rawValue: { choices: [{ delta: { reasoning_content: "first " } }] },
            },
            {
              type: "raw",
              rawValue: { choices: [{ delta: { reasoning_content: "thought" } }] },
            },
            { type: "text-start", id: "0" },
            { type: "text-delta", id: "0", delta: "intermediate" },
            { type: "text-end", id: "0" },
            {
              type: "raw",
              rawValue: { choices: [{ delta: { reasoning_content: "second thought" } }] },
            },
            { type: "text-start", id: "1" },
            { type: "text-delta", id: "1", delta: "provider answer" },
            { type: "text-end", id: "1" },
            {
              type: "finish",
              finishReason: { unified: "stop" },
              usage: {
                inputTokens: { total: 1 },
                outputTokens: { total: 3, text: 2, reasoning: 1 },
              },
            },
          ] as never[],
        }),
      },
    });
    const result = streamText({
      model: wrapOpenAICompatibleChatModel(baseModel),
      prompt: "hello",
      maxRetries: 0,
    });
    const uiStream = toUIMessageStream({
      stream: result.stream,
      sendReasoning: true,
      sendStart: true,
      sendFinish: true,
    });
    const states: UIMessage[] = [];
    for await (const message of readUIMessageStream({ stream: uiStream })) {
      states.push(message);
    }
    const finalMessage = states.at(-1);
    const reasoningTexts = states.flatMap((message) =>
      message.parts
        .filter((part) => part.type === "reasoning")
        .map((part) => (part.type === "reasoning" ? part.text : "")),
    );
    assert.ok(reasoningTexts.includes("first "));
    assert.ok(reasoningTexts.includes("first thought"));
    const reasoningParts = finalMessage?.parts.filter((part) => part.type === "reasoning") ?? [];
    const textParts = finalMessage?.parts.filter((part) => part.type === "text") ?? [];
    assert.deepEqual(
      reasoningParts.map((part) => (part.type === "reasoning" ? part.text : "")),
      ["first thought", "second thought"],
    );
    assert.deepEqual(
      textParts.map((part) => (part.type === "text" ? part.text : "")),
      ["intermediate", "provider answer"],
    );
  });
});
