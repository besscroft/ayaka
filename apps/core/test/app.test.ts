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

  void it("mints realtime client secrets only for an authorized setup request", async () => {
    const calls: Array<{ modelRef: string; sessionConfig: Record<string, unknown> }> = [];
    const app = createCoreApp({
      runtime: {
        ...createRuntime(),
        createRealtimeToken: async (modelRef, sessionConfig) => {
          calls.push({ modelRef, sessionConfig });
          return { token: "short-lived", url: "wss://example.test/realtime", expiresAt: 123 };
        },
      },
      sessionToken: "local-session",
    });
    const sessionConfig = { instructions: "Be concise", voice: "alloy" };
    const response = await app.request(
      "/api/realtime/setup?session=local-session&model=custom-openai/gpt-realtime",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionConfig }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      token: "short-lived",
      url: "wss://example.test/realtime",
      expiresAt: 123,
      tools: [],
    });
    assert.deepEqual(calls, [{ modelRef: "custom-openai/gpt-realtime", sessionConfig }]);

    const unauthorized = await app.request(
      "/api/realtime/setup?session=wrong&model=custom-openai/gpt-realtime",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionConfig }),
      },
    );
    assert.equal(unauthorized.status, 401);
    assert.equal(calls.length, 1);
  });

  void it("rejects invalid realtime model or session input without minting a token", async () => {
    let calls = 0;
    const app = createCoreApp({
      runtime: {
        ...createRuntime(),
        createRealtimeToken: async () => {
          calls++;
          return { token: "secret", url: "wss://example.test/realtime" };
        },
      },
      sessionToken: "local-session",
    });
    const response = await app.request(
      "/api/realtime/setup?session=local-session&model=bad-model",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionConfig: { instructions: "" } }),
      },
    );
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  });
});
