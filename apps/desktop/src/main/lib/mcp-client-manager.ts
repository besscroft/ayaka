import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type Client as ClientType,
  type McpSubscription,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { McpCapabilitySummary, McpProtocolEra, ToolServer } from "../../shared/types";
import { getToolSecretValue, resolveToolSecretReferences } from "./db";
import { getMcpExecutionContext } from "./mcp-context";
import { requestMcpInput } from "./mcp-interaction-broker";
import { getMcpOAuthProvider } from "./mcp-auth";

export interface McpConnectionSnapshot {
  protocolEra: McpProtocolEra;
  protocolVersion: string | null;
  serverInfo: { name: string; version: string; websiteUrl?: string } | null;
  instructions: string | null;
  capabilities: McpCapabilitySummary;
  connectedAt: number;
}

export interface McpConnection {
  serverId: string;
  client: ClientType;
  transport: Transport;
  snapshot: McpConnectionSnapshot;
  subscription: McpSubscription | null;
}

export type McpConnectionEvent =
  | { type: "capabilities-changed"; serverId: string; snapshot: McpConnectionSnapshot }
  | { type: "connection-closed"; serverId: string };

type ConnectionListener = (event: McpConnectionEvent) => void;

const connectionCache = new Map<string, { updatedAt: number; connection: McpConnection }>();
const pendingConnections = new Map<string, Promise<McpConnection>>();
const listeners = new Set<ConnectionListener>();

export function onMcpConnectionEvent(listener: ConnectionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mcpConnection(serverId: string): McpConnection | null {
  return connectionCache.get(serverId)?.connection ?? null;
}

export async function getMcpConnection(
  server: ToolServer,
  options: { forceNew?: boolean } = {},
): Promise<McpConnection> {
  const cached = connectionCache.get(server.id);
  if (!options.forceNew && cached?.updatedAt === server.updated_at) return cached.connection;
  if (cached) await closeMcpConnection(server.id);

  const pending = pendingConnections.get(server.id);
  if (pending) return pending;

  const promise = connectMcpServer(server).then((connection) => {
    connectionCache.set(server.id, { updatedAt: server.updated_at, connection });
    return connection;
  });
  pendingConnections.set(server.id, promise);
  try {
    return await promise;
  } finally {
    pendingConnections.delete(server.id);
  }
}

export async function closeMcpConnection(serverId: string): Promise<void> {
  const cached = connectionCache.get(serverId);
  if (!cached) {
    await pendingConnections.get(serverId)?.catch(() => undefined);
    return;
  }
  connectionCache.delete(serverId);
  await cached.connection.subscription?.close().catch(() => undefined);
  await cached.connection.client.close().catch(() => undefined);
  emit({ type: "connection-closed", serverId });
}

export async function closeAllMcpConnections(): Promise<void> {
  await Promise.all(
    [...pendingConnections.values()].map((pending) => pending.catch(() => undefined)),
  );
  await Promise.all([...connectionCache.keys()].map((serverId) => closeMcpConnection(serverId)));
}

export function mcpTimeoutMs(server: ToolServer): number {
  return Math.max(1, server.timeout_seconds || 60) * 1_000;
}

export async function withMcpTimeout<T>(
  promise: Promise<T>,
  server: ToolServer,
  message: string,
  onTimeout?: () => void | Promise<void>,
): Promise<T> {
  const timeoutMs = mcpTimeoutMs(server);
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

export function validateMcpUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("MCP URL is invalid.");
  }
  if (url.protocol === "https:") return url;
  if (url.protocol !== "http:") {
    throw new Error("MCP remote servers must use HTTPS or local HTTP.");
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "[::1]" &&
    hostname !== "::1"
  ) {
    throw new Error("Public MCP HTTP endpoints are not allowed; use HTTPS.");
  }
  return url;
}

export function redactMcpError(error: unknown, server?: ToolServer): string {
  let message = error instanceof Error ? error.message : String(error);
  if (server) {
    for (const value of secretValues(server)) {
      if (value) message = message.split(value).join("[REDACTED]");
    }
  }
  return message
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,]+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key\s*[=:]\s*)[^\s,}]+/gi, "$1[REDACTED]");
}

async function connectMcpServer(server: ToolServer): Promise<McpConnection> {
  if (server.kind !== "mcp") throw new Error("Built-in tool servers do not use MCP transport.");
  if (server.transport === "http") {
    try {
      return await connectWithTransport(server, await createHttpTransport(server));
    } catch (streamableError) {
      // A new Client is deliberately created for the SSE fallback. MCP Client
      // instances cannot be re-used after a failed initialization handshake.
      try {
        return await connectWithTransport(server, await createSseTransport(server));
      } catch (sseError) {
        throw new Error(
          `MCP Streamable HTTP failed (${redactMcpError(streamableError, server)}); SSE fallback failed (${redactMcpError(sseError, server)}).`,
        );
      }
    }
  }
  const transport =
    server.transport === "stdio"
      ? createStdioTransport(server)
      : server.transport === "sse"
        ? await createSseTransport(server)
        : (() => {
            throw new Error("Unsupported MCP transport.");
          })();
  return connectWithTransport(server, transport);
}

