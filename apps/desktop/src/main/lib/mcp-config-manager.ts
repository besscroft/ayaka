import { randomUUID } from "node:crypto";
import type {
  McpConfigFormat,
  McpConfigImportPreview,
  McpConfigImportResult,
  McpServerConfig,
  ToolServer,
} from "../../shared/types";
import {
  createToolServerAsync,
  listMcpServers,
  setToolSecretAsync,
  updateToolServerAsync,
} from "./db";

const PREVIEW_TTL_MS = 10 * 60 * 1_000;
const previews = new Map<
  string,
  { expiresAt: number; configs: McpServerConfig[]; format: McpConfigFormat; warnings: string[] }
>();

export function previewMcpConfigImport(input: {
  format: McpConfigFormat;
  text: string;
}): McpConfigImportPreview {
  const parsed = parseMcpConfig(input.format, input.text);
  const existing = listMcpServers();
  const warnings = [...parsed.warnings];
  const token = randomUUID();
  const expiresAt = Date.now() + PREVIEW_TTL_MS;
  previews.set(token, { expiresAt, configs: parsed.configs, format: input.format, warnings });
  for (const [key, value] of previews) if (value.expiresAt < Date.now()) previews.delete(key);
  return {
    token,
    format: input.format,
    expiresAt,
    servers: parsed.configs.map((config, index) => {
      const conflict = existing.find(
        (server) => server.name.trim().toLowerCase() === config.name.trim().toLowerCase(),
      );
      return {
        id: config.id ?? `import-${index + 1}`,
        name: config.name,
        transport: config.transport,
        command: config.command ?? null,
        url: config.url ?? null,
        envKeys: Object.keys(config.env ?? {}),
        headerKeys: Object.keys(config.headers ?? {}),
        conflictServerId: conflict?.id ?? null,
        diffs: conflict ? describeConfigDiff(config, conflict) : [],
        warnings: conflict
          ? [
              `A server named ${config.name} already exists; review the configuration before updating it.`,
            ]
          : [],
      };
    }),
    warnings,
  };
}

function describeConfigDiff(config: McpServerConfig, existing: ToolServer): string[] {
  const diffs: string[] = [];
  if (config.transport !== existing.transport) diffs.push("transport");
  if ((config.command ?? null) !== (existing.command ?? null)) diffs.push("command");
  if (JSON.stringify(config.args ?? []) !== JSON.stringify(jsonArray(existing.args_json)))
    diffs.push("args");
  if ((config.url ?? null) !== (existing.url ?? null)) diffs.push("url");
  if ((config.cwd ?? null) !== (existing.cwd ?? null)) diffs.push("cwd");
  if ((config.timeoutSeconds ?? 60) !== existing.timeout_seconds) diffs.push("timeout");
  if (!sameKeys(config.env ?? {}, jsonRecord(existing.env_json))) diffs.push("env");
  if (!sameKeys(config.headers ?? {}, jsonRecord(existing.headers_json))) diffs.push("headers");
  if ((config.requiresApproval ?? true) !== (existing.requires_approval !== 0))
    diffs.push("approval");
  return diffs;
}

function sameKeys(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return JSON.stringify(leftKeys) === JSON.stringify(rightKeys);
}

export async function applyMcpConfigImport(
  token: string,
  options: { confirmConflicts?: boolean } = {},
): Promise<McpConfigImportResult> {
  const preview = previews.get(token);
  if (!preview || preview.expiresAt < Date.now())
    throw new Error("MCP import preview expired. Preview the file again.");
  previews.delete(token);
  const existing = listMcpServers();
  const created: string[] = [];
  const updated: string[] = [];
  const warnings = [...preview.warnings];
  for (const config of preview.configs) {
    const conflict = existing.find(
      (server) => server.name.trim().toLowerCase() === config.name.trim().toLowerCase(),
    );
    if (conflict && options.confirmConflicts !== true) {
      warnings.push(
        `Skipped conflicting MCP server ${config.name}; confirm the import to update it.`,
      );
      continue;
    }
    const prepared = prepareImportedConfig(config);
    if (conflict) {
      const server = await updateToolServerAsync(conflict.id, {
        ...prepared.input,
        enabled: false,
        config_source: "import",
      });
      await saveImportedSecrets(server.id, prepared.secrets);
      updated.push(server.id);
    } else {
      const server = await createToolServerAsync({
        ...prepared.input,
        enabled: false,
        config_source: "import",
      });
      await saveImportedSecrets(server.id, prepared.secrets);
      created.push(server.id);
    }
  }
  return { created, updated, warnings };
}

export function exportMcpConfig(format: McpConfigFormat): string {
  const servers = listMcpServers();
  return format === "claude-json" ? exportClaudeJson(servers) : exportCodexToml(servers);
}

