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
