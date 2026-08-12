import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { DEFAULT_AGENT_ID, type AgentProfile } from "../../shared/types";

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
let tools: typeof import("./agent-management-tools");
let testRoot = "";

before(async () => {
  db = await import("./db");
  tools = await import("./agent-management-tools");
});

beforeEach(async () => {
  await db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "void-ai-agent-management-"));
  process.env.VOID_AI_USER_DATA_DIR = testRoot;
  db.initDb();
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.VOID_AI_USER_DATA_DIR;
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = "";
});

void describe("agent management tools", () => {
  void it("only creates tools for the root agent", () => {
    const installedTools = {} as Parameters<typeof tools.addAgentManagementTools>[0];
    const activeTools = new Set<string>();
    tools.addAgentManagementTools(installedTools, activeTools, { actorAgentId: DEFAULT_AGENT_ID });
    assert.deepEqual([...activeTools].sort(), [
      tools.AGENT_CREATE_TOOL_NAME,
      tools.AGENT_UPDATE_TOOL_NAME,
    ]);
    assert.equal(typeof installedTools.agent_create, "object");
    assert.equal(typeof installedTools.agent_update, "object");

    assert.throws(
      () => tools.createAgentManagementTools({ actorAgentId: "child-1" }),
      /only available to the root/i,
    );

    const rootTools = tools.createAgentManagementTools({ actorAgentId: DEFAULT_AGENT_ID });
    assert.equal(typeof rootTools.agent_create, "object");
    assert.equal(typeof rootTools.agent_update, "object");
  });

  void it("creates an active enabled child with normalized configuration", async () => {
    await db.createRuntimeRun({
      id: "run-create",
      root_agent_id: DEFAULT_AGENT_ID,
      status: "running",
    });
    const rootTools = tools.createAgentManagementTools({
      actorAgentId: DEFAULT_AGENT_ID,
      runId: "run-create",
    });
    const agent = await executeTool(rootTools.agent_create, {
      name: "Researcher",
      role: "Research specialist",
      personality: "Precise",
      soulPrompt: "Cite evidence.",
      runtime: { maxTurns: 99, contextPolicy: { mode: "off" } },
      handoff: { mode: "both", accepts: ["research"] },
      toolPolicy: { mode: "custom", allowedToolIds: ["web_search"] },
    });

    assert.equal(agent.kind, "child");
    assert.equal(agent.parent_agent_id, DEFAULT_AGENT_ID);
    assert.equal(agent.status, "active");
    assert.equal(agent.enabled, 1);
    assert.equal(JSON.parse(agent.runtime_config_json).maxTurns, 20);
    assert.equal(JSON.parse(agent.runtime_config_json).contextPolicy.mode, "off");
    assert.equal(JSON.parse(agent.handoff_config_json).mode, "both");
    assert.deepEqual(JSON.parse(agent.tool_policy_json).allowedToolIds, ["web_search"]);

    const event = db
      .listRuntimeEvents()
      .find((item) => item.tool_id === tools.AGENT_CREATE_TOOL_NAME);
    assert.ok(event);
    assert.equal(event.run_id, "run-create");
    assert.equal(event.status, "succeeded");
  });

  void it("deep merges updates and replaces arrays", async () => {
    const existing = await db.createAgent({
      name: "Existing",
      role: "Specialist",
      description: "Keep this",
      personality: "Keep personality",
      soul_prompt: "Keep prompt",
      avatar: "E",
      runtime_config_json: JSON.stringify({
        maxTurns: 4,
        contextPolicy: { mode: "semantic", keepRecentTokens: 10_000 },
      }),
      handoff_config_json: JSON.stringify({ mode: "consult", accepts: ["old"] }),
      tool_policy_json: JSON.stringify({ mode: "custom", allowedToolIds: ["web_search"] }),
    });
    const rootTools = tools.createAgentManagementTools({ actorAgentId: DEFAULT_AGENT_ID });

    const updated = await executeTool(rootTools.agent_update, {
      agentId: existing.id,
      description: "Updated description",
      runtime: { maxTurns: 7, contextPolicy: { mode: "prune" } },
      handoff: { accepts: ["new"] },
      toolPolicy: { allowedToolIds: ["memory_search"] },
    });

    assert.equal(updated.name, "Existing");
    assert.equal(updated.description, "Updated description");
    const runtime = JSON.parse(updated.runtime_config_json);
    assert.equal(runtime.maxTurns, 7);
    assert.equal(runtime.contextPolicy.mode, "prune");
    assert.equal(runtime.contextPolicy.keepRecentTokens, 10_000);
    assert.deepEqual(JSON.parse(updated.handoff_config_json).accepts, ["new"]);
    assert.deepEqual(JSON.parse(updated.tool_policy_json).allowedToolIds, ["memory_search"]);
  });

  void it("rejects root and main agent updates before writing", async () => {
    const rootTools = tools.createAgentManagementTools({ actorAgentId: DEFAULT_AGENT_ID });
    await assert.rejects(
      () => executeTool(rootTools.agent_update, { agentId: DEFAULT_AGENT_ID, name: "Nope" }),
      /root agent cannot be edited/i,
    );
    assert.equal(db.getAgent(DEFAULT_AGENT_ID)?.name, "Paimon");

    await assert.rejects(
      () => executeTool(rootTools.agent_update, { agentId: "missing-agent", name: "Nope" }),
      /agent not found/i,
    );
    assert.equal(
      db.listRuntimeEvents().some((item) => item.tool_id === tools.AGENT_UPDATE_TOOL_NAME),
      true,
    );
  });
});

async function executeTool(tool: unknown, input: unknown): Promise<AgentProfile> {
  const execute = (tool as { execute?: (value: unknown) => Promise<AgentProfile> }).execute;
  assert.equal(typeof execute, "function");
  return execute!(input);
}
