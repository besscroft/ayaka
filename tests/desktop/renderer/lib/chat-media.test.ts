import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type ModelCapabilities, type ProviderInfo } from "@shared/types";
import {
  getMediaCapableProviders,
  getVisionCapableProviders,
  parseMediaGenerationSettings,
  serializeMediaGenerationSettings,
} from "@renderer/lib/chat-media";

const textCapabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

const mediaCapabilities: ModelCapabilities = {
  ...textCapabilities,
  textGeneration: false,
  imageOutput: true,
  speechOutput: true,
  transcription: true,
  toolCalling: false,
};

void describe("chat media settings", () => {
  void it("normalizes and serializes per-kind defaults", () => {
    const settings = parseMediaGenerationSettings(
      JSON.stringify({
        defaults: {
          image: { modelRef: " mock/media ", options: { count: 2.8, size: "1024x1024" } },
          speech: { options: { voice: " alloy " } },
          video: { modelRef: "legacy/video", options: { duration: 5 } },
        },
      }),
    );

    assert.equal(settings.defaults.image.modelRef, "mock/media");
    assert.deepEqual(settings.defaults.image.options, { count: 2, size: "1024x1024" });
    assert.deepEqual(settings.defaults.speech.options, { voice: "alloy" });
    assert.equal("video" in settings.defaults, false);
    assert.deepEqual(settings.vision, { mode: "inherit", modelRef: null });
    assert.deepEqual(
      parseMediaGenerationSettings(serializeMediaGenerationSettings(settings)),
      settings,
    );
  });

  void it("falls back to empty defaults for malformed settings", () => {
    const settings = parseMediaGenerationSettings("{bad json");
    assert.equal(settings.version, 1);
    assert.equal(settings.defaults.image.modelRef, null);
    assert.equal("video" in settings.defaults, false);
  });

  void it("filters enabled models by media capability", () => {
    const providers = [provider()];
    assert.deepEqual(
      getMediaCapableProviders(providers, "image")[0]?.models.map((model) => model.id),
      ["media"],
    );
  });

  void it("normalizes and filters vision model settings", () => {
    const settings = parseMediaGenerationSettings(
      JSON.stringify({ vision: { mode: "model", modelRef: " mock/vision " } }),
    );
    assert.deepEqual(settings.vision, { mode: "model", modelRef: "mock/vision" });
    const providers = [provider()];
    providers[0]!.models.push({
      ...providers[0]!.models[0]!,
      id: "vision",
      capabilities: { ...textCapabilities, vision: true },
    });
    assert.deepEqual(
      getVisionCapableProviders(providers)[0]?.models.map((model) => model.id),
      ["vision"],
    );
  });
});

function provider(): ProviderInfo {
  return {
    id: "mock",
    label: "Mock",
    kind: "openai-compatible",
    source: "custom",
    models: [
      {
        id: "chat",
        enabled: true,
        source: "custom",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        contextWindow: 32_000,
        capabilities: textCapabilities,
        providerOptions: {},
      },
      {
        id: "media",
        enabled: true,
        source: "custom",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        contextWindow: 32_000,
        capabilities: mediaCapabilities,
        providerOptions: {},
      },
    ],
    helpUrl: "https://example.com",
    hasApiKey: true,
    hasProviderApiKey: true,
  };
}
