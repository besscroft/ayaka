import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename as fsRename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  LocalExecutionEngine,
  shouldRequireLocalExecutionApproval,
} from "@desktop-main/lib/local-execution-engine";

let root = "";
let outside = "";
let engine: LocalExecutionEngine;
let persistedCwds: string[];
let persistedWorkspaceCwds: string[];

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ayaka-local-execution-"));
  outside = await mkdtemp(path.join(tmpdir(), "ayaka-local-outside-"));
  persistedCwds = [];
  persistedWorkspaceCwds = [];
  engine = new LocalExecutionEngine({
    runId: "local-execution-test",
    workspaceRoot: root,
    cwd: root,
    workspaceCwd: root,
    persistCwd: async (cwd) => {
      persistedCwds.push(cwd);
    },
    persistWorkspaceCwd: async (cwd) => {
      persistedWorkspaceCwds.push(cwd);
    },
  });
});

afterEach(async () => {
  await engine.dispose();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

void describe("local execution engine", () => {
  void it("reads arbitrary UTF-8 paths with line ranges, byte limits, and hashes", async () => {
    const file = path.join(outside, "notes.txt");
    await writeFile(file, "alpha\r\nbeta\r\ngamma\r\n", "utf8");
    const ranged = await engine.readFile({ path: file, startLine: 2, endLine: 3 });
    assert.equal(ranged.ok, true);
    if (!ranged.ok) return;
    assert.equal(ranged.data.content, "beta\r\ngamma\r\n");
    assert.equal(ranged.data.startLine, 2);
    assert.equal(ranged.data.endLine, 3);
    assert.equal(ranged.data.totalLines, 3);
    assert.equal(typeof ranged.data.sha256, "string");

    const limited = await engine.readFile({ path: file, maxBytes: 4 });
    assert.equal(limited.ok, true);
    if (!limited.ok) return;
    assert.equal(limited.data.content, "alph");
    assert.equal(limited.data.truncated, true);
  });

  void it("rejects binary content and missing paths with stable error codes", async () => {
    const binaryPath = path.join(root, "binary.bin");
    await writeFile(binaryPath, Buffer.from([0xff, 0x00, 0x81]));
    const binary = await engine.readFile({ path: binaryPath });
    assert.equal(binary.ok, false);
    if (!binary.ok) assert.equal(binary.error.code, "UNSUPPORTED_ENCODING");
    const missing = await engine.readFile({ path: path.join(root, "missing.txt") });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, "PATH_NOT_FOUND");
  });

  void it("preserves BOM and newline style and rejects stale expected hashes", async () => {
    const target = path.join(root, "settings.txt");
    await writeFile(
      target,
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("old\r\ntext\r\n")]),
    );
    const original = await engine.readFile({ path: target });
    assert.equal(original.ok, true);
    if (!original.ok) return;
    const written = await engine.writeFile({
      path: target,
      content: "new\nvalue\n",
      expectedHash: original.data.sha256,
    });
    assert.equal(written.ok, true);
    const bytes = await readFile(target);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(bytes.subarray(3).toString("utf8"), "new\r\nvalue\r\n");
    const conflict = await engine.writeFile({
      path: target,
      content: "stale",
      expectedHash: original.data.sha256,
    });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.error.code, "HASH_CONFLICT");
  });

  void it("requires unique exact matches unless replaceAll is explicit", async () => {
    const target = path.join(root, "source.txt");
    await writeFile(target, "before\nbefore\n", "utf8");
    const ambiguous = await engine.editFile({ path: target, oldText: "before", newText: "after" });
    assert.equal(ambiguous.ok, false);
    if (!ambiguous.ok) assert.equal(ambiguous.error.code, "MATCH_AMBIGUOUS");
    assert.equal(await readFile(target, "utf8"), "before\nbefore\n");
    const replaced = await engine.editFile({
      path: target,
      oldText: "before",
      newText: "after",
      replaceAll: true,
    });
    assert.equal(replaced.ok, true);
    assert.equal(await readFile(target, "utf8"), "after\nafter\n");
  });

  void it("applies validated multi-file add, update, delete, and move operations", async () => {
    const updatePath = path.join(root, "update.txt");
    const deletePath = path.join(root, "delete.txt");
    const movePath = path.join(root, "move-from.txt");
    await writeFile(updatePath, "first\r\nsecond\r\n", "utf8");
    await writeFile(deletePath, "delete me\n", "utf8");
    await writeFile(movePath, "old name\n", "utf8");
    const result = await engine.applyPatch({
      patch: [
        "*** Begin Patch",
        "*** Add File: added.txt",
        "+created",
        "*** Update File: update.txt",
        "@@ -1,2 +1,2 @@",
        "-first",
        "+FIRST",
        " second",
        "*** Delete File: delete.txt",
        "*** Update File: move-from.txt",
        "*** Move to: move-to.txt",
        "@@ -1 +1 @@",
        "-old name",
        "+new name",
        "*** End Patch",
        "",
      ].join("\n"),
    });
    assert.equal(result.ok, true);
    assert.equal(await readFile(path.join(root, "added.txt"), "utf8"), "created\n");
    assert.equal(await readFile(updatePath, "utf8"), "FIRST\r\nsecond\r\n");
    await assert.rejects(() => readFile(deletePath));
    await assert.rejects(() => readFile(movePath));
    assert.equal(await readFile(path.join(root, "move-to.txt"), "utf8"), "new name\n");
  });

  void it("makes no changes when a later patch context conflicts", async () => {
    const source = path.join(root, "source.txt");
    const added = path.join(root, "would-add.txt");
    await writeFile(source, "current\n", "utf8");
    const result = await engine.applyPatch({
      patch: [
        "*** Begin Patch",
        "*** Add File: would-add.txt",
        "+new file",
        "*** Update File: source.txt",
        "@@ -1 +1 @@",
        "-stale",
        "+updated",
        "*** End Patch",
      ].join("\n"),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "PATCH_CONFLICT");
    assert.equal(await readFile(source, "utf8"), "current\n");
    await assert.rejects(() => readFile(added));
  });

  void it("rolls back files already committed when a later patch rename fails", async () => {
    let commitCount = 0;
    const rollbackEngine = new LocalExecutionEngine({
      runId: "local-execution-rollback-test",
      workspaceRoot: root,
      cwd: root,
      persistCwd: async () => undefined,
      renameForCommit: async (source, destination) => {
        commitCount += 1;
        if (commitCount === 2) {
          const error = Object.assign(new Error("simulated commit failure"), { code: "EIO" });
          throw error;
        }
        await fsRename(source, destination);
      },
    });
    try {
      const result = await rollbackEngine.applyPatch({
        patch: [
          "*** Begin Patch",
          "*** Add File: a-created.txt",
          "+first",
          "*** Add File: b-created.txt",
          "+second",
          "*** End Patch",
        ].join("\n"),
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "PATCH_CONFLICT");
      await assert.rejects(() => readFile(path.join(root, "a-created.txt")));
      await assert.rejects(() => readFile(path.join(root, "b-created.txt")));
    } finally {
      await rollbackEngine.dispose();
    }
  });

  void it("serializes same-path writes and requires review for out-of-workspace targets", async () => {
    const file = path.join(outside, "concurrent.txt");
    await writeFile(file, "start", "utf8");
    const [first, second] = await Promise.all([
      engine.writeFile({ path: file, content: "first" }),
      engine.writeFile({ path: file, content: "second" }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.ok(["first", "second"].includes(await readFile(file, "utf8")));
    const assessment = await engine.assess("local_read_file", { path: file });
    assert.equal(assessment.risk, "sensitive_path");
    assert.equal(assessment.decision, "require_review");
    const secretPath = path.join(root, ".env.local");
    await writeFile(secretPath, "secret", "utf8");
    const secret = await engine.assess("local_read_file", { path: secretPath });
    assert.equal(secret.risk, "sensitive_path");
  });

  void it("executes structured argv and persists the current local directory", async () => {
    const subdir = path.join(root, "subdir");
    await mkdir(subdir);
    const result = await engine.runCommand(
      {
        executable: process.execPath,
        args: [
          "-e",
          "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
          "--",
          "a;b",
          "x|y",
        ],
        cwd: subdir,
      },
      new AbortController().signal,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(JSON.parse(result.data.stdout), ["a;b", "x|y"]);
    assert.equal(result.data.cwd, subdir);
    assert.deepEqual(persistedCwds, [subdir]);
  });

  void it("keeps the compatibility command inside the workspace and persists its relative cwd", async () => {
    const subdir = path.join(root, "compat-subdir");
    await mkdir(subdir);
    const result = await engine.runCommand(
      {
        executable: "node",
        args: ["-e", "process.stdout.write(process.cwd())"],
        cwd: "compat-subdir",
      },
      new AbortController().signal,
      "conversation_workspace",
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.data.stdout, subdir);
    assert.equal(result.data.cwd, "compat-subdir");
    assert.deepEqual(persistedWorkspaceCwds, ["compat-subdir"]);

    const escaped = await engine.runCommand(
      { executable: "node", args: ["-e", ""], cwd: "../outside" },
      new AbortController().signal,
      "conversation_workspace",
    );
    assert.equal(escaped.ok, false);
    if (!escaped.ok) assert.equal(escaped.error.code, "INVALID_INPUT");
  });

  void it("resolves a symlink to its underlying file before editing", async (t) => {
    const realFile = path.join(outside, "real.txt");
    const linkFile = path.join(root, "linked.txt");
    await writeFile(realFile, "before", "utf8");
    try {
      await symlink(realFile, linkFile, process.platform === "win32" ? "file" : undefined);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") {
        t.skip("Symlink creation is unavailable.");
        return;
      }
      throw error;
    }
    const result = await engine.editFile({ path: linkFile, oldText: "before", newText: "after" });
    assert.equal(result.ok, true);
    assert.equal(await readFile(realFile, "utf8"), "after");
    assert.equal(await readFile(linkFile, "utf8"), "after");
  });

  void it("requires review for risky operations even when tool review is disabled", () => {
    const common = {
      reviewAll: false,
      toolRequiresApproval: false,
      toolApprovalRequested: false,
      agentPolicyRequiresApproval: false,
    };
    assert.equal(
      shouldRequireLocalExecutionApproval({
        ...common,
        permissionMode: "approve_risky",
        risk: "read_only",
      }),
      false,
    );
    assert.equal(
      shouldRequireLocalExecutionApproval({
        ...common,
        permissionMode: "approve_risky",
        risk: "write",
      }),
      true,
    );
    assert.equal(
      shouldRequireLocalExecutionApproval({
        ...common,
        permissionMode: "approve_risky",
        risk: "sensitive_path",
      }),
      true,
    );
    assert.equal(
      shouldRequireLocalExecutionApproval({
        ...common,
        permissionMode: "ask",
        risk: "read_only",
      }),
      true,
    );
    assert.equal(
      shouldRequireLocalExecutionApproval({
        ...common,
        permissionMode: "full_access",
        risk: "destructive",
        reviewAll: true,
        toolRequiresApproval: true,
      }),
      false,
    );
  });

  void it("rechecks target hashes when an approval is resumed and before execution", async () => {
    const target = path.join(root, "approval.txt");
    await writeFile(target, "before", "utf8");
    const input = { path: target, oldText: "before", newText: "after" };
    const assessment = await engine.assess("local_edit_file", input);
    assert.equal(
      await engine.resolveToolApproval("approval-changed", assessment, input, true),
      "requested",
    );
    await writeFile(target, "changed before approval response", "utf8");
    assert.equal(
      await engine.resolveToolApproval("approval-changed", assessment, input, true),
      "changed",
    );

    const nextAssessment = await engine.assess("local_edit_file", {
      path: target,
      oldText: "changed",
      newText: "approved",
    });
    const nextInput = { path: target, oldText: "changed", newText: "approved" };
    assert.equal(
      await engine.resolveToolApproval("approval-race", nextAssessment, nextInput, true),
      "requested",
    );
    assert.equal(
      await engine.resolveToolApproval("approval-race", nextAssessment, nextInput, true),
      "approved",
    );
    await writeFile(target, "changed after approval", "utf8");
    assert.equal(
      await engine.validateApprovalBeforeExecution(
        "approval-race",
        nextAssessment,
        nextInput,
        true,
      ),
      false,
    );
    assert.equal(
      await engine.validateApprovalBeforeExecution(
        "missing-snapshot",
        nextAssessment,
        nextInput,
        true,
      ),
      false,
    );
  });

  void it("binds persisted approval snapshots to their input and restores approved state", async () => {
    const target = path.join(root, "approval-restore.txt");
    await writeFile(target, "before", "utf8");
    const snapshots: Record<string, { phase: "pending" | "approved"; fingerprint: string }> = {};
    const originalEngine = new LocalExecutionEngine({
      runId: "local-execution-approval-persistence-test",
      workspaceRoot: root,
      cwd: root,
      persistCwd: async () => undefined,
      persistApprovalSnapshots: async (next) => {
        for (const key of Object.keys(snapshots)) delete snapshots[key];
        Object.assign(snapshots, structuredClone(next));
      },
    });
    const input = { path: target, oldText: "before", newText: "after" };
    const assessment = await originalEngine.assess("local_edit_file", input);
    assert.equal(
      await originalEngine.resolveToolApproval("approval-restored", assessment, input, true),
      "requested",
    );
    assert.equal(
      await originalEngine.resolveToolApproval("approval-restored", assessment, input, true),
      "approved",
    );
    assert.equal(
      await originalEngine.resolveToolApproval("approval-input-mismatch", assessment, input, true),
      "requested",
    );
    assert.equal(
      await originalEngine.resolveToolApproval(
        "approval-input-mismatch",
        assessment,
        { ...input, newText: "different" },
        true,
      ),
      "changed",
    );

    const restoredEngine = new LocalExecutionEngine({
      runId: "local-execution-approval-persistence-test",
      workspaceRoot: root,
      cwd: root,
      persistCwd: async () => undefined,
      approvalSnapshots: structuredClone(snapshots),
      persistApprovalSnapshots: async (next) => {
        for (const key of Object.keys(snapshots)) delete snapshots[key];
        Object.assign(snapshots, structuredClone(next));
      },
    });
    try {
      assert.equal(
        await restoredEngine.validateApprovalBeforeExecution(
          "approval-restored",
          assessment,
          input,
          true,
        ),
        true,
      );
      assert.deepEqual(snapshots, {});
    } finally {
      await restoredEngine.dispose();
      await originalEngine.dispose();
    }
  });
});
