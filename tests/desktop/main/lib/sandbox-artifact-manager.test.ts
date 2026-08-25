import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SandboxSession } from "@shared/types";

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
let artifacts: typeof import("@desktop-main/lib/sandbox-artifact-manager");
let root = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
  artifacts = await import("@desktop-main/lib/sandbox-artifact-manager");
});

beforeEach(async () => {
  await db.closeDb();
  root = await mkdtemp(path.join(tmpdir(), "ayaka-artifact-test-"));
  process.env.AYAKA_USER_DATA_DIR = root;
  db.initDb();
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

void describe("sandbox artifact manager", () => {
  void it("recognizes HTML and static artifacts, computes hashes, and keeps paths relative", async () => {
    const session = await makeSession("recognize");
    await mkdir(session.root_path, { recursive: true });
    await writeFile(path.join(session.root_path, "index.html"), "<h1>Hello</h1>");
    await mkdir(path.join(session.root_path, "site", "assets"), { recursive: true });
    await writeFile(
      path.join(session.root_path, "site", "index.html"),
      "<script src='./assets/app.js'></script>",
    );
    await writeFile(path.join(session.root_path, "site", "assets", "app.js"), "console.log('ok')");

    const html = await artifacts.publishSandboxArtifact(session, { path: "index.html" });
    const staticSite = await artifacts.publishSandboxArtifact(session, { path: "site" });

    assert.equal(html.kind, "html");
    assert.equal(html.path, "index.html");
    assert.equal(html.entry_path, "index.html");
    assert.match(html.sha256 ?? "", /^[0-9a-f]{64}$/);
    assert.equal(staticSite.kind, "static");
    assert.equal(staticSite.path, "site");
    assert.equal(staticSite.entry_path, "index.html");
    assert.equal(html.authorized, true);
    assert.equal(staticSite.authorized, true);
    assert.doesNotMatch(JSON.stringify(html), /[A-Za-z]:\\/);
  });

  void it("rejects traversal, symlink escape, snapshots, and oversized HTML", async () => {
    const session = await makeSession("reject");
    await mkdir(session.root_path, { recursive: true });
    await mkdir(path.join(session.root_path, ".snapshots"), { recursive: true });
    await writeFile(path.join(session.root_path, ".snapshots", "private.html"), "secret");
    await writeFile(path.join(root, "outside.html"), "outside");
    await symlink(path.join(root, "outside.html"), path.join(session.root_path, "escape.html"));
    await writeFile(path.join(session.root_path, "large.html"), Buffer.alloc(256 * 1024 + 1, 65));

    await assert.rejects(
      () => artifacts.publishSandboxArtifact(session, { path: "../outside.html" }),
      /relative|escapes/,
    );
    await assert.rejects(
      () => artifacts.publishSandboxArtifact(session, { path: ".snapshots/private.html" }),
      /Snapshot/,
    );
    await assert.rejects(
      () => artifacts.publishSandboxArtifact(session, { path: "escape.html" }),
      /Symlink|escapes/,
    );
    const large = await artifacts.publishSandboxArtifact(session, { path: "large.html" });
    assert.equal(large.size_bytes, 256 * 1024 + 1);
    assert.throws(() => artifacts.normalizeRelativePath("../escape.js"), /escapes/);
    assert.throws(() => artifacts.normalizeRelativePath("C:/escape.js"), /relative/);
  });

  void it("allows HTML reads without authorization", async () => {
    const session = await makeSession("authorize");
    await mkdir(session.root_path, { recursive: true });
    await writeFile(path.join(session.root_path, "index.html"), "<p>safe</p>");
    const artifact = await artifacts.publishSandboxArtifact(session, { path: "index.html" });
    const source = await artifacts.readSandboxArtifactHtml(session.conversation_id!, artifact.id);
    assert.equal(source.text, "<p>safe</p>");
  });

  void it("updates an artifact in place and protects static resources", async () => {
    const session = await makeSession("static");
    await mkdir(path.join(session.root_path, "site"), { recursive: true });
    await writeFile(
      path.join(session.root_path, "site", "index.html"),
      "<script src='./app.js'></script>",
    );
    await writeFile(path.join(session.root_path, "site", "app.js"), "console.log('one')");
    await writeFile(path.join(session.root_path, "site", "data.json"), '{"ok":true}');

    const first = await artifacts.publishSandboxArtifact(session, { path: "site" });
    await writeFile(path.join(session.root_path, "site", "app.js"), "console.log('two')");
    const updated = await artifacts.publishSandboxArtifact(session, { path: "site" });
    assert.equal(updated.id, first.id);
    assert.notEqual(updated.sha256, first.sha256);
    assert.equal(updated.status, "ready");

    assert.equal(
      artifacts.getSandboxArtifactResourceUrl(session.conversation_id!, updated.id),
      `ayaka-artifact://${updated.id}/index.html`,
    );
    const resource = await artifacts.readSandboxArtifactResource(updated.id, "data.json");
    assert.equal(resource.mimeType, "application/json; charset=utf-8");
    assert.equal(resource.body.toString("utf8"), '{"ok":true}');
    await assert.rejects(
      () => artifacts.readSandboxArtifactResource(updated.id, "../outside.json"),
      /escapes/,
    );
    await writeFile(path.join(session.root_path, "site", "unknown.bin"), "x");
    const withUnsupported = await artifacts.publishSandboxArtifact(session, { path: "site" });
    await assert.rejects(
      () => artifacts.readSandboxArtifactResource(withUnsupported.id, "unknown.bin"),
      /not supported/,
    );
  });

  void it("enforces conversation ownership for artifact IDs", async () => {
    const owner = await makeSession("owner");
    const other = await makeSession("other");
    await mkdir(owner.root_path, { recursive: true });
    await writeFile(path.join(owner.root_path, "index.html"), "<p>owner</p>");
    const artifact = await artifacts.publishSandboxArtifact(owner, { path: "index.html" });
    assert.throws(
      () => artifacts.getOwnedArtifact(other.conversation_id!, artifact.id),
      /does not belong to this conversation/,
    );
  });
});

async function makeSession(id: string): Promise<SandboxSession> {
  const now = Date.now();
  const session: SandboxSession = {
    id: "sandbox-artifact-" + id,
    conversation_id: "conversation-artifact-" + id,
    run_id: null,
    agent_id: null,
    root_path: path.join(root, id),
    isolation_mode: "local",
    status: "active",
    docker_available: 0,
    created_at: now,
    updated_at: now,
  };
  await db.createConversation(session.conversation_id!);
  db.upsertSandboxSession(session);
  return session;
}
