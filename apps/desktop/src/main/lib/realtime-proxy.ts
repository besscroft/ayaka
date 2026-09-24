import { randomBytes } from "node:crypto";
import WebSocket, { WebSocketServer, type RawData } from "ws";
import type { BailianRealtimeRegion } from "../../shared/types";

export interface RealtimeProxyTarget {
  modelId: string;
  endpoint: string;
  apiKey: string;
  workspace?: string;
}

export interface RealtimeProxySession {
  token: string;
  url: string;
  transport: "websocket";
  authMode: "api-key-header";
}

interface ProxyConnection {
  token: string;
  target: RealtimeProxyTarget;
  client: WebSocket | null;
  upstream: WebSocket | null;
  queuedMessages: Array<{ data: RawData; isBinary: boolean }>;
  expiryTimer: NodeJS.Timeout;
}

const PROXY_HOST = "127.0.0.1";
const PROXY_SESSION_TTL_MS = 60_000;
const QWEN38_REALTIME_MODEL = "qwen3.8-omni-flash-realtime";
const BAILIAN_WORKSPACE_HOST = /^([a-z0-9-]+)\.(cn-beijing|ap-southeast-1)\.maas\.aliyuncs\.com$/i;

let proxyServer: WebSocketServer | null = null;
let proxyServerPortPromise: Promise<number> | null = null;
const connections = new Map<string, ProxyConnection>();

function normalizeCloseCode(code: number): number {
  return code >= 1000 && code <= 4999 && code !== 1004 && code !== 1005 && code !== 1006
    ? code
    : 1000;
}

function closeSocket(socket: WebSocket | null, code: number, reason: string): void {
  if (!socket) return;
  if (socket.readyState === WebSocket.CONNECTING) {
    socket.terminate();
  } else if (socket.readyState === WebSocket.OPEN) {
    socket.close(normalizeCloseCode(code), reason);
  }
}

export function buildBailianRealtimeEndpoint(options: {
  modelId: string;
  endpoint: string;
  workspace?: string;
  region?: BailianRealtimeRegion;
}): string {
  const url = new URL(options.endpoint);
  if (options.modelId.toLowerCase() !== QWEN38_REALTIME_MODEL) {
    if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      throw new Error("阿里云百炼 Realtime 地址必须使用 ws:// 或 wss://。");
    }
    if (!url.searchParams.has("model")) url.searchParams.set("model", options.modelId);
    return url.toString();
  }

  const workspaceId = options.workspace?.trim();
  const boundHost = url.hostname.match(BAILIAN_WORKSPACE_HOST);
  if (boundHost) {
    if (workspaceId && boundHost[1].toLowerCase() !== workspaceId.toLowerCase()) {
      throw new Error("Realtime 地址中的 Workspace ID 与百炼业务空间 ID 不一致。");
    }
    url.protocol = "wss:";
  } else {
    if (!workspaceId) {
      throw new Error(
        "qwen3.8-omni-flash-realtime 必须填写百炼业务空间 ID，并使用绑定业务空间的地域地址。",
      );
    }
    if (!/^[a-z0-9-]+$/i.test(workspaceId)) {
      throw new Error("百炼业务空间 ID 格式无效。");
    }
    const region = options.region ?? "cn-beijing";
    url.protocol = "wss:";
    url.hostname = `${workspaceId}.${region}.maas.aliyuncs.com`;
  }

  url.pathname = "/api-ws/v1/realtime";
  url.search = "";
  url.searchParams.set("model", options.modelId);
  url.hash = "";
  return url.toString();
}

export function inferBailianRealtimeWorkspaceId(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).hostname.match(BAILIAN_WORKSPACE_HOST)?.[1];
  } catch {
    return undefined;
  }
}

export function resolveBailianRealtimeWorkspaceId(
  endpoint: string,
  workspace?: string,
): string | undefined {
  const endpointWorkspace = inferBailianRealtimeWorkspaceId(endpoint);
  const configuredWorkspace = workspace?.trim();
  if (
    endpointWorkspace &&
    configuredWorkspace &&
    endpointWorkspace.toLowerCase() !== configuredWorkspace.toLowerCase()
  ) {
    throw new Error("Realtime 地址中的 Workspace ID 与百炼业务空间 ID 不一致。");
  }
  return endpointWorkspace ?? configuredWorkspace;
}

