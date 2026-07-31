import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import {
  DEFAULT_AGENT_ID,
  isAgentRuntimeBusy,
  type AgentInput,
  type AgentRuntimeStatus,
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
let testRoot = "";

before(async () => {
  db = await import("./db");
});

beforeEach(async () => {
  db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "void-ai-agent-lifecycle-"));
  process.env.VOID_AI_USER_DATA_DIR = testRoot;
  db.initDb();
});

afterEach(async () => {
  db.closeDb();
  delete process.env.VOID_AI_USER_DATA_DIR;
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = "";
});

void describe("agent lifecycle persistence", () => {
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

  void it("rejects locked or busy agents before archiving and deleting", () => {
    assert.throws(() => db.archiveAgent(DEFAULT_AGENT_ID), /locked/i);
    assert.throws(() => db.deleteAgent(DEFAULT_AGENT_ID), /locked/i);

    const agent = db.createAgent(makeAgentInput("Busy agent"));
    db.upsertAgentRuntimeState({
      agent_id: agent.id,
      status: "running",
      current_run_id: "run-busy",
    });

    assert.throws(() => db.archiveAgent(agent.id), /busy \(running\)/i);
    assert.throws(() => db.deleteAgent(agent.id), /busy \(running\)/i);
    assert.equal(db.getAgent(agent.id)?.status, "active");

    db.upsertAgentRuntimeState({ agent_id: agent.id, status: "failed" });
    const archived = db.archiveAgent(agent.id);
    assert.equal(archived.status, "archived");
    assert.equal(archived.enabled, 0);
  });

  void it("restores only archived agents as disabled drafts", () => {
    const agent = db.createAgent(makeAgentInput("Restorable agent"));

    assert.throws(() => db.restoreAgent(agent.id), /only archived/i);
    db.archiveAgent(agent.id);

    const restored = db.restoreAgent(agent.id);
    assert.equal(restored.status, "draft");
    assert.equal(restored.enabled, 0);
    assert.throws(() => db.restoreAgent(agent.id), /only archived/i);
  });

  void it("publishes drafts and keeps duplicates disabled drafts", () => {
    const draft = db.createAgent({
      ...makeAgentInput("Draft agent"),
      status: "draft",
      enabled: false,
    });
    assert.equal(draft.status, "draft");
    assert.equal(draft.enabled, 0);

    const published = db.updateAgent(draft.id, { status: "active", enabled: true });
    assert.equal(published.status, "active");
    assert.equal(published.enabled, 1);

    const copy = db.duplicateAgent(published.id);
    assert.equal(copy.status, "draft");
    assert.equal(copy.enabled, 0);
  });

  void it("deletes agents atomically, nulls references, and removes runtime state", () => {
    const agent = db.createAgent(makeAgentInput("Disposable agent"));
    const run = db.createRuntimeRun({
      id: "run-delete-agent",
      root_agent_id: agent.id,
      final_agent_id: agent.id,
      status: "succeeded",
    });
    const step = db.createRuntimeStep({
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

    db.deleteAgent(agent.id);

    assert.equal(db.getAgent(agent.id), null);
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
