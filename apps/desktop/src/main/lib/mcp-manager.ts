import { createHash } from "node:crypto";
import { generateText, jsonSchema, tool, type ToolSet } from "ai";
import type { CallToolResult } from "@modelcontextprotocol/client";
import {
  resolveMcpToolPolicy,
  type ChatToolDescriptor,
  type McpCapabilitySnapshot,
  type McpCapabilitySummary,
  type McpCompletionResult,
  type McpPrompt,
  type McpPromptResult,
  type McpReadResourceResult,
  type McpResource,
  type McpResourceTemplate,
  type ToolDiscoveryResult,
  type ToolRecord,
  type ToolServer,
} from "../../shared/types";
import {
  getMcpServer,
  getMcpToolByReference,
  insertRuntimeEvent,
  listMcpServers,
  listMcpTools,
  updateMcpServerStatusAsync,
  upsertMcpToolDefinitionsAsync,
} from "./db";
import type { ChatToolModelContext } from "./chat-tools";
import {
  closeAllMcpConnections,
  closeMcpConnection as closeMcpClient,
  getMcpConnection,
  onMcpConnectionEvent,
  redactMcpError,
  withMcpTimeout,
  type McpConnection,
} from "./mcp-client-manager";
import { runWithMcpExecutionContext } from "./mcp-context";
import { getMcpAuthStatus } from "./mcp-auth";
import { ensureMcpServerStarted, onMcpServerStarted } from "./mcp-lifecycle-manager";

export { closeAllMcpConnections as closeAllMcpClients };
export { closeMcpClient };

const discoveryOperations = new Map<string, Promise<ToolDiscoveryResult>>();
const toolRefreshOperations = new Map<string, Promise<ToolRecord[]>>();
const toolChangeListeners = new Set<(event: { serverId: string }) => void>();

export function onMcpToolsChanged(listener: (event: { serverId: string }) => void): () => void {
  toolChangeListeners.add(listener);
  return () => toolChangeListeners.delete(listener);
}

export function notifyMcpToolsChanged(serverId: string): void {
  const event = { serverId };
  for (const listener of toolChangeListeners) {
    try {
      listener(event);
    } catch {
      // Renderer observers must not affect MCP discovery or tool persistence.
    }
  }
}

async function getReadyMcpConnection(server: ToolServer): Promise<McpConnection> {
  await ensureMcpServerStarted(server.id);
  return getMcpConnection(server);
}

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
      const policy = resolveMcpToolPolicy(server, mcpTool);
      return [
        {
          id: mcpToolReference(server.id, mcpTool.name),
          label: mcpTool.title || `${server.name}: ${mcpTool.name}`,
          description: mcpTool.description || `MCP tool from ${server.name}.`,
          kind: "host",
          execution: "host",
          category: "mcp",
          defaultAuto: policy.defaultAuto,
          requiresApproval: policy.requiresApproval,
          available: policy.available,
          unavailableReason: policy.available ? undefined : "MCP server or tool is disabled.",
          sourceId: server.id,
          sourceName: server.name,
        } satisfies ChatToolDescriptor,
      ];
    });
  } catch (error) {
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
        unavailableReason: error instanceof Error ? error.message : String(error),
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
    if (!server || !mcpTool) continue;
    const policy = resolveMcpToolPolicy(server, mcpTool);
    if (!policy.available) continue;
    const toolName = mcpToolRuntimeName(server.id, mcpTool.name);
    tools[toolName] = createMcpTool({ reference, server, mcpTool, model, conversationId, agentId });
    activeTools.push(toolName);
    if (policy.requiresApproval) {
      approvalToolNames.push(toolName);
    }
  }
  return { tools, activeTools, approvalToolNames };
}

export async function testMcpServer(serverId: string): Promise<ToolDiscoveryResult> {
  return discoverMcpServer(serverId);
}

/**
 * Discovery is shared by startup, lifecycle actions, and the MCP workspace.
 * Coalescing here prevents a post-start hook from racing an explicit refresh.
 */
export function discoverMcpServer(serverId: string): Promise<ToolDiscoveryResult> {
  const active = discoveryOperations.get(serverId);
  if (active) return active;
  const tracked = discoverMcpServerInternal(serverId).finally(() => {
    if (discoveryOperations.get(serverId) === tracked) discoveryOperations.delete(serverId);
  });
  discoveryOperations.set(serverId, tracked);
  return tracked;
}

