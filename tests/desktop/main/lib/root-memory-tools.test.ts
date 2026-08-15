import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { DEFAULT_AGENT_ID, type AgentInput, type MemoryRecord } from "@shared/types";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: {
    isPackaged: false,
    getPath: () => process.env.AYAKA_USER_DATA_DIR ?? process.cwd(),
  },
};
require.cache[electronPath] = electronModule;

let db: typeof import("@desktop-main/lib/db");
let memoryFiles: typeof import("@desktop-main/lib/agent-memory-files");
let crypto: typeof import("@desktop-main/lib/crypto");
let rootTools: typeof import("@desktop-main/lib/root-memory-tools");
let testRoot = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
  memoryFiles = await import("@desktop-main/lib/agent-memory-files");
  crypto = await import("@desktop-main/lib/crypto");
  rootTools = await import("@desktop-main/lib/root-memory-tools");
});

beforeEach(async () => {
  await db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "ayaka-root-memory-tools-"));
  process.env.AYAKA_USER_DATA_DIR = testRoot;
  db.initDb();
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = "";
});

void describe("root memory tools", () => {
  void it("registers only for root and exposes every private tool", () => {
    assert.throws(
      () => rootTools.createRootMemoryTools({ actorAgentId: "agent-child" }),
      /only available to the root/i,
    );

    const tools = rootTools.createRootMemoryTools({ actorAgentId: DEFAULT_AGENT_ID });
    assert.deepEqual(Object.keys(tools), [...rootTools.ROOT_MEMORY_TOOL_NAMES]);
  });

  void it("lists, reads, and writes SOUL files for archived agents", async () => {
    const child = await db.createAgent(agentInput("Archived specialist"));
    await db.archiveAgent(child.id);
    const tools = rootTools.createRootMemoryTools({ actorAgentId: DEFAULT_AGENT_ID });
    const secret = "private-soul-content";
    const content = `# SOUL\n\n${secret}${"x".repeat(4_100)}`;

    const written = await executeTool<{
      agentId: string;
      content: string;
      charCount: number;
      charLimit: number;
      truncated: boolean;
    }>(tools.soul_write, { agentId: child.id, content });
    assert.equal(written.agentId, child.id);
    assert.equal(written.charCount, 4_000);
    assert.equal(written.charLimit, 4_000);
    assert.equal(written.truncated, true);

    const read = await executeTool<{ content: string }>(tools.soul_read, { agentId: child.id });
    assert.equal(read.content.length, 4_000);
    assert.match(read.content, /private-soul-content/);

    const listed = await executeTool<Array<{ agentId: string; status: string }>>(
      tools.soul_list,
      {},
    );
    assert.equal(listed.find((item) => item.agentId === child.id)?.status, "archived");
    await assert.rejects(
      () => executeTool(tools.soul_read, { agentId: "missing-agent" }),
      /agent not found/i,
    );

    const events = db.listRuntimeEvents().filter((event) => event.tool_id?.startsWith("soul_"));
    assert.equal(
      events.some((event) => event.status === "succeeded"),
      true,
    );
    assert.equal(
      events.some((event) => event.status === "failed"),
      true,
    );
    assert.equal(
      events.some((event) => event.detail_json.includes(secret)),
      false,
    );
  });

  void it("writes global USER and MEMORY files without replacing the manual baseline", async () => {
    const manual = "# USER\n\n- Preserve this user-authored preference.";
    memoryFiles.writeMemoryFile("user", manual, { source: "user" });
    const tools = rootTools.createRootMemoryTools({ actorAgentId: DEFAULT_AGENT_ID });

    const written = await executeTool<{ kind: string; truncated: boolean; content: string }>(
      tools.memory_file_write,
      { kind: "user", content: "# USER\n\n- Agent-curated profile." },
    );
    assert.equal(written.kind, "user");
    assert.equal(written.truncated, false);

    const envelope = JSON.parse(
      readFileSync(path.join(testRoot, "data", "agent-memories", "global", "USER.md.enc"), "utf8"),
    ) as { manualBaseline: Parameters<typeof crypto.decrypt>[0] };
    assert.equal(crypto.decrypt(envelope.manualBaseline), manual);

    const memory = await executeTool<{ kind: string; content: string }>(tools.memory_file_write, {
      kind: "memory",
      content: "# MEMORY\n\n- Durable project fact.",
    });
    assert.equal(memory.kind, "memory");
    assert.match(memory.content, /Durable project fact/);
  });

  void it("lists and gets global and agent-scoped structured memories", async () => {
    const child = await db.createAgent(agentInput("Memory owner"));
    const global = memoryRecord({ id: "global-memory", content: "Global profile" });
    const scoped = memoryRecord({
      id: "scoped-memory",
      content: "Child-only lesson",
      scope: "agent",
      agent_id: child.id,
    });
    const archived = memoryRecord({
      id: "archived-memory",
      content: "Old lesson",
      status: "archived",
    });
    await db.saveMemory(global, { queueSync: false });
    await db.saveMemory(scoped, { queueSync: false });
    await db.saveMemory(archived, { queueSync: false });

    const tools = rootTools.createRootMemoryTools({ actorAgentId: DEFAULT_AGENT_ID });
    const active = await executeTool<MemoryRecord[]>(tools.memory_list, {});
    assert.deepEqual(
      new Set(active.map((memory) => memory.id)),
      new Set(["global-memory", "scoped-memory"]),
    );

    const childMemories = await executeTool<MemoryRecord[]>(tools.memory_list, {
      scope: "agent",
      agentId: child.id,
    });
    assert.deepEqual(
      childMemories.map((memory) => memory.id),
      ["scoped-memory"],
    );

    const inactive = await executeTool<MemoryRecord[]>(tools.memory_list, {
      status: "archived",
    });
    assert.deepEqual(
      inactive.map((memory) => memory.id),
      ["archived-memory"],
    );
    assert.equal(
      (await executeTool<MemoryRecord>(tools.memory_get, { id: "scoped-memory" })).content,
      "Child-only lesson",
    );
  });
});

async function executeTool<T = unknown>(tool: unknown, input: unknown): Promise<T> {
  const execute = (tool as { execute?: (value: unknown) => Promise<T> }).execute;
  assert.equal(typeof execute, "function");
  return execute!(input);
}

function agentInput(name: string): AgentInput {
  return {
    name,
    role: "Specialist",
    description: "",
    personality: "",
    soul_prompt: "",
    avatar: name.slice(0, 1),
  };
}

function memoryRecord(
  patch: Omit<Partial<MemoryRecord>, "id"> & Pick<MemoryRecord, "id">,
): MemoryRecord {
  const { id, ...rest } = patch;
  const now = Date.now();
  return {
    id,
    scope: "global",
    kind: "fact",
    title: patch.content ?? "Memory",
    content: patch.content ?? "Memory",
    agent_id: null,
    conversation_id: null,
    source_run_id: null,
    salience: 70,
    pinned: 0,
    confidence: 80,
    origin: "manual",
    status: "active",
    evidence_json: "[]",
    last_used_at: null,
    expires_at: null,
    supersedes_id: null,
    mem0_id: null,
    sync_status: "pending",
    strength: 70,
    last_reinforced_at: now,
    created_at: now,
    updated_at: now,
    ...rest,
  };
}
