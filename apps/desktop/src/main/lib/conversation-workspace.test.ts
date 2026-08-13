import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  app: { isPackaged: false, getPath: () => process.env.VOID_AI_USER_DATA_DIR ?? process.cwd() },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => "" },
};
require.cache[electronPath] = electronModule;

let db: typeof import("./db");
let workspace: typeof import("./conversation-workspace");
let root = "";

before(async () => {
  db = await import("./db");
  workspace = await import("./conversation-workspace");
});

beforeEach(async () => {
  await db.closeDb();
  root = await mkdtemp(path.join(tmpdir(), "void-ai-workspace-test-"));
  process.env.VOID_AI_USER_DATA_DIR = root;
  const repoRoot = path.resolve(fileURLToPath(new URL("../../../../../", import.meta.url)));
  db.initDb({
    migrationsFolder: path.join(repoRoot, "apps", "desktop", "drizzle"),
  });
  await db.setSetting("workspace_parent_directory", path.join(root, "parent"));
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.VOID_AI_USER_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

void describe("conversation workspaces", () => {
  void it("rejects absolute and escaping paths", () => {
    assert.throws(() => workspace.resolveWorkspacePath(root, "../outside"), /escapes/);
    assert.throws(
      () => workspace.resolveWorkspacePath(root, path.join(root, "outside")),
      /relative/,
    );
  });

  void it("returns the absolute configured workspace parent", async () => {
    const state = await workspace.getWorkspaceParentState();
    assert.equal(state.configured, true);
    assert.equal(state.path, path.join(root, "parent"));
  });

  void it("creates a dated workspace only when prepared", async () => {
    const id = "12345678-abcd-efgh";
    assert.equal(db.getConversation(id), null);
    const info = await workspace.prepareConversationWorkspace(id);
    assert.match(info.relativePath, /^\d{4}-\d{2}-\d{2}-conv-12345678(?:-\d+)?$/);
    const rootPath = db.getConversationWorkspace(id)!.root_path;
    assert.equal((await stat(path.join(rootPath, "attachments"))).isDirectory(), true);
    assert.equal((await stat(path.join(rootPath, "outputs"))).isDirectory(), true);
    assert.ok(db.getConversation(id));
  });

  void it("rolls back an empty temporary conversation and its files", async () => {
    const id = "rollback-conversation";
    await workspace.prepareConversationWorkspace(id);
    const rootPath = db.getConversationWorkspace(id)!.root_path;
    await workspace.rollbackConversationWorkspacePreparation(id);
    assert.equal(db.getConversation(id), null);
    assert.equal(db.getConversationWorkspace(id), null);
    await assert.rejects(readFile(rootPath));
  });

  void it("stages attachments, disambiguates names, and rejects bad data", async () => {
    const id = "attachments-conversation";
    const refs = await workspace.saveWorkspaceAttachments(id, [
      { filename: "report.txt", mediaType: "text/plain", dataUrl: "data:text/plain;base64,QQ==" },
      { filename: "report.txt", mediaType: "text/plain", dataUrl: "data:text/plain;base64,Qg==" },
      {
        filename: "bad/name?.txt",
        mediaType: "text/plain",
        dataUrl: "data:text/plain;base64,Qw==",
      },
    ]);
    assert.deepEqual(
      refs.map((ref) => ref.filename),
      ["report.txt", "report-1.txt", "name_.txt"],
    );
    const rootPath = db.getConversationWorkspace(id)!.root_path;
    assert.equal(
      (await readFile(path.join(rootPath, "attachments", "report-1.txt"))).toString(),
      "B",
    );
    await assert.rejects(
      workspace.saveWorkspaceAttachments(id, [{ filename: "bad", dataUrl: "not-a-data-url" }]),
      /base64 data URL/,
    );
  });

  void it("keeps generated output names unique and reads controlled content", async () => {
    const id = "output-conversation";
    const first = await workspace.writeWorkspaceOutput(id, {
      filename: "image",
      mediaType: "image/png",
      data: new Uint8Array([1]),
    });
    const second = await workspace.writeWorkspaceOutput(id, {
      filename: "image",
      mediaType: "image/png",
      data: new Uint8Array([2]),
    });
    assert.equal(first.filename, "image.png");
    assert.equal(second.filename, "image-1.png");
    const content = await workspace.readWorkspaceFileContent(id, second.path);
    assert.equal(content.mediaType, "image/png");
    assert.deepEqual(Array.from(content.data), [2]);
    await assert.rejects(workspace.readWorkspaceFileContent(id, "../outside"), /escapes/);
  });

  void it("finds and removes only valid orphan directories", async () => {
    const parent = path.join(root, "parent");
    await mkdir(path.join(parent, "2026-08-12-conv-orphan"), { recursive: true });
    await writeFile(path.join(parent, "2026-08-12-conv-orphan", "keep.txt"), "keep");
    const orphans = await workspace.listWorkspaceOrphans();
    assert.equal(orphans.length, 1);
    assert.equal(await workspace.openWorkspaceOrphan(orphans[0]!.id), true);
    assert.equal(await workspace.removeWorkspaceOrphan(orphans[0]!.id), true);
    assert.equal((await workspace.listWorkspaceOrphans()).length, 0);
    await assert.rejects(workspace.removeWorkspaceOrphan("missing-orphan"), /not found/);
  });

  void it("exposes deleted conversation workspaces as orphans and restores ownership", async () => {
    const id = "deleted-conversation";
    await workspace.prepareConversationWorkspace(id);
    const rootPath = db.getConversationWorkspace(id)!.root_path;

    await db.deleteConversation(id);
    const deletedOrphans = await workspace.listWorkspaceOrphans();
    assert.equal(
      deletedOrphans.some((orphan) => orphan.name === path.basename(rootPath)),
      false,
    );

    await db.restoreConversation(id);
    const restoredOrphans = await workspace.listWorkspaceOrphans();
    assert.equal(
      restoredOrphans.some((orphan) => orphan.name === path.basename(rootPath)),
      false,
    );

    await db.permanentlyDeleteConversation(id);
    const permanentlyDeletedOrphans = await workspace.listWorkspaceOrphans();
    assert.equal(
      permanentlyDeletedOrphans.some((orphan) => orphan.name === path.basename(rootPath)),
      true,
    );
  });

  void it("marks workspaces orphaned when deleted conversations expire", async () => {
    const id = "expired-conversation";
    await workspace.prepareConversationWorkspace(id);
    const rootPath = db.getConversationWorkspace(id)!.root_path;
    await db.deleteConversation(id);

    assert.equal(
      await db.purgeExpiredDeletedConversations(Date.now() + 31 * 24 * 60 * 60 * 1000),
      1,
    );
    assert.equal(db.getConversation(id), null);
    assert.equal(
      (await workspace.listWorkspaceOrphans()).some(
        (orphan) => orphan.name === path.basename(rootPath),
      ),
      true,
    );
  });
});
