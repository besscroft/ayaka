import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelCapabilities, ModelOption } from "@shared/types";
import {
  getModelReasoningDefault,
  supportsReasoningLevel,
} from "@renderer/components/ReasoningSelector";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: true,
  embedding: false,
};

void describe("model reasoning defaults", () => {
  void it("uses advertised levels and falls back when the default is unavailable", () => {
    const model = modelOption({
      reasoningDefault: "high",
      reasoningLevels: ["provider-default", "none", "medium"],
    });

    assert.equal(supportsReasoningLevel(model, "medium"), true);
    assert.equal(supportsReasoningLevel(model, "high"), false);
    assert.equal(getModelReasoningDefault(model), "provider-default");
  });

  void it("infers the complete reasoning menu for reasoning-capable legacy models", () => {
    const model = modelOption({ reasoningLevels: undefined, reasoningDefault: "high" });

    assert.equal(supportsReasoningLevel(model, "xhigh"), true);
    assert.equal(getModelReasoningDefault(model), "high");
  });
});

function modelOption(
  overrides: Pick<ModelOption, "reasoningDefault" | "reasoningLevels">,
): ModelOption {
  return {
    id: "reasoning-model",
    source: "custom",
    enabled: true,
    temperature: 0.7,
    topP: 1,
    maxOutputTokens: 4096,
    contextWindow: 32_000,
    capabilities,
    providerOptions: {},
    ...overrides,
  };
}