async function discoverMcpServerInternal(serverId: string): Promise<ToolDiscoveryResult> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found: " + serverId);
  let connection: Awaited<ReturnType<typeof getMcpConnection>> | undefined;
  try {
    // Discovery is an explicit connection request, but it still belongs to
    // the lifecycle manager. This keeps lazy-start, runtime diagnostics, and
    // reconnect state identical to a tool invocation or a manual probe.
    await ensureMcpServerStarted(server.id);
    connection = await getMcpConnection(server);
    const tools = await refreshMcpToolDefinitions(connection, server);
    const capabilities = await loadMcpCapabilities(connection, server);
    const nextServer =
      (await updateMcpServerStatusAsync(server.id, {
        status: server.enabled ? "ready" : "disabled",
        last_error: null,
        last_connected_at: connection.snapshot.connectedAt,
      })) ?? server;
    insertRuntimeEvent({
      kind: "tool",
      title: "MCP discovered: " + server.name,
      status: "succeeded",
      owner_type: "server",
      owner_id: server.id,
      detail: {
        serverId: server.id,
        tools: tools.length,
        resources: capabilities.resources.length,
        resourceTemplates: capabilities.resourceTemplates.length,
        prompts: capabilities.prompts.length,
        protocolEra: connection.snapshot.protocolEra,
      },
    });
    return {
      server: nextServer,
      tools,
      resources: capabilities.resources.length,
      resourceTemplates: capabilities.resourceTemplates.length,
      prompts: capabilities.prompts.length,
      message: `Discovered ${tools.length} tools.`,
      protocolEra: connection.snapshot.protocolEra,
      protocolVersion: connection.snapshot.protocolVersion,
      serverIdentity: connection.snapshot.serverInfo,
      instructions: connection.snapshot.instructions,
      capabilities: connection.snapshot.capabilities,
    };
  } catch (error) {
    await closeMcpClient(server.id);
    const message = redactMcpError(error, server, connection?.transport);
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
  }
}

function refreshMcpToolDefinitions(
  connection: Awaited<ReturnType<typeof getMcpConnection>>,
  server: ToolServer,
): Promise<ToolRecord[]> {
  const active = toolRefreshOperations.get(server.id);
  if (active) return active;
  const tracked = refreshMcpToolDefinitionsInternal(connection, server).finally(() => {
    if (toolRefreshOperations.get(server.id) === tracked) toolRefreshOperations.delete(server.id);
  });
  toolRefreshOperations.set(server.id, tracked);
  return tracked;
}

async function refreshMcpToolDefinitionsInternal(
  connection: Awaited<ReturnType<typeof getMcpConnection>>,
  server: ToolServer,
): Promise<ToolRecord[]> {
  if (!connection.snapshot.capabilities.tools) return listMcpTools(server.id);
  const toolsResult = await withMcpTimeout(
    connection.client.listTools(),
    server,
    "MCP tool discovery timed out.",
    () => closeMcpClient(server.id),
  );
  const definitions = toolsResult.tools.map((definition) => ({
    name: definition.name,
    title: getOptionalString(definition, "title"),
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: getOptionalValue(definition, "outputSchema"),
  }));
  const tools = await upsertMcpToolDefinitionsAsync(server.id, definitions);
  notifyMcpToolsChanged(server.id);
  return tools;
}

export async function getMcpCapabilities(serverId: string): Promise<McpCapabilitySnapshot> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found: " + serverId);
  let connection: Awaited<ReturnType<typeof getMcpConnection>> | undefined;
  try {
    connection = await getReadyMcpConnection(server);
    // Capabilities refresh is also the user-facing discovery action. This
    // keeps the persisted Agent ToolSet in sync when a server was started
    // before its tools had ever been discovered.
    await refreshMcpToolDefinitions(connection, server);
    const loaded = await loadMcpCapabilities(connection, server);
    await updateMcpServerStatusAsync(server.id, {
      status: server.enabled ? "ready" : "disabled",
      last_error: null,
      last_connected_at: connection.snapshot.connectedAt,
    });
    return {
      serverId,
      protocolEra: connection.snapshot.protocolEra,
      protocolVersion: connection.snapshot.protocolVersion,
      identity: connection.snapshot.serverInfo,
      instructions: connection.snapshot.instructions,
      capabilities: connection.snapshot.capabilities,
      resources: loaded.resources,
      resourceTemplates: loaded.resourceTemplates,
      prompts: loaded.prompts,
      auth: getMcpAuthStatus(serverId),
      connectedAt: connection.snapshot.connectedAt,
    };
  } catch (error) {
    const message = redactMcpError(error, server, connection?.transport);
    await updateMcpServerStatusAsync(server.id, { status: "error", last_error: message });
    throw new Error(message, { cause: error });
  }
}

