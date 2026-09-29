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

    assert.deepEqual((await session.drain("steering")).map(readText), ["s1"]);
    assert.deepEqual((await session.drain("steering")).map(readText), ["s2"]);
    assert.deepEqual((await session.drain("follow_up")).map(readText), ["f1"]);
    assert.equal(await manager.start({ ...baseOptions(runId), mode: "resume" }), session);
    await session.complete();
  });

  void it("drains mixed queued inputs in sequence order", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = await manager.start(baseOptions(runId));
    await manager.enqueueFollowUp(runId, message("follow-up first"), "user");
    await manager.enqueue(runId, "steering", "user", message("steering second"));
    await manager.enqueueFollowUp(runId, message("follow-up third"), "user");

    const drained: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const next = await session.drainNext();
      if (next) drained.push(readText(next));
    }
    assert.deepEqual(drained, ["follow-up first", "steering second", "follow-up third"]);

    await session.complete();
  });

  void it("removes a queued follow-up before it is consumed", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = await manager.start(baseOptions(runId));
    const queuedMessage = message("remove me");
    const queued = await manager.enqueueFollowUp(runId, queuedMessage, "user");

    assert.equal(
      session.messageTrace.some((item) => item.id === queuedMessage.id),
      false,
    );
    assert.equal(
      db.getMessagesSnapshot(conversationId).messages.some((item) => item.id === queuedMessage.id),
      false,
    );
    assert.equal(await manager.discardQueuedInput(runId, queued.id), true);
    assert.equal(await manager.discardQueuedInput(runId, queued.id), false);
    assert.deepEqual(await session.drain("follow_up"), []);
    assert.equal(
      session.messageTrace.some((item) => item.id === queuedMessage.id),
      false,
    );
    assert.equal(db.listAgentRunInputs(runId)[0]?.status, "discarded");
    const removalEvent = db
      .listRuntimeEvents()
      .find((event) => event.run_id === runId && event.title === "Queued input removed from queue");
    assert.equal(removalEvent?.status, "cancelled");
    assert.deepEqual(JSON.parse(removalEvent?.detail_json ?? "{}"), { inputId: queued.id });

    await session.complete();
  });

  void it("does not remove a follow-up after the runtime has consumed it", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = await manager.start(baseOptions(runId));
    const queuedMessage = message("already consumed");
    const queued = await manager.enqueueFollowUp(runId, queuedMessage, "user");

    assert.deepEqual(await session.drain("follow_up"), [queuedMessage]);
    assert.equal(
      session.messageTrace.some((item) => item.id === queuedMessage.id),
      true,
    );
    assert.equal(await manager.discardQueuedInput(runId, queued.id), false);
    assert.equal(db.listAgentRunInputs(runId)[0]?.status, "consumed");

    await session.complete();
  });

  void it("claims completion only after draining queued inputs and rejects later input", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    const session = await manager.start(baseOptions(runId));
    const queuedMessage = message("arrived near completion");
    const queued = await manager.enqueueFollowUp(runId, queuedMessage, "user");

    const pending = await session.claimCompletionIfNoQueuedInputs();
    assert.equal(pending.claimed, false);
    assert.deepEqual(pending.followUps, [queuedMessage]);

    const completionPromise = session.claimCompletionIfNoQueuedInputs();
    const tooLateMessage = message("too late");
    const tooLateEnqueuePromise = manager.enqueueFollowUp(runId, tooLateMessage, "user");
    const claimed = await completionPromise;
    assert.equal(claimed.claimed, true);
    await assert.rejects(
      tooLateEnqueuePromise,
      (error: unknown) =>
        error instanceof sessionModule.AgentLoopSessionError && error.code === "run_not_active",
    );
    assert.equal(
      session.messageTrace.some((item) => item.id === tooLateMessage.id),
      false,
    );
    assert.equal(db.listAgentRunInputs(runId).length, 1);
    assert.equal(
      db.listAgentRunInputs(runId).find((input) => input.id === queued.id)?.status,
      "consumed",
    );

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

  void it("clears approval state and cancels unfinished steps when a run is stopped", async () => {
    const manager = new sessionModule.AgentLoopSessionManager();
    const runId = randomUUID();
    await manager.start(baseOptions(runId));
    db.upsertAgentRuntimeState({
      agent_id: DEFAULT_AGENT_ID,
      status: "reviewing",
      current_run_id: runId,
    });
    db.upsertConversationAgentState({
      conversation_id: conversationId,
      active_agent_id: DEFAULT_AGENT_ID,
      current_run_id: runId,
      current_step_id: "approval-step",
      status: "reviewing",
      summary: "Waiting for user approval",
    });
    await db.createRuntimeStep({
      id: "approval-step",
      run_id: runId,
      agent_id: DEFAULT_AGENT_ID,
      kind: "approval",
      status: "queued",
      title: "Approval requested: workspace_run_command",
    });

    assert.equal(await manager.cancel(runId), true);

    const agentState = db
      .listagentRuntimeStates()
      .find((state) => state.agent_id === DEFAULT_AGENT_ID);
    const conversationState = db.getConversationAgentState(conversationId);
    const approvalStep = db.listRuntimeSteps().find((step) => step.id === "approval-step");
    assert.equal(agentState?.status, "idle");
    assert.equal(agentState?.current_run_id, null);
    assert.equal(conversationState?.status, "idle");
    assert.equal(conversationState?.current_run_id, null);
    assert.equal(conversationState?.current_step_id, null);
    assert.equal(approvalStep?.status, "cancelled");
    assert.notEqual(approvalStep?.finished_at, null);
  });

  void it("preserves approval runs when recovering stale runs", async () => {
    const runId = randomUUID();
    await db.createRuntimeRun({
      id: runId,
      conversation_id: conversationId,
      root_agent_id: DEFAULT_AGENT_ID,
      status: "waiting_approval",
    });
    await db.createRuntimeStep({
      id: "stale-approval-step",
      run_id: runId,
      agent_id: DEFAULT_AGENT_ID,
      kind: "approval",
      status: "queued",
      title: "Approval requested: workspace_run_command",
    });
    await db.createRuntimeStep({
      id: "stale-completed-step",
      run_id: runId,
      agent_id: DEFAULT_AGENT_ID,
      kind: "model",
      status: "succeeded",
      title: "Model step",
      finished_at: Date.now(),
    });

    await db.closeDb();
    db.initDb();

    const recoveredRun = db.getRuntimeRun(runId);
    const approvalStep = db.listRuntimeSteps().find((step) => step.id === "stale-approval-step");
    const completedStep = db.listRuntimeSteps().find((step) => step.id === "stale-completed-step");
    assert.equal(recoveredRun?.status, "waiting_approval");
    assert.equal(recoveredRun?.finish_reason, null);
    assert.equal(approvalStep?.status, "queued");
    assert.equal(approvalStep?.error, null);
    assert.equal(approvalStep?.finished_at, null);
    assert.equal(completedStep?.status, "succeeded");
  });

  void it("resumes a persisted approval run", async () => {
    const runId = randomUUID();
    await db.createRuntimeRun({
      id: runId,
      conversation_id: conversationId,
      root_agent_id: DEFAULT_AGENT_ID,
      status: "waiting_approval",
    });

    const manager = new sessionModule.AgentLoopSessionManager();
    const session = await manager.start({ ...baseOptions(runId), mode: "resume" });

    assert.equal(session.runId, runId);
    assert.equal(db.getRuntimeRun(runId)?.status, "running");
    await session.complete();
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
