import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleTrayAction } from "@renderer/lib/tray-actions";

void describe("tray actions", () => {
  void it("opens settings without changing the current page", () => {
    const calls: string[] = [];
    handleTrayAction("open-settings", {
      openSettings: () => calls.push("settings"),
      openHome: () => calls.push("home"),
      newChat: () => calls.push("new-chat"),
    });
    assert.deepEqual(calls, ["settings"]);
  });

  void it("opens the home chat and preserves the current conversation", () => {
    const calls: string[] = [];
    handleTrayAction("open-home", {
      openSettings: () => calls.push("settings"),
      openHome: () => calls.push("home"),
      newChat: () => calls.push("new-chat"),
    });
    assert.deepEqual(calls, ["home"]);
  });

  void it("opens the home chat and creates a new conversation", () => {
    const calls: string[] = [];
    handleTrayAction("new-chat", {
      openSettings: () => calls.push("settings"),
      openHome: () => calls.push("home"),
      newChat: () => calls.push("new-chat"),
    });
    assert.deepEqual(calls, ["home", "new-chat"]);
  });
});
