import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCoreApp, type CoreRuntime } from "../../../../apps/core/src/index.js";
import { CHAT_RUN_ID_HEADER, CHAT_SESSION_HEADER } from "../../../../apps/core/src/contracts.js";

const token = "core-test-session";
const messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hello" }] }];

function createRuntime(overrides: Partial<CoreRuntime> = {}): CoreRuntime {
  return {
    listModels: () => [],
    chat: async () => new Response("ok"),
    generateText: async () => ({ text: "generated" }),
    generateMedia: async () => ({ kind: "image", text: "ok", files: [] }),
    ...overrides,
  };
}

void describe("Core app", () => {
  void it("keeps health and authorization at the host-neutral HTTP boundary", async () => {
    const app = createCoreApp({
      runtime: createRuntime(),
      sessionToken: token,
      getAssignedPort: () => 4321,
    });

    const health = await app.request("/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, port: 4321 });

    const unauthorized = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test/model", messages }),
    });
    assert.equal(unauthorized.status, 401);
  });

  void it("assigns a fresh run id when a stale resume needs recovery", async () => {
    const calls: Array<{ runId?: string; mode?: string; recovery?: unknown }> = [];
    const app = createCoreApp({
      runtime: createRuntime({
        chat: async (input) => {
          calls.push({ runId: input.runId, mode: input.mode, recovery: input.recovery });
          if (calls.length === 1) {
            throw Object.assign(new Error("inactive"), { code: "run_not_active" });
          }
          return new Response("recovered");
        },
      }),
      sessionToken: token,
    });

    const previousRunId = "123e4567-e89b-12d3-a456-426614174000";
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        model: "test/model",
        messages,
        runId: previousRunId,
        mode: "resume",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "recovered");
    const assignedRunId = response.headers.get(CHAT_RUN_ID_HEADER);
    assert.ok(assignedRunId);
    assert.notEqual(assignedRunId, previousRunId);
    assert.deepEqual(calls[1], {
      runId: assignedRunId,
      mode: "start",
      recovery: { previousRunId, reason: "run_not_active" },
    });
  });
});
