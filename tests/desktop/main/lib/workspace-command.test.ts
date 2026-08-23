import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { chmod, copyFile, mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: {
    isPackaged: false,
    getPath: () => process.cwd(),
  },
};
require.cache[electronPath] = electronModule;

let command: typeof import("@desktop-main/lib/workspace-command");
let session: import("@desktop-main/lib/workspace-command").WorkspaceCommandSessionHandle;
let root = "";
let persistedCwds: string[] = [];

before(async () => {
  command = await import("@desktop-main/lib/workspace-command");
});

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ayaka-command-test-"));
  persistedCwds = [];
  session = command.createWorkspaceCommandSession({
    runId: "command-test",
    rootPath: root,
    persistCwd: async (cwd) => {
      persistedCwds.push(cwd);
    },
  });
});

afterEach(async () => {
  await session.dispose();
  await rm(root, { recursive: true, force: true });
});

void describe("workspace command policy", () => {
  void it("classifies read-only, mutating, network, process, and unknown commands", () => {
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "rg", args: ["--files"] }).decision,
      "allow",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "git", args: ["status"] }).risk,
      "read_only",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "rm", args: ["file.txt"] }).risk,
      "destructive",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "pnpm", args: ["install"] }).risk,
      "install",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "curl", args: ["https://example.com"] })
        .risk,
      "network",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "docker", args: ["run", "image"] }).risk,
      "process",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "echo", args: ["hello"] }).risk,
      "unknown",
    );
  });

  void it("rejects shell executable paths, path escapes, and timeout overflow", () => {
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: process.execPath }).decision,
      "deny",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "node", cwd: "../outside" }).decision,
      "deny",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "node", args: ["C:\\outside.txt"] })
        .decision,
      "deny",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({ executable: "node", timeoutMs: 60_001 }).decision,
      "deny",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({
        executable: "node",
        args: ["a; b", "$(whoami)", "x|y"],
      }).decision,
      "require_review",
    );
    assert.equal(
      command.evaluateWorkspaceCommandPolicy({
        executable: "powershell",
        args: ["-Command", "dir"],
      }).risk,
      "unknown",
    );
  });

  void it("redacts sensitive argv values and environment values", () => {
    assert.deepEqual(
      command.redactWorkspaceCommandInput({
        executable: "curl",
        args: ["--token", "secret-value", "--header=Authorization: Bearer abc"],
        env: { API_KEY: "do-not-log", NO_COLOR: "1" },
      }),
      {
        executable: "curl",
        args: ["--token", "[redacted]", "--header=Authorization: [redacted]"],
        env: { API_KEY: "[redacted]", NO_COLOR: "[redacted]" },
      },
    );
  });
});

function nodeCommand(script: string, ...args: string[]): { executable: string; args: string[] } {
  return { executable: "node", args: ["-e", script, "--", ...args] };
}

function execute(
  input: import("@shared/types").WorkspaceCommandInput,
  signal = new AbortController().signal,
): Promise<import("@shared/types").WorkspaceCommandResult> {
  return session.execute(input, signal);
}

void describe("workspace command execution", () => {
  void it("passes argv literally, persists cwd, and keeps env per call", async () => {
    const subdir = path.join(root, "subdir");
    await mkdir(subdir);

    const argvResult = await execute({
      ...nodeCommand(
        "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
        "a;b",
        "$(echo nope)",
        "x|y",
      ),
      cwd: "subdir",
      env: { NODE_ENV: "workspace-only" },
    });
    assert.deepEqual(JSON.parse(argvResult.stdout), ["a;b", "$(echo nope)", "x|y"]);
    assert.equal(argvResult.cwd, "subdir");
    assert.equal(argvResult.outcome, "completed");

    const cwdResult = await execute(nodeCommand("process.stdout.write(process.cwd())"));
    assert.equal(path.normalize(cwdResult.stdout), path.normalize(subdir));

    const envResult = await execute(
      nodeCommand("process.stdout.write(process.env.NODE_ENV || '')"),
    );
    assert.notEqual(envResult.stdout, "workspace-only");
    assert.equal(persistedCwds.at(-1), "subdir");
  });

  void it("runs workspace-relative executables and rejects executable symlink escapes", async (t) => {
    const bin = path.join(root, "bin");
    await mkdir(bin);
    const executableName = process.platform === "win32" ? "ayaka-node.exe" : "ayaka-node";
    const executablePath = path.join(bin, executableName);
    await copyFile(process.execPath, executablePath);
    if (process.platform !== "win32") await chmod(executablePath, 0o755);

    const executable = `./bin/${executableName}`;
    const result = await execute({
      executable,
      args: ["-e", "process.stdout.write('workspace-executable')"],
    });
    assert.equal(result.outcome, "completed");
    assert.equal(result.stdout, "workspace-executable");

    const link = path.join(root, "outside-node");
    try {
      await symlink(process.execPath, link, process.platform === "win32" ? "file" : undefined);
      await assert.rejects(
        () => execute({ executable: "./outside-node" }),
        /escapes the conversation workspace/,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") t.skip("Symlink creation is unavailable.");
      else throw error;
    }
  });

  void it("rejects missing and symlinked workspace directories without persisting them", async (t) => {
    await assert.rejects(
      () => execute({ ...nodeCommand("process.stdout.write('nope')"), cwd: "missing" }),
      /not a directory/,
    );
    assert.deepEqual(persistedCwds, []);

    const outside = await mkdtemp(path.join(tmpdir(), "ayaka-command-outside-"));
    const link = path.join(root, "outside-link");
    try {
      await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
      await assert.rejects(
        () => execute({ ...nodeCommand("process.stdout.write('nope')"), cwd: "outside-link" }),
        /escapes the conversation workspace/,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") t.skip("Symlink creation is unavailable.");
      else throw error;
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  void it("bounds output and reports failed starts", async () => {
    const output = await execute(nodeCommand("process.stdout.write('x'.repeat(70000))"));
    assert.equal(output.stdoutBytes, 70000);
    assert.equal(output.stdoutTruncated, true);
    assert.equal(
      Buffer.byteLength(output.stdout) <= command.MAX_WORKSPACE_COMMAND_OUTPUT_BYTES,
      true,
    );

    const failed = await execute({ executable: "ayaka-command-that-does-not-exist" });
    assert.equal(failed.outcome, "failed_to_start");
    assert.equal(failed.exitCode, null);
  });

  void it("terminates a command on timeout and cancellation", async () => {
    const timedOut = await execute({
      ...nodeCommand("setTimeout(() => {}, 10000)"),
      timeoutMs: 1000,
    });
    assert.equal(timedOut.outcome, "timed_out");
    assert.equal(timedOut.timedOut, true);

    const controller = new AbortController();
    const pending = execute(
      { ...nodeCommand("setTimeout(() => {}, 10000)"), timeoutMs: 60_000 },
      controller.signal,
    );
    setTimeout(() => controller.abort("test cancellation"), 50);
    const cancelled = await pending;
    assert.equal(cancelled.outcome, "cancelled");
    assert.equal(cancelled.aborted, true);
  });
});
