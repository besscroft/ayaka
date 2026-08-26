import { unzipSync } from "fflate";
import { execFileSync } from "node:child_process";
import type {
  JsonObject,
  SkillDependencyStatus,
  SkillEntryRuntime,
  SkillExecutionMode,
} from "../../shared/types";

const SCRIPT_EXTENSIONS: Record<string, SkillEntryRuntime> = {
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".py": "python",
  ".ps1": "powershell",
  ".cmd": "cmd",
  ".bat": "cmd",
  ".sh": "shell",
};

export interface InspectedSkillArchive {
  files: Record<string, Uint8Array>;
  totalBytes: number;
  markdown: string;
  name: string;
  description: string;
  executionMode: SkillExecutionMode;
  scripts: InspectedSkillScript[];
  dependencies: SkillDependencyStatus[];
  manifest: JsonObject;
}

export interface InspectedSkillScript {
  relativePath: string;
  name: string;
  runtime: SkillEntryRuntime;
  available: boolean;
  unavailableReason?: string;
}

export interface TextSkillFile {
  path: string;
  contents: string;
}

export function inspectSkillArchive(bytes: Uint8Array): InspectedSkillArchive {
  const archive = unzipSync(bytes);
  const entries = Object.entries(archive).filter(([, data]) => data.length > 0);
  if (entries.length > 500) throw new Error("Skill archive contains too many files.");
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  const skillEntry = entries.find(([path]) => /(^|\/)SKILL\.md$/i.test(path));
  if (!skillEntry) throw new Error("Skill archive does not contain SKILL.md.");
  const rootPrefix = skillEntry[0].slice(0, -"SKILL.md".length);
  for (const [archivePath, data] of entries) {
    if (rootPrefix && !archivePath.startsWith(rootPrefix)) continue;
    const relativePath = archivePath.slice(rootPrefix.length).replace(/\\/g, "/");
    validateArchivePath(relativePath);
    totalBytes += data.byteLength;
    if (totalBytes > 20 * 1024 * 1024) throw new Error("Expanded skill exceeds 20 MB.");
    files[relativePath] = data;
  }
  const skillFile = findSkillFile(files);
  files["SKILL.md"] = files[skillFile]!;
  if (skillFile !== "SKILL.md") delete files[skillFile];
  const markdown = new TextDecoder().decode(files["SKILL.md"]);
  const frontmatter = parseSkillFrontmatter(markdown);
  return inspectSkillMetadata(files, markdown, frontmatter);
}

export function inspectSkillFiles(entries: TextSkillFile[]): InspectedSkillArchive {
  if (entries.length > 500) throw new Error("Skill package contains too many files.");
  const files: Record<string, Uint8Array> = {};
  let totalBytes = 0;
  for (const entry of entries) {
    validateArchivePath(entry.path);
    const data = new TextEncoder().encode(entry.contents);
    totalBytes += data.byteLength;
    if (totalBytes > 20 * 1024 * 1024) throw new Error("Expanded skill exceeds 20 MB.");
    files[entry.path] = data;
  }
  const skillPath = Object.keys(files).find((path) => /(^|\/)SKILL\.md$/i.test(path));
  if (!skillPath) throw new Error("Skill package does not contain SKILL.md.");
  const rootPrefix = skillPath.slice(0, -"SKILL.md".length);
  const rootedFiles = Object.fromEntries(
    Object.entries(files)
      .filter(([path]) => !rootPrefix || path.startsWith(rootPrefix))
      .map(([path, data]) => [path.slice(rootPrefix.length), data]),
  );
  const normalizedSkillPath = Object.keys(rootedFiles).find((path) => /^SKILL\.md$/i.test(path));
  if (!normalizedSkillPath) throw new Error("Skill package does not contain SKILL.md.");
  rootedFiles["SKILL.md"] = rootedFiles[normalizedSkillPath]!;
  if (normalizedSkillPath !== "SKILL.md") delete rootedFiles[normalizedSkillPath];
  const markdown = new TextDecoder().decode(rootedFiles["SKILL.md"]);
  const frontmatter = parseSkillFrontmatter(markdown);
  return inspectSkillMetadata(rootedFiles, markdown, frontmatter);
}

export function validateArchivePath(path: string): void {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (
    !path ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    segments.includes("..") ||
    segments.includes("")
  ) {
    throw new Error(`Unsafe archive path: ${path}`);
  }
}

