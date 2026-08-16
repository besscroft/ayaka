import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AnimatedDisclosure,
  AnimatedDisclosureTrigger,
} from "@renderer/components/ai-elements/animated-disclosure";
import { Conversation, ConversationContent } from "@renderer/components/ai-elements/conversation";
import {
  CONVERSATION_AUTO_STICK_THRESHOLD,
  CONVERSATION_DISCLOSURE_SCROLL_LOCK_MS,
  CONVERSATION_SCROLL_BUTTON_THRESHOLD,
  getConversationScrollDistance,
  getConversationScrollState,
  isConversationDisclosureScrollLocked,
  shouldFollowConversationContent,
  shouldHandleConversationScroll,
} from "@renderer/components/ai-elements/use-conversation-scroll";

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

  void it("suppresses auto-follow during disclosure layout changes", () => {
    const now = 1_000;
    const lockedUntil = now + CONVERSATION_DISCLOSURE_SCROLL_LOCK_MS;

    assert.equal(isConversationDisclosureScrollLocked(now, lockedUntil), true);
    assert.equal(shouldFollowConversationContent(true, true), false);
    assert.equal(isConversationDisclosureScrollLocked(lockedUntil, lockedUntil), false);
    assert.equal(shouldFollowConversationContent(true, false), true);
  });

  void it("keeps disclosure triggers usable outside a Conversation", () => {
    const html = renderToStaticMarkup(
      createElement(
        AnimatedDisclosure,
        null,
        createElement(AnimatedDisclosureTrigger, null, "Toggle"),
      ),
    );

    assert.match(html, /data-slot="animated-disclosure-trigger"/);
    assert.match(html, /aria-expanded="false"/);
  });

  void it("keeps the conversation viewport separate from its positioning shell", () => {
    const html = renderToStaticMarkup(
      createElement(
        Conversation,
        null,
        createElement(ConversationContent, null, "Messages"),
        createElement("button", { type: "button", "data-test-id": "scroll-button" }, "Jump"),
      ),
    );
    const shellIndex = html.indexOf('data-slot="conversation"');
    const viewportIndex = html.indexOf('data-slot="conversation-viewport"');
    const buttonIndex = html.indexOf('data-test-id="scroll-button"');

    assert.ok(shellIndex >= 0);
    assert.ok(viewportIndex > shellIndex);
    assert.ok(buttonIndex > viewportIndex);
    assert.match(html, /data-slot="conversation"[^>]*class="[^"]*relative[^"]*"/);
    assert.match(html, /data-slot="conversation-viewport"[^>]*class="[^"]*overflow-y-auto[^"]*"/);
  });

  void it("ignores intermediate programmatic scroll events", () => {
    assert.equal(shouldHandleConversationScroll(true), false);
    assert.equal(shouldHandleConversationScroll(false), true);
  });
});
