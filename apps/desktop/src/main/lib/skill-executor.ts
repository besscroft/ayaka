import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import type {
  SkillEntryRuntime,
  SkillRunInput,
  SkillRunResult,
  SkillRunRecord,
  WorkspaceCommandResult,
} from "../../shared/types";
import {
  createSkillRunAsync,
  getConversationWorkspace,
  getSkillInspection,
  insertRuntimeEvent,
  markSkillToolRunAsync,
  setSkillPackageStatusAsync,
  updateSkillRunAsync,
} from "./db";
import { createWorkspaceCommandSession, redactWorkspaceCommandInput } from "./workspace-command";
import { managedRuntimeForCommand } from "./runtime-manager";
import { refreshSkillPackageStatus } from "./skill-dependencies";
import {
  isSkillPackageHashCurrent,
  assertSafeSkillRuntimePath,
  resolveSkillScriptPath,
  toSkillRunResult,
  validateSkillRuntimeArgs,
} from "./skill-executor-policy";

export {
  MAX_SKILL_ARGS,
  MAX_SKILL_ARG_LENGTH,
  MAX_SKILL_OUTPUT_BYTES,
  validateSkillArgs,
  validateSkillRuntimeArgs,
} from "./skill-executor-policy";
export { isSkillPackageHashCurrent as isPackageHashCurrent } from "./skill-executor-policy";

const activeRuns = new Map<string, AbortController>();
const runSkills = new Map<string, string>();
const activeRunCompletions = new Map<string, Promise<void>>();
const runListeners = new Set<(run: SkillRunRecord) => void>();

export function onSkillRunUpdated(handler: (run: SkillRunRecord) => void): () => void {
  runListeners.add(handler);
  return () => runListeners.delete(handler);
}

function notifyRun(run: SkillRunRecord | null): void {
  if (!run) return;
  for (const listener of runListeners) listener(run);
}

