import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import { createIncrementalTokenCache } from "@renderer/lib/chat-token-cache";

void describe("incremental chat token cache", () => {
  void it("keeps the same total while reusing unchanged message entries", () => {
    const cache = createIncrementalTokenCache();
    const user: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] };
    const answer: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "world" }],
    };

    const first = cache.estimate([user, answer]);
    const second = cache.estimate([user, answer]);
    const changedAnswer: UIMessage = {
      ...answer,
      parts: [{ type: "text", text: "world with a longer answer" }],
    };
    const third = cache.estimate([user, changedAnswer]);

    assert.equal(second, first);
    assert.ok(third > second);
  });

  void it("drops removed messages without retaining their token count", () => {
    const cache = createIncrementalTokenCache();
    const longMessage: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "text", text: "a".repeat(400) }],
    };
    const initial = cache.estimate([longMessage]);
    const empty = cache.estimate([]);

    assert.ok(initial > 0);
    assert.equal(empty, 0);
  });
});
