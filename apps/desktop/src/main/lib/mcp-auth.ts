import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { shell } from "electron";
import {
  auth,
  type OAuthClientInformationMixed,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthClientInformationFull,
  type OAuthDiscoveryState,
  type OAuthTokens,
} from "@modelcontextprotocol/client";
import type { McpAuthStatus, McpAuthorizationResult, ToolServer } from "../../shared/types";
import {
  deleteToolSecret,
  getMcpServer,
  getToolSecretValue,
  listToolSecretsPublic,
  setToolSecretAsync,
} from "./db";
import { closeMcpConnection as closeMcpClient } from "./mcp-client-manager";

const TOKEN_KEY = "mcp.oauth.tokens";
const CLIENT_KEY = "mcp.oauth.client";
const VERIFIER_KEY = "mcp.oauth.verifier";
const DISCOVERY_KEY = "mcp.oauth.discovery";

type AuthListener = (serverId: string, status: McpAuthStatus) => void;

const providers = new Map<string, Promise<McpOAuthProvider>>();
const pendingStates = new Map<string, McpOAuthProvider>();
const listeners = new Set<AuthListener>();
let loopback: Server | null = null;
let loopbackReady: Promise<string> | null = null;
let redirectUrl: string | null = null;

export function onMcpAuthChanged(listener: AuthListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getMcpOAuthProvider(
  server: ToolServer,
): Promise<OAuthClientProvider | undefined> {
  if (server.transport !== "http" && server.transport !== "sse") return undefined;
  return providerFor(server);
}

export async function authorizeMcpServer(serverId: string): Promise<McpAuthorizationResult> {
  const server = requireRemoteServer(serverId);
  const provider = await providerFor(server);
  emit(serverId, { status: "pending", expiresAt: null });
  try {
    const result = await auth(provider, { serverUrl: server.url! });
    if (result === "REDIRECT") {
      emit(serverId, { status: "pending", expiresAt: null });
      return {
        status: "pending",
        authorizationUrl: provider.lastAuthorizationUrl,
        message: "Complete authorization in your browser, then return to Ayaka.",
      };
    }
    const status = getMcpAuthStatus(serverId);
    emit(serverId, status);
    return { status: "authorized", message: "MCP server authorized." };
  } catch (error) {
    const status: McpAuthStatus = {
      status: "error",
      expiresAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
    emit(serverId, status);
    throw error;
  }
}

export function getMcpAuthStatus(serverId: string): McpAuthStatus {
  const server = getMcpServer(serverId);
  if (!server || (server.transport !== "http" && server.transport !== "sse")) {
    return { status: "not_required", expiresAt: null };
  }
  const raw = getToolSecretValue("server", serverId, TOKEN_KEY);
  if (!raw) return { status: "unknown", expiresAt: null };
  try {
    const tokens = JSON.parse(raw) as OAuthTokens & { ayaka_saved_at?: number };
    const savedAt = typeof tokens.ayaka_saved_at === "number" ? tokens.ayaka_saved_at : Date.now();
    const expiresAt =
      typeof tokens.expires_in === "number" ? savedAt + tokens.expires_in * 1000 : null;
    return { status: "authorized", expiresAt };
  } catch {
    return { status: "error", expiresAt: null, error: "Stored MCP authorization is invalid." };
  }
}

export async function logoutMcpServer(serverId: string): Promise<boolean> {
  const secrets = listToolSecretsPublic("server", serverId).filter((secret) =>
    [TOKEN_KEY, CLIENT_KEY, VERIFIER_KEY, DISCOVERY_KEY].includes(secret.key),
  );
  for (const secret of secrets) deleteToolSecret(secret.id);
  providers.delete(serverId);
  await closeMcpClient(serverId);
  emit(serverId, { status: "unknown", expiresAt: null });
  return true;
}

export async function closeMcpOAuthLoopback(): Promise<void> {
  const server = loopback;
  const ready = loopbackReady;
  loopback = null;
  loopbackReady = null;
  redirectUrl = null;
  pendingStates.clear();
  if (!server) return;
  await ready?.catch(() => undefined);
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function providerFor(server: ToolServer): Promise<McpOAuthProvider> {
  const existing = providers.get(server.id);
  if (existing) return existing;
  const pending = ensureLoopbackRedirect().then(
    (redirect) => new McpOAuthProvider(server.id, server.url ?? "", redirect),
  );
  providers.set(server.id, pending);
  try {
    return await pending;
  } catch (error) {
    providers.delete(server.id);
    throw error;
  }
}

function requireRemoteServer(serverId: string): ToolServer {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found: " + serverId);
  if (server.transport !== "http" && server.transport !== "sse") {
    throw new Error("OAuth is only available for remote MCP servers.");
  }
  if (!server.url) throw new Error("MCP server is missing a URL.");
  return server;
}

function emit(serverId: string, status: McpAuthStatus): void {
  for (const listener of listeners) {
    try {
      listener(serverId, status);
    } catch {
      // Event subscribers are best effort.
    }
  }
}

function ensureLoopbackRedirect(): Promise<string> {
  if (redirectUrl) return Promise.resolve(redirectUrl);
  if (loopbackReady) return loopbackReady;
  const server = createServer((request, response) => void handleCallback(request, response));
  loopback = server;
  loopbackReady = new Promise<string>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener("listening", onListening);
      loopback = null;
      loopbackReady = null;
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        onError(new Error("MCP OAuth loopback listener did not expose a port."));
        return;
      }
      redirectUrl = `http://127.0.0.1:${address.port}/mcp/oauth/callback`;
      resolve(redirectUrl);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  return loopbackReady;
}

async function handleCallback(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp/oauth/callback") {
    response.writeHead(404).end();
    return;
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const provider = state ? pendingStates.get(state) : undefined;
  if (!state || !provider || !code) {
    response
      .writeHead(400, { "content-type": "text/plain; charset=utf-8" })
      .end("Invalid MCP OAuth callback.");
    return;
  }
  pendingStates.delete(state);
  try {
    const server = requireRemoteServer(provider.serverId);
    await auth(provider, {
      serverUrl: server.url!,
      authorizationCode: code,
      iss: url.searchParams.get("iss") ?? undefined,
    });
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        "<title>Ayaka authorization complete</title><p>Authorization complete. You can return to Ayaka.</p>",
      );
    emit(provider.serverId, getMcpAuthStatus(provider.serverId));
  } catch (error) {
    response
      .writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      .end("MCP authorization failed.");
    emit(provider.serverId, {
      status: "error",
      expiresAt: null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

class McpOAuthProvider implements OAuthClientProvider {
  readonly serverId: string;
  readonly serverUrl: string;
  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;
  lastAuthorizationUrl: string | undefined;
  private verifier: string | undefined;

  constructor(serverId: string, serverUrl: string, redirectUrlValue: string) {
    this.serverId = serverId;
    this.serverUrl = serverUrl;
    this.redirectUrl = redirectUrlValue;
    this.clientMetadata = {
      client_name: "Ayaka",
      redirect_uris: [redirectUrlValue],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  state(): string {
    const state = randomUUID();
    pendingStates.set(state, this);
    return state;
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const raw = getToolSecretValue("server", this.serverId, CLIENT_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthClientInformationFull;
    } catch {
      return undefined;
    }
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await setToolSecretAsync({
      ownerType: "server",
      ownerId: this.serverId,
      key: CLIENT_KEY,
      label: "MCP OAuth client metadata",
      value: JSON.stringify(clientInformation),
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const raw = getToolSecretValue("server", this.serverId, TOKEN_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthTokens;
    } catch {
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await setToolSecretAsync({
      ownerType: "server",
      ownerId: this.serverId,
      key: TOKEN_KEY,
      label: "MCP OAuth tokens",
      value: JSON.stringify({ ...tokens, ayaka_saved_at: Date.now() }),
    });
    this.verifier = undefined;
    await deleteSecretByKey(this.serverId, VERIFIER_KEY);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    this.lastAuthorizationUrl = url.toString();
    await shell.openExternal(this.lastAuthorizationUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.verifier = codeVerifier;
    await setToolSecretAsync({
      ownerType: "server",
      ownerId: this.serverId,
      key: VERIFIER_KEY,
      label: "MCP OAuth PKCE verifier",
      value: codeVerifier,
    });
  }

  async codeVerifier(): Promise<string> {
    if (this.verifier) return this.verifier;
    const stored = getToolSecretValue("server", this.serverId, VERIFIER_KEY);
    if (!stored) throw new Error("MCP OAuth PKCE verifier is missing.");
    this.verifier = stored;
    return stored;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await setToolSecretAsync({
      ownerType: "server",
      ownerId: this.serverId,
      key: DISCOVERY_KEY,
      label: "MCP OAuth discovery state",
      value: JSON.stringify(state),
    });
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    const raw = getToolSecretValue("server", this.serverId, DISCOVERY_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as OAuthDiscoveryState;
    } catch {
      return undefined;
    }
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all" || scope === "client") await deleteSecretByKey(this.serverId, CLIENT_KEY);
    if (scope === "all" || scope === "tokens") await deleteSecretByKey(this.serverId, TOKEN_KEY);
    if (scope === "all" || scope === "verifier")
      await deleteSecretByKey(this.serverId, VERIFIER_KEY);
    if (scope === "all" || scope === "discovery")
      await deleteSecretByKey(this.serverId, DISCOVERY_KEY);
  }
}

async function deleteSecretByKey(serverId: string, key: string): Promise<void> {
  for (const secret of listToolSecretsPublic("server", serverId)) {
    if (secret.key === key) deleteToolSecret(secret.id);
  }
}
