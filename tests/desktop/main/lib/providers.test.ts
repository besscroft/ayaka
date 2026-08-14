import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { SettingKey, type ModelCatalogSettings } from "@shared/types";

let providerHelpers: typeof import("@desktop-main/lib/providers");

const providerKeys = new Map<string, string>();
const modelKeys = new Map<string, string>();
const settings = new Map<string, string>();

mock.module(new URL("../../../../apps/desktop/src/main/lib/db.ts", import.meta.url).href, {
  namedExports: {
    deleteApiKey: (providerId: string) => {
      providerKeys.delete(providerId);
    },
    deleteModelApiKey: (providerId: string, modelId: string) => {
      modelKeys.delete(`${providerId}/${modelId}`);
    },
    deleteModelApiKeysForProvider: (providerId: string) => {
      for (const key of modelKeys.keys()) {
        if (key.startsWith(providerId + "/")) modelKeys.delete(key);
      }
    },
    getApiKey: (providerId: string) => providerKeys.get(providerId) ?? null,
    getModelApiKey: (providerId: string, modelId: string) =>
      modelKeys.get(`${providerId}/${modelId}`) ?? null,
    getSetting: (key: string) => settings.get(key) ?? null,
    listApiKeyProviders: () => [...providerKeys.keys()],
    listModelApiKeyRefs: () => [...modelKeys.keys()],
    setApiKey: (providerId: string, apiKey: string) => {
      providerKeys.set(providerId, apiKey);
    },
    setModelApiKey: (providerId: string, modelId: string, apiKey: string) => {
      modelKeys.set(`${providerId}/${modelId}`, apiKey);
    },
    setSetting: (key: string, value: string) => {
      settings.set(key, value);
    },
  },
});

before(async () => {
  providerHelpers = await import("@desktop-main/lib/providers");
});

beforeEach(() => {
  providerKeys.clear();
  modelKeys.clear();
  settings.clear();
  settings.set(SettingKey.ModelCatalog, JSON.stringify(emptyCatalog()));
  settings.set(SettingKey.SelectedModel, "");
});

const capabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("provider helpers", () => {
  void it("registers the new built-in providers in the approved order", () => {
    const providers = providerHelpers.listProviders();
    assert.deepEqual(
      providers.slice(-5).map((provider) => ({
        id: provider.id,
        label: provider.label,
        kind: provider.kind,
        source: provider.source,
        baseUrl: provider.baseUrl,
        helpUrl: provider.helpUrl,
        models: provider.models,
        hasApiKey: provider.hasApiKey,
        hasProviderApiKey: provider.hasProviderApiKey,
      })),
      [
        {
          id: "minimax-cn",
          label: "MiniMax CN",
          kind: "openai-compatible",
          source: "builtin",
          baseUrl: "https://api.minimaxi.com/v1",
          helpUrl: "https://platform.minimaxi.com/console/access?tab=api-keys",
          models: [],
          hasApiKey: false,
          hasProviderApiKey: false,
        },
        {
          id: "xiaomi",
          label: "Xiaomi MiMo",
          kind: "openai-compatible",
          source: "builtin",
          baseUrl: "https://api.xiaomimimo.com/v1",
          helpUrl: "https://platform.xiaomimimo.com/console/api-keys",
          models: [],
          hasApiKey: false,
          hasProviderApiKey: false,
        },
        {
          id: "siliconflow-cn",
          label: "硅基流动",
          kind: "openai-compatible",
          source: "builtin",
          baseUrl: "https://api.siliconflow.cn/v1",
          helpUrl: "https://cloud.siliconflow.cn/account/ak",
          models: [],
          hasApiKey: false,
          hasProviderApiKey: false,
        },
        {
          id: "zai",
          label: "Z.ai",
          kind: "openai-compatible",
          source: "builtin",
          baseUrl: "https://api.z.ai/api/paas/v4",
          helpUrl: "https://z.ai/manage-apikey/apikey-list",
          models: [],
          hasApiKey: false,
          hasProviderApiKey: false,
        },
        {
          id: "moonshotai-cn",
          label: "Kimi CN",
          kind: "openai-compatible",
          source: "builtin",
          baseUrl: "https://api.moonshot.cn/v1",
          helpUrl: "https://platform.kimi.com/console/api-keys",
          models: [],
          hasApiKey: false,
          hasProviderApiKey: false,
        },
      ],
    );
    assert.equal(new Set(providers.map((provider) => provider.id)).size, providers.length);
  });

  void it("lets a legacy custom collision override and update its built-in slot", async () => {
    const modelId = "Qwen/Qwen3-8B";
    const catalog: ModelCatalogSettings = {
      providers: [
        {
          id: "siliconflow-cn",
          label: "Legacy SiliconFlow",
          kind: "openai-compatible",
          baseUrl: "https://legacy.example/v1",
          helpUrl: "https://legacy.example/keys",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      models: [
        {
          providerId: "siliconflow-cn",
          id: modelId,
          label: "Legacy Qwen",
          enabled: true,
          temperature: 0.5,
          topP: 0.9,
          maxOutputTokens: 4096,
          contextWindow: 32_000,
          capabilities,
          providerOptions: {},
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      modelStates: [{ providerId: "siliconflow-cn", id: modelId, enabled: true, updatedAt: 1 }],
    };
    settings.set(SettingKey.ModelCatalog, JSON.stringify(catalog));

    await providerHelpers.saveModelApiKey("siliconflow-cn", modelId, "legacy-model-key");
    let provider = providerHelpers.getProviderConfig("siliconflow-cn");
    assert.equal(provider?.source, "custom");
    assert.equal(provider?.label, "Legacy SiliconFlow");
    assert.equal(provider?.baseUrl, "https://legacy.example/v1");
    assert.deepEqual(
      provider?.models.map((model) => model.id),
      [modelId],
    );
    assert.equal(provider?.hasProviderApiKey, false);
    assert.equal(provider?.hasApiKey, true);

    await providerHelpers.saveProviderApiKey("siliconflow-cn", "provider-key");
    provider = await providerHelpers.upsertCustomProvider({
      id: "siliconflow-cn",
      label: "Updated SiliconFlow",
      baseUrl: "https://updated.example/v1/",
      helpUrl: "https://updated.example/keys",
    });
    assert.equal(provider.source, "custom");
    assert.equal(provider.label, "Updated SiliconFlow");
    assert.equal(provider.baseUrl, "https://updated.example/v1");
    assert.deepEqual(
      provider.models.map((model) => model.id),
      [modelId],
    );
    assert.equal(provider.hasProviderApiKey, true);
    assert.equal(provider.hasApiKey, true);

    const providers = providerHelpers.listProviders();
    assert.equal(providers.filter((item) => item.id === "siliconflow-cn").length, 1);
    assert.equal(
      providers.findIndex((item) => item.id === "siliconflow-cn"),
      7,
    );
    assert.equal(new Set(providers.map((item) => item.id)).size, providers.length);
    await assert.rejects(
      providerHelpers.upsertCustomProvider({
        id: "xiaomi",
        label: "Custom Xiaomi",
        baseUrl: "https://custom-xiaomi.example/v1",
      }),
      /Built-in providers cannot be overwritten/,
    );

    await providerHelpers.clearProviderApiKey("siliconflow-cn");
    provider = providerHelpers.getProviderConfig("siliconflow-cn");
    assert.equal(provider?.hasProviderApiKey, false);
    assert.equal(provider?.hasApiKey, true);

    await providerHelpers.deleteCustomProvider("siliconflow-cn");
    provider = providerHelpers.getProviderConfig("siliconflow-cn");
    assert.equal(provider?.source, "builtin");
    assert.equal(provider?.label, "硅基流动");
    assert.equal(provider?.baseUrl, "https://api.siliconflow.cn/v1");
    assert.deepEqual(provider?.models, []);
    assert.equal(provider?.hasProviderApiKey, false);
    assert.equal(provider?.hasApiKey, false);
  });

  void it("syncs compatible models with Bearer auth and preserves namespaced IDs", async () => {
    await providerHelpers.saveProviderApiKey("siliconflow-cn", "silicon-key");
    const previousFetch = globalThis.fetch;
    let requestedUrl = "";
    let authorization: string | null = null;
    globalThis.fetch = (async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get("Authorization");
      return new Response(
        JSON.stringify({
          data: [{ id: "Qwen/Qwen3-8B", display_name: "Qwen 3 8B" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const result = await providerHelpers.syncAvailableModels("siliconflow-cn");
      assert.equal(requestedUrl, "https://api.siliconflow.cn/v1/models");
      assert.equal(authorization, "Bearer silicon-key");
      assert.equal(result.discovered, 1);
      assert.equal(result.added, 1);
      assert.deepEqual(
        result.provider.models.map((model) => model.id),
        ["Qwen/Qwen3-8B"],
      );
      assert.equal(result.provider.models[0]?.enabled, false);

      const modelRef = "siliconflow-cn/Qwen/Qwen3-8B";
      await providerHelpers.updateModelEnabled("siliconflow-cn", "Qwen/Qwen3-8B", true);
      settings.set(SettingKey.SelectedModel, modelRef);
      await providerHelpers.updateModelEnabled("siliconflow-cn", "Qwen/Qwen3-8B", true);
      assert.equal(settings.get(SettingKey.SelectedModel), modelRef);
      const resolved = providerHelpers.resolveModel(modelRef);
      assert.equal(resolved.providerId, "siliconflow-cn");
      assert.equal(resolved.modelId, "Qwen/Qwen3-8B");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  void it("parses remote model list responses from supported providers", () => {
    const openaiModels = providerHelpers.parseOpenAIModelListResponse({
      data: [
        {
          id: "gpt-4o",
          display_name: "GPT-4o",
          context_length: 256_000,
          max_completion_tokens: 16_384,
          architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
          supported_parameters: ["tools", "reasoning_effort"],
          reasoning_levels: ["low", "medium", "high"],
          reasoning_default: "medium",
        },
        { name: "fallback-model" },
        { id: "" },
      ],
    });
    assert.deepEqual(
      openaiModels.map((model) => model.id),
      ["fallback-model", "gpt-4o"],
    );
    const openaiModel = openaiModels.find((model) => model.id === "gpt-4o");
    assert.equal(openaiModel?.contextWindow, 256_000);
    assert.equal(openaiModel?.maxOutputTokens, 16_384);
    assert.equal(openaiModel?.capabilities?.vision, true);
    assert.equal(openaiModel?.capabilities?.toolCalling, true);
    assert.equal(openaiModel?.capabilities?.reasoning, true);
    assert.equal(openaiModel?.capabilitySources?.vision, "provider");
    assert.equal(openaiModel?.capabilitySources?.reasoning, "provider");
    assert.deepEqual(openaiModel?.reasoningLevels, ["low", "medium", "high"]);
    assert.equal(openaiModel?.reasoningDefault, "medium");

    const anthropicModels = providerHelpers.parseAnthropicModelListResponse({
      data: [
        {
          id: "claude-sonnet-4-5",
          display_name: "Claude Sonnet",
          max_input_tokens: 180_000,
          max_output_tokens: 8_192,
        },
      ],
    });
    assert.equal(anthropicModels[0]?.label, "Claude Sonnet");
    assert.equal(anthropicModels[0]?.contextWindow, 180_000);
    assert.equal(anthropicModels[0]?.maxOutputTokens, 8_192);

    const googleModels = providerHelpers.parseGoogleModelListResponse({
      models: [
        {
          name: "models/gemini-2.5-pro",
          displayName: "Gemini Pro",
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 1_000_000,
          outputTokenLimit: 65_536,
        },
        {
          name: "models/text-embedding-004",
          supportedGenerationMethods: ["embedContent"],
        },
        {
          name: "models/custom-image-model",
          supportedGenerationMethods: ["predict"],
          outputModalities: ["image"],
        },
      ],
    });
    assert.deepEqual(
      googleModels.map((model) => model.id),
      ["custom-image-model", "gemini-2.5-pro"],
    );
    const googleTextModel = googleModels.find((model) => model.id === "gemini-2.5-pro");
    const googleImageModel = googleModels.find((model) => model.id === "custom-image-model");
    assert.equal(googleTextModel?.capabilities?.textGeneration, true);
    assert.equal(googleTextModel?.capabilitySources?.textGeneration, "provider");
    assert.equal(googleTextModel?.contextWindow, 1_000_000);
    assert.equal(googleTextModel?.maxOutputTokens, 32_768);
    assert.equal(googleImageModel?.capabilities?.imageOutput, true);
  });

  void it("infers media capabilities for known provider model families", () => {
    assert.deepEqual(pickMediaCapabilities(providerHelpers.inferModelCapabilities("gpt-image-1")), {
      textGeneration: false,
      imageOutput: true,
      speechOutput: false,
      transcription: false,
      videoOutput: false,
    });
    assert.deepEqual(
      pickMediaCapabilities(providerHelpers.inferModelCapabilities("gpt-4o-mini-tts")),
      {
        textGeneration: false,
        imageOutput: false,
        speechOutput: true,
        transcription: false,
        videoOutput: false,
      },
    );
    assert.deepEqual(pickMediaCapabilities(providerHelpers.inferModelCapabilities("whisper-1")), {
      textGeneration: false,
      imageOutput: false,
      speechOutput: false,
      transcription: true,
      videoOutput: false,
    });
    assert.deepEqual(
      pickMediaCapabilities(providerHelpers.inferModelCapabilities("veo-3.0-generate-preview")),
      {
        textGeneration: false,
        imageOutput: false,
        speechOutput: false,
        transcription: false,
        videoOutput: true,
      },
    );
  });

  void it("keeps Google media models that do not expose generateContent", () => {
    const googleModels = providerHelpers.parseGoogleModelListResponse({
      models: [
        { name: "models/imagen-4.0", supportedGenerationMethods: ["predict"] },
        {
          name: "models/veo-3.0-generate-preview",
          supportedGenerationMethods: ["predictLongRunning"],
        },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    });

    assert.deepEqual(
      googleModels.map((model) => model.id),
      ["imagen-4.0", "veo-3.0-generate-preview"],
    );
  });

  void it("merges remote capabilities while keeping local runtime settings", () => {
    const catalog: ModelCatalogSettings = {
      providers: [],
      models: [
        {
          providerId: "openai",
          id: "gpt-4o",
          enabled: true,
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 2048,
          contextWindow: 64_000,
          capabilities: { ...capabilities, vision: true },
          providerOptions: { openai: { textVerbosity: "low" } },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      modelStates: [{ providerId: "openai", id: "gpt-4o", enabled: true, updatedAt: 1 }],
    };

    const result = providerHelpers.mergeRemoteModelsIntoCatalog(
      catalog,
      "openai",
      [
        {
          id: "gpt-4o",
          label: "GPT-4o",
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
        },
        { id: "o3-mini", label: "O3 mini", contextWindow: 128_000 },
      ],
      1234,
    );

    assert.equal(result.discovered, 2);
    assert.equal(result.added, 1);
    assert.equal(result.updated, 1);

    const existing = result.catalog.models.find((model) => model.id === "gpt-4o");
    assert.equal(existing?.enabled, true);
    assert.equal(existing?.temperature, 0.2);
    assert.deepEqual(existing?.providerOptions, { openai: { textVerbosity: "low" } });
    assert.equal(existing?.label, "GPT-4o");
    assert.equal(existing?.contextWindow, 128_000);
    assert.equal(existing?.maxOutputTokens, 8_192);
    assert.equal(existing?.reasoningDefault, "provider-default");
    assert.equal(existing?.lastSyncedAt, 1234);

    const discovered = result.catalog.models.find((model) => model.id === "o3-mini");
    assert.equal(discovered?.enabled, false);
    assert.equal(discovered?.contextWindow, 128_000);
    assert.equal(
      result.catalog.modelStates.find((state) => state.id === "o3-mini")?.enabled,
      false,
    );
    assert.equal(discovered?.maxOutputTokens, 4_096);
  });

  void it("keeps local defaults when a provider omits model limits", () => {
    const catalog: ModelCatalogSettings = {
      providers: [],
      models: [
        {
          providerId: "openai",
          id: "local-model",
          enabled: true,
          temperature: 0.3,
          topP: 0.85,
          maxOutputTokens: 2_048,
          contextWindow: 64_000,
          capabilities,
          providerOptions: {},
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      modelStates: [{ providerId: "openai", id: "local-model", enabled: true, updatedAt: 1 }],
    };

    const result = providerHelpers.mergeRemoteModelsIntoCatalog(
      catalog,
      "openai",
      [{ id: "local-model", capabilities: { ...capabilities, vision: true } }],
      5678,
    );

    const model = result.catalog.models[0];
    assert.equal(model.contextWindow, 64_000);
    assert.equal(model.maxOutputTokens, 2_048);
    assert.equal(model.temperature, 0.3);
    assert.equal(model.topP, 0.85);
    assert.equal(model.capabilities.vision, true);
    assert.equal(result.updated, 1);
  });

  void it("replaces manual capability values with the next remote snapshot", () => {
    const catalog: ModelCatalogSettings = {
      providers: [],
      models: [
        {
          providerId: "openai",
          id: "custom-model",
          enabled: true,
          temperature: 0.4,
          topP: 0.8,
          maxOutputTokens: 1024,
          contextWindow: 32_000,
          capabilities: { ...capabilities, vision: true, reasoning: false },
          providerOptions: { openai: { reasoningEffort: "low" } },
          reasoningDefault: "high",
          reasoningLevels: ["provider-default", "none", "high"],
          capabilitySources: { vision: "manual", reasoning: "manual" },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      modelStates: [{ providerId: "openai", id: "custom-model", enabled: true, updatedAt: 1 }],
    };

    const result = providerHelpers.mergeRemoteModelsIntoCatalog(
      catalog,
      "openai",
      [
        {
          id: "custom-model",
          capabilities: { vision: false, reasoning: true },
          reasoningLevels: ["provider-default", "none", "medium"],
          capabilitySources: { vision: "provider", reasoning: "provider" },
        },
      ],
      4321,
    );
    const model = result.catalog.models[0];
    assert.equal(model.capabilities.vision, false);
    assert.equal(model.capabilities.reasoning, true);
    assert.deepEqual(model.reasoningLevels, ["provider-default", "none", "medium"]);
    assert.equal(model.reasoningDefault, "provider-default");
    assert.equal(model.capabilitySources?.vision, "provider");
    assert.equal(model.temperature, 0.4);
    assert.deepEqual(model.providerOptions, { openai: { reasoningEffort: "low" } });
    assert.equal(result.updatedCapabilities, 1);
  });

  void it("validates provider options JSON", () => {
    assert.equal(providerHelpers.parseProviderOptionsJson(undefined), undefined);
    assert.deepEqual(providerHelpers.parseProviderOptionsJson(""), {});
    assert.deepEqual(
      providerHelpers.parseProviderOptionsJson('{"openai":{"reasoningEffort":"low"}}'),
      {
        openai: { reasoningEffort: "low" },
      },
    );
    assert.throws(() => providerHelpers.parseProviderOptionsJson("[]"), /JSON object/);
    assert.throws(() => providerHelpers.parseProviderOptionsJson("{"), /valid JSON/);
  });

  void it("prefers provider keys and falls back to legacy model keys", () => {
    const legacyKeys: Record<string, string> = {
      "gpt-4o": "legacy-gpt-key",
      "o3-mini": "legacy-o3-key",
    };
    const getLegacyModelKey = (modelId: string): string | null => legacyKeys[modelId] ?? null;

    assert.equal(
      providerHelpers.resolveProviderApiKeyFallback({
        providerId: "openai",
        providerKey: "provider-key",
        legacyModelRefs: ["openai/gpt-4o"],
        getLegacyModelKey,
      }),
      "provider-key",
    );
    assert.equal(
      providerHelpers.resolveProviderApiKeyFallback({
        providerId: "openai",
        modelId: "o3-mini",
        providerKey: null,
        legacyModelRefs: ["openai/gpt-4o"],
        getLegacyModelKey,
      }),
      "legacy-o3-key",
    );
    assert.equal(
      providerHelpers.resolveProviderApiKeyFallback({
        providerId: "openai",
        providerKey: null,
        legacyModelRefs: ["other/model", "openai/gpt-4o"],
        getLegacyModelKey,
      }),
      "legacy-gpt-key",
    );
  });
});

function emptyCatalog(): ModelCatalogSettings {
  return { providers: [], models: [], modelStates: [] };
}

function pickMediaCapabilities(capabilities: import("@shared/types").ModelCapabilities): {
  textGeneration: boolean;
  imageOutput: boolean;
  speechOutput: boolean;
  transcription: boolean;
  videoOutput: boolean;
} {
  return {
    textGeneration: capabilities.textGeneration,
    imageOutput: capabilities.imageOutput,
    speechOutput: capabilities.speechOutput,
    transcription: capabilities.transcription,
    videoOutput: capabilities.videoOutput,
  };
}