onMcpServerStarted(async (serverId) => {
  const result = await discoverMcpServer(serverId);
  if (result.server.status === "error") {
    console.warn(`[mcp] post-start discovery failed for ${serverId}: ${result.message}`);
  }
});

export async function readMcpResource(
  serverId: string,
  uri: string,
): Promise<McpReadResourceResult> {
  const server = requireMcpServer(serverId);
  const connection = await getReadyMcpConnection(server);
  const result = await withMcpRequest(
    connection.client.readResource({ uri }),
    server,
    "MCP resource read timed out.",
    () => closeMcpClient(server.id),
  );
  return {
    contents: result.contents.map((content) => ({
      uri: content.uri,
      mimeType: content.mimeType,
      text: getOptionalString(content, "text"),
      blob: getOptionalString(content, "blob"),
    })),
  };
}

export async function getMcpPrompt(
  serverId: string,
  name: string,
  args?: Record<string, string>,
): Promise<McpPromptResult> {
  const server = requireMcpServer(serverId);
  const connection = await getReadyMcpConnection(server);
  const result = await withMcpRequest(
    connection.client.getPrompt({ name, arguments: args }),
    server,
    "MCP prompt retrieval timed out.",
    () => closeMcpClient(server.id),
  );
  return {
    description: result.description,
    messages: result.messages.map((message) => ({
      role: message.role,
      content: toJsonObject(message.content),
    })),
  };
}

export async function completeMcp(
  serverId: string,
  ref: Record<string, unknown>,
  argument: { name: string; value: string },
): Promise<McpCompletionResult> {
  const server = requireMcpServer(serverId);
  const connection = await getReadyMcpConnection(server);
  const result = await withMcpRequest(
    connection.client.complete({ ref, argument } as never),
    server,
    "MCP completion timed out.",
    () => closeMcpClient(server.id),
  );
  return {
    values: result.completion.values,
    total: result.completion.total,
    hasMore: result.completion.hasMore,
  };
}

export async function listenMcpCapabilities(serverId: string): Promise<boolean> {
  const server = requireMcpServer(serverId);
  const connection = await getReadyMcpConnection(server);
  if (connection.snapshot.protocolEra !== "modern") return false;
  await connection.subscription?.close().catch(() => undefined);
  connection.subscription = await withMcpRequest(
    connection.client.listen({
      tools: true,
      resources: true,
      prompts: true,
    } as never),
    server,
    "MCP capability subscription timed out.",
    () => closeMcpClient(server.id),
  );
  return true;
}

