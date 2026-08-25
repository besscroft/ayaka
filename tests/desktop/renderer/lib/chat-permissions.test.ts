import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_CHAT_PERMISSION_MODE,
  clearChatPermissionForConversation,
  getChatPermissionForConversation,
  parseChatPermissionsSetting,
  withChatPermissionDefault,
  withChatPermissionForConversation,
} from "@shared/types";

void describe("chat permission settings", () => {
  void it("uses approve_risky for missing or invalid settings", () => {
    assert.deepEqual(parseChatPermissionsSetting(null), {
      version: 1,
      defaultMode: DEFAULT_CHAT_PERMISSION_MODE,
      byConversation: {},
    });
    assert.equal(parseChatPermissionsSetting("not-json").defaultMode, "approve_risky");
    assert.equal(
      parseChatPermissionsSetting(
        JSON.stringify({ version: 1, defaultMode: "not-a-mode", byConversation: [] }),
      ).defaultMode,
      "approve_risky",
    );
  });

  void it("resolves a conversation override and can restore inheritance", () => {
    const overridden = withChatPermissionForConversation(null, "conversation-1", "full_access");
    assert.deepEqual(
      getChatPermissionForConversation(JSON.stringify(overridden), "conversation-1"),
      {
        mode: "full_access",
        source: "conversation",
      },
    );
    assert.deepEqual(
      getChatPermissionForConversation(JSON.stringify(overridden), "conversation-2"),
      {
        mode: "approve_risky",
        source: "default",
      },
    );

    const inherited = clearChatPermissionForConversation(
      JSON.stringify(overridden),
      "conversation-1",
    );
    assert.deepEqual(
      getChatPermissionForConversation(JSON.stringify(inherited), "conversation-1"),
      {
        mode: "approve_risky",
        source: "default",
      },
    );
  });

  void it("changes the global default without removing conversation overrides", () => {
    const setting = withChatPermissionForConversation(null, "conversation-1", "ask");
    const next = withChatPermissionDefault(JSON.stringify(setting), "full_access");

    assert.equal(next.defaultMode, "full_access");
    assert.equal(next.byConversation["conversation-1"], "ask");
    assert.deepEqual(getChatPermissionForConversation(JSON.stringify(next), "conversation-2"), {
      mode: "full_access",
      source: "default",
    });
  });
});
