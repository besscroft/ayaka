import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Chat } from "@ai-sdk/react";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  DefaultChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { writeStreamSequentially } from "@desktop-main/lib/agent-ui-stream";

const initialMessages: UIMessage[] = [
  { id: "user-1", role: "user", parts: [{ type: "text", text: "start" }] },
];

void describe("agent UI message streams", () => {
  void it("preserves queued follow-up output after the current model stream", async () => {
    const stream = createUIMessageStream<UIMessage>({
      originalMessages: initialMessages,
      execute: async ({ writer }) => {
        await writeStreamSequentially(modelEpoch("current answer", true), (chunk) =>
          writer.write(chunk),
        );
        await writeStreamSequentially(modelEpoch("queued follow-up answer", false), (chunk) =>
          writer.write(chunk),
        );
        writer.write({ type: "finish", finishReason: "stop" });
      },
    });
    const response = createUIMessageStreamResponse({ stream });
    const chat = new Chat<UIMessage>({
      id: "queued-follow-up-stream",
      messages: initialMessages,
      transport: new DefaultChatTransport<UIMessage>({
        api: "http://ayaka.test/api/chat",
        fetch: async () => response,
      }),
    });

    await chat.sendMessage();

    assert.equal(chat.status, "ready");
    const assistantMessage = chat.messages.find((message) => message.role === "assistant");
    assert.ok(assistantMessage);
    assert.deepEqual(
      assistantMessage.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])),
      ["current answer", "queued follow-up answer"],
    );
  });
});

function modelEpoch(text: string, start: boolean): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      if (start) controller.enqueue({ type: "start", messageId: "assistant-response" });
      controller.enqueue({ type: "text-start", id: "0" });
      controller.enqueue({ type: "text-delta", id: "0", delta: text });
      controller.enqueue({ type: "text-end", id: "0" });
      controller.close();
    },
  });
}