function sanitizeDiagnosticText(value: string, secret?: string): string {
  const withSecretRedacted = secret ? value.split(secret).join("[REDACTED]") : value;
  return withSecretRedacted
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

function safeEndpointLabel(raw: string): string {
  try {
    const url = new URL(raw);
    const model = url.searchParams.get("model");
    return `${url.protocol}//${url.host}${url.pathname}${model ? `?model=${encodeURIComponent(model)}` : ""}`;
  } catch {
    return "[invalid endpoint]";
  }
}

function describeSocketError(error: Error, secret?: string): Record<string, unknown> {
  const socketError = error as NodeJS.ErrnoException & { cause?: unknown };
  const details: Record<string, unknown> = {
    name: error.name,
    message: sanitizeDiagnosticText(error.message, secret),
  };
  for (const field of ["code", "errno", "syscall", "hostname", "address", "port"] as const) {
    const value = socketError[field];
    if (value !== undefined) details[field] = value;
  }
  if (socketError.cause instanceof Error)
    details.cause = describeSocketError(socketError.cause, secret);
  return details;
}

function buildUpstreamUrl(target: RealtimeProxyTarget): string {
  const url = new URL(target.endpoint);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("Realtime proxy endpoint must use ws:// or wss://.");
  }
  if (!url.searchParams.has("model")) url.searchParams.set("model", target.modelId);
  return url.toString();
}

function closeConnection(connection: ProxyConnection, code = 1000, reason = ""): void {
  clearTimeout(connection.expiryTimer);
  closeSocket(connection.client, code, reason);
  closeSocket(connection.upstream, code, reason);
  connections.delete(connection.token);
}

function sendQueuedMessages(connection: ProxyConnection): void {
  const upstream = connection.upstream;
  if (!upstream || upstream.readyState !== WebSocket.OPEN) return;
  for (const message of connection.queuedMessages) {
    upstream.send(message.data, { binary: message.isBinary });
  }
  connection.queuedMessages = [];
}

