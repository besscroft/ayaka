import type {
  McpManagerSnapshot,
  McpDependencyInstallation,
  McpServerRuntimeState,
  McpLifecycleState,
  ToolServer,
} from "../../shared/types";
import {
  getMcpDependencyInstallation,
  getMcpRuntimeState,
  getMcpServer,
  insertRuntimeEvent,
  listMcpServers,
  listManagedRuntimes,
  listRuntimePreferences,
  listToolRecords,
  upsertMcpRuntimeStateAsync,
  updateMcpServerStatusAsync,
} from "./db";
import {
  closeAllMcpConnections,
  closeMcpConnection,
  getMcpConnection,
  type McpConnectionEvent,
  mcpConnection,
  onMcpConnectionEvent,
} from "./mcp-client-manager";
import { parseMcpCommand } from "./mcp-command";
import {
  isRuntimeCommandAvailable,
  managedRuntimeForCommand,
  resolveMcpCommand,
  runtimeKindForCommand,
} from "./runtime-manager";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const operations = new Map<string, Promise<unknown>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const stateListeners = new Set<(state: McpServerRuntimeState) => void>();
let shuttingDown = false;
let connectionEventUnsubscribe: (() => void) | null = null;

export function onMcpLifecycleStateChanged(
  listener: (state: McpServerRuntimeState) => void,
): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function handleMcpConnectionEvent(event: McpConnectionEvent): void {
  if (event.type !== "connection-closed" || shuttingDown) return;
  const state = getMcpRuntimeState(event.serverId);
  const server = getMcpServer(event.serverId);
  if (server?.transport !== "stdio") {
    void setState(event.serverId, {
      desiredState: "stopped",
      state: "stopped",
      lastExitAt: Date.now(),
      pid: null,
      nextRetryAt: null,
      lastError: null,
    });
    return;
  }
  if (!state || state.desiredState !== "running") {
    void setState(event.serverId, { state: "stopped", lastExitAt: Date.now(), pid: null });
    return;
  }
  scheduleReconnect(event.serverId, state.restartAttempts);
}

function subscribeToConnectionEvents(): void {
  if (!connectionEventUnsubscribe) {
    connectionEventUnsubscribe = onMcpConnectionEvent(handleMcpConnectionEvent);
  }
}

subscribeToConnectionEvents();

export async function startMcpServer(serverId: string): Promise<McpServerRuntimeState> {
  return runExclusive(serverId, async () => {
    const server = requireMcpServer(serverId);
    const currentState = getMcpRuntimeState(serverId);
    let parsedCommand: ReturnType<typeof parseMcpCommand> | null = null;
    if (currentState?.state === "running" && mcpConnection(serverId)) return currentState;
    if (server.enabled === 0) {
      return setState(serverId, { desiredState: "stopped", state: "stopped", lastError: null });
    }
    if (server.transport === "stdio") {
      const command = parseMcpCommand(server.command, parseArray(server.args_json));
      parsedCommand = command;
      const runtimeKind = runtimeKindForCommand(server.command ?? "");
      if (runtimeKind && !isRuntimeCommandAvailable(server.command ?? "")) {
        return setState(serverId, {
          desiredState: "stopped",
          state: "needs_runtime",
          lastError: `${runtimeKind === "node" ? "Node.js" : "uv"} Runtime is not available. Install it from Ayaka Settings or add it to PATH.`,
        });
      }
      const dependency = getMcpDependencyInstallation(server.id);
      if (command.manager !== "none" && dependency?.status !== "installed") {
        const needsConfirmation =
          command.installStatus === "needs_confirmation" ||
          dependency?.status === "needs_confirmation";
        return setState(serverId, {
          desiredState: "stopped",
          state: needsConfirmation ? "needs_confirmation" : "needs_install",
          lastError:
            dependency?.lastError ?? "Install this MCP server's dependencies before starting it.",
        });
      }
    }
    clearRetry(serverId);
    await setState(serverId, {
      desiredState: "running",
      state: "starting",
      lastError: null,
      nextRetryAt: null,
      ...(server.command
        ? {
            resolvedCommand:
              parsedCommand?.resolvedCommand ?? resolveMcpCommand(server.command).command,
            runtimeInstallationId:
              managedRuntimeForCommand(parsedCommand?.resolvedCommand ?? server.command)?.runtime
                .id ?? null,
          }
        : {}),
    });
    try {
      await getMcpConnection(server);
      const next = await setState(serverId, {
        desiredState: "running",
        state: "running",
        startedAt: Date.now(),
        restartAttempts: 0,
        nextRetryAt: null,
        lastError: null,
      });
      await updateMcpServerStatusAsync(serverId, {
        status: "ready",
        last_error: null,
        last_connected_at: next.startedAt,
      });
      recordLifecycleEvent(server, "MCP server started", "succeeded");
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = classifyFailure(message, server);
      const next = await setState(serverId, { state, lastError: message, pid: null });
      await updateMcpServerStatusAsync(serverId, { status: "error", last_error: message });
      recordLifecycleEvent(server, "MCP server start failed", "failed", { state, error: message });
      return next;
    }
  });
}

