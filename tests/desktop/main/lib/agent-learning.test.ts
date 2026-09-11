import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import type { MemoryJob } from "@shared/types";

let nextJob: MemoryJob | null = null;
const finished: Array<{ id: string; status: string }> = [];
const usableMemoryConfigurationMock = mock.fn(() => false);
const resetMemoryInstanceMock = mock.fn();
const queueMemoryJobMock = mock.fn(async () => null);
const syncJobMock = mock.fn(async () => undefined);

mock.module(new URL("../../../../apps/desktop/src/main/lib/db.ts", import.meta.url).href, {
  namedExports: {
    claimNextMemoryJob: async () => {
      const job = nextJob;
      nextJob = null;
      return job;
    },
    finishMemoryJob: async (id: string, status: string) => {
      finished.push({ id, status });
      return null;
    },
    insertRuntimeEvent: mock.fn(),
    listMessages: () => [],
    queueMemoryJob: queueMemoryJobMock,
    updateAyakaLearningState: mock.fn(),
  },
});
mock.module(
  new URL("../../../../apps/desktop/src/main/lib/memory-orchestrator.ts", import.meta.url).href,
  {
    namedExports: {
      memoryOrchestrator: {
        consolidate: mock.fn(async () => 0),
        decay: mock.fn(async () => 0),
        observeTurn: mock.fn(async () => []),
        rehydrate: mock.fn(async () => 0),
        syncJob: syncJobMock,
      },
    },
  },
);
mock.module(new URL("../../../../apps/desktop/src/main/lib/providers.ts", import.meta.url).href, {
  namedExports: { hasUsableMemoryConfiguration: usableMemoryConfigurationMock },
});
mock.module(
  new URL("../../../../apps/desktop/src/main/lib/mem0-service.ts", import.meta.url).href,
  {
    namedExports: { resetMemoryInstance: resetMemoryInstanceMock },
  },
);

let learning: typeof import("@desktop-main/lib/agent-learning");

before(async () => {
  learning = await import("@desktop-main/lib/agent-learning");
});

void describe("memory worker configuration handling", () => {
  void it("cancels Mem0 jobs without a usable configuration instead of retrying them", async () => {
    nextJob = {
      id: "sync-job",
      kind: "sync",
      status: "queued",
      conversation_id: null,
      agent_id: "agent-root",
      run_id: null,
      idempotency_key: "memory:one:upsert",
      payload_json: JSON.stringify({ action: "upsert", memoryId: "memory-one" }),
      attempts: 0,
      last_error: null,
      scheduled_at: Date.now(),
      started_at: null,
      finished_at: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    assert.equal(await learning.runMemoryWorkerOnce(), true);
    assert.deepEqual(finished, [{ id: "sync-job", status: "cancelled" }]);
    assert.equal(syncJobMock.mock.calls.length, 0);
    learning.clearMemoryWorker();
  });

  void it("only queues rehydration after a usable memory configuration exists", () => {
    learning.notifyMemoryConfigurationChanged();
    assert.equal(resetMemoryInstanceMock.mock.calls.length, 1);
    assert.equal(queueMemoryJobMock.mock.calls.length, 0);

    usableMemoryConfigurationMock.mock.mockImplementation(() => true);
    learning.notifyMemoryConfigurationChanged();
    assert.equal(resetMemoryInstanceMock.mock.calls.length, 2);
    assert.equal(queueMemoryJobMock.mock.calls.length, 1);
    assert.equal(queueMemoryJobMock.mock.calls[0]?.arguments[0].kind, "rehydrate");
    learning.clearMemoryWorker();
  });
});
