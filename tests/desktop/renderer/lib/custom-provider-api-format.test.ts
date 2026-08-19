import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOM_PROVIDER_API_FORMATS,
  DEFAULT_CUSTOM_PROVIDER_API_FORMAT,
  isCustomProviderApiFormat,
} from "@shared/types";
import { en, zhCN } from "@renderer/lib/i18n.messages";

const labelKeys = [
  "model.apiFormat.chatCompletions",
  "model.apiFormat.responses",
  "model.apiFormat.anthropicMessages",
] as const;

void describe("custom provider API format settings", () => {
  void it("keeps all supported formats and defaults new providers to Chat Completions", () => {
    assert.deepEqual(CUSTOM_PROVIDER_API_FORMATS, [
      "chat-completions",
      "responses",
      "anthropic-messages",
    ]);
    assert.equal(DEFAULT_CUSTOM_PROVIDER_API_FORMAT, "chat-completions");
  });

  void it("rejects unsupported persisted values", () => {
    assert.equal(isCustomProviderApiFormat("chat-completions"), true);
    assert.equal(isCustomProviderApiFormat("responses"), true);
    assert.equal(isCustomProviderApiFormat("anthropic-messages"), true);
    assert.equal(isCustomProviderApiFormat("openai"), false);
    assert.equal(isCustomProviderApiFormat(null), false);
  });

  void it("provides localized labels for every option", () => {
    for (const key of labelKeys) {
      assert.notEqual(en[key], key);
      assert.notEqual(zhCN[key], key);
    }
  });
});