export function onMcpCapabilitiesChanged(
  listener: (serverId: string, capabilities: McpCapabilitySnapshot) => void,
): () => void {
  return onMcpConnectionEvent((event) => {
    if (event.type !== "capabilities-changed") return;
    const server = getMcpServer(event.serverId);
    if (!server) return;
    void getReadyMcpConnection(server)
      .then(async (connection) => {
        if (event.snapshot.capabilities.tools) {
          await refreshMcpToolDefinitions(connection, server);
        }
        return loadMcpCapabilities(connection, server);
      })
      .then((loaded) =>
        listener(event.serverId, {
          serverId: event.serverId,
          protocolEra: event.snapshot.protocolEra,
          protocolVersion: event.snapshot.protocolVersion,
          identity: event.snapshot.serverInfo,
          instructions: event.snapshot.instructions,
          capabilities: event.snapshot.capabilities,
          resources: loaded.resources,
          resourceTemplates: loaded.resourceTemplates,
          prompts: loaded.prompts,
          auth: getMcpAuthStatus(event.serverId),
          connectedAt: event.snapshot.connectedAt,
        }),
      )
      .catch(() => undefined);
  });
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
}): Promise<CallToolResult> {
  const parsed = parseMcpToolReference(reference);
  if (!parsed) throw new Error("Invalid MCP tool reference: " + reference);
  const server = getMcpServer(parsed.serverId);
  const mcpTool = getMcpToolByReference(parsed.serverId, parsed.toolName);
  if (!server || !mcpTool || server.enabled === 0 || mcpTool.enabled === 0) {
    throw new Error("MCP tool is unavailable: " + reference);
  }
  const started = Date.now();
  try {
    const output = await runWithMcpExecutionContext(
      {
        serverId: server.id,
        conversationId: conversationId ?? null,
        agentId: agentId ?? null,
        sampling: createMcpSamplingHandler(model),
      },
      () =>
        withMcpTimeout(
          getReadyMcpConnection(server).then((connection) =>
            connection.client.callTool({
              name: mcpTool.name,
              arguments: normalizeToolInput(input),
            }),
          ),
          server,
          "MCP tool call timed out.",
          () => closeMcpClient(server.id),
        ),
    );
    insertRuntimeEvent({
      kind: "tool",
      title: "MCP tool: " + mcpTool.name,
      status: output.isError ? "failed" : "succeeded",
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
        isError: output.isError === true,
        hasStructuredContent: output.structuredContent !== undefined,
      },
    });
    // MCP tool-level failures are data, not transport failures. Passing the
    // result through preserves structuredContent and lets the model decide how
    // to explain the server's error.
    return output;
  } catch (error) {
    const message = redactMcpError(error, server);
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
    throw new Error(message, { cause: error });
  }
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

function createMcpSamplingHandler(
  model: ChatToolModelContext,
): ((request: unknown) => Promise<unknown>) | undefined {
  const languageModel = model.languageModel;
  if (!languageModel) return undefined;
  return async (request: unknown): Promise<unknown> => {
    const params = asRecord(asRecord(request).params);
    const rawMessages = Array.isArray(params.messages) ? params.messages : [];
    const messages = rawMessages.map((item) => {
      const message = asRecord(item);
      return {
        role: message.role === "assistant" ? "assistant" : "user",
        content: samplingContent(message.content),
      };
    });
    if (messages.length === 0) throw new Error("MCP sampling request did not include messages.");
    const maxOutputTokens =
      typeof params.maxTokens === "number" && Number.isFinite(params.maxTokens)
        ? Math.max(1, Math.min(16_384, Math.floor(params.maxTokens)))
        : undefined;
    const temperature =
      typeof params.temperature === "number" && Number.isFinite(params.temperature)
        ? Math.max(0, Math.min(2, params.temperature))
        : undefined;
    const result = await generateText({
      model: languageModel,
      system: typeof params.systemPrompt === "string" ? params.systemPrompt : undefined,
      messages: messages as never,
      maxOutputTokens,
      temperature,
      providerOptions: model.providerOptions,
    });
    return {
      model: model.modelId,
      role: "assistant",
      content: { type: "text", text: result.text },
      stopReason: mapSamplingStopReason(result.finishReason),
    };
  };
}

function samplingContent(value: unknown): string {
  if (typeof value === "string") return value;
  const content = asRecord(value);
  if (content.type === "text" && typeof content.text === "string") return content.text;
  if (Array.isArray(value)) {
    return value
      .map((item) => samplingContent(item))
      .filter(Boolean)
      .join("\n");
  }
  return JSON.stringify(value ?? "");
}

function mapSamplingStopReason(
  reason: string,
): "endTurn" | "stopSequence" | "maxTokens" | "toolUse" {
  if (reason === "length") return "maxTokens";
  if (reason === "content-filter") return "stopSequence";
  if (reason === "tool-calls") return "toolUse";
  return "endTurn";
}

