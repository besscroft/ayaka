import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getChatSamplingSettings } from "./chat-model-settings";

void describe("chat sampling settings", () => {
  void it("keeps sampling settings for ordinary models", () => {
    assert.deepEqual(
      getChatSamplingSettings({ reasoningModel: false, temperature: 0.7, topP: 0.9 }),
      { temperature: 0.7, topP: 0.9 },
    );
  });

  void it("omits unsupported sampling settings for reasoning models", () => {
    assert.deepEqual(
      getChatSamplingSettings({ reasoningModel: true, temperature: 0.7, topP: 0.9 }),
      {},
    );
  });
});
