import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { WorkspaceCommandResult } from "@shared/types";
import {
  MAX_SKILL_ARG_LENGTH,
  MAX_SKILL_ARGS,
  MAX_SKILL_OUTPUT_BYTES,
  resolveSkillScriptPath,
  isSkillPackageHashCurrent,
  toSkillRunResult,
  validateSkillArgs,
  validateSkillRuntimeArgs,
} from "@desktop-main/lib/skill-executor-policy";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ayaka-skill-executor-policy-"));
  await mkdir(path.join(root, "scripts"));
  await writeFile(path.join(root, "scripts", "run.js"), "console.log('ok')", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function commandResult(patch: Partial<WorkspaceCommandResult> = {}): WorkspaceCommandResult {
  return {
    executable: "node",
    args: ["script.js"],
    cwd: ".",
    outcome: "completed",
    risk: "write",
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    stdout: "ok",
    stderr: "",
    stdoutBytes: 2,
    stderrBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 12,
    ...patch,
  };
}

void describe("Skill executor policy", () => {
  void it("validates structured argv without shell text", () => {
    assert.deepEqual(validateSkillArgs(["--name", "a value"]), ["--name", "a value"]);
    assert.throws(() => validateSkillArgs(["--name", 42]), /strings/);
    assert.throws(() => validateSkillArgs(new Array(MAX_SKILL_ARGS + 1).fill("x")), /at most/);
    assert.throws(() => validateSkillArgs(["x\0y"]), /NUL/);
    assert.throws(() => validateSkillArgs(["x".repeat(MAX_SKILL_ARG_LENGTH + 1)]), /length/);
    assert.deepEqual(validateSkillRuntimeArgs("cmd", ["safe value"]), ["safe value"]);
    assert.throws(() => validateSkillRuntimeArgs("cmd", ["safe & unsafe"]), /metacharacters/);
    assert.deepEqual(validateSkillRuntimeArgs("node", ["safe & value"]), ["safe & value"]);
  });

  void it("confines entries to regular files inside the package", async () => {
    assert.equal(
      resolveSkillScriptPath(root, "scripts/run.js"),
      path.join(root, "scripts", "run.js"),
    );
    assert.throws(() => resolveSkillScriptPath(root, "../outside.js"), /escapes/);
    await symlink(path.join(root, "scripts", "run.js"), path.join(root, "scripts", "link.js"));
    assert.throws(() => resolveSkillScriptPath(root, "scripts/link.js"), /regular file/);
  });

  void it("maps process outcomes and bounds returned output", () => {
    const result = toSkillRunResult(
      "run-1",
      "skill-1",
      "entry-1",
      commandResult({
        stdout: "x".repeat(MAX_SKILL_OUTPUT_BYTES + 10),
        stdoutTruncated: true,
      }),
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.stdout.length, MAX_SKILL_OUTPUT_BYTES);
    assert.equal(result.truncated, true);
    assert.equal(
      toSkillRunResult("run-2", "skill-1", "entry-1", commandResult({ exitCode: 2 })).status,
      "failed",
    );
    assert.equal(
      toSkillRunResult(
        "run-3",
        "skill-1",
        "entry-1",
        commandResult({ outcome: "timed_out", timedOut: true, exitCode: null }),
      ).status,
      "timed_out",
    );
    assert.equal(
      toSkillRunResult(
        "run-4",
        "skill-1",
        "entry-1",
        commandResult({ outcome: "cancelled", aborted: true, exitCode: null }),
      ).status,
      "cancelled",
    );
  });

  void it("detects package content changes and symlink materialization", async () => {
    const file = path.join(root, "scripts", "run.js");
    const hash = createHash("sha256");
    hash.update("scripts/run.js");
    hash.update(await readFile(file));
    const expected = hash.digest("hex");
    assert.equal(isSkillPackageHashCurrent(root, expected), true);
    await writeFile(file, "changed", "utf8");
    assert.equal(isSkillPackageHashCurrent(root, expected), false);
    await symlink(file, path.join(root, "scripts", "link.js"));
    assert.equal(isSkillPackageHashCurrent(root, "anything"), false);
  });
});
