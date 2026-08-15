import assert from "node:assert/strict";
import { afterEach, before, describe, it, mock } from "node:test";
import { DEFAULT_AGENT_ID, type MemoryObservation, type MemoryRecord } from "@shared/types";
import { createMemoryAccessContext } from "@desktop-main/lib/memory-access";

const memories: MemoryRecord[] = [];
const observations: MemoryObservation[] = [];
const queuedJobs: unknown[] = [];
const usedIds: string[] = [];

const searchMem0Mock = mock.fn<() => Promise<unknown[] | null>>(async () => []);
const upsertMem0Mock = mock.fn(async () => "mem0-new");
const deleteMem0Mock = mock.fn(async () => undefined);
const resetMem0Mock = mock.fn(async () => true);

mock.module(new URL("../../../../apps/desktop/src/main/lib/db.ts", import.meta.url).href, {
  namedExports: {
    deleteMemory: (id: string) => {
      const index = memories.findIndex((memory) => memory.id === id);
      if (index >= 0) memories.splice(index, 1);
    },
    expireMemoryObservations: () => 0,
    getMemoryById: (id: string) => memories.find((memory) => memory.id === id) ?? null,
    getMemoryByMem0Id: (id: string) => memories.find((memory) => memory.mem0_id === id) ?? null,
    insertRuntimeEvent: mock.fn(),
    listMemories: () => memories.filter((memory) => memory.status === "active"),
    listMemoryObservations: ({ status }: { status?: string } = {}) =>
      observations.filter((observation) => !status || observation.status === status),
    markMemoriesUsed: (ids: string[]) => {
      usedIds.push(...ids);
      return ids.length;
    },
    queueMemoryJob: (job: unknown) => {
      queuedJobs.push(job);
      return job;
    },
    saveMemory: (memory: MemoryRecord) => {
      const index = memories.findIndex((item) => item.id === memory.id);
      if (index >= 0) memories[index] = memory;
      else memories.push(memory);
    },
    saveMemoryObservation: (input: {
      dedupeKey: string;
      title: string;
      content: string;
      kind: MemoryObservation["kind"];
      sourceConversationId?: string | null;
      sourceRunId?: string | null;
      sourceAgentId?: string | null;
      confidence: number;
      evidence: unknown;
      expiresAt: number;
    }) => {
      const existing = observations.find(
        (observation) =>
          observation.dedupe_key === input.dedupeKey && observation.status === "pending",
      );
      if (existing) {
        existing.evidence_count += 1;
        existing.updated_at = Date.now();
        return existing;
      }
      const observation: MemoryObservation = {
        id: `observation-${observations.length + 1}`,
        dedupe_key: input.dedupeKey,
        title: input.title,
        content: input.content,
        kind: input.kind,
        source_conversation_id: input.sourceConversationId ?? null,
        source_run_id: input.sourceRunId ?? null,
        source_agent_id: input.sourceAgentId ?? null,
        confidence: input.confidence,
        evidence_count: 1,
        evidence_json: JSON.stringify(input.evidence),
        status: "pending",
        expires_at: input.expiresAt,
        promoted_memory_id: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      observations.push(observation);
      return observation;
    },
    searchMemories: async ({ query }: { query?: string }) =>
      memories.filter((memory) =>
        `${memory.title} ${memory.content}`.toLowerCase().includes(query?.toLowerCase() ?? ""),
      ),
    updateMemoryObservation: (
      id: string,
      patch: Partial<MemoryObservation>,
    ): MemoryObservation | null => {
      const observation = observations.find((item) => item.id === id);
      if (!observation) return null;
      Object.assign(observation, patch);
      return observation;
    },
    updateMemorySyncState: (
      id: string,
      patch: { mem0Id?: string | null; status: MemoryRecord["sync_status"] },
    ) => {
      const memory = memories.find((item) => item.id === id);
      if (!memory) return;
      memory.mem0_id = patch.mem0Id;
      memory.sync_status = patch.status;
    },
  },
});

mock.module(
  new URL("../../../../apps/desktop/src/main/lib/mem0-service.ts", import.meta.url).href,
  {
    namedExports: {
      deleteMemoryFromMem0: deleteMem0Mock,
      resetMem0Index: resetMem0Mock,
      searchMem0: searchMem0Mock,
      upsertMemoryInMem0: upsertMem0Mock,
    },
  },
);

mock.module(
  new URL("../../../../apps/desktop/src/main/lib/agent-memory-files.ts", import.meta.url).href,
  {
    namedExports: {
      dreamMemoryFiles: mock.fn(async () => undefined),
      incorporateNewMemories: mock.fn(async () => undefined),
    },
  },
);

let orchestrator: typeof import("@desktop-main/lib/memory-orchestrator").memoryOrchestrator;

before(async () => {
  orchestrator = (await import("@desktop-main/lib/memory-orchestrator")).memoryOrchestrator;
});

afterEach(() => {
  memories.length = 0;
  observations.length = 0;
  queuedJobs.length = 0;
  usedIds.length = 0;
  searchMem0Mock.mock.mockImplementation(async () => []);
  upsertMem0Mock.mock.mockImplementation(async () => "mem0-new");
  deleteMem0Mock.mock.resetCalls();
  resetMem0Mock.mock.mockImplementation(async () => true);
});

void describe("MemoryOrchestrator", () => {
  void it("promotes an explicit preference without user confirmation", async () => {
    await orchestrator.observeTurn({
      conversationId: "c1",
      agentId: "agent-root",
      messages: [{ id: "turn-1", role: "user", content: "I prefer concise answers." }],
    });

    assert.equal(observations[0]?.status, "promoted");
    assert.equal(memories.length, 1);
    assert.equal(memories[0]?.scope, "global");
    assert.equal(memories[0]?.kind, "preference");
    assert.equal(memories[0]?.sync_status, "pending");
  });

  void it("keeps a low-confidence episode short-term until repeated", async () => {
    const input = {
      conversationId: "c1",
      agentId: "agent-root",
      messages: [{ role: "user", content: "Yesterday I reviewed the release checklist." }],
    };
    await orchestrator.observeTurn({
      ...input,
      messages: [{ id: "turn-1", ...input.messages[0]! }],
    });
    assert.equal(memories.length, 0);
    assert.equal(observations[0]?.status, "pending");

    await orchestrator.observeTurn({
      ...input,
      messages: [{ id: "turn-2", ...input.messages[0]! }],
    });
    assert.equal(memories.length, 1);
    assert.equal(observations[0]?.status, "promoted");
  });

  void it("uses Mem0 candidates but filters archived records through SQLite", async () => {
    const active = memoryRecord({
      id: "active",
      mem0_id: "mem0-active",
      content: "Concise answers",
    });
    const archived = memoryRecord({
      id: "archived",
      mem0_id: "mem0-archived",
      content: "Verbose answers",
      status: "archived",
    });
    memories.push(active, archived);
    searchMem0Mock.mock.mockImplementation(async () => [
      { id: "mem0-archived", memory: "Verbose", score: 0.99, metadata: { sqliteId: "archived" } },
      { id: "mem0-active", memory: "Concise", score: 0.8, metadata: { sqliteId: "active" } },
    ]);

    const result = await orchestrator.retrieve({
      query: "answers",
      access: createMemoryAccessContext("agent-root"),
      agentId: "agent-root",
    });
    assert.deepEqual(
      result.map((memory) => memory.id),
      ["active"],
    );
    assert.deepEqual(usedIds, ["active"]);
  });

  void it("gives root all agent memories while keeping child retrieval isolated", async () => {
    memories.push(
      memoryRecord({ id: "global", content: "shared answer" }),
      memoryRecord({
        id: "child-a",
        content: "alpha answer",
        scope: "agent",
        agent_id: "agent-a",
      }),
      memoryRecord({
        id: "child-b",
        content: "beta answer",
        scope: "agent",
        agent_id: "agent-b",
      }),
    );

    const root = await orchestrator.retrieve({
      query: "answer",
      access: createMemoryAccessContext(DEFAULT_AGENT_ID),
      limit: 12,
    });
    assert.deepEqual(
      new Set(root.map((memory) => memory.id)),
      new Set(["global", "child-a", "child-b"]),
    );

    const child = await orchestrator.retrieve({
      query: "answer",
      access: createMemoryAccessContext("agent-a"),
      limit: 12,
    });
    assert.deepEqual(new Set(child.map((memory) => memory.id)), new Set(["global", "child-a"]));

    await assert.rejects(
      () =>
        orchestrator.retrieve({
          query: "answer",
          access: createMemoryAccessContext("agent-a"),
          agentId: "agent-b",
        }),
      /cannot access memories/i,
    );
  });

  void it("binds the stable Mem0 id after a sync job", async () => {
    memories.push(memoryRecord({ id: "m1", content: "A durable fact" }));
    await orchestrator.syncJob({ action: "upsert", memoryId: "m1" });
    assert.equal(memories[0]?.mem0_id, "mem0-new");
    assert.equal(memories[0]?.sync_status, "synced");
  });

  void it("archives an old weak episode during decay", async () => {
    memories.push(
      memoryRecord({
        id: "old",
        kind: "episode",
        strength: 30,
        last_reinforced_at: Date.now() - 365 * 24 * 60 * 60 * 1_000,
      }),
    );
    assert.equal(await orchestrator.decay(), 1);
    assert.equal(memories[0]?.status, "archived");
  });
});

function memoryRecord(
  patch: Omit<Partial<MemoryRecord>, "id"> & Pick<MemoryRecord, "id">,
): MemoryRecord {
  const { id, ...rest } = patch;
  return {
    id,
    scope: "global",
    kind: "fact",
    title: patch.title ?? patch.content ?? "Memory",
    content: patch.content ?? "Memory",
    agent_id: null,
    conversation_id: null,
    source_run_id: null,
    salience: 70,
    pinned: 0,
    confidence: 80,
    origin: "auto",
    status: "active",
    evidence_json: "[]",
    last_used_at: null,
    expires_at: null,
    supersedes_id: null,
    mem0_id: null,
    sync_status: "pending",
    strength: 70,
    last_reinforced_at: Date.now(),
    created_at: Date.now(),
    updated_at: Date.now(),
    ...rest,
  };
}
