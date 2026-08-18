import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatTransport, UIMessage } from "ai";
import { ChatSessionRegistry, type ChatSessionEvent } from "@renderer/lib/chat-session-registry";

function transport(): ChatTransport<UIMessage> {
  return {
    sendMessages: async () => new ReadableStream(),
    reconnectToStream: async () => null,
  } as unknown as ChatTransport<UIMessage>;
}

function finishEvent(): ChatSessionEvent {
  return {
    type: "finish",
    payload: {
      message: { id: "a1", role: "assistant", parts: [{ type: "text", text: "done" }] },
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "question" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "done" }] },
      ],
      isAbort: false,
      isDisconnect: false,
      isError: false,
    },
  };
}

void describe("chat session registry", () => {
  void it("reuses a Chat instance and isolates message state by conversation", () => {
    const registry = new ChatSessionRegistry();
    const first = registry.getOrCreate({ conversationId: "a", transport: transport() });
    const same = registry.getOrCreate({ conversationId: "a", transport: transport() });
    const second = registry.getOrCreate({ conversationId: "b", transport: transport() });

    first.chat.messages = [{ id: "a1", role: "user", parts: [{ type: "text", text: "A" }] }];
    second.chat.messages = [{ id: "b1", role: "user", parts: [{ type: "text", text: "B" }] }];

    assert.equal(first, same);
    assert.equal(first.chat, same.chat);
    assert.notEqual(first.chat, second.chat);
    assert.equal(first.chat.messages[0]?.id, "a1");
    assert.equal(second.chat.messages[0]?.id, "b1");
  });

  void it("drains lifecycle events after a conversation is revisited", () => {
    const registry = new ChatSessionRegistry();
    const session = registry.getOrCreate({ conversationId: "a", transport: transport() });
    session.pendingEvents.push(finishEvent());

    const received: ChatSessionEvent[] = [];
    const unsubscribe = registry.subscribe("a", (event) => received.push(event));

    assert.equal(received.length, 1);
    assert.equal(received[0]?.type, "finish");
    assert.equal(session.pendingEvents.length, 0);
    unsubscribe();
  });

  void it("evicts only completed inactive sessions with an LRU limit", () => {
    const registry = new ChatSessionRegistry({ maxCachedSessions: 1 });
    const first = registry.getOrCreate({ conversationId: "a", transport: transport() });
    registry.release(first.conversationId);
    registry.getOrCreate({ conversationId: "b", transport: transport() });

    assert.equal(registry.get("a"), undefined);
    assert.ok(registry.get("b"));
  });
});