export async function runSkill(input: SkillRunInput): Promise<SkillRunResult> {
  let inspection: ReturnType<typeof getSkillInspection>;
  try {
    inspection = getSkillInspection(input.skillId);
  } catch (error) {
    reportSkillPreflightFailure(input, error);
    throw error;
  }
  const fail = (error: unknown): never => {
    reportSkillPreflightFailure(input, error, inspection.skill.name);
    throw error instanceof Error ? error : new Error(String(error));
  };
  if (input.cwd !== undefined && input.cwd !== "skill" && input.cwd !== "workspace") {
    return fail(new Error("Skill run cwd must be 'skill' or 'workspace'."));
  }
  if (inspection.skill.enabled === 0) return fail(new Error("Skill is disabled."));
  if (inspection.package) {
    try {
      await refreshSkillPackageStatus(input.skillId);
    } catch (error) {
      return fail(error);
    }
    try {
      inspection = getSkillInspection(input.skillId);
    } catch (error) {
      return fail(error);
    }
  }
  const pkg = inspection.package;
  if (!pkg) return fail(new Error("This Skill does not contain an executable package."));
  if (pkg.status === "disabled")
    return fail(new Error("Enable this Skill before running scripts."));
  if (pkg.status === "needs_confirmation") {
    return fail(new Error("Skill dependencies require confirmation before scripts can run."));
  }
  if (pkg.status !== "ready") {
    return fail(new Error(pkg.lastError || "Skill package is not executable: " + pkg.status + "."));
  }
  if (!isSkillPackageHashCurrent(pkg.rootPath, pkg.contentHash)) {
    await setSkillPackageStatusAsync(
      input.skillId,
      "error",
      "Skill package content changed; review it again.",
    );
    return fail(new Error("Skill package content changed; review it again before running."));
  }

  const entry = inspection.entries.find((candidate) => candidate.id === input.entryId);
  if (!entry) return fail(new Error("Skill entry does not exist."));
  if (!entry.enabled) return fail(new Error("Skill entry is disabled."));
  if (!entry.available)
    return fail(new Error(entry.unavailableReason || "Skill runtime is unavailable."));
  let args: string[];
  try {
    args = validateSkillRuntimeArgs(entry.runtime, input.args);
  } catch (error) {
    return fail(error);
  }
  const runtime = resolveRuntime(entry.runtime);
  if (!runtime.available) {
    await setSkillPackageStatusAsync(input.skillId, "needs_runtime", runtime.reason);
    return fail(new Error(runtime.reason));
  }

  let workspaceRoot: string | null;
  let selectedRoot: string;
  let scriptPath: string;
  try {
    workspaceRoot = input.conversationId ? getWorkspaceRoot(input.conversationId) : null;
    selectedRoot = input.cwd === "skill" ? pkg.rootPath : (workspaceRoot ?? "");
    if (!selectedRoot) throw new Error("A conversation workspace is required for this Skill run.");
    assertDirectory(selectedRoot);
    scriptPath = resolveSkillScriptPath(pkg.rootPath, entry.relativePath);
    assertSafeSkillRuntimePath(entry.runtime, scriptPath);
  } catch (error) {
    return fail(error);
  }

  const run = await createSkillRunAsync({
    skillId: input.skillId,
    entryId: entry.id,
    conversationId: input.conversationId ?? null,
    agentId: input.agentId ?? null,
    cwd: input.cwd === "skill" ? "skill" : "workspace",
    argsJson: JSON.stringify(
      (redactWorkspaceCommandInput({ args }) as { args?: unknown }).args ?? [],
    ),
  });
  const controller = new AbortController();
  activeRuns.set(run.runId, controller);
  runSkills.set(run.runId, input.skillId);
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  activeRunCompletions.set(run.runId, completion);
  const startedAt = Date.now();
  notifyRun(await updateSkillRunAsync(run.runId, { status: "running", startedAt }));
  insertRuntimeEvent({
    kind: "skill",
    title: "Skill script started: " + inspection.skill.name,
    status: "running",
    tool_id: input.skillId,
    conversation_id: input.conversationId,
    agent_id: input.agentId,
    detail: { skillId: input.skillId, entryId: entry.id, runId: run.runId },
  });

  try {
    const command = buildCommand(entry.runtime, scriptPath, args);
    const session = createWorkspaceCommandSession({
      runId: run.runId,
      rootPath: selectedRoot,
    });
    let result: WorkspaceCommandResult;
    try {
      result = await session.execute(
        {
          executable: command.executable,
          args: command.args,
          env: {
            AYAKA_SKILL_ROOT: pkg.rootPath,
            AYAKA_WORKSPACE_ROOT: workspaceRoot ?? pkg.rootPath,
            AYAKA_SKILL_ID: input.skillId,
            AYAKA_SKILL_RUN_ID: run.runId,
          },
          timeoutMs: entry.timeoutMs,
        },
        controller.signal,
        {
          allowedArgumentRoots: [pkg.rootPath, ...(workspaceRoot ? [workspaceRoot] : [])],
          allowedExecutableRoots: command.executableRoot ? [command.executableRoot] : [],
        },
      );
    } finally {
      await session.dispose();
    }
    const final = toSkillRunResult(run.runId, input.skillId, entry.id, result);
    notifyRun(
      await updateSkillRunAsync(run.runId, {
        status: final.status,
        stdout: final.stdout,
        stderr: final.stderr,
        exitCode: final.exitCode,
        signal: final.signal,
        durationMs: final.durationMs,
        truncated: final.truncated,
        error: final.error ?? null,
        finishedAt: Date.now(),
      }),
    );
    await markSkillToolRunAsync(input.skillId);
    insertRuntimeEvent({
      kind: final.status === "succeeded" ? "skill" : "error",
      title: "Skill script " + final.status + ": " + inspection.skill.name,
      status: final.status === "succeeded" ? "succeeded" : "failed",
      tool_id: input.skillId,
      conversation_id: input.conversationId,
      agent_id: input.agentId,
      detail: {
        skillId: input.skillId,
        entryId: entry.id,
        runId: run.runId,
        exitCode: final.exitCode,
        durationMs: final.durationMs,
      },
    });
    return final;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed: SkillRunResult = {
      runId: run.runId,
      skillId: input.skillId,
      entryId: entry.id,
      status: controller.signal.aborted ? "cancelled" : "failed",
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - startedAt,
      truncated: false,
      error: message,
    };
    notifyRun(
      await updateSkillRunAsync(run.runId, {
        status: failed.status,
        durationMs: failed.durationMs,
        error: message,
        finishedAt: Date.now(),
      }),
    );
    insertRuntimeEvent({
      kind: "error",
      title: "Skill script failed: " + inspection.skill.name,
      status: "failed",
      tool_id: input.skillId,
      conversation_id: input.conversationId,
      agent_id: input.agentId,
      detail: { skillId: input.skillId, entryId: entry.id, runId: run.runId, error: message },
    });
    return failed;
  } finally {
    activeRuns.delete(run.runId);
    runSkills.delete(run.runId);
    activeRunCompletions.delete(run.runId);
    resolveCompletion();
  }
}

