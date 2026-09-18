import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoreApp, startCoreServer, type CoreRuntime } from "../src/index.js";

function createRuntime(): CoreRuntime {
  return {
    listModels: () => [{ id: "test", label: "Test", models: [{ id: "model" }] }],
    chat: async () => new Response("ok"),
    generateText: async () => ({ text: "generated" }),
    generateMedia: async () => ({ kind: "image", text: "ok", files: [] }),
  };
}

void describe("Core app package", () => {
  void it("serves health and models through the standard fetch boundary", async () => {
    const app = createCoreApp({ runtime: createRuntime(), getAssignedPort: () => 8787 });

    const health = await app.request("/api/health");
    assert.deepEqual(await health.json(), { ok: true, port: 8787 });

    const models = await app.request("/api/models");
    assert.deepEqual(await models.json(), {
      providers: [{ id: "test", label: "Test", models: [{ id: "model" }] }],
    });
  });

  void it("can host the same app through the optional Node adapter", async () => {
    const app = createCoreApp({ runtime: createRuntime() });
    const server = await startCoreServer(app, { hostname: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, port: 0 });
    } finally {
      server.close();
    }
  });
});