/**
 * Keep the lifecycle badge actionable when dependency installation finishes
 * without starting a server, for example while waiting for uvx script
 * confirmation or after a failed install.
 */
export async function syncMcpDependencyState(
  serverId: string,
  dependency: McpDependencyInstallation,
): Promise<McpServerRuntimeState | null> {
  return runExclusive(serverId, async () => {
    const server = requireMcpServer(serverId);
    if (server.transport !== "stdio") return getMcpRuntimeState(serverId);
    const command = parseMcpCommand(server.command, parseArray(server.args_json));
    if (command.manager === "none") return getMcpRuntimeState(serverId);

    if (dependency.status === "installed") {
      return setState(serverId, {
        desiredState: "stopped",
        state: "stopped",
        pid: null,
        nextRetryAt: null,
        lastError: null,
      });
    }
    if (dependency.status === "needs_confirmation") {
      return setState(serverId, {
        desiredState: "stopped",
        state: "needs_confirmation",
        pid: null,
        nextRetryAt: null,
        lastError: dependency.lastError,
      });
    }
    if (dependency.status === "failed" || dependency.status === "not_installed") {
      const needsRuntime =
        dependency.status === "failed" &&
        /Runtime is not available/i.test(dependency.lastError ?? "");
      return setState(serverId, {
        desiredState: "stopped",
        state: needsRuntime ? "needs_runtime" : "needs_install",
        pid: null,
        nextRetryAt: null,
        lastError:
          dependency.lastError ?? "Install this MCP server's dependencies before starting it.",
      });
    }
    if (dependency.status === "installing") {
      return setState(serverId, {
        desiredState: "stopped",
        state: "stopped",
        pid: null,
        nextRetryAt: null,
        lastError: null,
      });
    }
    return getMcpRuntimeState(serverId);
  });
}

export async function ensureMcpServerStarted(serverId: string): Promise<void> {
  const state = getMcpRuntimeState(serverId);
  if (state?.state === "running") return;
  const next = await startMcpServer(serverId);
  if (next.state !== "running") throw new Error(next.lastError ?? `MCP server is ${next.state}.`);
}

export async function stopMcpServer(serverId: string): Promise<McpServerRuntimeState> {
  return runExclusive(serverId, async () => {
    const server = requireMcpServer(serverId);
    clearRetry(serverId);
    await setState(serverId, {
      desiredState: "stopped",
      state: "stopping",
      nextRetryAt: null,
      lastError: null,
    });
    await closeMcpConnection(serverId);
    const next = await setState(serverId, {
      desiredState: "stopped",
      state: "stopped",
      pid: null,
      lastExitAt: Date.now(),
      nextRetryAt: null,
    });
    await updateMcpServerStatusAsync(serverId, {
      status: server.enabled === 0 ? "disabled" : "unknown",
      last_error: null,
    });
    recordLifecycleEvent(server, "MCP server stopped", "succeeded");
    return next;
  });
}

export async function restartMcpServer(serverId: string): Promise<McpServerRuntimeState> {
  await stopMcpServer(serverId);
  return startMcpServer(serverId);
}

export async function probeMcpServer(serverId: string): Promise<McpServerRuntimeState> {
  return startMcpServer(serverId);
}

export function getMcpManagerSnapshot(): McpManagerSnapshot {
  const states = new Map(
    listMcpServers().map((server) => [
      server.id,
      getMcpRuntimeState(server.id) ?? defaultState(server.id),
    ]),
  );
  return {
    servers: listMcpServers().map((server) => ({
      server,
      runtime: states.get(server.id) ?? defaultState(server.id),
      dependency: getMcpDependencyInstallation(server.id),
    })),
    managedRuntimes: listManagedRuntimes(),
    runtimePreferences: listRuntimePreferences(),
    tools: listToolRecords("mcp"),
  };
}

