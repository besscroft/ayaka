import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Module, { createRequire } from "node:module";
import type { SandboxSession } from "@shared/types";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: { isPackaged: false, getPath: () => process.cwd() },
  BrowserWindow: class BrowserWindow {},
  WebContentsView: class WebContentsView {},
};
require.cache[electronPath] = electronModule;

const preview = await import("@desktop-main/lib/sandbox-preview-manager");

void describe("sandbox preview manager", () => {
  void it("allows only the current loopback origin and its HMR websocket", () => {
    assert.equal(
      preview.isAllowedPreviewUrl("http://127.0.0.1:4173/", "http://127.0.0.1:4173"),
      true,
    );
    assert.equal(
      preview.isAllowedPreviewUrl("ws://127.0.0.1:4173/@vite/client", "http://127.0.0.1:4173"),
      true,
    );
    assert.equal(
      preview.isAllowedPreviewUrl("wss://127.0.0.1:4173/socket", "https://127.0.0.1:4173"),
      true,
    );
    assert.equal(
      preview.isAllowedPreviewUrl("http://127.0.0.1:4174/", "http://127.0.0.1:4173"),
      false,
    );
    assert.equal(
      preview.isAllowedPreviewUrl("http://localhost:4173/", "http://127.0.0.1:4173"),
      false,
    );
    assert.equal(
      preview.isAllowedPreviewUrl("https://example.com/", "http://127.0.0.1:4173"),
      false,
    );
    assert.equal(
      preview.isAllowedPreviewUrl("http://user@127.0.0.1:4173/", "http://127.0.0.1:4173"),
      false,
    );
  });

  void it("builds an explicit Docker preview with a loopback-only port mapping", () => {
    const session: SandboxSession = {
      id: "sandbox-preview-test",
      conversation_id: "conversation-preview-test",
      run_id: "run-preview-test",
      agent_id: "agent-ayaka",
      root_path: "C:\\tmp\\ayaka-preview",
      isolation_mode: "docker",
      status: "active",
      docker_available: 1,
      created_at: 1,
      updated_at: 1,
    };
    const args = preview.buildSandboxPreviewDockerArgs(
      session,
      {
        executable: "npm",
        args: ["run", "dev", "--", "--host", "0.0.0.0"],
        cwd: "site",
        env: { PATH: "C:\\Program Files\\nodejs" },
      },
      4173,
      "preview-1234567890",
      "ayaka-preview-test",
    );
    assert.equal(args[0], "run");
    assert.equal(args.includes("--network"), true);
    assert.equal(args[args.indexOf("--network") + 1], "bridge");
    assert.equal(args.includes("--network"), true);
    assert.equal(args.includes("--publish"), true);
    assert.equal(args[args.indexOf("--publish") + 1], "127.0.0.1:4173:4173");
    assert.equal(args[args.indexOf("--name") + 1], "ayaka-preview-test");
    assert.equal(args.includes("--workdir"), true);
    assert.equal(args[args.indexOf("--workdir") + 1], "/workspace/site");
    assert.equal(
      args.some((value) => value.includes("source=C:\\tmp\\ayaka-preview")),
      true,
    );
  });
});
