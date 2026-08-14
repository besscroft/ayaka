import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  app: {
    isPackaged: false,
    getPath: () => process.env.VOID_AI_USER_DATA_DIR ?? process.cwd(),
  },
};
require.cache[electronPath] = electronModule;

let rootPath = "";
let sandbox: typeof import("@desktop-main/lib/sandbox-agents");

before(async () => {
  rootPath = await mkdtemp(path.join(tmpdir(), "void-ai-sandbox-test-"));
  process.env.VOID_AI_USER_DATA_DIR = rootPath;
  sandbox = await import("@desktop-main/lib/sandbox-agents");
});

after(async () => {
  delete process.env.VOID_AI_USER_DATA_DIR;
  if (rootPath) await rm(rootPath, { recursive: true, force: true });
});

void describe("sandbox agents", () => {
  void it("confines file paths to the sandbox root", () => {
    const session = makeSession("paths");

    assert.throws(
      () => sandbox.resolveSandboxPath(session.root_path, "../escape.txt"),
      /escapes the sandbox root/,
    );
    assert.throws(
      () => sandbox.resolveSandboxPath(session.root_path, path.resolve(rootPath, "outside")),
      /must be relative/,
    );
    assert.throws(
      () => sandbox.resolveSandboxPath(session.root_path, ".snapshots/private"),
      /Snapshot internals/,
    );
  });

  void it("lists, reads, and writes sandbox files without exposing snapshot internals", async () => {
    const session = makeSession("files");
    await mkdir(path.join(session.root_path, ".snapshots", "private"), { recursive: true });

    await sandbox.writeSandboxFile(session, "src/app.txt", "first");
    await sandbox.writeSandboxFile(session, "src/app.txt", " + second", { append: true });

    const file = await sandbox.readSandboxFile(session, "src/app.txt");
    const listing = await sandbox.listSandboxFiles(session, ".");

    assert.equal(file.path, "src/app.txt");
    assert.equal(file.text, "first + second");
    assert.equal(
      listing.entries.some((entry) => entry.name === ".snapshots"),
      false,
    );
    assert.equal(
      listing.entries.some((entry) => entry.name === "src"),
      true,
    );
  });

  void it("filters command environment variables and constrains cwd", async () => {
    const session = makeSession("command-env");
    await sandbox.writeSandboxFile(session, "work/input.txt", "ok");
    const result = await sandbox.runSandboxCommand(session, {
      command: process.execPath,
      args: [
        "-e",
        [
          "console.log(process.cwd())",
          "console.log(process.env.TEMP || 'missing')",
          "console.log(process.env.SECRET_TOKEN || 'missing')",
        ].join(";"),
      ],
      cwd: "work",
      env: { TEMP: "sandbox-temp", SECRET_TOKEN: "hidden" },
      timeoutMs: 2_000,
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.cwd, "work");
    assert.match(result.stdout, /sandbox-temp/);
    assert.match(result.stdout, /missing/);
    assert.doesNotMatch(result.stdout, /hidden/);
    assert.throws(
      () => sandbox.resolveSandboxPath(session.root_path, "../outside"),
      /escapes the sandbox root/,
    );
  });

  void it("times out long-running commands", async () => {
    const session = makeSession("command-timeout");
    await mkdir(session.root_path, { recursive: true });
    const timedOut = await sandbox.runSandboxCommand(session, {
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 5_000)"],
      timeoutMs: 1_000,
    });

    assert.equal(timedOut.timedOut, true);
  });

  void it("builds a real container command for Docker sessions", () => {
    const session = { ...makeSession("docker"), isolation_mode: "docker" as const };
    const args = sandbox.buildSandboxDockerArgs(
      session,
      { env: { TEMP: "sandbox-temp", SECRET_TOKEN: "hidden" } },
      "node",
      ["--version"],
      "work",
      "void-ai-test-container",
    );

    assert.deepEqual(args.slice(0, 12), [
      "run",
      "--rm",
      "--name",
      "void-ai-test-container",
      "--network",
      "none",
      "--cpus",
      "1",
      "--memory",
      "512m",
      "--pids-limit",
      "128",
    ]);
    assert.ok(args.includes("--cap-drop"));
    assert.ok(args.some((value) => value.includes("target=/workspace")));
    assert.ok(args.includes("TEMP=sandbox-temp"));
    assert.equal(
      args.some((value) => value.includes("SECRET_TOKEN")),
      false,
    );
    assert.equal(args.at(-2), "node");
    assert.equal(args.at(-1), "--version");
  });
});

function makeSession(id: string): SandboxSession {
  const now = Date.now();
  return {
    id: "sandbox-" + id,
    conversation_id: "c-" + id,
    run_id: "run-" + id,
    agent_id: "agent-void",
    root_path: path.join(rootPath, id),
    isolation_mode: "local",
    status: "active",
    docker_available: 0,
    created_at: now,
    updated_at: now,
  };
}
