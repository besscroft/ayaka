import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { createHash } from "node:crypto";
import { jsonSchema, tool, type ToolSet } from "ai";
import type {
  ChatToolDescriptor,
  ToolDiscoveryResult,
  ToolRecord,
  ToolServer,
} from "../../shared/types";
import {
  getMcpServer,
  getMcpToolByReference,
  insertRuntimeEvent,
  listMcpServers,
  listMcpTools,
  resolveToolSecretReferences,
  updateMcpServerStatusAsync,
  upsertMcpToolDefinitionsAsync,
} from "./db";
import type { ChatToolModelContext } from "./chat-tools";

const clientCache = new Map<string, { updatedAt: number; client: MCPClient }>();

export function mcpToolReference(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function parseMcpToolReference(
  reference: string,
): { serverId: string; toolName: string } | null {
  const match = reference.match(/^mcp:([^:]+):(.+)$/);
  if (!match) return null;
  return { serverId: match[1], toolName: match[2] };
}

export function mcpToolRuntimeName(serverId: string, toolName: string): string {
  const identity = `${serverId}\0${toolName}`;
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 10);
  return "mcp_" + toolNamePart(serverId) + "_" + toolNamePart(toolName) + "_" + suffix;
}

export function createMcpToolDescriptors(): ChatToolDescriptor[] {
  try {
    const servers = listMcpServers();
    const serverById = new Map(servers.map((server) => [server.id, server]));
    return listMcpTools().flatMap((mcpTool) => {
      const server = mcpTool.server_id ? serverById.get(mcpTool.server_id) : null;
      if (!server) return [];
      const available = server.enabled !== 0 && mcpTool.enabled !== 0;
      return [
        {
          id: mcpToolReference(server.id, mcpTool.name),
          label: mcpTool.title || `${server.name}: ${mcpTool.name}`,
          description: mcpTool.description || `MCP tool from ${server.name}.`,
          kind: "host",
          execution: "host",
          category: "mcp",
          defaultAuto: available && server.auto_use !== 0 && mcpTool.auto_use !== 0,
          requiresApproval: server.requires_approval !== 0 || mcpTool.requires_approval !== 0,
          available,
          unavailableReason: available ? undefined : "MCP server or tool is disabled.",
          sourceId: server.id,
          sourceName: server.name,
        } satisfies ChatToolDescriptor,
      ];
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      {
        id: "mcp:registry:error",
        label: "MCP registry unavailable",
        description: "MCP tools could not be loaded from the local registry.",
        kind: "host",
        execution: "host",
        category: "mcp",
        defaultAuto: false,
        requiresApproval: false,
        available: false,
        unavailableReason: message,
        sourceName: "MCP",
      } satisfies ChatToolDescriptor,
    ];
  }
}

export function createMcpToolSet({
  references,
  model,
  conversationId,
  agentId,
}: {
  references: string[];
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): { tools: ToolSet; activeTools: string[]; approvalToolNames: string[] } {
  const tools: ToolSet = {};
  const activeTools: string[] = [];
  const approvalToolNames: string[] = [];
  for (const reference of references) {
    const parsed = parseMcpToolReference(reference);
    if (!parsed) continue;
    const server = getMcpServer(parsed.serverId);
    const mcpTool = getMcpToolByReference(parsed.serverId, parsed.toolName);
    if (!server || !mcpTool || server.enabled === 0 || mcpTool.enabled === 0) continue;
    const toolName = mcpToolRuntimeName(server.id, mcpTool.name);
    tools[toolName] = createMcpTool({ reference, server, mcpTool, model, conversationId, agentId });
    activeTools.push(toolName);
    if (server.requires_approval !== 0 || mcpTool.requires_approval !== 0) {
      approvalToolNames.push(toolName);
    }
  }
  return { tools, activeTools, approvalToolNames };
}

export async function testMcpServer(serverId: string): Promise<ToolDiscoveryResult> {
  return discoverMcpServer(serverId);
}

export async function discoverMcpServer(serverId: string): Promise<ToolDiscoveryResult> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found: " + serverId);
  let client: MCPClient | null = null;
  try {
    await closeMcpClient(serverId);
    client = await withServerTimeout(createClient(server), server, "MCP connection timed out.");
    const toolsResult = await withServerTimeout(
      client.listTools(),
      server,
      "MCP tool discovery timed out.",
    );
    const definitions = toolsResult.tools.map((definition) => ({
      name: definition.name,
      title: getOptionalString(definition, "title"),
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: getOptionalValue(definition, "outputSchema"),
    }));
    const tools = await upsertMcpToolDefinitionsAsync(server.id, definitions);
    const [resources, resourceTemplates, prompts] = await Promise.all([
      countSafely(() => client?.listResources()),
      countSafely(() => client?.listResourceTemplates()),
      countSafely(() => client?.experimental_listPrompts()),
    ]);
    const connectedAt = Date.now();
    const nextServer =
      (await updateMcpServerStatusAsync(server.id, {
        status: server.enabled ? "ready" : "disabled",
        last_error: null,
        last_connected_at: connectedAt,
      })) ?? server;
    insertRuntimeEvent({
      kind: "tool",
      title: "MCP discovered: " + server.name,
      status: "succeeded",
      owner_type: "server",
      owner_id: server.id,
      detail: { serverId: server.id, tools: tools.length, resources, resourceTemplates, prompts },
    });
    return {
      server: nextServer,
      tools,
      resources,
      resourceTemplates,
      prompts,
      message: `Discovered ${tools.length} tools.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextServer =
      (await updateMcpServerStatusAsync(server.id, { status: "error", last_error: message })) ??
      server;
    insertRuntimeEvent({
      kind: "error",
      title: "MCP discovery failed: " + server.name,
      status: "failed",
      owner_type: "server",
      owner_id: server.id,
      detail: { serverId: server.id, error: message },
    });
    return {
      server: nextServer,
      tools: listMcpTools(server.id),
      resources: 0,
      resourceTemplates: 0,
      prompts: 0,
      message,
    };
  } finally {
    await client?.close().catch(() => undefined);
  }
}

export async function closeMcpClient(serverId: string): Promise<void> {
  const cached = clientCache.get(serverId);
  if (!cached) return;
  clientCache.delete(serverId);
  await cached.client.close().catch(() => undefined);
}

export async function closeAllMcpClients(): Promise<void> {
  const clients = [...clientCache.values()];
  clientCache.clear();
  await Promise.all(clients.map((entry) => entry.client.close().catch(() => undefined)));
}

async function executeMcpTool({
  reference,
  input,
  model,
  conversationId,
  agentId,
}: {
  reference: string;
  input: unknown;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): Promise<unknown> {
  const parsed = parseMcpToolReference(reference);
  if (!parsed) throw new Error("Invalid MCP tool reference: " + reference);
  const server = getMcpServer(parsed.serverId);
  const mcpTool = getMcpToolByReference(parsed.serverId, parsed.toolName);
  if (!server || !mcpTool || server.enabled === 0 || mcpTool.enabled === 0) {
    throw new Error("MCP tool is unavailable: " + reference);
  }
  const started = Date.now();
  try {
    const output = await withServerTimeout(
      getOrCreateClient(server).then((client) =>
        client.callTool({
          name: mcpTool.name,
          arguments: normalizeToolInput(input),
        }),
      ),
      server,
      "MCP tool call timed out.",
      () => closeMcpClient(server.id),
    );
    insertRuntimeEvent({
      kind: "tool",
      title: "MCP tool: " + mcpTool.name,
      status: "succeeded",
      conversation_id: conversationId ?? null,
      agent_id: agentId ?? null,
      tool_id: mcpTool.id,
      owner_type: "server",
      owner_id: server.id,
      duration_ms: Date.now() - started,
      detail: {
        serverId: server.id,
        serverName: server.name,
        toolName: mcpTool.name,
        providerId: model.providerId,
        modelId: model.modelId,
      },
    });
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await closeMcpClient(server.id);
    await updateMcpServerStatusAsync(server.id, { status: "error", last_error: message });
    insertRuntimeEvent({
      kind: "error",
      title: "MCP tool failed: " + mcpTool.name,
      status: "failed",
      conversation_id: conversationId ?? null,
      agent_id: agentId ?? null,
      tool_id: mcpTool.id,
      owner_type: "server",
      owner_id: server.id,
      duration_ms: Date.now() - started,
      detail: { serverId: server.id, toolName: mcpTool.name, error: message },
    });
    throw error;
  }
}

async function getOrCreateClient(server: ToolServer): Promise<MCPClient> {
  const cached = clientCache.get(server.id);
  if (cached && cached.updatedAt === server.updated_at) return cached.client;
  await closeMcpClient(server.id);
  const client = await createClient(server);
  clientCache.set(server.id, { updatedAt: server.updated_at, client });
  return client;
}

async function createClient(server: ToolServer): Promise<MCPClient> {
  const transport =
    server.transport === "stdio"
      ? new Experimental_StdioMCPTransport({
          command: requireCommand(server),
          args: safeJsonArray(server.args_json).map(String),
          env: {
            ...stringEnv(process.env),
            ...resolveToolSecretReferences("server", server.id, safeJsonRecord(server.env_json)),
          },
          cwd: server.cwd ?? undefined,
        })
      : server.transport === "http" || server.transport === "sse"
        ? {
            type: server.transport,
            url: requireUrl(server),
            headers: resolveToolSecretReferences(
              "server",
              server.id,
              safeJsonRecord(server.headers_json),
            ),
            redirect: "error" as const,
          }
        : (() => {
            throw new Error("Built-in tool servers do not use MCP transport");
          })();
  return createMCPClient({
    clientName: "ayaka",
    version: "1.0.0",
    transport,
    maxRetries: 0,
    onUncaughtError: (error) => {
      console.warn("[mcp] uncaught error:", error);
    },
  });
}

function withServerTimeout<T>(
  promise: Promise<T>,
  server: ToolServer,
  message: string,
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  const timeoutMs = Math.max(1, server.timeout_seconds || 60) * 1_000;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      void Promise.resolve(onTimeout?.()).catch(() => undefined);
      reject(new Error(message));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function createMcpTool({
  reference,
  server,
  mcpTool,
  model,
  conversationId,
  agentId,
}: {
  reference: string;
  server: ToolServer;
  mcpTool: ToolRecord;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): ToolSet[string] {
  return tool({
    description: mcpTool.description || `Call ${mcpTool.name} on ${server.name}.`,
    inputSchema: jsonSchema<Record<string, unknown>>(safeJsonSchema(mcpTool.input_schema_json)),
    execute: (input) => executeMcpTool({ reference, input, model, conversationId, agentId }),
  });
}

function requireCommand(server: ToolServer): string {
  const command = server.command?.trim();
  if (!command) throw new Error("MCP stdio server is missing a command.");
  return command;
}

function requireUrl(server: ToolServer): string {
  const url = server.url?.trim();
  if (!url) throw new Error("MCP remote server is missing a URL.");
  return url;
}

function safeJsonSchema(raw: string): Record<string, unknown> {
  const parsed = safeJson(raw, {});
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return { type: "object", additionalProperties: true };
}

function safeJsonRecord(raw: string): Record<string, string> {
  const parsed = safeJson(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
  );
}

function safeJsonArray(raw: string): unknown[] {
  const parsed = safeJson(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function safeJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("MCP tool input must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

async function countSafely(run: () => Promise<unknown> | undefined): Promise<number> {
  try {
    const value = await run();
    if (!value || typeof value !== "object") return 0;
    const record = value as Record<string, unknown>;
    for (const key of ["tools", "resources", "resourceTemplates", "prompts"]) {
      const list = record[key];
      if (Array.isArray(list)) return list.length;
    }
    return 0;
  } catch {
    return 0;
  }
}

function getOptionalString(record: unknown, key: string): string | undefined {
  const value = getOptionalValue(record, key);
  return typeof value === "string" ? value : undefined;
}

function getOptionalValue(record: unknown, key: string): unknown {
  if (!record || typeof record !== "object") return undefined;
  return (record as Record<string, unknown>)[key];
}

function toolNamePart(value: string): string {
  const part = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return part || "tool";
}