async function loadMcpCapabilities(
  connection: {
    client: {
      listResources: () => Promise<unknown>;
      listResourceTemplates: () => Promise<unknown>;
      listPrompts: () => Promise<unknown>;
    };
    snapshot: { capabilities: Pick<McpCapabilitySummary, "resources" | "prompts"> };
  },
  server: ToolServer,
): Promise<{
  resources: McpResource[];
  resourceTemplates: McpResourceTemplate[];
  prompts: McpPrompt[];
}> {
  const [resourcesResult, templatesResult, promptsResult] = await Promise.all([
    connection.snapshot.capabilities.resources
      ? withMcpTimeout(
          connection.client.listResources(),
          server,
          "MCP resource discovery timed out.",
          () => closeMcpClient(server.id),
        ).catch(() => ({ resources: [] }))
      : Promise.resolve({ resources: [] }),
    connection.snapshot.capabilities.resources
      ? withMcpTimeout(
          connection.client.listResourceTemplates(),
          server,
          "MCP resource template discovery timed out.",
          () => closeMcpClient(server.id),
        ).catch(() => ({ resourceTemplates: [] }))
      : Promise.resolve({ resourceTemplates: [] }),
    connection.snapshot.capabilities.prompts
      ? withMcpTimeout(
          connection.client.listPrompts(),
          server,
          "MCP prompt discovery timed out.",
          () => closeMcpClient(server.id),
        ).catch(() => ({ prompts: [] }))
      : Promise.resolve({ prompts: [] }),
  ]);
  const resources = Array.isArray((resourcesResult as { resources?: unknown[] }).resources)
    ? (resourcesResult as { resources: unknown[] }).resources.map(toMcpResource)
    : [];
  const resourceTemplates = Array.isArray(
    (templatesResult as { resourceTemplates?: unknown[] }).resourceTemplates,
  )
    ? (templatesResult as { resourceTemplates: unknown[] }).resourceTemplates.map(
        toMcpResourceTemplate,
      )
    : [];
  const prompts = Array.isArray((promptsResult as { prompts?: unknown[] }).prompts)
    ? (promptsResult as { prompts: unknown[] }).prompts.map(toMcpPrompt)
    : [];
  return { resources, resourceTemplates, prompts };
}

function requireMcpServer(serverId: string): ToolServer {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found: " + serverId);
  if (server.enabled === 0) throw new Error("MCP server is disabled.");
  return server;
}

function toMcpResource(value: unknown): McpResource {
  const record = asRecord(value);
  return {
    uri: String(record.uri ?? ""),
    name: String(record.name ?? record.uri ?? "Resource"),
    title: getOptionalString(record, "title"),
    description: getOptionalString(record, "description"),
    mimeType: getOptionalString(record, "mimeType"),
    size: typeof record.size === "number" ? record.size : undefined,
  };
}

function toMcpResourceTemplate(value: unknown): McpResourceTemplate {
  const record = asRecord(value);
  return {
    uriTemplate: String(record.uriTemplate ?? ""),
    name: String(record.name ?? record.uriTemplate ?? "Resource template"),
    title: getOptionalString(record, "title"),
    description: getOptionalString(record, "description"),
    mimeType: getOptionalString(record, "mimeType"),
  };
}

function toMcpPrompt(value: unknown): McpPrompt {
  const record = asRecord(value);
  const args = Array.isArray(record.arguments)
    ? record.arguments.map((argument) => {
        const item = asRecord(argument);
        return {
          name: String(item.name ?? ""),
          title: getOptionalString(item, "title"),
          description: getOptionalString(item, "description"),
          required: item.required === true,
        };
      })
    : undefined;
  return {
    name: String(record.name ?? ""),
    title: getOptionalString(record, "title"),
    description: getOptionalString(record, "description"),
    arguments: args,
  };
}

function toJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

function safeJsonSchema(raw: string): Record<string, unknown> {
  const parsed = safeJson(raw, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : { type: "object", additionalProperties: true };
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("MCP tool input must be a JSON object.");
  }
  return input as Record<string, unknown>;
}

function safeJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function getOptionalString(record: unknown, key: string): string | undefined {
  const value = getOptionalValue(record, key);
  return typeof value === "string" ? value : undefined;
}

function getOptionalValue(record: unknown, key: string): unknown {
  return asRecord(record)[key];
}

function toolNamePart(value: string): string {
  const part = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return part || "tool";
}

async function withMcpRequest<T>(
  promise: Promise<T>,
  server: ToolServer,
  message: string,
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  try {
    return await withMcpTimeout(promise, server, message, onTimeout);
  } catch (error) {
    throw new Error(redactMcpError(error, server), { cause: error });
  }
}
