import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import Module, { createRequire } from "node:module";
import { mkdtemp, rm, stat } from "node:fs/promises";
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
  app: {
    isPackaged: false,
    getPath: () => process.env.AYAKA_USER_DATA_DIR ?? process.cwd(),
  },
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
  shell: {
    openPath: async () => "",
    showItemInFolder: () => undefined,
  },
};
require.cache[electronPath] = electronModule;

let db: typeof import("@desktop-main/lib/db");
let cronStore: typeof import("@desktop-main/lib/cron-store");
let automationWorkspace: typeof import("@desktop-main/lib/automation-workspace");
let root = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
  cronStore = await import("@desktop-main/lib/cron-store");
  automationWorkspace = await import("@desktop-main/lib/automation-workspace");
});

beforeEach(async () => {
  await db.closeDb();
  root = await mkdtemp(path.join(tmpdir(), "ayaka-automation-workspace-test-"));
  process.env.AYAKA_USER_DATA_DIR = root;
  const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
  db.initDb({
    migrationsFolder: path.join(repoRoot, "apps", "desktop", "drizzle"),
  });
  await db.setSetting("workspace_parent_directory", path.join(root, "parent"));
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

void describe("automation workspaces", () => {
  void it("creates workspaces for new jobs and repairs legacy jobs idempotently", async () => {
    const legacyJob = await cronStore.createCronJob(makeInput("legacy"));
    assert.equal(db.getConversationWorkspace(legacyJob.conversationId), null);

    await automationWorkspace.ensureAutomationWorkspace(legacyJob);
    const first = db.getConversationWorkspace(legacyJob.conversationId);
    assert.ok(first);
    assert.equal((await stat(first.root_path)).isDirectory(), true);

    await automationWorkspace.ensureAutomationWorkspace(legacyJob);
    assert.equal(db.getConversationWorkspace(legacyJob.conversationId)?.root_path, first.root_path);

    const created = await automationWorkspace.createCronJobWithWorkspace(makeInput("created"));
    assert.ok(db.getConversationWorkspace(created.conversationId));
  });
});

function makeInput(name: string): import("@shared/types").CronJobInput {
  return {
    name,
    schedule: { kind: "once", at: new Date(Date.now() + 60_000).toISOString() },
    payload: { prompt: "run" },
  };
}