function attachConnection(connection: ProxyConnection, client: WebSocket): void {
  connection.client = client;

  let upstreamUrl: string;
  try {
    upstreamUrl = buildUpstreamUrl(connection.target);
  } catch {
    client.close(1008, "Invalid realtime endpoint");
    closeConnection(connection, 1008, "Invalid realtime endpoint");
    return;
  }

  const upstream = new WebSocket(upstreamUrl, {
    headers: {
      Authorization: `Bearer ${connection.target.apiKey}`,
      ...(connection.target.workspace
        ? { "X-DashScope-WorkSpace": connection.target.workspace }
        : {}),
    },
  });
  connection.upstream = upstream;
  let upstreamRejected = false;
  let upstreamOpened = false;

  client.on("message", (data: RawData, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else connection.queuedMessages.push({ data, isBinary });
  });
  client.on("close", () => closeConnection(connection));
  client.on("error", () => closeConnection(connection, 1011, "Realtime proxy client error"));

  upstream.on("open", () => {
    upstreamOpened = true;
    sendQueuedMessages(connection);
  });
  upstream.on("message", (data: RawData, isBinary: boolean) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  upstream.on("unexpected-response", (_request, response) => {
    upstreamRejected = true;
    const chunks: Buffer[] = [];
    let remainingBytes = 4096;
    response.on("data", (chunk: Buffer) => {
      if (remainingBytes <= 0) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const accepted = bytes.subarray(0, remainingBytes);
      chunks.push(accepted);
      remainingBytes -= accepted.length;
    });
    response.on("end", () => {
      const body = sanitizeDiagnosticText(
        Buffer.concat(chunks).toString("utf8").slice(0, 4096),
        connection.target.apiKey,
      );
      console.error(
        `[realtime-proxy] upstream rejected WebSocket at ${safeEndpointLabel(upstreamUrl)}`,
        {
          statusCode: response.statusCode ?? 0,
          statusMessage: response.statusMessage
            ? sanitizeDiagnosticText(response.statusMessage, connection.target.apiKey)
            : undefined,
          body,
          workspaceHeaderSent: Boolean(connection.target.workspace),
        },
      );
      if (client.readyState === WebSocket.OPEN)
        client.close(1011, "Realtime provider rejected connection");
      closeConnection(connection, 1011, "Realtime provider rejected connection");
    });
  });
  upstream.on("close", (code, reason) => {
    if (!upstreamOpened && !upstreamRejected) {
      console.error(
        `[realtime-proxy] upstream closed during handshake at ${safeEndpointLabel(upstreamUrl)}`,
        {
          closeCode: code,
          closeReason: sanitizeDiagnosticText(reason.toString(), connection.target.apiKey),
          workspaceHeaderSent: Boolean(connection.target.workspace),
        },
      );
    }
    if (client.readyState === WebSocket.OPEN) client.close(normalizeCloseCode(code), reason);
    closeConnection(connection, code, reason.toString());
  });
  upstream.on("error", (error) => {
    if (upstreamRejected) return;
    console.error(
      `[realtime-proxy] upstream connection failed at ${safeEndpointLabel(upstreamUrl)}`,
      {
        phase: upstreamOpened ? "connection" : "handshake",
        workspaceHeaderSent: Boolean(connection.target.workspace),
        error: describeSocketError(error, connection.target.apiKey),
      },
    );
    if (client.readyState === WebSocket.OPEN) client.close(1011, "Realtime provider error");
    closeConnection(connection, 1011, "Realtime provider error");
  });
}

async function ensureProxyServer(): Promise<number> {
  if (proxyServerPortPromise) return proxyServerPortPromise;

  proxyServer = new WebSocketServer({
    host: PROXY_HOST,
    port: 0,
    handleProtocols: (protocols) => (protocols.has("realtime") ? "realtime" : false),
  });
  proxyServer.on("connection", (client, request) => {
    const requestUrl = new URL(request.url ?? "/", `ws://${PROXY_HOST}`);
    const token = requestUrl.searchParams.get("session") ?? "";
    const connection = connections.get(token);
    if (!connection || connection.client) {
      client.close(1008, "Invalid realtime proxy session");
      return;
    }
    attachConnection(connection, client);
  });

  proxyServerPortPromise = new Promise<number>((resolve, reject) => {
    const server = proxyServer;
    if (!server) return reject(new Error("Realtime proxy server failed to initialize."));
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      proxyServerPortPromise = null;
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        proxyServerPortPromise = null;
        reject(new Error("Realtime proxy server did not expose a TCP port."));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
  });

  try {
    return await proxyServerPortPromise;
  } catch (error) {
    proxyServer?.close();
    proxyServer = null;
    throw error;
  }
}

export async function createRealtimeProxySession(
  target: RealtimeProxyTarget,
): Promise<RealtimeProxySession> {
  const endpoint = new URL(target.endpoint);
  if (endpoint.protocol !== "ws:" && endpoint.protocol !== "wss:") {
    throw new Error("Realtime proxy endpoint must use ws:// or wss://.");
  }
  const workspace = resolveBailianRealtimeWorkspaceId(endpoint.toString(), target.workspace);

  const port = await ensureProxyServer();
  const token = randomBytes(32).toString("hex");
  const expiryTimer = setTimeout(() => {
    const connection = connections.get(token);
    if (connection) closeConnection(connection, 1000, "Realtime proxy session expired");
  }, PROXY_SESSION_TTL_MS);
  expiryTimer.unref?.();

  connections.set(token, {
    token,
    target: {
      ...target,
      endpoint: endpoint.toString(),
      workspace,
    },
    client: null,
    upstream: null,
    queuedMessages: [],
    expiryTimer,
  });

  return {
    token,
    url: `ws://${PROXY_HOST}:${port}/realtime?session=${encodeURIComponent(token)}`,
    transport: "websocket",
    authMode: "api-key-header",
  };
}

export async function closeRealtimeProxy(): Promise<void> {
  for (const connection of connections.values()) closeConnection(connection);
  connections.clear();
  const server = proxyServer;
  proxyServer = null;
  proxyServerPortPromise = null;
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
