import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, type Dirent } from "node:fs";
import path from "node:path";
import type { SkillEntryRuntime, SkillRunResult, WorkspaceCommandResult } from "../../shared/types";

export const MAX_SKILL_ARGS = 40;
export const MAX_SKILL_ARG_LENGTH = 4_096;
export const MAX_SKILL_OUTPUT_BYTES = 64 * 1024;

export function validateSkillArgs(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_SKILL_ARGS) {
    throw new Error("Skill arguments must contain at most " + MAX_SKILL_ARGS + " values.");
  }
  return raw.map((value) => {
    if (typeof value !== "string" || value.length > MAX_SKILL_ARG_LENGTH || value.includes("\0")) {
      throw new Error(
        "Skill arguments must be strings without NUL characters and within length limits.",
      );
    }
    return value;
  });
}

/**
 * CMD/BAT files are launched through cmd.exe even when Node itself uses
 * shell:false. Reject metacharacters so a structured argument cannot become
 * a second command in cmd.exe's /c command line.
 */
export function validateSkillRuntimeArgs(runtime: SkillEntryRuntime, raw: unknown): string[] {
  const args = validateSkillArgs(raw);
  if (runtime === "cmd" && args.some((value) => /[&|<>^()%!"\r\n]/.test(value))) {
    throw new Error("CMD/BAT arguments cannot contain shell metacharacters.");
  }
  return args;
}

export function assertSafeSkillRuntimePath(runtime: SkillEntryRuntime, scriptPath: string): void {
  if (runtime === "cmd" && /[&|<>^()%!"\r\n]/.test(scriptPath)) {
    throw new Error("CMD/BAT Skill paths cannot contain shell metacharacters.");
  }
}

export function resolveSkillScriptPath(packageRoot: string, relativePath: string): string {
  const scriptPath = path.resolve(packageRoot, relativePath);
  const relative = path.relative(path.resolve(packageRoot), scriptPath);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Skill path escapes the installed package.");
  }
  try {
    if (!lstatSync(scriptPath).isFile()) throw new Error();
  } catch {
    throw new Error("Skill entry is not a regular file.");
  }
  return scriptPath;
}

export function toSkillRunResult(
  runId: string,
  skillId: string,
  entryId: string,
  result: WorkspaceCommandResult,
): SkillRunResult {
  const status =
    result.outcome === "cancelled"
      ? "cancelled"
      : result.outcome === "timed_out"
        ? "timed_out"
        : result.outcome === "completed" && result.exitCode === 0
          ? "succeeded"
          : "failed";
  const truncated =
    result.stdoutTruncated ||
    result.stderrTruncated ||
    result.stdout.length > MAX_SKILL_OUTPUT_BYTES ||
    result.stderr.length > MAX_SKILL_OUTPUT_BYTES;
  return {
    runId,
    skillId,
    entryId,
    status,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout.slice(-MAX_SKILL_OUTPUT_BYTES),
    stderr: result.stderr.slice(-MAX_SKILL_OUTPUT_BYTES),
    durationMs: result.durationMs,
    truncated,
    ...(result.error ? { error: result.error } : {}),
  };
}

export function isSkillPackageHashCurrent(root: string, expected: string): boolean {
  try {
    const hash = createHash("sha256");
    const files: string[] = [];
    collectFiles(path.resolve(root), files);
    for (const file of files.sort()) {
      hash.update(path.relative(path.resolve(root), file).split(path.sep).join("/"));
      hash.update(readFileSync(file));
    }
    return hash.digest("hex") === expected;
  } catch {
    return false;
  }
}

function collectFiles(current: string, files: string[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true }) as Dirent[]) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Skill packages cannot contain symbolic links.");
    if (entry.isDirectory()) collectFiles(full, files);
    else if (entry.isFile()) files.push(full);
  }
}
