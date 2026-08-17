import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTrayMenuItems, getDefaultTrayMenuLabels } from "@desktop-main/lib/tray-menu";

void describe("tray menu", () => {
  void it("builds the expected action order", () => {
    const items = createTrayMenuItems({
      settings: "Settings",
      openHome: "Open Ayaka",
      chat: "Chat with Ayaka",
      quit: "Quit",
    });

    assert.deepEqual(items, [
      { type: "command", label: "Settings", action: "open-settings" },
      { type: "command", label: "Open Ayaka", action: "open-home" },
      { type: "command", label: "Chat with Ayaka", action: "new-chat" },
      { type: "separator" },
      { type: "command", label: "Quit", action: "quit" },
    ]);
  });

  void it("uses Chinese labels for Chinese locales and English otherwise", () => {
    assert.deepEqual(getDefaultTrayMenuLabels("zh-CN"), {
      settings: "设置",
      openHome: "打开 Ayaka",
      chat: "与 Ayaka 聊天",
      quit: "退出",
    });
    assert.deepEqual(getDefaultTrayMenuLabels("en-US"), {
      settings: "Settings",
      openHome: "Open Ayaka",
      chat: "Chat with Ayaka",
      quit: "Quit",
    });
  });
});
