import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: { getPath: () => process.env.AYAKA_USER_DATA_DIR ?? process.cwd() },
  dialog: {},
  shell: {},
};
require.cache[electronPath] = electronModule;

let db: typeof import("@desktop-main/lib/db");
let conversationWorkspace: typeof import("@desktop-main/lib/conversation-workspace");
let testRoot = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
  conversationWorkspace = await import("@desktop-main/lib/conversation-workspace");
});

beforeEach(async () => {
  await db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "ayaka-db-performance-"));
  process.env.AYAKA_USER_DATA_DIR = testRoot;
  const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  db.initDb({
    migrationsFolder: path.join(repoRoot, "apps", "desktop", "drizzle"),
  });
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  await rm(testRoot, { recursive: true, force: true });
  testRoot = "";
});

void describe("database performance paths", () => {
  void it("reads multiple settings in one result while preserving missing keys", async () => {
    await db.setSettings([
      { key: "performance.skin", value: "white" },
      { key: "performance.language", value: "zh-CN" },
    ]);

    assert.deepEqual(db.getSettings(["performance.skin", "missing", "performance.skin"]), {
      "performance.skin": "white",
      missing: null,
    });
    assert.deepEqual(db.getSettings([]), {});
  });

  void it("commits setting batches atomically", async () => {
    await db.setSettings([{ key: "performance.keep", value: "before" }]);
    await assert.rejects(
      db.setSettings([
        { key: "performance.keep", value: "after" },
        { key: "performance.invalid", value: undefined as unknown as string },
      ]),
      /Invalid settings batch/,
    );
    assert.equal(db.getSetting("performance.keep"), "before");
    assert.equal(db.getSetting("performance.invalid"), null);
  });

  void it("treats an empty message batch as a no-op", async () => {
    await db.saveMessagesBatch([]);
  });

  void it("rejects a message batch for a missing conversation", async () => {
    await assert.rejects(
      db.saveMessagesBatch([
        {
          id: "missing-conversation-message",
          conversation_id: "missing-conversation",
          role: "user",
          content: "{}",
          created_at: 100,
        },
      ]),
      /Conversation does not exist/,
    );
  });

  void it("rejects invalid message rows before writing any part of a batch", async () => {
    const conversationId = "batch-invalid-conversation";
    await db.createConversation(conversationId, "Invalid batch");

    await assert.rejects(
      db.saveMessagesBatch([
        {
          id: "batch-valid-before-invalid",
          conversation_id: conversationId,
          role: "user",
          content: "{}",
          created_at: 100,
        },
        {
          id: "batch-invalid-role",
          conversation_id: conversationId,
          role: "tool" as never,
          content: "{}",
          created_at: 200,
        },
      ]),
      /role is invalid/,
    );

    const snapshot = db.getMessagesSnapshot(conversationId);
    assert.equal(snapshot.revision, 0);
    assert.deepEqual(snapshot.messages, []);
  });

  void it("rejects cross-conversation message batches before writing", async () => {
    const firstConversationId = "batch-first-conversation";
    const secondConversationId = "batch-second-conversation";
    await db.createConversation(firstConversationId, "First");
    await db.createConversation(secondConversationId, "Second");

    await assert.rejects(
      db.saveMessagesBatch([
        {
          id: "batch-first-message",
          conversation_id: firstConversationId,
          role: "user",
          content: '{"id":"batch-first-message"}',
          created_at: 100,
        },
        {
          id: "batch-second-message",
          conversation_id: secondConversationId,
          role: "assistant",
          content: '{"id":"batch-second-message"}',
          created_at: 200,
        },
      ]),
      /one conversation only/,
    );

    assert.equal(db.getMessagesSnapshot(firstConversationId).revision, 0);
    assert.equal(db.getMessagesSnapshot(secondConversationId).revision, 0);
    assert.equal(db.getMessagesSnapshot(firstConversationId).messages.length, 0);
    assert.equal(db.getMessagesSnapshot(secondConversationId).messages.length, 0);
  });

  void it("advances a message batch revision once after all rows are committed", async () => {
    const conversationId = "batch-revision-conversation";
    await db.createConversation(conversationId, "Batch");
    await db.saveMessagesBatch([
      {
        id: "batch-message-1",
        conversation_id: conversationId,
        role: "user",
        content: "{}",
        created_at: 100,
      },
      {
        id: "batch-message-2",
        conversation_id: conversationId,
        role: "assistant",
        content: "{}",
        created_at: 200,
      },
    ]);
    const snapshot = db.getMessagesSnapshot(conversationId);
    assert.equal(snapshot.revision, 1);
    assert.deepEqual(
      snapshot.messages.map((message) => message.id),
      ["batch-message-1", "batch-message-2"],
    );
  });

  void it("prevents a message id from moving to another conversation", async () => {
    const firstConversationId = "ownership-first-conversation";
    const secondConversationId = "ownership-second-conversation";
    await db.createConversation(firstConversationId, "First");
    await db.createConversation(secondConversationId, "Second");
    await db.saveMessage({
      id: "owned-message",
      conversation_id: firstConversationId,
      role: "user",
      content: "first",
      created_at: 100,
    });

    await assert.rejects(
      db.saveMessagesBatch([
        {
          id: "owned-message",
          conversation_id: secondConversationId,
          role: "assistant",
          content: "attempted move",
          created_at: 200,
        },
      ]),
      /belongs to another conversation/,
    );

    assert.equal(db.getMessagesSnapshot(firstConversationId).messages[0]?.content, "first");
    assert.equal(db.getMessagesSnapshot(secondConversationId).revision, 0);
    assert.deepEqual(db.getMessagesSnapshot(secondConversationId).messages, []);
  });

  void it("returns a conversation-scoped hot runtime status", async () => {
    const conversationId = "runtime-status-conversation";
    const otherConversationId = "runtime-status-other";
    await db.createConversation(conversationId, "Runtime status");
    await db.createConversation(otherConversationId, "Other");
    await db.createRuntimeRun({
      id: "runtime-status-run",
      conversation_id: conversationId,
      status: "running",
      started_at: 100,
    });
    await db.createRuntimeRun({
      id: "runtime-status-other-run",
      conversation_id: otherConversationId,
      status: "running",
      started_at: 200,
    });
    await db.createRuntimeStep({
      id: "runtime-status-step",
      run_id: "runtime-status-run",
      kind: "model",
      status: "running",
      title: "Model",
      started_at: 100,
    });
    await db.createRuntimeStep({
      id: "runtime-status-other-step",
      run_id: "runtime-status-other-run",
      kind: "model",
      status: "running",
      title: "Other model",
      started_at: 200,
    });
    await db.createRuntimeRun({
      id: "runtime-status-latest-run",
      conversation_id: conversationId,
      status: "succeeded",
      started_at: 300,
    });
    await db.createRuntimeStep({
      id: "runtime-status-latest-step",
      run_id: "runtime-status-latest-run",
      kind: "model",
      status: "succeeded",
      title: "Latest model",
      started_at: 300,
    });
    const queuedInput = await db.enqueueAgentRunInput({
      runId: "runtime-status-run",
      kind: "follow_up",
      source: "user",
      message: { id: "runtime-status-input", role: "user", parts: [] },
    });

    const snapshot = db.getConversationRuntimeStatus(conversationId);
    assert.deepEqual(
      snapshot.runtimeRuns.map((run) => run.id),
      ["runtime-status-latest-run", "runtime-status-run"],
    );
    assert.deepEqual(
      snapshot.runtimeSteps.map((step) => step.id),
      ["runtime-status-step"],
    );
    assert.deepEqual(
      snapshot.agentRunInputs.map((input) => input.id),
      [queuedInput.id],
    );
    assert.equal(snapshot.runtimeEvents.length, 0);

    const limited = db.getConversationRuntimeStatus(conversationId, {
      runLimit: 1,
      stepLimit: 1,
    });
    assert.deepEqual(
      limited.runtimeRuns.map((run) => run.id),
      ["runtime-status-latest-run"],
    );
    assert.deepEqual(
      limited.runtimeSteps.map((step) => step.id),
      ["runtime-status-latest-step"],
    );

    const selectedOlderRun = db.getConversationRuntimeStatus(conversationId, {
      runId: "runtime-status-run",
      runLimit: 1,
    });
    assert.deepEqual(
      selectedOlderRun.runtimeRuns.map((run) => run.id),
      ["runtime-status-run"],
    );
    assert.deepEqual(
      selectedOlderRun.runtimeSteps.map((step) => step.id),
      ["runtime-status-step"],
    );

    const crossConversationRun = db.getConversationRuntimeStatus(conversationId, {
      runId: "runtime-status-other-run",
      runLimit: 1,
    });
    assert.deepEqual(
      crossConversationRun.runtimeRuns.map((run) => run.id),
      ["runtime-status-latest-run"],
    );
  });

  void it("returns a conversation, message snapshot, and workspace in one hydration shape", async () => {
    const conversationId = "performance-conversation";
    await db.createConversation(conversationId, "Fast history");
    await db.saveMessage({
      id: "performance-message",
      conversation_id: conversationId,
      role: "user",
      content: JSON.stringify({
        id: "performance-message",
        role: "user",
        parts: [],
      }),
      created_at: 100,
    });
    await db.createConversationWorkspace({
      conversation_id: conversationId,
      parent_path: testRoot,
      root_path: path.join(testRoot, "workspace"),
      status: "active",
      created_at: 100,
      updated_at: 200,
    });

    const hydration = conversationWorkspace.getConversationHydrationInfo(conversationId);
    assert.ok(hydration);
    assert.equal(hydration.conversation.title, "Fast history");
    assert.equal(hydration.messages.revision, 1);
    assert.equal(hydration.messages.messages[0]?.id, "performance-message");
    assert.equal(hydration.workspace?.conversationId, conversationId);
    assert.equal(hydration.workspace?.relativePath, "workspace");
    assert.equal(conversationWorkspace.getConversationHydrationInfo("missing"), null);
  });

  void it("lists only conversations with an active runtime run", async () => {
    await db.createConversation("running-conversation", "Running");
    await db.createConversation("waiting-conversation", "Waiting");
    await db.createConversation("finished-conversation", "Finished");
    await db.createRuntimeRun({
      id: "running-run",
      conversation_id: "running-conversation",
      status: "running",
      started_at: 100,
    });
    await db.createRuntimeRun({
      id: "waiting-run",
      conversation_id: "waiting-conversation",
      status: "waiting_approval",
      started_at: 200,
    });
    await db.createRuntimeRun({
      id: "finished-run",
      conversation_id: "finished-conversation",
      status: "succeeded",
      started_at: 300,
    });

    assert.deepEqual(db.listRunningConversationIds().sort(), [
      "running-conversation",
      "waiting-conversation",
    ]);
  });
});