export async function shutdownMcpLifecycle(): Promise<void> {
  shuttingDown = true;
  connectionEventUnsubscribe?.();
  connectionEventUnsubscribe = null;
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  await closeAllMcpConnections();
}

export function resumeMcpLifecycle(): void {
  shuttingDown = false;
  subscribeToConnectionEvents();
}

/**
 * A process crash can leave the persisted desired state at `running` even
 * though no child process survived. Recover that durable state without
 * connecting any server; the next tool call, discovery, or explicit Start
 * performs the lazy connection.
 */
export async function recoverMcpLifecycleStates(): Promise<void> {
  for (const server of listMcpServers()) {
    const state = getMcpRuntimeState(server.id);
    if (!state || (state.state === "stopped" && state.desiredState === "stopped")) continue;
    await setState(server.id, {
      desiredState: "stopped",
      state: "stopped",
      pid: null,
      nextRetryAt: null,
      lastError: state.lastError ?? null,
    });
  }
}

async function setState(
  serverId: string,
  patch: Omit<Parameters<typeof upsertMcpRuntimeStateAsync>[0], "serverId">,
): Promise<McpServerRuntimeState> {
  const state = await upsertMcpRuntimeStateAsync({ serverId, ...patch });
  for (const listener of stateListeners) {
    try {
      listener(state);
    } catch {
      // Renderer observers must not affect lifecycle state.
    }
  }
  return state;
}

function scheduleReconnect(serverId: string, attempts: number): void {
  if (retryTimers.has(serverId) || attempts >= RETRY_DELAYS_MS.length) {
    if (attempts >= RETRY_DELAYS_MS.length) {
      void setState(serverId, {
        state: "error",
        lastError: "MCP server stopped after 3 reconnect attempts.",
      });
    }
    return;
  }
  const delay = RETRY_DELAYS_MS[attempts] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
  void setState(serverId, {
    state: "reconnecting",
    restartAttempts: attempts + 1,
    nextRetryAt: Date.now() + delay,
  });
  const timer = setTimeout(() => {
    retryTimers.delete(serverId);
    void startMcpServer(serverId).catch(() => undefined);
  }, delay);
  retryTimers.set(serverId, timer);
}

function clearRetry(serverId: string): void {
  const timer = retryTimers.get(serverId);
  if (timer) clearTimeout(timer);
  retryTimers.delete(serverId);
}

async function runExclusive<T>(serverId: string, operation: () => Promise<T>): Promise<T> {
  const previous = operations.get(serverId) as Promise<unknown> | undefined;
  const next = (previous ?? Promise.resolve()).then(operation);
  operations.set(serverId, next);
  try {
    return await next;
  } finally {
    if (operations.get(serverId) === next) operations.delete(serverId);
  }
}

function requireMcpServer(serverId: string): ToolServer {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found: " + serverId);
  return server;
}

function defaultState(serverId: string): McpServerRuntimeState {
  return {
    serverId,
    desiredState: "stopped",
    state: "stopped",
    pid: null,
    resolvedCommand: null,
    runtimeInstallationId: null,
    startedAt: null,
    lastExitAt: null,
    restartAttempts: 0,
    nextRetryAt: null,
    lastError: null,
    updatedAt: 0,
  };
}

function classifyFailure(message: string, server: ToolServer): McpLifecycleState {
  if (
    /uv trampoline failed to canonicalize script path|uv trampoline failed to determine executable path/i.test(
      message,
    )
  ) {
    return "needs_install";
  }
  if (
    server.transport === "stdio" &&
    runtimeKindForCommand(server.command ?? "") &&
    /not found|ENOENT|spawn\s+.+\s+ENOENT/i.test(message)
  ) {
    return "needs_runtime";
  }
  if (/install this MCP server|could not safely identify|package/i.test(message)) {
    return "needs_install";
  }
  return "error";
}

function recordLifecycleEvent(
  server: ToolServer,
  title: string,
  status: "succeeded" | "failed",
  detail?: Record<string, unknown>,
): void {
  insertRuntimeEvent({
    kind: status === "failed" ? "error" : "tool",
    title,
    status,
    owner_type: "server",
    owner_id: server.id,
    detail: { serverId: server.id, ...detail },
  });
}

function parseArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}
