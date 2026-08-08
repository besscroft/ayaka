import { app } from "electron";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_AGENT_ID } from "../../shared/types";

const AGENT_MEMORIES_DIRNAME = "agent-memories";
const SOUL_FILE_NAME = "SOUL.md.enc";

let invalidateSoulCache: ((agentId: string) => void) | null = null;

export interface AgentSoulFilePaths {
  primary: string;
  backup: string;
}

export function registerSoulCacheInvalidator(invalidator: (agentId: string) => void): void {
  invalidateSoulCache = invalidator;
}

export function resolveAgentMemoriesRoot(): string {
  const userDataDir = process.env.VOID_AI_USER_DATA_DIR || app.getPath("userData");
  return join(userDataDir, "data", AGENT_MEMORIES_DIRNAME);
}

export function resolveAgentSoulFilePaths(agentId: string): AgentSoulFilePaths {
  const root = resolveAgentMemoriesRoot();
  const primary = join(root, "agents", safePathPart(agentId), SOUL_FILE_NAME);
  return { primary, backup: `${primary}.bak` };
}

export function ensureAgentSoulDirectory(agentId: string): string {
  const directory = join(resolveAgentMemoriesRoot(), "agents", safePathPart(agentId));
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  return directory;
}

export function removeAgentSoulFiles(agentId: string): void {
  const paths = resolveAgentSoulFilePaths(agentId);
  let firstError: unknown = null;

  for (const path of [paths.primary, paths.backup]) {
    if (!existsSync(path)) continue;
    try {
      unlinkSync(path);
    } catch (error) {
      if (isMissingFileError(error)) continue;
      firstError ??= error;
    }
  }

  try {
    invalidateSoulCache?.(agentId);
  } finally {
    if (firstError) throw firstError;
  }
}

function safePathPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 120) || DEFAULT_AGENT_ID;
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
