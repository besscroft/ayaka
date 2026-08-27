import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { SkillPackage, ToolSkill } from "../../shared/types";
import { isSkillPackageHashCurrent } from "./skill-executor-policy";

export const MAX_SKILL_RESOURCE_BYTES = 256 * 1024;
const MAX_SKILL_RESOURCE_PATH_LENGTH = 1_024;

const ALLOWED_SKILL_RESOURCE_EXTENSIONS = new Set([
  ".csv",
  ".json",
  ".md",
  ".mdx",
  ".toml",
  ".txt",
  ".yaml",
  ".yml",
]);

export interface SkillResourceReadInput {
  skill: ToolSkill;
  packageInfo: SkillPackage | null;
  relativePath: string;
}

export interface SkillResourceReadResult {
  skillId: string;
  name: string;
  path: string;
  bytes: number;
  content: string;
}

/**
 * Read one documentation resource from an installed Skill without exposing
 * arbitrary filesystem access to the model.
 */
export function readSkillResourceFile({
  skill,
  packageInfo,
  relativePath,
}: SkillResourceReadInput): SkillResourceReadResult {
  if (skill.enabled === 0) throw new Error("Skill is disabled: " + skill.name);

  const normalizedPath = normalizeRelativePath(relativePath);
  const extension = path.posix.extname(normalizedPath).toLowerCase();
  if (!ALLOWED_SKILL_RESOURCE_EXTENSIONS.has(extension)) {
    throw new Error("Skill resource must be a supported documentation text file.");
  }

  const rootPath = resolveSkillRoot(skill, packageInfo);
  if (packageInfo && !isSkillPackageHashCurrent(packageInfo.rootPath, packageInfo.contentHash)) {
    throw new Error("Skill package content changed; review it again.");
  }

  const realRoot = resolveDirectory(rootPath);
  const candidate = path.resolve(realRoot, ...normalizedPath.split("/"));
  assertContained(realRoot, candidate);

  const realCandidate = resolveFile(candidate, normalizedPath);
  assertContained(realRoot, realCandidate);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(realCandidate);
  } catch {
    throw new Error("Skill resource is no longer available: " + normalizedPath);
  }
  if (!stat.isFile()) throw new Error("Skill resource is not a regular file.");
  if (stat.size > MAX_SKILL_RESOURCE_BYTES) {
    throw new Error(
      `Skill resource is too large; the maximum size is ${MAX_SKILL_RESOURCE_BYTES} bytes.`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = readFileSync(realCandidate);
  } catch {
    throw new Error("Skill resource could not be read: " + normalizedPath);
  }
  if (buffer.length > MAX_SKILL_RESOURCE_BYTES) {
    throw new Error(
      `Skill resource is too large; the maximum size is ${MAX_SKILL_RESOURCE_BYTES} bytes.`,
    );
  }
  if (buffer.includes(0)) throw new Error("Skill resource must be UTF-8 text.");

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("Skill resource must be valid UTF-8 text.");
  }

  return {
    skillId: skill.id,
    name: skill.name,
    path: normalizedPath,
    bytes: buffer.length,
    content,
  };
}

function resolveSkillRoot(skill: ToolSkill, packageInfo: SkillPackage | null): string {
  if (packageInfo) return packageInfo.rootPath;
  const config = parseJsonObject(skill.config_json);
  const installPath = config.installPath;
  if (typeof installPath === "string" && installPath.trim()) return installPath;
  throw new Error("Skill has no installed package resources.");
}

function normalizeRelativePath(raw: string): string {
  if (typeof raw !== "string" || !raw.trim() || containsControlCharacter(raw)) {
    throw new Error("Skill resource path must be a non-empty relative path.");
  }
  const normalized = raw.trim().replaceAll("\\", "/");
  if (normalized.length > MAX_SKILL_RESOURCE_PATH_LENGTH) {
    throw new Error("Skill resource path is too long.");
  }
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("Skill resource path must stay inside the installed package.");
  }
  if (normalized === "." || normalized.split("/").some((segment) => segment === ".")) {
    throw new Error("Skill resource path must identify a package file.");
  }
  return normalized;
}

function resolveDirectory(rootPath: string): string {
  try {
    const realRoot = realpathSync(rootPath);
    if (!lstatSync(realRoot).isDirectory()) throw new Error();
    return realRoot;
  } catch {
    throw new Error("Skill package directory is unavailable.");
  }
}

function resolveFile(candidate: string, displayPath: string): string {
  try {
    return realpathSync(candidate);
  } catch {
    throw new Error("Skill resource was not found: " + displayPath);
  }
}

function assertContained(rootPath: string, targetPath: string): void {
  const relative = path.relative(rootPath, targetPath);
  if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new Error("Skill resource path escapes the installed package.");
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