export function parseMcpConfigText(
  format: McpConfigFormat,
  text: string,
): { configs: McpServerConfig[]; warnings: string[] } {
  if (format === "claude-json") return parseClaudeJson(text);
  return parseCodexToml(text);
}

function parseMcpConfig(
  format: McpConfigFormat,
  text: string,
): { configs: McpServerConfig[]; warnings: string[] } {
  return parseMcpConfigText(format, text);
}

function parseClaudeJson(text: string): { configs: McpServerConfig[]; warnings: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Claude MCP configuration must be valid JSON.");
  }
  const root = asRecord(value);
  const source = asRecord(root.mcpServers ?? root.mcp_servers);
  if (Object.keys(source).length === 0)
    throw new Error("Claude MCP configuration has no mcpServers entries.");
  const warnings: string[] = [];
  const configs = Object.entries(source).map(([name, raw]) =>
    normalizeImportedConfig(name, asRecord(raw), warnings),
  );
  for (const key of Object.keys(root))
    if (key !== "mcpServers" && key !== "mcp_servers")
      warnings.push(`Ignored unsupported top-level field: ${key}.`);
  return { configs, warnings };
}

function parseCodexToml(text: string): { configs: McpServerConfig[]; warnings: string[] } {
  const warnings: string[] = [];
  const sections = new Map<string, Record<string, unknown>>();
  let current: Record<string, unknown> | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const section = line.match(/^\[mcp_servers\.(?:"([^"]+)"|'([^']+)'|([^\]]+))\]$/);
    if (section) {
      const currentName = section[1] ?? section[2] ?? section[3]!.trim();
      current = {};
      sections.set(currentName, current);
      continue;
    }
    if (!current) {
      warnings.push(`Ignored TOML line outside mcp_servers: ${rawLine.trim()}.`);
      continue;
    }
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(.+)$/);
    if (!assignment) {
      warnings.push(`Ignored unsupported TOML line: ${rawLine.trim()}.`);
      continue;
    }
    current[assignment[1]] = parseTomlValue(assignment[2], warnings);
  }
  if (sections.size === 0)
    throw new Error("Codex TOML configuration has no [mcp_servers.<name>] entries.");
  const configs = [...sections.entries()].map(([name, raw]) =>
    normalizeImportedConfig(name, raw, warnings),
  );
  return { configs, warnings };
}

function normalizeImportedConfig(
  name: string,
  raw: Record<string, unknown>,
  warnings: string[],
): McpServerConfig {
  const command = stringValue(raw.command);
  const url = stringValue(raw.url) ?? stringValue(raw.endpoint);
  const headers = recordValue(raw.headers ?? raw.http_headers);
  const env = recordValue(raw.env);
  const args = arrayValue(raw.args);
  const transport = url && !command ? "http" : "stdio";
  const approval = raw.requires_approval ?? raw.requiresApproval ?? raw.approval;
  for (const key of Object.keys(raw)) {
    if (
      ![
        "command",
        "args",
        "env",
        "url",
        "endpoint",
        "headers",
        "http_headers",
        "cwd",
        "timeout",
        "timeout_seconds",
        "startup_timeout_sec",
        "tool_timeout_sec",
        "enabled",
        "disabled",
        "requires_approval",
        "requiresApproval",
        "approval",
      ].includes(key)
    ) {
      warnings.push(`Ignored unsupported field ${name}.${key}.`);
    }
  }
  if (transport === "stdio" && !command)
    throw new Error(`Imported MCP server ${name} is missing command.`);
  if (transport === "http" && !url) throw new Error(`Imported MCP server ${name} is missing URL.`);
  return {
    name: name.trim().slice(0, 120),
    transport,
    command,
    args,
    env,
    headers,
    url,
    cwd: stringValue(raw.cwd),
    timeoutSeconds: numberValue(
      raw.tool_timeout_sec ?? raw.timeout_seconds ?? raw.timeout ?? raw.startup_timeout_sec,
    ),
    enabled: false,
    requiresApproval: approvalValue(approval),
    source: "import",
  };
}

export function prepareImportedConfig(config: McpServerConfig): {
  input: ReturnType<typeof toToolServerInput>;
  secrets: Record<string, string>;
} {
  const secrets: Record<string, string> = {};
  const env = protectImportedValues(config.env ?? {}, secrets, "env");
  const headers = protectImportedValues(config.headers ?? {}, secrets, "header");
  return {
    input: toToolServerInput({ ...config, env, headers }),
    secrets,
  };
}

