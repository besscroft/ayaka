import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
let root = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
});

beforeEach(async () => {
  await db.closeDb();
  root = await mkdtemp(path.join(tmpdir(), "ayaka-realtime-session-test-"));
  process.env.AYAKA_USER_DATA_DIR = root;
  const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  db.initDb({ migrationsFolder: path.join(repoRoot, "apps", "desktop", "drizzle") });
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

void describe("realtime session persistence", () => {
  void it("creates an independent session, stores text only, updates title, and lists newest first", async () => {
    const first = await db.createRealtimeSession({
      id: "realtime-session-a",
      providerId: "openai",
      modelId: "gpt-realtime",
    });
    assert.equal(first.transcript_json, "[]");
    assert.deepEqual(
      db.listRealtimeSessions().map((session) => session.id),
      ["realtime-session-a"],
    );

    const saved = await db.saveRealtimeSessionTranscript("realtime-session-a", [
      { id: "user-1", role: "user", text: "Plan a weekend trip", createdAt: 100 },
      { id: "assistant-1", role: "assistant", text: "Where would you like to go?", createdAt: 110 },
    ]);
    assert.ok(saved);
    assert.equal(saved.title, "Plan a weekend trip");
    assert.equal(JSON.parse(saved.transcript_json).length, 2);
    assert.equal(saved.transcript_json.includes("audio"), false);
    assert.deepEqual(db.getRealtimeSession("realtime-session-a")?.messages, [
      { id: "user-1", role: "user", text: "Plan a weekend trip", createdAt: 100 },
      { id: "assistant-1", role: "assistant", text: "Where would you like to go?", createdAt: 110 },
    ]);
    assert.deepEqual(db.listRealtimeSessions()[0]?.messages.length, 2);
  });

  void it("deletes a realtime session without touching normal chat conversations", async () => {
    await db.createConversation("normal-chat-1", "Ordinary chat");
    await db.createRealtimeSession({
      id: "realtime-session-b",
      providerId: "openai",
      modelId: "gpt-realtime",
    });
    assert.equal(await db.deleteRealtimeSession("realtime-session-b"), true);
    assert.equal(await db.deleteRealtimeSession("realtime-session-b"), false);
    assert.equal(db.getRealtimeSession("realtime-session-b"), null);
    assert.equal(db.getConversation("normal-chat-1")?.title, "Ordinary chat");
  });
});
