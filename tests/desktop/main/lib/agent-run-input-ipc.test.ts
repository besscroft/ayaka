import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunInput } from "@shared/types";
import { createRuntimeEnqueueInputHandler } from "@desktop-main/lib/agent-run-input-ipc";

test("returns a cloneable enqueue result after the runtime queue write resolves", async () => {
  const queuedInput: AgentRunInput = {
    id: "input-1",
    run_id: "run-1",
    kind: "steering",
    source: "user",
    status: "queued",
    message_json: JSON.stringify({ id: "message-1", role: "user", parts: [] }),
    sequence: 1,
    created_at: 1,
    consumed_at: null,
    discarded_reason: null,
  };
  const handle = createRuntimeEnqueueInputHandler(async () => queuedInput);

  const result = await handle({
    runId: "run-1",
    kind: "steering",
    message: { id: "message-1", role: "user", parts: [] },
  });

  assert.deepEqual(result, { ok: true, value: queuedInput });
  assert.deepEqual(structuredClone(result), result);
});

test("returns a serializable error result when queueing fails", async () => {
  const handle = createRuntimeEnqueueInputHandler(async () => {
    throw Object.assign(new Error("Run is no longer active."), { code: "run_not_active" });
  });

  const result = await handle({
    runId: "run-1",
    kind: "steering",
    message: { id: "message-1", role: "user", parts: [] },
  });

  assert.deepEqual(result, {
    ok: false,
    code: "run_not_active",
    error: "Run is no longer active.",
  });
  assert.deepEqual(structuredClone(result), result);
});
