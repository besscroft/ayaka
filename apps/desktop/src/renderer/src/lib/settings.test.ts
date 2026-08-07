import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAT_REASONING_LEVELS, SettingKey } from "@shared/types";
import { parseSettings } from "./settings";

void describe("parseSettings", () => {
  void it("uses the default Nova light skin", () => {
    const settings = parseSettings({} as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.skin, "nova-light");
    assert.equal(settings.chatReasoningLevel, "provider-default");
  });

  void it("keeps explicit language and skin values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "zh-CN",
      [SettingKey.Skin]: "ocean-light",
    } as Record<string, string | null>);

    assert.equal(settings.language, "zh-CN");
    assert.equal(settings.skin, "ocean-light");
  });

  void it("rejects invalid enum values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "de-DE",
      [SettingKey.Skin]: "not-a-skin",
      [SettingKey.ChatReasoningLevel]: "maximum",
    } as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.skin, "nova-light");
    assert.equal(settings.chatReasoningLevel, "provider-default");
  });

  void it("keeps every supported chat reasoning level", () => {
    for (const level of CHAT_REASONING_LEVELS) {
      const settings = parseSettings({
        [SettingKey.ChatReasoningLevel]: level,
      } as Record<string, string | null>);

      assert.equal(settings.chatReasoningLevel, level);
    }
  });
});
