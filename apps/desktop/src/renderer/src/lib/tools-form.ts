import type { McpTransportKind, ToolServerInput, ToolSkillInput } from "@shared/types";

export interface McpFormState {
  name: string;
  description: string;
  transport: McpTransportKind;
  enabled: boolean;
  auto_use: boolean;
  requires_approval: boolean;
  commandLine?: string;
  command: string;
  args: string;
  url: string;
  headers: string;
  env: string;
  cwd: string;
  timeoutSeconds?: string;
}

export interface SkillFormState {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  auto_use: boolean;
  requires_approval: boolean;
  triggerKeywords: string;
  tags: string;
  configSchema: string;
  config: string;
}

export interface SkillPackageDraft {
  name: string;
  description: string;
  instructions: string;
  markdown: string;
  source: "upload" | "ai";
}

export function buildMcpInput(form: McpFormState): ToolServerInput {
  const name = form.name.trim();
  if (!name) throw new Error("Name is required.");
  const commandLine = form.commandLine?.trim() ?? "";
  if (form.transport === "stdio" && !commandLine && !form.command.trim()) {
    throw new Error("Command is required.");
  }
  if (form.transport !== "stdio" && !form.url.trim()) throw new Error("URL is required.");
  const stdio = commandLine
    ? parseCommandLine(commandLine)
    : { command: form.command.trim(), args: parseArray(form.args, "args").map(String) };
  const headers = normalizeObjectText(form.headers, "headers");
  const env = normalizeObjectText(form.env, "env");
  return {
    args: JSON.stringify(stdio.args),
    auto_use: form.auto_use,
    command: form.transport === "stdio" ? stdio.command : null,
    cwd: form.cwd.trim() || null,
    description: form.description.trim(),
    enabled: form.enabled,
    env,
    headers,
    name,
    requires_approval: form.requires_approval,
    timeout_seconds: normalizeTimeoutSeconds(form.timeoutSeconds ?? 60),
    transport: form.transport,
    url: form.url.trim() || null,
  };
}

export function formatMcpEnvironment(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "";
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== "string")) return "";
    return entries.map(([key, value]) => `${key}=${value}`).join("\n");
  } catch {
    return "";
  }
}

export function buildSkillInput(form: SkillFormState): ToolSkillInput {
  const name = form.name.trim();
  if (!name) throw new Error("Name is required.");
  parseArray(form.triggerKeywords, "trigger keywords");
  parseArray(form.tags, "tags");
  parseObject(form.configSchema, "config schema");
  parseObject(form.config, "config");
  return {
    auto_use: form.auto_use,
    category: form.category.trim() || "general",
    config: form.config,
    configSchema: form.configSchema,
    description: form.description.trim(),
    enabled: form.enabled,
    name,
    requires_approval: form.requires_approval,
    tags: form.tags,
    triggerKeywords: form.triggerKeywords,
  };
}

export function parseSkillMarkdown(markdown: string, source: "upload" | "ai"): SkillPackageDraft {
  const normalized = markdown.replace(/^\uFEFF/, "").trim();
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md must start with YAML frontmatter.");
  const meta = parseSkillFrontmatter(match[1] ?? "");
  const instructions = (match[2] ?? "").trim();
  if (!meta.name) throw new Error("SKILL.md frontmatter must include name.");
  if (!meta.description) throw new Error("SKILL.md frontmatter must include description.");
  if (!instructions) throw new Error("SKILL.md body cannot be empty.");
  return {
    name: meta.name,
    description: meta.description,
    instructions,
    markdown: normalized,
    source,
  };
}

export function buildSkillInputFromMarkdown(
  markdown: string,
  source: "upload" | "ai",
): ToolSkillInput {
  const draft = parseSkillMarkdown(markdown, source);
  return {
    auto_use: false,
    category: "skill",
    config: {
      source: draft.source,
      markdown: draft.markdown,
    },
    configSchema: {
      type: "object",
      properties: {
        request: { type: "string", description: "What the skill should accomplish." },
      },
      additionalProperties: true,
    },
    description: draft.description,
    instructions: draft.instructions,
    enabled: true,
    name: draft.name,
    requires_approval: true,
    tags: ["skill", draft.source],
    triggerKeywords: [draft.name],
  };
}

function parseCommandLine(commandLine: string): { command: string; args: string[] } {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index] ?? "";
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Command has an unclosed quote.");
  if (current) parts.push(current);
  if (parts.length === 0) throw new Error("Command is required.");
  return { command: parts[0] ?? "", args: parts.slice(1) };
}

function normalizeObjectText(raw: string, label: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "{}";
  if (trimmed.startsWith("{")) return JSON.stringify(parseObject(trimmed, label));
  const entries: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean) continue;
    const separator = clean.indexOf("=");
    if (separator <= 0) throw new Error(label + " lines must use KEY=value format.");
    const key = clean.slice(0, separator).trim();
    const value = clean.slice(separator + 1).trim();
    if (!key) throw new Error(label + " keys cannot be empty.");
    entries[key] = value;
  }
  return JSON.stringify(entries);
}

function normalizeTimeoutSeconds(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error("Timeout must be a number.");
  if (parsed < 1 || parsed > 600) throw new Error("Timeout must be between 1 and 600 seconds.");
  return Math.round(parsed);
}

function parseSkillFrontmatter(raw: string): { name: string; description: string } {
  const values: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key === "name" || key === "description") values[key] = unquoteYamlString(value);
  }
  return {
    name: values.name?.trim() ?? "",
    description: values.description?.trim() ?? "",
  };
}

function unquoteYamlString(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value.trim();
}

function parseArray(raw: string, label: string): unknown[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through.
  }
  throw new Error(label + " must be a JSON array.");
}

function parseObject(raw: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through.
  }
  throw new Error(label + " must be a JSON object.");
}
