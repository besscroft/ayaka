import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { MCP_PRESETS } from "@desktop-main/lib/mcp-presets";

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

mock.module(new URL("../../../../apps/desktop/src/main/lib/mcp-manager.ts", import.meta.url).href, {
  namedExports: {
    closeMcpClient: mock.fn(async () => undefined),
    discoverMcpServer: mock.fn(async (serverId: string) => ({
      server: {
        id: serverId,
        status: "ready",
      },
      message: "ready",
    })),
  },
});

let db: typeof import("@desktop-main/lib/db");
let catalog: typeof import("@desktop-main/lib/catalog-service");
let testRoot = "";

const testPreset = {
  id: "catalog-service-test",
  name: "Catalog Service Test MCP",
  description: "A test-only local MCP preset.",
  version: "1.0.0",
  transport: "stdio" as const,
  command: "node",
  args: ["server.js"],
  env: { API_TOKEN: "$secret:API_TOKEN" },
  secretKeys: ["API_TOKEN"],
  warnings: ["Test preset requires review."],
};

before(async () => {
  db = await import("@desktop-main/lib/db");
  catalog = await import("@desktop-main/lib/catalog-service");
});

beforeEach(async () => {
  await db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "ayaka-catalog-service-"));
  process.env.AYAKA_USER_DATA_DIR = testRoot;
  db.initDb();
  MCP_PRESETS.push(testPreset);
});

afterEach(async () => {
  const index = MCP_PRESETS.findIndex((preset) => preset.id === testPreset.id);
  if (index >= 0) MCP_PRESETS.splice(index, 1);
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  testRoot = "";
});

void describe("MCP preset catalog installation", () => {
  void it("installs disabled, encrypts secrets, preserves user config, and uninstalls cleanly", async () => {
    const result = await catalog.searchCatalogMcp({ query: "Catalog Service Test" });
    assert.equal(result.sources[0]?.source, "builtin-mcp");
    assert.equal(result.sources[0]?.status, "builtin");
    const item = result.items[0];
    assert.ok(item);

    const installation = await catalog.installCatalogItem({
      itemId: item.id,
      secrets: { API_TOKEN: "first-secret" },
    });
    assert.equal(installation.status, "disabled");
    assert.ok(installation.toolServerId);

    const server = db.getMcpServer(installation.toolServerId);
    assert.ok(server);
    assert.equal(server.enabled, 0);
    assert.deepEqual(JSON.parse(server.env_json), { API_TOKEN: "$secret:API_TOKEN" });
    assert.equal(db.getToolSecretValue("server", server.id, "API_TOKEN"), "first-secret");
    const secretRow = db.getDb().select().from(db.schema.toolSecrets).get();
    assert.ok(secretRow);
    assert.doesNotMatch(secretRow.ciphertext, /first-secret/);

    db.updateToolServer(server.id, {
      command: "user-command",
      args: ["user-arg"],
      description: "User-maintained MCP configuration",
    });
    const updated = await catalog.installCatalogItem({
      itemId: item.id,
      secrets: { API_TOKEN: "second-secret" },
    });
    assert.equal(updated.id, installation.id);
    const preserved = db.getMcpServer(server.id);
    assert.ok(preserved);
    assert.equal(preserved.command, "user-command");
    assert.deepEqual(JSON.parse(preserved.args_json), ["user-arg"]);
    assert.equal(preserved.description, "User-maintained MCP configuration");
    assert.equal(db.getToolSecretValue("server", server.id, "API_TOKEN"), "second-secret");

    const metadataUpdatedPreset = {
      ...testPreset,
      version: "1.1.0",
      description: "An updated test-only local MCP preset.",
    };
    MCP_PRESETS.splice(0, 1, metadataUpdatedPreset);
    const refreshed = await catalog.searchCatalogMcp({ query: "Catalog Service Test" });
    const refreshedItem = refreshed.items[0];
    assert.ok(refreshedItem);
    assert.equal(refreshedItem.id, item.id);
    assert.equal(refreshedItem.version, "1.1.0");
    assert.equal(refreshedItem.updateAvailable, true);

    const metadataUpdated = await catalog.installCatalogItem({ itemId: refreshedItem.id });
    assert.equal(metadataUpdated.id, installation.id);
    assert.equal(metadataUpdated.version, "1.1.0");
    const preservedAfterMetadataUpdate = db.getMcpServer(server.id);
    assert.ok(preservedAfterMetadataUpdate);
    assert.equal(preservedAfterMetadataUpdate.command, "user-command");
    assert.deepEqual(JSON.parse(preservedAfterMetadataUpdate.args_json), ["user-arg"]);
    assert.equal(preservedAfterMetadataUpdate.description, "User-maintained MCP configuration");

    const enabled = await catalog.installCatalogItem({ itemId: item.id, enable: true });
    assert.equal(enabled.status, "enabled");
    assert.equal(db.getMcpServer(server.id)?.enabled, 1);

    assert.equal(await catalog.uninstallArtifact(installation.id), true);
    assert.equal(db.getMcpServer(server.id), null);
    assert.equal(db.getToolSecretValue("server", server.id, "API_TOKEN"), null);
    assert.equal(
      db
        .getDb()
        .select()
        .from(db.schema.artifactInstallations)
        .all()
        .some((row) => row.id === installation.id),
      false,
    );
  });
});