async function connectWithTransport(
  server: ToolServer,
  transport: Transport,
): Promise<McpConnection> {
  const client = new Client({ name: "ayaka", version: "1.0.0" }, {
    // Keep the option surface in one adapter so the rest of Ayaka never
    // depends on SDK-specific protocol types.
    versionNegotiation: { mode: "auto", probe: { maxRetries: 0 } },
    capabilities: {
      elicitation: { form: {}, url: {} },
      sampling: {},
    },
    listChanged: {
      tools: { onChanged: () => emitCapabilityChange(server.id, client) },
      resources: { onChanged: () => emitCapabilityChange(server.id, client) },
      prompts: { onChanged: () => emitCapabilityChange(server.id, client) },
    },
    inputRequired: { autoFulfill: true, maxRounds: 3 },
  } as never);
  client.setRequestHandler(
    "elicitation/create",
    async (request) => (await requestMcpInput(server.id, request)) as never,
  );
  client.setRequestHandler("sampling/createMessage", async (request) => {
    const context = getMcpExecutionContext();
    if (!context?.sampling) {
      throw new Error("MCP sampling is only available while a Chat model is active.");
    }
    return (await context.sampling(request)) as never;
  });
  try {
    await withMcpTimeout(
      client.connect(transport, { timeout: mcpTimeoutMs(server) } as never),
      server,
      "MCP connection timed out.",
    );
    const snapshot = await readConnectionSnapshot(client);
    const connection: McpConnection = {
      serverId: server.id,
      client,
      transport,
      snapshot,
      subscription: null,
    };
    transport.onclose = () => {
      const current = connectionCache.get(server.id)?.connection;
      if (current !== connection) return;
      connectionCache.delete(server.id);
      void connection.subscription?.close().catch(() => undefined);
      emit({ type: "connection-closed", serverId: server.id });
    };
    return connection;
  } catch (error) {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    throw error;
  }
}

function createStdioTransport(server: ToolServer): StdioClientTransport {
  const command = server.command?.trim();
  if (!command) throw new Error("MCP stdio server is missing a command.");
  return new StdioClientTransport({
    command,
    args: safeJsonArray(server.args_json).map(String),
    env: {
      ...safeProcessEnv(),
      ...resolveToolSecretReferences("server", server.id, safeJsonRecord(server.env_json)),
    },
    cwd: server.cwd ?? undefined,
    stderr: "pipe",
  });
}

async function createHttpTransport(server: ToolServer): Promise<StreamableHTTPClientTransport> {
  return new StreamableHTTPClientTransport(validateMcpUrl(requireUrl(server)), {
    requestInit: { headers: resolveHeaders(server), redirect: "error" },
    authProvider: await getMcpOAuthProvider(server),
  });
}

async function createSseTransport(server: ToolServer): Promise<SSEClientTransport> {
  return new SSEClientTransport(validateMcpUrl(requireUrl(server)), {
    requestInit: { headers: resolveHeaders(server), redirect: "error" },
    authProvider: await getMcpOAuthProvider(server),
  });
}

async function readConnectionSnapshot(client: ClientType): Promise<McpConnectionSnapshot> {
  const serverVersion = client.getServerVersion();
  const serverCapabilities = (client.getServerCapabilities() ?? {}) as Record<string, unknown>;
  const toolsCapability = asRecord(serverCapabilities.tools);
  const resourcesCapability = asRecord(serverCapabilities.resources);
  const promptsCapability = asRecord(serverCapabilities.prompts);
  const protocolEra = client.getProtocolEra() === "modern" ? "modern" : "legacy";
  const capabilities: McpCapabilitySummary = {
    tools: Boolean(serverCapabilities.tools),
    resources: Boolean(serverCapabilities.resources),
    resourceTemplates: Boolean(serverCapabilities.resources),
    prompts: Boolean(serverCapabilities.prompts),
    resourceSubscriptions: Boolean(serverCapabilities.resources && resourcesCapability.subscribe),
    listChanged: {
      tools: Boolean(serverCapabilities.tools && toolsCapability.listChanged),
      resources: Boolean(serverCapabilities.resources && resourcesCapability.listChanged),
      prompts: Boolean(serverCapabilities.prompts && promptsCapability.listChanged),
    },
    sampling: Boolean(serverCapabilities.sampling),
    elicitation: Boolean(serverCapabilities.elicitation),
  };
  return {
    protocolEra,
    protocolVersion: client.getNegotiatedProtocolVersion() ?? null,
    serverInfo: serverVersion
      ? {
          name: serverVersion.name,
          version: serverVersion.version,
          websiteUrl: serverVersion.websiteUrl,
        }
      : null,
    instructions: client.getInstructions() ?? null,
    capabilities,
    connectedAt: Date.now(),
  };
}

async function emitCapabilityChange(serverId: string, client: ClientType): Promise<void> {
  const snapshot = await readConnectionSnapshot(client).catch(() => undefined);
  if (!snapshot) return;
  const current = connectionCache.get(serverId)?.connection;
  if (current?.client === client) current.snapshot = snapshot;
  emit({ type: "capabilities-changed", serverId, snapshot });
}

function emit(event: McpConnectionEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A renderer subscriber must never be able to break the MCP connection.
    }
  }
}

function requireUrl(server: ToolServer): string {
  const url = server.url?.trim();
  if (!url) throw new Error("MCP remote server is missing a URL.");
  return url;
}

function resolveHeaders(server: ToolServer): Record<string, string> {
  return resolveToolSecretReferences("server", server.id, safeJsonRecord(server.headers_json));
}

function secretValues(server: ToolServer): string[] {
  const values: string[] = [];
  for (const source of [server.env_json, server.headers_json]) {
    for (const value of Object.values(safeJsonRecord(source))) {
      const match = value.match(/^\$secret:(.+)$/);
      if (match) {
        const resolved = getToolSecretValue("server", server.id, match[1]);
        if (resolved) values.push(resolved);
      }
    }
  }
  return values;
}

function safeJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function safeJsonRecord(raw: string): Record<string, string> {
  const parsed = safeJson(raw, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function safeJsonArray(raw: string): unknown[] {
  const parsed = safeJson(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeProcessEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export type { CallToolResult };
