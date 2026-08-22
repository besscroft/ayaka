import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, afterEach, beforeEach, test } from "node:test";
import Module from "node:module";

let active = false;
let connectionListener: ((event: { type: "connection-closed"; serverId: string }) => void) | null =
  null;

const electronPath = createRequire(import.meta.url).resolve("electron");
const require = createRequire(import.meta.url);
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: { isPackaged: false, getPath: () => process.env.AYAKA_USER_DATA_DIR ?? process.cwd() },
};
require.cache[electronPath] = electronModule;

mock.module(
  new URL("../../../../apps/desktop/src/main/lib/mcp-client-manager.ts", import.meta.url).href,
  {
    namedExports: {
      closeAllMcpConnections: async () => {
        active = false;
      },
      closeMcpConnection: async (serverId: string) => {
        active = false;
        connectionListener?.({ type: "connection-closed", serverId });
      },
      getMcpConnection: async (server: { id: string }) => {
        active = true;
        return { serverId: server.id };
      },
      mcpConnection: () => (active ? { serverId: "mock" } : null),
      onMcpConnectionEvent: (listener: typeof connectionListener) => {
        connectionListener = listener;
        return () => {
          connectionListener = null;
        };
      },
    },
  },
);

const db = await import("@desktop-main/lib/db");
const lifecycle = await import("@desktop-main/lib/mcp-lifecycle-manager");

let root = "";
let serverId = "";

beforeEach(async () => {
  await db.closeDb();
  root = await mkdtemp(join(tmpdir(), "ayaka-mcp-lifecycle-"));
  process.env.AYAKA_USER_DATA_DIR = root;
  db.initDb();
  const server = await db.createToolServerAsync({
    name: "Lifecycle test",
    transport: "http",
    url: "https://example.com/mcp",
    enabled: true,
  });
  serverId = server.id;
  active = false;
  lifecycle.resumeMcpLifecycle();
});

afterEach(async () => {
  await lifecycle.shutdownMcpLifecycle();
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  await rm(root, { recursive: true, force: true });
});

test("coalesces concurrent starts and stops the local HTTP session", async () => {
  const [first, second] = await Promise.all([
    lifecycle.startMcpServer(serverId),
    lifecycle.startMcpServer(serverId),
  ]);

  assert.equal(first.state, "running");
  assert.equal(second.state, "running");
  assert.equal(lifecycle.getMcpManagerSnapshot().servers[0]?.runtime.state, "running");

  const stopped = await lifecycle.stopMcpServer(serverId);
  assert.equal(stopped.state, "stopped");
  assert.equal(active, false);
});

test("records reconnecting state for an unexpected stdio close", async () => {
  await db.updateToolServerAsync(serverId, {
    transport: "stdio",
    command: "node",
    args: ["server.js"],
  });
  await lifecycle.startMcpServer(serverId);
  // The mocked connection does not expose a process; the lifecycle callback is
  // still the same event boundary used by the real stdio transport.
  connectionListener?.({ type: "connection-closed", serverId });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(db.getMcpRuntimeState(serverId)?.state, "reconnecting");
});

test("projects dependency confirmation and failures into actionable lifecycle states", async () => {
  await db.updateToolServerAsync(serverId, {
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
  });

  const confirmation = await db.upsertMcpDependencyInstallationAsync({
    serverId,
    manager: "uvx",
    packageSpecs: ["mcp-server-fetch"],
    status: "needs_confirmation",
    lastError: "uvx installation may execute Python build scripts; confirm before continuing.",
  });
  const confirmationState = await lifecycle.syncMcpDependencyState(serverId, confirmation);
  assert.equal(confirmationState?.state, "needs_confirmation");
  assert.match(confirmationState?.lastError ?? "", /Python build scripts/);

  const failed = await db.upsertMcpDependencyInstallationAsync({
    serverId,
    manager: "uvx",
    status: "failed",
    lastError: "uv Runtime is not available. Install it from Ayaka Settings or add it to PATH.",
  });
  const failedState = await lifecycle.syncMcpDependencyState(serverId, failed);
  assert.equal(failedState?.state, "needs_runtime");
});

test("auto-starts enabled stdio MCPs whose dependencies are installed", async () => {
  await db.updateToolServerAsync(serverId, {
    transport: "stdio",
    command: "npx",
    args: ["mcp-server-fetch"],
    enabled: true,
  });
  await db.upsertMcpDependencyInstallationAsync({
    serverId,
    manager: "npx",
    packageSpecs: ["mcp-server-fetch"],
    status: "installed",
    installRoot: "C:/ayaka-test-dependencies",
  });

  await lifecycle.startEnabledMcpServers();
  assert.equal(db.getMcpRuntimeState(serverId)?.state, "running");
});