async function saveImportedSecrets(
  serverId: string,
  secrets: Record<string, string>,
): Promise<void> {
  for (const [key, value] of Object.entries(secrets)) {
    await setToolSecretAsync({
      ownerType: "server",
      ownerId: serverId,
      key,
      label: key,
      value,
    });
  }
}

function protectImportedValues(
  values: Record<string, string>,
  secrets: Record<string, string>,
  scope: "env" | "header",
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, rawValue]) => {
      const value = String(rawValue);
      if (value.startsWith("$secret:")) return [key, value];
      if (!isSensitiveConfigKey(key)) return [key, value];
      const secretKey = normalizeSecretKey(`${scope}_${key}`);
      secrets[secretKey] = value;
      return [key, `$secret:${secretKey}`];
    }),
  );
}

function approvalValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["always", "required", "confirm", "manual"].includes(normalized)) return true;
    if (["never", "none", "auto", "automatic"].includes(normalized)) return false;
  }
  return undefined;
}

function isSensitiveConfigKey(key: string): boolean {
  return /(token|secret|password|authorization|api[-_]?key|credential|private[-_]?key|cookie)/i.test(
    key,
  );
}

function normalizeSecretKey(key: string): string {
  const normalized = key.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized.slice(0, 120) || "MCP_SECRET";
}

function toToolServerInput(config: McpServerConfig) {
  return {
    name: config.name,
    description: config.description ?? "",
    transport: config.transport,
    command: config.command ?? null,
    args: config.args ?? [],
    env: config.env ?? {},
    headers: config.headers ?? {},
    url: config.url ?? null,
    cwd: config.cwd ?? null,
    timeout_seconds: config.timeoutSeconds ?? 60,
    auto_use: config.autoUse ?? false,
    requires_approval: config.requiresApproval ?? true,
    config_source: "import" as const,
  };
}

function exportClaudeJson(servers: ToolServer[]): string {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    const value: Record<string, unknown> = {};
    if (server.transport === "stdio") {
      value.command = server.command ?? "";
      value.args = jsonArray(server.args_json);
      value.env = jsonRecord(server.env_json);
      if (server.cwd) value.cwd = server.cwd;
    } else {
      value.url = server.url ?? "";
      value.headers = jsonRecord(server.headers_json);
    }
    mcpServers[server.name] = value;
  }
  return JSON.stringify({ mcpServers }, null, 2) + "\n";
}

function exportCodexToml(servers: ToolServer[]): string {
  return (
    servers
      .map((server) => {
        const name = quoteToml(server.name);
        const lines = [`[mcp_servers.${name}]`];
        if (server.transport === "stdio") {
          lines.push(`command = ${quoteToml(server.command ?? "")}`);
          lines.push(`args = ${tomlArray(jsonArray(server.args_json))}`);
          lines.push(`env = ${tomlRecord(jsonRecord(server.env_json))}`);
          if (server.cwd) lines.push(`cwd = ${quoteToml(server.cwd)}`);
        } else {
          lines.push(`url = ${quoteToml(server.url ?? "")}`);
          lines.push(`http_headers = ${tomlRecord(jsonRecord(server.headers_json))}`);
        }
        return lines.join("\n");
      })
      .join("\n\n") + "\n"
  );
}

function parseTomlValue(raw: string, warnings: string[]): unknown {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]"))
    return splitComma(value.slice(1, -1))
      .map((item) => parseTomlValue(item, warnings))
      .filter((item) => item !== "");
  if (value.startsWith("{") && value.endsWith("}")) {
    const result: Record<string, string> = {};
    for (const pair of splitComma(value.slice(1, -1))) {
      const match = pair.match(/^\s*(?:"([^"]+)"|'([^']+)'|([A-Za-z_][A-Za-z0-9_-]*))\s*=\s*(.+)$/);
      if (match)
        result[match[1] ?? match[2] ?? match[3]!] = String(parseTomlValue(match[4], warnings));
    }
    return result;
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    return value.slice(1, -1).replaceAll('\\"', '"');
  if (value === "true" || value === "false") return value === "true";
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function splitComma(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === quote) quote = "";
    else if (!quote && (char === '"' || char === "'")) quote = char;
    else if (!quote && char === ",") {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function jsonArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function jsonRecord(raw: string): Record<string, string> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(600, Math.round(number))) : undefined;
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function recordValue(value: unknown): Record<string, string> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]))
    : {};
}

function quoteToml(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function tomlArray(values: string[]): string {
  return `[${values.map(quoteToml).join(", ")}]`;
}

function tomlRecord(values: Record<string, string>): string {
  return `{ ${Object.entries(values)
    .map(([key, value]) => `${tomlKey(key)} = ${quoteToml(value)}`)
    .join(", ")} }`;
}

function tomlKey(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value) ? value : quoteToml(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
