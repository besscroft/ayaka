import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  SettingKey,
  type ManagedModelInfo,
  type MediaGenerationKind,
  type ModelCapabilities,
} from "@shared/types";
import type { MediaGenerationToolRequestDependencies } from "@desktop-main/lib/media-generation";
import {
  buildMediaGenerationToolRequest,
  hasVisionInput,
  resolveConfiguredVisionModelRef,
} from "@desktop-main/lib/media-generation";

const baseCapabilities: ModelCapabilities = {
  textGeneration: false,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: false,
  reasoning: false,
  embedding: false,
};

void describe("media generation tool requests", () => {
  void it("resolves a valid configured vision model only for image input", async () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" }],
      },
    ];
    const raw = JSON.stringify({ vision: { mode: "model", modelRef: "ready/vision" } });
    assert.equal(hasVisionInput(messages), true);
    assert.equal(
      await resolveConfiguredVisionModelRef(
        messages,
        dependencies(raw, [
          managedModel("ready/vision", "image", { vision: true, textGeneration: true }),
        ]),
      ),
      "ready/vision",
    );
    assert.equal(await resolveConfiguredVisionModelRef([], dependencies(raw, [])), null);
  });

  void it("ignores disabled, missing-key, and non-vision configured models", async () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,AA==" }],
      },
    ];
    const raw = JSON.stringify({ vision: { mode: "model", modelRef: "bad/vision" } });
    assert.equal(
      await resolveConfiguredVisionModelRef(
        messages,
        dependencies(raw, [
          managedModel("bad/vision", "image", {
            enabled: false,
            vision: true,
            textGeneration: true,
          }),
        ]),
      ),
      null,
    );
  });

  void it("uses a valid configured model and lets tool options override global defaults", async () => {
    const request = await buildMediaGenerationToolRequest(
      { kind: "image", content: " draw a city ", options: { count: 3 } },
      [],
      dependencies(
        JSON.stringify({
          defaults: {
            image: {
              modelRef: "configured/image",
              options: { count: 2, size: "1024x1024", voice: "ignored" },
            },
          },
        }),
        [managedModel("configured/image", "image")],
      ),
    );

    assert.deepEqual(request, {
      kind: "image",
      model: "configured/image",
      prompt: "draw a city",
      options: { size: "1024x1024", count: 3 },
    });
  });

  void it("falls back to the first enabled capable model with an API key", async () => {
    const request = await buildMediaGenerationToolRequest(
      { kind: "video", content: "quiet ocean" },
      [],
      dependencies(JSON.stringify({ defaults: { video: { modelRef: "disabled/video" } } }), [
        managedModel("disabled/video", "video", { enabled: false }),
        managedModel("missing-key/video", "video", { hasApiKey: false }),
        managedModel("ready/video", "video"),
      ]),
    );

    assert.equal(request.model, "ready/video");
  });

  void it("uses the latest audio attachment and supports filename disambiguation", async () => {
    const messages: UIMessage[] = [
      userMessage("u1", "old.wav", "data:audio/wav;base64,T0xE"),
      userMessage("u2", "latest.wav", "data:audio/wav;base64,TkVX"),
    ];
    const deps = dependencies(null, [managedModel("ready/transcribe", "transcription")]);

    const latest = await buildMediaGenerationToolRequest({ kind: "transcription" }, messages, deps);
    const named = await buildMediaGenerationToolRequest(
      { kind: "transcription", sourceFilename: "old.wav" },
      messages,
      deps,
    );

    assert.equal(latest.kind, "transcription");
    assert.equal(latest.kind === "transcription" ? latest.audio.filename : null, "latest.wav");
    assert.equal(named.kind === "transcription" ? named.audio.filename : null, "old.wav");
  });

  void it("rejects missing content, audio, and configured media models", async () => {
    await assert.rejects(
      buildMediaGenerationToolRequest(
        { kind: "speech" },
        [],
        dependencies(null, [managedModel("ready/speech", "speech")]),
      ),
      /Speech text is required/,
    );
    await assert.rejects(
      buildMediaGenerationToolRequest(
        { kind: "transcription" },
        [],
        dependencies(null, [managedModel("ready/transcribe", "transcription")]),
      ),
      /audio attachment/i,
    );
    await assert.rejects(
      buildMediaGenerationToolRequest(
        { kind: "image", content: "draw" },
        [],
        dependencies(null, []),
      ),
      /No image model is available/,
    );
  });
});

function dependencies(
  raw: string | null,
  models: ManagedModelInfo[],
): MediaGenerationToolRequestDependencies {
  return {
    getSetting: (key: string) => (key === SettingKey.MediaGeneration ? raw : null),
    listManagedModels: () => models,
  };
}

function managedModel(
  ref: string,
  kind: MediaGenerationKind,
  patch: Partial<Pick<ManagedModelInfo, "enabled" | "hasApiKey">> &
    Partial<Pick<ModelCapabilities, "vision" | "textGeneration">> = {},
): ManagedModelInfo {
  const [providerId, modelId] = ref.split("/");
  return {
    ref,
    providerId: providerId ?? "provider",
    providerLabel: providerId ?? "Provider",
    providerKind: "openai-compatible",
    providerSource: "custom",
    providerBaseUrl: "https://example.test/v1",
    providerHelpUrl: "https://example.test",
    modelId: modelId ?? "model",
    modelLabel: modelId,
    modelSource: "custom",
    enabled: patch.enabled ?? true,
    hasApiKey: patch.hasApiKey ?? true,
    temperature: 0.7,
    topP: 1,
    maxOutputTokens: 4096,
    contextWindow: 32_000,
    capabilities: {
      ...baseCapabilities,
      imageOutput: kind === "image",
      speechOutput: kind === "speech",
      transcription: kind === "transcription",
      videoOutput: kind === "video",
      vision: patch.vision ?? baseCapabilities.vision,
      textGeneration: patch.textGeneration ?? baseCapabilities.textGeneration,
    },
    providerOptions: {},
    providerOptionsJson: "{}",
  };
}

function userMessage(id: string, filename: string, url: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "file", mediaType: "audio/wav", filename, url }],
  };
}
