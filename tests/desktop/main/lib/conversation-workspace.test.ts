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
  dialog: {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    showSaveDialog: async () => saveDialogResult,
  },
  shell: {
    openPath: async () => "",
    showItemInFolder: (filePath: string) => {
      revealedPath = filePath;
    },
  },
};
require.cache[electronPath] = electronModule;

let db: typeof import("@desktop-main/lib/db");
let workspace: typeof import("@desktop-main/lib/conversation-workspace");
let root = "";
let saveDialogResult: { canceled: boolean; filePath?: string } = { canceled: true };
let revealedPath = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
  workspace = await import("@desktop-main/lib/conversation-workspace");
});

beforeEach(async () => {
  await db.closeDb();
  root = await mkdtemp(path.join(tmpdir(), "void-ai-workspace-test-"));
  process.env.VOID_AI_USER_DATA_DIR = root;
  saveDialogResult = { canceled: true };
  revealedPath = "";
  const repoRoot = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
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
    assert.deepEqual(Array.from(new Uint8Array(content.data)), [2]);
    await assert.rejects(workspace.readWorkspaceFileContent(id, "../outside"), /escapes/);
  });

  void it("saves media through the native dialog and reveals workspace files safely", async () => {
    const id = "image-actions-conversation";
    const output = await workspace.writeWorkspaceOutput(id, {
      filename: "generated",
      mediaType: "image/png",
      data: new Uint8Array([7, 8, 9]),
    });
    saveDialogResult = { canceled: false, filePath: path.join(root, "saved-image.png") };

    const saved = await workspace.saveWorkspaceMediaAs({
      filename: "generated.png",
      mediaType: "image/png",
      data: new Uint8Array([1, 2, 3]).buffer,
    });
    assert.equal(saved.saved, true);
    assert.deepEqual(Array.from(await readFile(path.join(root, "saved-image.png"))), [1, 2, 3]);

    saveDialogResult = { canceled: true };
    assert.deepEqual(
      await workspace.saveWorkspaceMediaAs({
        filename: "cancelled.png",
        mediaType: "image/png",
        data: new Uint8Array([4]).buffer,
      }),
      { saved: false },
    );

    assert.equal(await workspace.revealWorkspaceFile(id, output.path), true);
    assert.equal(revealedPath, path.join(db.getConversationWorkspace(id)!.root_path, output.path));
    await assert.rejects(workspace.revealWorkspaceFile(id, "../outside.png"), /escapes/);
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

  void it("normalizes workspace images and validates supported media URLs", async () => {
    const id = "media-input-conversation";
    await workspace.saveWorkspaceAttachment(id, {
      filename: "pixel.png",
      mediaType: "image/png",
      data: new Uint8Array([0, 1, 2]),
    });

    const workspaceMessages = await workspace.normalizeChatMediaInputs(id, [
      {
        id: "m1",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", url: "workspace://attachments/pixel.png" }],
      },
    ]);
    assert.equal(
      workspaceMessages[0]?.parts[0]?.type === "file" && workspaceMessages[0].parts[0].url,
      "data:image/png;base64,AAEC",
    );

    const supported = await workspace.normalizeChatMediaInputs(undefined, [
      {
        id: "m2",
        role: "user",
        parts: [
          { type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" },
          { type: "file", mediaType: "image/png", url: "https://example.com/image.png" },
        ],
      },
    ]);
    assert.equal(
      supported[0]?.parts[0]?.type === "file" && supported[0].parts[0].url,
      "data:image/png;base64,AA==",
    );
    assert.equal(
      supported[0]?.parts[1]?.type === "file" && supported[0].parts[1].url,
      "https://example.com/image.png",
    );
  });

  void it("rejects unsafe or malformed media references without exposing the value", async () => {
    for (const url of [
      "workspace://attachments/missing.png",
      "blob:local",
      "file:///tmp/a.png",
      "",
      "data:image/png;base64,not-base64",
    ]) {
      await assert.rejects(
        workspace.normalizeChatMediaInputs(undefined, [
          { id: "m3", role: "user", parts: [{ type: "file", mediaType: "image/png", url }] },
        ]),
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, "invalid_media_input");
          if (url) assert.equal((error as Error).message.includes(url), false);
          return true;
        },
      );
    }
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
