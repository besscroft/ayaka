import { before, beforeEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { SettingKey, type ModelCatalogSettings } from "@shared/types";

let providerHelpers: typeof import("@desktop-main/lib/providers");

const providerKeys = new Map<string, string>();
const modelKeys = new Map<string, string>();
const settings = new Map<string, string>();
let getApiKeyCalls = 0;
let getModelApiKeyCalls = 0;

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
    getApiKey: (providerId: string) => {
      getApiKeyCalls += 1;
      return providerKeys.get(providerId) ?? null;
    },
    getModelApiKey: (providerId: string, modelId: string) => {
      getModelApiKeyCalls += 1;
      return modelKeys.get(`${providerId}/${modelId}`) ?? null;
    },
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
  getApiKeyCalls = 0;
  getModelApiKeyCalls = 0;
  settings.set(SettingKey.ModelCatalog, JSON.stringify(emptyCatalog()));
  settings.set(SettingKey.SelectedModel, "");
});

const capabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("provider helpers", () => {
  void it("derives a provider ID when the optional ID is left blank", async () => {
    const provider = await providerHelpers.upsertCustomProvider({
      id: "",
      label: "Example Provider",
      baseUrl: "https://example-provider.test/v1",
    });

    assert.equal(provider.id, "example-provider");
    assert.equal(provider.label, "Example Provider");
  });

  void it("lists API key metadata without decrypting stored keys", async () => {
    await providerHelpers.upsertCustomProvider({
      id: "metadata-provider",
      label: "Metadata Provider",
      baseUrl: "https://metadata.example/v1",
    });
    await providerHelpers.upsertCustomModel({
      providerId: "metadata-provider",
      id: "model-a",
      capabilities,
    });
    await providerHelpers.saveProviderApiKey("metadata-provider", "provider-key");
    await providerHelpers.saveModelApiKey("metadata-provider", "model-a", "model-key");

    getApiKeyCalls = 0;
    getModelApiKeyCalls = 0;
    const provider = providerHelpers
      .listProviders()
      .find((item) => item.id === "metadata-provider");

    assert.equal(provider?.hasProviderApiKey, true);
    assert.equal(provider?.models[0]?.hasApiKey, true);
    assert.equal(getApiKeyCalls, 0);
    assert.equal(getModelApiKeyCalls, 0);
  });

  void it("reveals a provider API key only through the explicit reveal helper", async () => {
    await providerHelpers.upsertCustomProvider({
      id: "reveal-provider",
      label: "Reveal Provider",
      baseUrl: "https://reveal.example/v1",
    });
    await providerHelpers.saveProviderApiKey("reveal-provider", "provider-key");

    getApiKeyCalls = 0;
    providerHelpers.listProviders();
    assert.equal(getApiKeyCalls, 0);
    assert.equal(providerHelpers.revealProviderApiKey("reveal-provider"), "provider-key");
    assert.equal(getApiKeyCalls, 1);
    await assert.rejects(
      Promise.resolve().then(() => providerHelpers.revealProviderApiKey("missing-provider")),
      /Unknown provider/,
    );
  });

  void it("registers the new built-in providers in the approved order", async () => {
    const providers = providerHelpers.listProviders();
    assert.deepEqual(
      providers
        .filter((provider) =>
          ["minimax-cn", "xiaomi", "siliconflow-cn", "zai", "moonshotai-cn"].includes(provider.id),
        )
        .map((provider) => ({
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
    const free = providers.find((provider) => provider.id === "opencode-free");
    assert.equal(free?.authKind, "none");
    assert.equal(free?.baseUrl, "https://opencode.ai/zen/v1");
    assert.equal(free?.helpUrl, undefined);
    assert.deepEqual(
      free?.models.map((model) => model.id),
      [
        "nemotron-3-ultra-free",
        "nemotron-3.5-lightning-free",
        "big-pickle",
        "hy3-free",
        "mimo-v2.5-free",
        "muse-spark-1.2-contributor-free",
        "x-preview-f-free",
      ],
    );
    assert.equal(free?.hasApiKey, false);
    assert.equal(free?.hasProviderApiKey, false);
    assert.equal(new Set(providers.map((provider) => provider.id)).size, providers.length);
    await assert.rejects(
      providerHelpers.saveProviderApiKey("opencode-free", "should-not-be-stored"),
      /does not use an API key/,
    );
    await assert.rejects(
      providerHelpers.clearProviderApiKey("opencode-free"),
      /does not use an API key/,
    );
    await assert.rejects(
      providerHelpers.deleteCustomProvider("opencode-free"),
      /Built-in providers cannot be modified/,
    );
  });

  void it("initializes the anonymous default and syncs OpenCode models without auth", async () => {
    await providerHelpers.initializeBuiltinProviderCatalog();
    assert.equal(settings.get(SettingKey.SelectedModel), "opencode-free/nemotron-3-ultra-free");
    settings.set(SettingKey.SelectedModel, "opencode-free/big-pickle");
    await providerHelpers.initializeBuiltinProviderCatalog();
    assert.equal(settings.get(SettingKey.SelectedModel), "opencode-free/big-pickle");

    const previousFetch = globalThis.fetch;
    const requests: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (url === "https://models.dev/api.json") {
        return new Response(
          JSON.stringify({
            opencode: {
              models: {
                "big-pickle": {
                  id: "big-pickle",
                  name: "Big Pickle",
                  tool_call: true,
                  modalities: { input: ["text"], output: ["text"] },
                  limit: { context: 200_000, output: 32_000 },
                  cost: { input: 0, output: 0 },
                },
                "paid-model": {
                  id: "paid-model",
                  tool_call: true,
                  modalities: { input: ["text"], output: ["text"] },
                  cost: { input: 1, output: 1 },
                },
                "deprecated-model": {
                  id: "deprecated-model",
                  status: "deprecated",
                  tool_call: true,
                  modalities: { input: ["text"], output: ["text"] },
                  cost: { input: 0, output: 0 },
                },
                "no-tools-model": {
                  id: "no-tools-model",
                  tool_call: false,
                  modalities: { input: ["text"], output: ["text"] },
                  cost: { input: 0, output: 0 },
                },
                "image-only-model": {
                  id: "image-only-model",
                  tool_call: true,
                  modalities: { input: ["image"], output: ["text"] },
                  cost: { input: 0, output: 0 },
                },
              },
            },
          }),
          { status: 200, headers: { ETag: '"fixture-v1"' } },
        );
      }
      if (url === "https://opencode.ai/zen/v1/models") {
        return new Response(
          JSON.stringify({
            data: [
              { id: "big-pickle", object: "model" },
              { id: "paid-model", object: "model" },
              { id: "deprecated-model", object: "model" },
              { id: "no-tools-model", object: "model" },
              { id: "image-only-model", object: "model" },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/chat/completions")) {
        return new Response("fixture request reached chat completions", { status: 400 });
      }
      throw new Error("Unexpected fixture URL: " + url);
    }) as typeof fetch;

    try {
      const result = await providerHelpers.syncAvailableModels("opencode-free");
      assert.equal(result.discovered, 1);
      assert.deepEqual(
        result.provider.models.map((model) => model.id),
        ["big-pickle"],
      );
      assert.equal(result.provider.models[0]?.capabilities.textGeneration, true);
      assert.equal(result.provider.models[0]?.capabilities.toolCalling, true);
      assert.equal(result.provider.models[0]?.capabilities.vision, false);
      assert.equal(result.provider.models[0]?.contextWindow, 200_000);
      assert.equal(result.provider.models[0]?.maxOutputTokens, 32_000);
      assert.equal(settings.get(SettingKey.SelectedModel), "opencode-free/big-pickle");

      const modelListRequest = requests.find((request) => request.url.endsWith("/models"));
      assert.equal(modelListRequest?.headers.get("Authorization"), null);
      const resolved = providerHelpers.resolveModel("opencode-free/big-pickle");
      await assert.rejects(
        (
          resolved.model as unknown as {
            doGenerate(options: { prompt: unknown[] }): Promise<unknown>;
          }
        ).doGenerate({
          prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        }),
      );
      const chatRequest = requests.find((request) => request.url.endsWith("/chat/completions"));
      assert.equal(chatRequest?.headers.get("Authorization"), null);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  void it("uses the cached models.dev ETag and preserves the snapshot on refresh failure", async () => {
    await providerHelpers.initializeBuiltinProviderCatalog();
    const previousFetch = globalThis.fetch;
    let mode: "first" | "not-modified" | "failed" = "first";
    const requests: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (mode === "failed") throw new Error("fixture network down");
      if (url === "https://models.dev/api.json") {
        if (mode === "not-modified") return new Response(null, { status: 304 });
        return new Response(
          JSON.stringify({
            opencode: {
              models: {
                "big-pickle": {
                  name: "Big Pickle",
                  tool_call: true,
                  modalities: { input: ["text"], output: ["text"] },
                  cost: { input: 0, output: 0 },
                },
              },
            },
          }),
          { status: 200, headers: { ETag: '"fixture-v1"' } },
        );
      }
      return new Response(JSON.stringify({ data: [{ id: "big-pickle" }] }), { status: 200 });
    }) as typeof fetch;

    try {
      await providerHelpers.syncAvailableModels("opencode-free");
      mode = "not-modified";
      await providerHelpers.syncAvailableModels("opencode-free");
      assert.equal(
        requests
          .filter((request) => request.url === "https://models.dev/api.json")
          .at(-1)
          ?.headers.get("If-None-Match"),
        '"fixture-v1"',
      );
      const before = providerHelpers
        .listProviders()
        .find((provider) => provider.id === "opencode-free");
      await providerHelpers.updateModelEnabled("opencode-free", "big-pickle", false);
      mode = "failed";
      await assert.rejects(
        providerHelpers.syncAvailableModels("opencode-free"),
        /fixture network down/,
      );
      const after = providerHelpers
        .listProviders()
        .find((provider) => provider.id === "opencode-free");
      assert.deepEqual(
        after?.models.map((model) => model.id),
        before?.models.map((model) => model.id),
      );
      assert.equal(after?.models[0]?.enabled, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
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

  void it("persists custom provider API formats and uses protocol-specific model list auth", async () => {
    const previousFetch = globalThis.fetch;
    const requests: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({ data: [{ id: "format-model" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      for (const [apiFormat, expectedHeaders] of [
        ["chat-completions", { authorization: "Bearer format-key" }],
        ["responses", { authorization: "Bearer format-key" }],
        ["anthropic-messages", { "x-api-key": "format-key", "anthropic-version": "2023-06-01" }],
      ] as const) {
        const provider = await providerHelpers.upsertCustomProvider({
          id: "format-provider",
          label: "Format Provider",
          baseUrl: "https://format.example/v1",
          apiFormat,
        });
        assert.equal(provider.apiFormat, apiFormat);
        assert.equal(provider.helpUrl, undefined);
        await providerHelpers.saveProviderApiKey("format-provider", "format-key");

        const result = await providerHelpers.syncAvailableModels("format-provider");
        assert.equal(result.discovered, 1);
        assert.equal(requests.at(-1)?.url, "https://format.example/v1/models");
        for (const [name, value] of Object.entries(expectedHeaders)) {
          assert.equal(requests.at(-1)?.headers.get(name), value);
        }
        assert.equal(providerHelpers.getProviderConfig("format-provider")?.apiFormat, apiFormat);
      }
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  void it("defaults legacy custom providers to Chat Completions", () => {
    const catalog: ModelCatalogSettings = {
      providers: [
        {
          id: "legacy-format",
          label: "Legacy Format",
          kind: "openai-compatible",
          baseUrl: "https://legacy-format.example/v1",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      models: [],
      modelStates: [],
    };
    settings.set(SettingKey.ModelCatalog, JSON.stringify(catalog));

    assert.equal(providerHelpers.getProviderConfig("legacy-format")?.apiFormat, "chat-completions");
  });

  void it("routes custom text models to the selected API format", async () => {
    const previousFetch = globalThis.fetch;
    const requests: Array<{ url: string; headers: Headers }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response("unsupported test endpoint", { status: 400 });
    }) as typeof fetch;

    try {
      for (const [apiFormat, expectedPath, expectedHeader] of [
        ["chat-completions", "/chat/completions", ["Authorization", "Bearer route-key"]],
        ["responses", "/responses", ["Authorization", "Bearer route-key"]],
        ["anthropic-messages", "/messages", ["x-api-key", "route-key"]],
      ] as const) {
        const providerId = `route-${apiFormat}`;
        await providerHelpers.upsertCustomProvider({
          id: providerId,
          label: providerId,
          baseUrl: "https://route.example/v1",
          apiFormat,
        });
        await providerHelpers.upsertCustomModel({
          providerId,
          id: "route-model",
          enabled: true,
          capabilities,
        });
        await providerHelpers.saveProviderApiKey(providerId, "route-key");

        const resolved = providerHelpers.resolveModel(`${providerId}/route-model`);
        await assert.rejects(
          (
            resolved.model as unknown as {
              doGenerate(options: { prompt: unknown[] }): Promise<unknown>;
            }
          ).doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          }),
        );

        const request = requests.at(-1);
        assert.equal(request?.url, `https://route.example/v1${expectedPath}`);
        assert.equal(request?.headers.get(expectedHeader[0]), expectedHeader[1]);
      }
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
    });
    assert.deepEqual(
      pickMediaCapabilities(providerHelpers.inferModelCapabilities("gpt-4o-mini-tts")),
      {
        textGeneration: false,
        imageOutput: false,
        speechOutput: true,
        transcription: false,
      },
    );
    assert.deepEqual(pickMediaCapabilities(providerHelpers.inferModelCapabilities("whisper-1")), {
      textGeneration: false,
      imageOutput: false,
      speechOutput: false,
      transcription: true,
    });
    assert.deepEqual(
      pickMediaCapabilities(providerHelpers.inferModelCapabilities("veo-3.0-generate-preview")),
      {
        textGeneration: false,
        imageOutput: false,
        speechOutput: false,
        transcription: false,
      },
    );
  });

  void it("keeps supported Google media models and excludes video-only models", () => {
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
      ["imagen-4.0"],
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

  void it("automatically selects the current chat model and a same-provider embedding model", async () => {
    await providerHelpers.upsertCustomProvider({
      id: "memory-provider",
      label: "Memory Provider",
      baseUrl: "https://memory.example/v1",
    });
    await providerHelpers.upsertCustomModel({
      providerId: "memory-provider",
      id: "chat-model",
      capabilities,
    });
    await providerHelpers.upsertCustomModel({
      providerId: "memory-provider",
      id: "embedding-model",
      capabilities: memoryCapabilities({ textGeneration: false, embedding: true }),
    });
    await providerHelpers.saveModelApiKey("memory-provider", "chat-model", "memory-chat-key");
    await providerHelpers.saveModelApiKey(
      "memory-provider",
      "embedding-model",
      "memory-embedding-key",
    );
    settings.set(SettingKey.SelectedModel, "memory-provider/chat-model");

    const resolved = providerHelpers.resolveMemoryConfiguration();
    assert.deepEqual(resolved.llm, {
      ref: "memory-provider/chat-model",
      providerId: "memory-provider",
      modelId: "chat-model",
      baseUrl: "https://memory.example/v1",
      apiKey: "memory-chat-key",
    });
    assert.deepEqual(resolved.embedding, {
      ref: "memory-provider/embedding-model",
      providerId: "memory-provider",
      modelId: "embedding-model",
      baseUrl: "https://memory.example/v1",
      apiKey: "memory-embedding-key",
    });
    assert.equal(providerHelpers.hasUsableMemoryConfiguration(), true);
  });

  void it("honors independent manual memory model selections and falls back across providers", async () => {
    await providerHelpers.upsertCustomProvider({
      id: "memory-chat",
      label: "Memory Chat",
      baseUrl: "https://chat.example/v1",
    });
    await providerHelpers.upsertCustomProvider({
      id: "memory-embedding",
      label: "Memory Embedding",
      baseUrl: "https://embedding.example/v1",
    });
    await providerHelpers.upsertCustomModel({
      providerId: "memory-chat",
      id: "chat-model",
      capabilities,
    });
    await providerHelpers.upsertCustomModel({
      providerId: "memory-chat",
      id: "chat-embedding",
      capabilities: memoryCapabilities({ textGeneration: false, embedding: true }),
    });
    await providerHelpers.upsertCustomModel({
      providerId: "memory-embedding",
      id: "embedding-model",
      capabilities: memoryCapabilities({ textGeneration: false, embedding: true }),
    });
    await providerHelpers.saveProviderApiKey("memory-chat", "chat-key");
    await providerHelpers.saveProviderApiKey("memory-embedding", "embedding-key");
    settings.set(SettingKey.SelectedModel, "memory-chat/chat-model");
    settings.set(SettingKey.MemoryLlmModel, "memory-chat/chat-model");
    settings.set(SettingKey.MemoryEmbeddingModel, "memory-embedding/embedding-model");

    const manuallyResolved = providerHelpers.resolveMemoryConfiguration();
    assert.equal(manuallyResolved.llm?.ref, "memory-chat/chat-model");
    assert.equal(manuallyResolved.embedding?.ref, "memory-embedding/embedding-model");
    assert.equal(manuallyResolved.embedding?.apiKey, "embedding-key");

    settings.set(SettingKey.MemoryEmbeddingModel, "missing/stale-model");
    const fallbackResolved = providerHelpers.resolveMemoryConfiguration();
    assert.equal(fallbackResolved.embedding?.ref, "memory-chat/chat-embedding");
  });

  void it("rejects unsupported custom protocols, disabled models, and missing credentials", async () => {
    await providerHelpers.upsertCustomProvider({
      id: "responses-memory",
      label: "Responses Memory",
      baseUrl: "https://responses.example/v1",
      apiFormat: "responses",
    });
    await providerHelpers.upsertCustomModel({
      providerId: "responses-memory",
      id: "chat-model",
      capabilities,
    });
    await providerHelpers.upsertCustomProvider({
      id: "disabled-memory",
      label: "Disabled Memory",
      baseUrl: "https://disabled.example/v1",
    });
    await providerHelpers.upsertCustomModel({
      providerId: "disabled-memory",
      id: "chat-model",
      enabled: false,
      capabilities,
    });
    await providerHelpers.upsertCustomProvider({
      id: "missing-memory",
      label: "Missing Memory",
      baseUrl: "https://missing.example/v1",
    });
    await providerHelpers.upsertCustomModel({
      providerId: "missing-memory",
      id: "embedding-model",
      capabilities: memoryCapabilities({ textGeneration: false, embedding: true }),
    });

    const resolved = providerHelpers.resolveMemoryConfiguration();
    assert.equal(resolved.llm, null);
    assert.equal(resolved.embedding, null);
    assert.equal(providerHelpers.hasUsableMemoryConfiguration(), false);
  });
});

function emptyCatalog(): ModelCatalogSettings {
  return { providers: [], models: [], modelStates: [] };
}

function memoryCapabilities(
  overrides: Partial<import("@shared/types").ModelCapabilities> = {},
): import("@shared/types").ModelCapabilities {
  return { ...capabilities, ...overrides };
}

function pickMediaCapabilities(capabilities: import("@shared/types").ModelCapabilities): {
  textGeneration: boolean;
  imageOutput: boolean;
  speechOutput: boolean;
  transcription: boolean;
} {
  return {
    textGeneration: capabilities.textGeneration,
    imageOutput: capabilities.imageOutput,
    speechOutput: capabilities.speechOutput,
    transcription: capabilities.transcription,
  };
}