function reportSkillPreflightFailure(
  input: SkillRunInput,
  error: unknown,
  skillName?: string,
): void {
  const message = error instanceof Error ? error.message : String(error);
  insertRuntimeEvent({
    kind: "error",
    title: "Skill failed" + (skillName ? ": " + skillName : ""),
    status: "failed",
    ...(skillName ? { tool_id: input.skillId } : {}),
    conversation_id: input.conversationId,
    agent_id: input.agentId,
    detail: {
      skillId: input.skillId,
      entryId: input.entryId,
      error: message,
      phase: "preflight",
    },
  });
}

export async function cancelSkillRun(runId: string): Promise<boolean> {
  const controller = activeRuns.get(runId);
  if (!controller) return false;
  controller.abort();
  await activeRunCompletions.get(runId);
  return true;
}

export async function cancelSkillRunsForSkill(skillId: string): Promise<number> {
  let count = 0;
  for (const [runId, owner] of runSkills) {
    if (owner !== skillId) continue;
    if (await cancelSkillRun(runId)) count += 1;
  }
  return count;
}

function getWorkspaceRoot(conversationId: string): string {
  const workspace = getConversationWorkspace(conversationId);
  if (!workspace) throw new Error("Conversation workspace does not exist.");
  return path.resolve(workspace.root_path);
}

function resolveRuntime(runtime: SkillEntryRuntime): { available: boolean; reason: string } {
  if (runtime === "shell") {
    return probeExecutable("sh", "Shell runtime is unavailable.");
  }
  if (runtime === "powershell") {
    return process.platform === "win32"
      ? probeExecutable("powershell.exe", "PowerShell runtime is unavailable.")
      : probeExecutable("pwsh", "PowerShell runtime is unavailable.");
  }
  if (runtime === "cmd") {
    return process.platform === "win32"
      ? probeExecutable("cmd.exe", "CMD runtime is unavailable.")
      : { available: false, reason: "CMD scripts are only available on Windows." };
  }
  if (runtime === "python") {
    if (managedRuntimeForCommand("uv")) return { available: true, reason: "" };
    return probeExecutable(
      process.platform === "win32" ? "python" : "python3",
      "Python runtime is unavailable; install or enable Python.",
    );
  }
  return managedRuntimeForCommand("node")
    ? { available: true, reason: "" }
    : probeExecutable("node", "Node runtime is unavailable; install or enable Node.js.");
}

function probeExecutable(command: string, reason: string): { available: boolean; reason: string } {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    return { available: true, reason: "" };
  } catch {
    return { available: false, reason };
  }
}

function buildCommand(
  runtime: SkillEntryRuntime,
  scriptPath: string,
  args: string[],
): { executable: string; args: string[]; executableRoot?: string } {
  if (runtime === "node") {
    const managed = managedRuntimeForCommand("node");
    return managed
      ? {
          executable: managed.executablePath,
          args: [...managed.argsPrefix, scriptPath, ...args],
          executableRoot: path.dirname(managed.executablePath),
        }
      : { executable: "node", args: [scriptPath, ...args] };
  }
  if (runtime === "python") {
    const managedUv = managedRuntimeForCommand("uv");
    if (managedUv) {
      return {
        executable: managedUv.executablePath,
        args: [...managedUv.argsPrefix, "run", "--no-project", "python", scriptPath, ...args],
        executableRoot: path.dirname(managedUv.executablePath),
      };
    }
    return {
      executable: process.platform === "win32" ? "python" : "python3",
      args: [scriptPath, ...args],
    };
  }
  if (runtime === "powershell") {
    return {
      executable: process.platform === "win32" ? "powershell.exe" : "pwsh",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath,
        ...args,
      ],
    };
  }
  if (runtime === "cmd") {
    return { executable: "cmd.exe", args: ["/d", "/s", "/c", scriptPath, ...args] };
  }
  return { executable: "sh", args: [scriptPath, ...args] };
}

function assertDirectory(value: string): void {
  try {
    if (!statSync(value).isDirectory()) throw new Error();
  } catch {
    throw new Error("Skill run cwd is not a directory.");
  }
}
