import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CONVERSATION_AUTO_STICK_THRESHOLD,
  CONVERSATION_SCROLL_BUTTON_THRESHOLD,
  getConversationScrollDistance,
  getConversationScrollState,
  shouldFollowConversationContent,
  shouldHandleConversationScroll,
} from "./use-conversation-scroll";

void describe("conversation scroll state", () => {
  void it("keeps the stream attached within the bottom threshold", () => {
    assert.deepEqual(getConversationScrollState(CONVERSATION_AUTO_STICK_THRESHOLD), {
      isAtLatest: true,
      isAwayFromLatest: false,
    });
    assert.equal(
      getConversationScrollState(CONVERSATION_AUTO_STICK_THRESHOLD + 1).isAtLatest,
      false,
    );
  });

  void it("shows the latest button only after the larger distance threshold", () => {
    assert.equal(
      getConversationScrollState(CONVERSATION_SCROLL_BUTTON_THRESHOLD).isAwayFromLatest,
      false,
    );
    assert.equal(
      getConversationScrollState(CONVERSATION_SCROLL_BUTTON_THRESHOLD + 1).isAwayFromLatest,
      true,
    );
  });

  void it("calculates a non-negative distance from the latest content", () => {
    assert.equal(
      getConversationScrollDistance({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 }),
      0,
    );
    assert.equal(
      getConversationScrollDistance({ scrollHeight: 1400, scrollTop: 700, clientHeight: 300 }),
      400,
    );
  });

  void it("follows content changes only while attached", () => {
    assert.equal(shouldFollowConversationContent(true), true);
    assert.equal(shouldFollowConversationContent(false), false);
  });

  void it("ignores intermediate programmatic scroll events", () => {
    assert.equal(shouldHandleConversationScroll(true), false);
    assert.equal(shouldHandleConversationScroll(false), true);
  });
});
