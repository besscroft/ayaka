import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import type { UIMessage } from "ai";
import { DEFAULT_AGENT_ID } from "@shared/types";
import type { AgentLoopSessionOptions } from "@desktop-main/lib/agent-loop-session";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: { isPackaged: false, getPath: () => process.env.AYAKA_USER_DATA_DIR ?? process.cwd() },
};
require.cache[electronPath] = electronModule;

let db: typeof import("@desktop-main/lib/db");
let sessionModule: typeof import("@desktop-main/lib/agent-loop-session");
let testRoot = "";
let conversationId = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
  sessionModule = await import("@desktop-main/lib/agent-loop-session");
});

beforeEach(async () => {
  await db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "ayaka-agent-loop-"));
  process.env.AYAKA_USER_DATA_DIR = testRoot;
  db.initDb();
  conversationId = randomUUID();
  await db.createConversation(conversationId);
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  await rm(testRoot, { recursive: true, force: true });
});

void describe("AgentLoopSessionManager", () => {
  void it("drains steering FIFO before follow-up and keeps one run id", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = await manager.start(baseOptions(runId));
    await manager.enqueue(runId, "steering", "user", message("s1"));
    await manager.enqueue(runId, "steering", "user", message("s2"));
    await manager.enqueueFollowUp(runId, message("f1"));

    assert.deepEqual((await session.drain("steering")).map(readText), ["s1", "s2"]);
    assert.deepEqual((await session.drain("follow_up")).map(readText), ["f1"]);
    assert.equal(await manager.start({ ...baseOptions(runId), mode: "resume" }), session);
    await session.complete();
  });

  void it("records budget exhaustion and discards queued input", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = await manager.start({
      ...baseOptions(runId),
      runtimeConfig: { maxTurns: 1, maxDurationMs: 600_000, maxToolCalls: 50 },
    });
    await manager.enqueueFollowUp(runId, message("pending"));
    assert.equal(session.recordStep(), "max_turns");
    await session.complete("done");

    assert.equal(db.getRuntimeRun(runId)?.finish_reason, "budget_exhausted");
    assert.equal(db.listAgentRunInputs(runId)[0]?.status, "discarded");
  });

  void it("cancels without consuming queued input", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    await manager.start(baseOptions(runId));
    await manager.enqueue(runId, "steering", "user", message("pending"));
    assert.equal(await manager.cancel(runId), true);
    assert.equal(db.getRuntimeRun(runId)?.finish_reason, "cancelled");
    assert.equal(db.listAgentRunInputs(runId)[0]?.status, "discarded");
  });

  void it("persists absolute limits and rejects resume after the hard cap", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = await manager.start({
      ...baseOptions(runId),
      runtimeConfig: {
        maxTurns: 1,
        maxDurationMs: 600_000,
        maxToolCalls: 50,
        absoluteMaxDurationMs: 60_000,
        absoluteMaxToolCalls: 1,
        maxNoProgressRounds: 3,
      },
    });
    assert.equal(session.beginToolCall(), true);
    assert.equal(session.beginToolCall(), false);
    await session.block("absolute limit");
    assert.equal(db.getRuntimeRun(runId)?.status, "blocked");
    await assert.rejects(
      manager.start({ ...baseOptions(runId), mode: "resume" }),
      (error: unknown) =>
        error instanceof sessionModule.AgentLoopSessionError &&
        error.code === "absolute_limit_reached",
    );
  });
});

function baseOptions(runId: string): AgentLoopSessionOptions {
  return {
    runId,
    conversationId,
    rootAgentId: DEFAULT_AGENT_ID,
    modelRef: "mock/chat",
    mode: "start" as const,
  };
}

function message(text: string): UIMessage {
  return { id: randomUUID(), role: "user", parts: [{ type: "text", text }] };
}

function readText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}
