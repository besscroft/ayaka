import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHAT_REASONING_LEVELS, SettingKey } from "@shared/types";
import { parseSettings } from "@renderer/lib/settings";

void describe("parseSettings", () => {
  void it("uses the default White skin", () => {
    const settings = parseSettings({} as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.skin, "white");
    assert.equal(settings.chatReasoningLevel, "provider-default");
  });

  void it("keeps explicit language and skin values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "zh-CN",
      [SettingKey.Skin]: "ocean",
    } as Record<string, string | null>);

    assert.equal(settings.language, "zh-CN");
    assert.equal(settings.skin, "ocean");

    const legacyIds = [
      ["nova-light", "white"],
      ["nova-dark", "black"],
      ["ocean-light", "ocean"],
    ] as const;
    for (const [legacy, expected] of legacyIds) {
      const migrated = parseSettings({
        [SettingKey.Skin]: legacy,
      } as Record<string, string | null>);
      assert.equal(migrated.skin, expected);
    }
  });

  void it("rejects invalid enum values", () => {
    const settings = parseSettings({
      [SettingKey.Language]: "de-DE",
      [SettingKey.Skin]: "not-a-skin",
      [SettingKey.ChatReasoningLevel]: "maximum",
    } as Record<string, string | null>);

    assert.equal(settings.language, "system");
    assert.equal(settings.skin, "white");
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
