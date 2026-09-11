import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { after, before, describe, it, mock } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ResolvedMemoryConfiguration } from "@desktop-main/lib/providers";

const testRoot = mkdtempSync(join(tmpdir(), "ayaka-mem0-service-"));
process.env.AYAKA_USER_DATA_DIR = testRoot;

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = { app: { getPath: () => testRoot } };
require.cache[electronPath] = electronModule;

const configurations: Array<ResolvedMemoryConfiguration | null> = [];
const constructedConfigs: unknown[] = [];

class FakeMemory {
  constructor(config: unknown) {
    constructedConfigs.push(config);
  }

  async add(): Promise<{ results: Array<{ id: string }> }> {
    return { results: [{ id: "memory-id" }] };
  }

  async delete(): Promise<void> {}

  async reset(): Promise<void> {}

  async search(): Promise<{ results: unknown[] }> {
    return { results: [] };
  }

  async update(): Promise<void> {}
}

mock.module(new URL("../../../../apps/desktop/src/main/lib/db.ts", import.meta.url).href, {
  namedExports: {
    getSetting: () => null,
    setSetting: () => undefined,
  },
});
mock.module(new URL("../../../../apps/desktop/src/main/lib/providers.ts", import.meta.url).href, {
  namedExports: {
    resolveMemoryConfiguration: () => configurations.at(-1) ?? null,
  },
});
const sourceRequire = createRequire(
  new URL("../../../../apps/desktop/src/main/lib/mem0-service.ts", import.meta.url),
);
const mem0OssModule = sourceRequire.resolve("mem0ai/oss");
mock.module(pathToFileURL(mem0OssModule).href, { namedExports: { Memory: FakeMemory } });
mock.module(pathToFileURL(mem0OssModule.replace(/\.js$/, ".mjs")).href, {
  namedExports: { Memory: FakeMemory },
});

let memoryService: typeof import("@desktop-main/lib/mem0-service");

before(async () => {
  memoryService = await import("@desktop-main/lib/mem0-service");
});

after(() => {
  delete process.env.AYAKA_USER_DATA_DIR;
  rmSync(testRoot, { recursive: true, force: true });
});

void describe("Mem0 service", { concurrency: false }, () => {
  void it("constructs the native OpenAI adapter from both resolved memory models", async () => {
    configurations.push({
      llm: {
        ref: "compatible/chat-model",
        providerId: "compatible",
        modelId: "chat-model",
        baseUrl: "https://chat.example/v1",
        apiKey: "fake-chat-key",
      },
      embedding: {
        ref: "compatible/embedding-model",
        providerId: "compatible",
        modelId: "embedding-model",
        baseUrl: "https://embedding.example/v1",
        apiKey: "fake-embedding-key",
      },
    });

    const first = await memoryService.getMemory();
    const second = await memoryService.getMemory();
    assert.equal(first, second);
    assert.equal(constructedConfigs.length, 1);
    assert.deepEqual(constructedConfigs[0], {
      llm: {
        provider: "openai",
        config: {
          apiKey: "fake-chat-key",
          baseURL: "https://chat.example/v1",
          model: "chat-model",
        },
      },
      embedder: {
        provider: "openai",
        config: {
          apiKey: "fake-embedding-key",
          baseURL: "https://embedding.example/v1",
          model: "embedding-model",
        },
      },
      vectorStore: {
        provider: "memory",
        config: { collectionName: "ayaka-memories" },
      },
      historyDbPath: join(testRoot, "data", "mem0-history.db"),
    });
  });

  void it("recreates the cached instance when the resolved configuration changes", async () => {
    configurations.push({
      llm: {
        ref: "compatible/new-chat",
        providerId: "compatible",
        modelId: "new-chat",
        baseUrl: "https://new.example/v1",
        apiKey: "fake-new-key",
      },
      embedding: {
        ref: "compatible/new-embedding",
        providerId: "compatible",
        modelId: "new-embedding",
        baseUrl: "https://new.example/v1",
        apiKey: "fake-new-key",
      },
    });

    const next = await memoryService.getMemory();
    assert.notEqual(next, null);
    assert.equal(constructedConfigs.length, 2);

    configurations.push({ llm: null, embedding: null });
    assert.equal(await memoryService.getMemory(), null);
  });
});
