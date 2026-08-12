import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import {
  DEFAULT_AGENT_ID,
  isAgentRuntimeBusy,
  type AgentInput,
  type AgentRuntimeStatus,
  type ToolSkillInput,
} from "../../shared/types";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: {
    isPackaged: false,
    getPath: () => process.env.VOID_AI_USER_DATA_DIR ?? process.cwd(),
  },
};
require.cache[electronPath] = electronModule;

let db: typeof import("./db");
let memoryFiles: typeof import("./agent-memory-files");
let memoryStorage: typeof import("./agent-memory-file-storage");
let testRoot = "";

before(async () => {
  db = await import("./db");
  memoryFiles = await import("./agent-memory-files");
  memoryStorage = await import("./agent-memory-file-storage");
});

beforeEach(async () => {
  await db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "void-ai-agent-lifecycle-"));
  process.env.VOID_AI_USER_DATA_DIR = testRoot;
  db.initDb();
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.VOID_AI_USER_DATA_DIR;
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = "";
});

void describe("agent lifecycle persistence", () => {
  void it("keeps installed Skills ordered by creation time after updates", () => {
    const older = db.createSkillTool(makeSkillInput("Older skill"));
    const newer = db.createSkillTool(makeSkillInput("Newer skill"));

    db.getDb()
      .update(db.schema.tools)
      .set({ discovered_at: 100, updated_at: 100 })
      .where(eq(db.schema.tools.id, older.id))
      .run();
    db.getDb()
      .update(db.schema.tools)
      .set({ discovered_at: 200, updated_at: 200 })
      .where(eq(db.schema.tools.id, newer.id))
      .run();

    assert.deepEqual(
      db.listSkillTools().map((skill) => skill.id),
      [newer.id, older.id],
    );

    db.updateSkillTool(older.id, { description: "Updated description" });
    assert.deepEqual(
      db.listSkillTools().map((skill) => skill.id),
      [newer.id, older.id],
    );

    db.getDb()
      .update(db.schema.tools)
      .set({ discovered_at: 300 })
      .where(eq(db.schema.tools.id, older.id))
      .run();
    db.getDb()
      .update(db.schema.tools)
      .set({ discovered_at: 300 })
      .where(eq(db.schema.tools.id, newer.id))
      .run();

    assert.deepEqual(
      db.listSkillTools().map((skill) => skill.id),
      [older.id, newer.id].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
    );
  });

  void it("classifies only active runtime work as busy", () => {
    const busyStatuses = [
      "queued",
      "running",
      "reviewing",
      "handoff",
      "tool_calling",
      "sandbox",
      "learning",
    ] satisfies AgentRuntimeStatus[];

    for (const status of busyStatuses) assert.equal(isAgentRuntimeBusy(status), true, status);
    for (const status of ["idle", "failed", null, undefined] as const) {
      assert.equal(isAgentRuntimeBusy(status), false, String(status));
    }
  });

  void it("rejects locked or busy agents before archiving and deleting", async () => {
    await assert.rejects(db.archiveAgent(DEFAULT_AGENT_ID), /locked/i);
    await assert.rejects(db.deleteAgent(DEFAULT_AGENT_ID), /locked/i);

    const agent = await db.createAgent(makeAgentInput("Busy agent"));
    db.upsertAgentRuntimeState({
      agent_id: agent.id,
      status: "running",
      current_run_id: "run-busy",
    });

    await assert.rejects(db.archiveAgent(agent.id), /busy \(running\)/i);
    await assert.rejects(db.deleteAgent(agent.id), /busy \(running\)/i);
    assert.equal(db.getAgent(agent.id)?.status, "active");

    db.upsertAgentRuntimeState({ agent_id: agent.id, status: "failed" });
    const archived = await db.archiveAgent(agent.id);
    assert.equal(archived.status, "archived");
    assert.equal(archived.enabled, 0);
  });

  void it("restores only archived agents as disabled drafts", async () => {
    const agent = await db.createAgent(makeAgentInput("Restorable agent"));

    await assert.rejects(db.restoreAgent(agent.id), /only archived/i);
    await db.archiveAgent(agent.id);

    const restored = await db.restoreAgent(agent.id);
    assert.equal(restored.status, "draft");
    assert.equal(restored.enabled, 0);
    await assert.rejects(db.restoreAgent(agent.id), /only archived/i);
  });

  void it("keeps soul files through archive and restore", async () => {
    const agent = await db.createAgent(makeAgentInput("Restorable soul agent"));
    const soul = "# SOUL\n\nPreserve this soul while the agent is archived.";
    memoryFiles.writeMemoryFile("soul", soul, { source: "user", agentId: agent.id });
    const paths = memoryStorage.resolveAgentSoulFilePaths(agent.id);

    await db.archiveAgent(agent.id);
    assert.equal(existsSync(paths.primary), true);
    assert.equal(memoryFiles.readMemoryFile("soul", agent.id), soul);

    await db.restoreAgent(agent.id);
    assert.equal(existsSync(paths.primary), true);
    assert.equal(memoryFiles.readMemoryFile("soul", agent.id), soul);
  });

  void it("deletes agents without a soul file", async () => {
    const agent = await db.createAgent(makeAgentInput("Agent without soul file"));
    const paths = memoryStorage.resolveAgentSoulFilePaths(agent.id);

    assert.equal(existsSync(paths.primary), false);
    assert.equal(existsSync(paths.backup), false);
    await db.deleteAgent(agent.id);
    assert.equal(db.getAgent(agent.id), null);
  });

  void it("publishes drafts and keeps duplicates disabled drafts", async () => {
    const draft = await db.createAgent({
      ...makeAgentInput("Draft agent"),
      status: "draft",
      enabled: false,
    });
    assert.equal(draft.status, "draft");
    assert.equal(draft.enabled, 0);

    const published = await db.updateAgent(draft.id, { status: "active", enabled: true });
    assert.equal(published.status, "active");
    assert.equal(published.enabled, 1);

    const copy = await db.duplicateAgent(published.id);
    assert.equal(copy.status, "draft");
    assert.equal(copy.enabled, 0);
  });

  void it("deletes agents atomically, removes soul files, and clears runtime state", async () => {
    const agent = await db.createAgent(makeAgentInput("Disposable agent"));
    const soul = "# SOUL\n\nThis file must be deleted with the agent.";
    memoryFiles.writeMemoryFile("soul", soul, { source: "user", agentId: agent.id });
    memoryFiles.writeMemoryFile("soul", `${soul}\nUpdated`, {
      source: "user",
      agentId: agent.id,
    });
    const soulPaths = memoryStorage.resolveAgentSoulFilePaths(agent.id);
    assert.equal(existsSync(soulPaths.primary), true);
    assert.equal(existsSync(soulPaths.backup), true);

    const run = await db.createRuntimeRun({
      id: "run-delete-agent",
      root_agent_id: agent.id,
      final_agent_id: agent.id,
      status: "succeeded",
    });
    const step = await db.createRuntimeStep({
      id: "step-delete-agent",
      run_id: run.id,
      agent_id: agent.id,
      kind: "model",
      status: "succeeded",
      title: "Referenced step",
    });
    const existingEvent = db.insertRuntimeEvent({
      id: "event-delete-agent",
      run_id: run.id,
      step_id: step.id,
      agent_id: agent.id,
      kind: "diagnostic",
      title: "Referenced event",
    });

    await db.deleteAgent(agent.id);

    assert.equal(db.getAgent(agent.id), null);
    assert.equal(existsSync(soulPaths.primary), false);
    assert.equal(existsSync(soulPaths.backup), false);
    assert.notEqual(memoryFiles.readMemoryFile("soul", agent.id), `${soul}\nUpdated`);
    assert.equal(db.listRuntimeRuns().find((item) => item.id === run.id)?.root_agent_id, null);
    assert.equal(db.listRuntimeRuns().find((item) => item.id === run.id)?.final_agent_id, null);
    assert.equal(db.listRuntimeSteps().find((item) => item.id === step.id)?.agent_id, null);
    assert.equal(
      db.listRuntimeEvents().find((item) => item.id === existingEvent.id)?.agent_id,
      null,
    );

    const deletionEvent = db
      .listRuntimeEvents()
      .find((item) => item.title === "Agent permanently deleted");
    assert.ok(deletionEvent);
    assert.equal(deletionEvent.agent_id, null);
    assert.deepEqual(JSON.parse(deletionEvent.detail_json), {
      agentId: agent.id,
      name: agent.name,
    });
    assert.equal(
      db.listagentRuntimeStates().some((state) => state.agent_id === agent.id),
      false,
    );
    assert.equal(
      db
        .initDb()
        .select()
        .from(db.schema.agentPolicies)
        .all()
        .some((policy) => policy.agent_id === agent.id),
      false,
    );
  });
});

function makeAgentInput(name: string): AgentInput {
  return {
    name,
    role: "Test agent",
    description: "Agent lifecycle test fixture",
    personality: "Deterministic",
    soul_prompt: "Follow the test instructions.",
    avatar: "T",
    status: "active",
    enabled: true,
  };
}

function makeSkillInput(name: string): ToolSkillInput {
  return {
    name,
    description: "Skill lifecycle test fixture",
    instructions: "Follow the test instructions.",
    category: "test",
  };
}