export function parseSkillFrontmatter(markdown: string): {
  name: string;
  description: string;
} {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) throw new Error("SKILL.md must begin with YAML frontmatter.");
  const fields = Object.fromEntries(
    match[1]!
      .split(/\r?\n/)
      .map((line) => /^([A-Za-z][A-Za-z0-9_-]*):\s*["']?(.*?)["']?\s*$/.exec(line))
      .filter((item): item is RegExpExecArray => item !== null)
      .map((item) => [item[1]!, item[2]!]),
  );
  const name = fields.name?.trim();
  if (!name) throw new Error("Skill frontmatter name is required.");
  return {
    name: name.slice(0, 160),
    description: (fields.description?.trim() || "Installed skill").slice(0, 1_000),
  };
}

function findSkillFile(files: Record<string, Uint8Array>): string {
  const path = Object.keys(files).find((item) => /^SKILL\.md$/i.test(item));
  if (!path) throw new Error("Skill archive does not contain SKILL.md.");
  return path;
}

function inspectSkillMetadata(
  files: Record<string, Uint8Array>,
  markdown: string,
  frontmatter: { name: string; description: string },
): InspectedSkillArchive {
  const scripts = Object.keys(files)
    .filter((path) => path.startsWith("scripts/") && path.split("/").length > 1)
    .map((relativePath) => inspectScript(relativePath))
    .filter((entry): entry is InspectedSkillScript => entry !== null);
  const manifest = parseSkillManifest(files["agents/openai.yaml"]);
  const dependencies = parseSkillDependencies(manifest, frontmatter.name);
  return {
    files,
    totalBytes: Object.values(files).reduce((sum, data) => sum + data.byteLength, 0),
    markdown,
    ...frontmatter,
    executionMode:
      scripts.length === 0
        ? "instructions"
        : hasSkillInstructionBody(markdown)
          ? "hybrid"
          : "scripts",
    scripts,
    dependencies,
    manifest,
  };
}

function inspectScript(relativePath: string): InspectedSkillScript | null {
  const lastDot = relativePath.lastIndexOf(".");
  if (lastDot < 0) return null;
  const extension = relativePath.slice(lastDot).toLowerCase();
  const runtime = SCRIPT_EXTENSIONS[extension];
  if (!runtime) return null;
  const available =
    runtime === "shell"
      ? canRunExecutable("sh")
      : runtime === "cmd"
        ? process.platform === "win32"
        : true;
  return {
    relativePath,
    name: relativePath.slice("scripts/".length),
    runtime,
    available,
    unavailableReason: available
      ? undefined
      : runtime === "cmd"
        ? "CMD scripts are only available on Windows."
        : "Shell runtime is unavailable on this device.",
  };
}

function hasSkillInstructionBody(markdown: string): boolean {
  return markdown.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, "").trim().length > 0;
}

function canRunExecutable(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function parseSkillManifest(raw: Uint8Array | undefined): JsonObject {
  if (!raw) return {};
  const text = new TextDecoder().decode(raw);
  const result: JsonObject = {};
  const allowImplicit = /^\s*allow_implicit_invocation:\s*(true|false)\s*$/m.exec(text);
  if (allowImplicit) result.allowImplicitInvocation = allowImplicit[1] === "true";
  const autoUse = /^\s*auto_use:\s*(true|false)\s*$/m.exec(text);
  if (autoUse) result.allowImplicitInvocation = autoUse[1] === "true";
  const keywords = /^\s*trigger_keywords:\s*\[(.*?)\]\s*$/m.exec(text);
  if (keywords) {
    result.triggerKeywords = keywords[1]!
      .split(",")
      .map((value) => value.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const lines = text.split(/\r?\n/);
  const dependencies: JsonObject[] = [];
  let current: JsonObject | null = null;
  let inDependencies = false;
  for (const line of lines) {
    if (/^\s*dependencies\s*:\s*$/.test(line)) {
      inDependencies = true;
      current = null;
      continue;
    }
    if (inDependencies && /^\S/.test(line) && !/^dependencies\s*:/.test(line)) {
      inDependencies = false;
      current = null;
    }
    if (!inDependencies) continue;
    const item = /^\s*-\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (item) {
      current = {};
      current[item[1]!] = parseYamlScalar(item[2]!);
      dependencies.push(current);
      continue;
    }
    const field = /^\s+([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
    if (field && current) current[field[1]!] = parseYamlScalar(field[2]!);
  }
  if (dependencies.length > 0) result.dependencies = dependencies;
  return result;
}

function parseYamlScalar(value: string): string | boolean {
  const normalized = value.trim().replace(/^['"]|['"]$/g, "");
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return normalized;
}

function parseSkillDependencies(manifest: JsonObject, skillName: string): SkillDependencyStatus[] {
  const dependencies = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
  return dependencies.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const type =
      item.type === "browser" || item.kind === "browser"
        ? "browser"
        : item.type === "runtime" || item.kind === "runtime"
          ? "runtime"
          : item.type === "mcp" || item.kind === "mcp"
            ? "mcp"
            : null;
    if (!type) return [];
    const value =
      typeof item.value === "string"
        ? item.value
        : typeof item.name === "string"
          ? item.name
          : skillName + "-" + (index + 1);
    return [
      {
        id: `dependency-${index + 1}`,
        skillId: "",
        kind: type,
        name: value,
        status: type === "runtime" ? ("needs_runtime" as const) : ("needs_confirmation" as const),
        source:
          typeof item.url === "string"
            ? item.url
            : typeof item.source === "string"
              ? item.source
              : undefined,
        detail: typeof item.description === "string" ? item.description : undefined,
      },
    ];
  });
}
