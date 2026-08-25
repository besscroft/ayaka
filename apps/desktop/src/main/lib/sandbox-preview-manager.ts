import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { BrowserWindow, WebContentsView } from "electron";
import {
  createSandboxPreviewArtifact,
  getOwnedArtifact,
  MAX_HTML_EXECUTABLE_BYTES,
  setSandboxArtifactStatus,
} from "./sandbox-artifact-manager";
import { getSandboxArtifact, getSandboxSession } from "./db";
import { buildSandboxDockerArgs, resolveSandboxPath } from "./sandbox-agents";
import { terminateProcessTree } from "./workspace-command";
import type {
  SandboxArtifact,
  SandboxPreview,
  SandboxPreviewStatus,
  SandboxSession,
} from "../../shared/types";

const PREVIEW_START_TIMEOUT_MS = 15_000;
const PREVIEW_HEALTH_INTERVAL_MS = 120;
const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4_096;
const MAX_ENV_ENTRIES = 64;
const MAX_ENV_VALUE_LENGTH = 16_384;

interface PreviewLaunch {
  executable: string;
  args: string[];
  cwd: string;
  port?: number;
  env: Record<string, string>;
}

interface PreviewHandle extends SandboxPreview {
  sessionId: string;
  launch: PreviewLaunch;
  child: ChildProcess | null;
  view: WebContentsView | null;
  window: BrowserWindow | null;
  dockerContainerName: string | null;
  stopping: boolean;
}

const handles = new Map<string, PreviewHandle>();
const listeners = new Set<(preview: SandboxPreview) => void>();

export interface StartSandboxPreviewInput {
  artifactId: string;
  executable: string;
  args?: string[];
  cwd?: string;
  port?: number;
  env?: Record<string, string>;
}

export function onSandboxPreviewUpdated(listener: (preview: SandboxPreview) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listSandboxPreviewsForConversation(conversationId: string): SandboxPreview[] {
  return [...handles.values()]
    .filter((handle) => handle.conversation_id === conversationId)
    .map(publicPreview);
}

export function getSandboxPreview(previewId: string): SandboxPreview | null {
  const handle = handles.get(previewId);
  return handle ? publicPreview(handle) : null;
}

export function isSandboxPreviewPortManaged(sessionId: string, port: number): boolean {
  return [...handles.values()].some(
    (handle) =>
      handle.sessionId === sessionId && handle.port === port && handle.status === "running",
  );
}

export async function startSandboxPreview(
  session: SandboxSession,
  input: StartSandboxPreviewInput,
): Promise<SandboxPreview> {
  const artifact = getOwnedArtifact(session.conversation_id ?? "", input.artifactId);
  if (artifact.session_id !== session.id)
    throw new Error("Sandbox artifact belongs to another session.");
  if (artifact.kind === "html" && (artifact.size_bytes ?? 0) > MAX_HTML_EXECUTABLE_BYTES) {
    throw new Error("HTML artifacts over 256 KB can only be shown as source.");
  }
  if (artifact.kind !== "html" && artifact.kind !== "static") {
    throw new Error("Only published HTML or static artifacts can be previewed.");
  }
  const launch = await normalizeLaunch(session, input);
  const previewId = randomUUID();
  return startWithId(previewId, session, artifact, launch);
}

export async function stopSandboxPreview(
  previewId: string,
  conversationId?: string,
): Promise<SandboxPreview> {
  const handle = getHandle(previewId);
  assertPreviewConversation(handle, conversationId);
  await stopHandle(handle);
  return publicPreview(handle);
}

export async function restartSandboxPreview(
  previewId: string,
  conversationId?: string,
): Promise<SandboxPreview> {
  const handle = getHandle(previewId);
  assertPreviewConversation(handle, conversationId);
  const session = getSandboxSession(handle.sessionId);
  const artifact = getSandboxArtifact(handle.artifact_id);
  if (!session || !artifact) throw new Error("Preview resources are no longer available.");
  await stopHandle(handle);
  handle.stopping = false;
  handle.status = "starting";
  handle.error = null;
  handle.updated_at = Date.now();
  emitPreview(handle);
  return startWithId(handle.id, session, artifact, handle.launch, handle);
}

export async function closeSandboxPreview(
  previewId: string,
  conversationId?: string,
): Promise<boolean> {
  const handle = getHandle(previewId);
  assertPreviewConversation(handle, conversationId);
  await stopHandle(handle);
  detachView(handle);
  handles.delete(previewId);
  return true;
}

export async function closeSandboxPreviewsForConversation(conversationId: string): Promise<number> {
  const ids = [...handles.values()]
    .filter((handle) => handle.conversation_id === conversationId)
    .map((handle) => handle.id);
  await Promise.all(ids.map((id) => closeSandboxPreview(id)));
  return ids.length;
}

export async function closeAllSandboxPreviews(): Promise<void> {
  await Promise.all(
    [...handles.keys()].map((id) => closeSandboxPreview(id).catch(() => undefined)),
  );
}

export function setSandboxPreviewBounds(
  previewId: string,
  conversationId: string | undefined,
  window: BrowserWindow,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  const handle = getHandle(previewId);
  assertPreviewConversation(handle, conversationId);
  if (handle.status !== "running") return;
  const safeBounds = {
    x: clampInt(bounds.x, 0, 100_000),
    y: clampInt(bounds.y, 0, 100_000),
    width: clampInt(bounds.width, 1, 100_000),
    height: clampInt(bounds.height, 1, 100_000),
  };
  if (!handle.view || handle.window !== window) {
    detachView(handle);
    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition: `sandbox-preview-${handle.id}`,
        webSecurity: true,
      },
    });
    handle.view = view;
    handle.window = window;
    window.contentView.addChildView(view);
    configurePreviewView(handle, view);
    void view.webContents.loadURL(handle.url);
  }
  handle.view.setBounds(safeBounds);
}

export function setSandboxPreviewVisible(
  previewId: string,
  conversationId: string | undefined,
  window: BrowserWindow,
  visible: boolean,
): void {
  const handle = getHandle(previewId);
  assertPreviewConversation(handle, conversationId);
  if (!handle.view || handle.window !== window || handle.view.webContents.isDestroyed()) return;
  handle.view.setVisible(visible);
}

async function startWithId(
  previewId: string,
  session: SandboxSession,
  artifact: SandboxArtifact,
  launch: PreviewLaunch,
  existing?: PreviewHandle,
): Promise<SandboxPreview> {
  const handle: PreviewHandle = existing ?? {
    id: previewId,
    artifact_id: artifact.id,
    conversation_id: session.conversation_id ?? "",
    port: launch.port ?? 0,
    url: "",
    status: "starting",
    error: null,
    updated_at: Date.now(),
    sessionId: session.id,
    launch,
    child: null,
    view: null,
    window: null,
    dockerContainerName: null,
    stopping: false,
  };
  handle.launch = launch;
  handle.port = await findAvailablePort(launch.port);
  handle.url = `http://127.0.0.1:${handle.port}`;
  handle.status = "starting";
  handle.error = null;
  handle.updated_at = Date.now();
  handle.stopping = false;
  handles.set(handle.id, handle);
  emitPreview(handle);

  try {
    handle.child = spawnPreviewProcess(session, handle);
    attachExitHandler(handle);
    await waitForHealthy(handle);
    if (handle.stopping) throw new Error("Preview was stopped during startup.");
    handle.status = "running";
    handle.updated_at = Date.now();
    await createSandboxPreviewArtifact(session, {
      port: handle.port,
      previewId: handle.id,
      conversationId: handle.conversation_id,
    });
    await setSandboxArtifactStatus(
      artifact.id,
      artifact.status === "failed" ? "ready" : "running",
    ).catch(() => undefined);
    emitPreview(handle);
    return publicPreview(handle);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    handle.status = "failed";
    handle.error = redactPreviewError(message);
    handle.updated_at = Date.now();
    if (handle.child) await terminateProcessTree(handle.child).catch(() => undefined);
    await removePreviewDockerContainer(handle);
    await setSandboxArtifactStatus(artifact.id, "failed").catch(() => undefined);
    emitPreview(handle);
    throw new Error(handle.error);
  }
}

function spawnPreviewProcess(session: SandboxSession, handle: PreviewHandle): ChildProcess {
  if (session.isolation_mode === "docker") {
    if (session.docker_available === 0) throw new Error("Docker preview is unavailable.");
    handle.dockerContainerName = getPreviewDockerContainerName(handle.id);
    const args = buildSandboxPreviewDockerArgs(
      session,
      handle.launch,
      handle.port,
      handle.id,
      handle.dockerContainerName,
    );
    return spawn("docker", args, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "ignore", "pipe"],
    });
  }
  const cwd = resolveSandboxPath(session.root_path, handle.launch.cwd);
  const executable = resolvePreviewExecutable(session, handle.launch.cwd, handle.launch.executable);
  return spawn(executable, handle.launch.args, {
    cwd,
    env: buildPreviewEnv(handle.launch.env),
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "pipe"],
  });
}

export function buildSandboxPreviewDockerArgs(
  session: SandboxSession,
  launch: PreviewLaunch,
  port: number,
  previewId: string,
  containerName = getPreviewDockerContainerName(previewId),
): string[] {
  const base = buildSandboxDockerArgs(
    session,
    { env: launch.env },
    launch.executable,
    launch.args,
    launch.cwd === "." ? "." : launch.cwd,
    containerName,
  );
  const networkIndex = base.indexOf("--network");
  if (networkIndex >= 0) base.splice(networkIndex, 2);
  const runIndex = base.indexOf("run");
  if (runIndex < 0) throw new Error("Invalid Docker preview command.");
  base.splice(runIndex + 1, 0, "--network", "bridge", "--publish", `127.0.0.1:${port}:${port}`);
  return base;
}

function attachExitHandler(handle: PreviewHandle): void {
  const child = handle.child;
  if (!child) return;
  child.stderr?.on("data", () => undefined);
  child.once("error", (error) => {
    if (handle.stopping) return;
    void markExited(handle, redactPreviewError(error.message), "failed");
  });
  child.once("exit", (code, signal) => {
    if (handle.stopping) return;
    void markExited(
      handle,
      `Preview exited${code === null ? ` with ${signal ?? "a signal"}` : ` with code ${code}`}.`,
      "failed",
    );
  });
}

async function markExited(
  handle: PreviewHandle,
  error: string,
  status: SandboxPreviewStatus,
): Promise<void> {
  handle.child = null;
  handle.status = status;
  handle.error = status === "failed" ? error : null;
  handle.updated_at = Date.now();
  await setSandboxArtifactStatus(
    handle.artifact_id,
    status === "failed" ? "failed" : "stopped",
  ).catch(() => undefined);
  emitPreview(handle);
}

async function stopHandle(handle: PreviewHandle): Promise<void> {
  handle.stopping = true;
  const child = handle.child;
  handle.child = null;
  if (child) await terminateProcessTree(child).catch(() => undefined);
  await removePreviewDockerContainer(handle);
  handle.status = "stopped";
  handle.error = null;
  handle.updated_at = Date.now();
  await setSandboxArtifactStatus(handle.artifact_id, "stopped").catch(() => undefined);
  detachView(handle);
  emitPreview(handle);
}

function configurePreviewView(handle: PreviewHandle, view: WebContentsView): void {
  const origin = new URL(handle.url).origin;
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedPreviewUrl(url, origin)) event.preventDefault();
  });
  view.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedPreviewUrl(url, origin)) event.preventDefault();
  });
  view.webContents.session.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, callback) =>
    callback({ cancel: !isAllowedPreviewUrl(details.url, origin) }),
  );
  view.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  view.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || handle.stopping) return;
      void markExited(handle, `Preview view failed: ${errorDescription} (${errorCode}).`, "failed");
    },
  );
  view.webContents.on("dom-ready", () => {
    if (!view.webContents.isDestroyed()) {
      view.webContents
        .insertCSS(`:root { color-scheme: light dark; }`, { cssOrigin: "author" })
        .catch(() => undefined);
    }
  });
}

function detachView(handle: PreviewHandle): void {
  if (handle.view && handle.window && !handle.window.isDestroyed()) {
    handle.window.contentView.removeChildView(handle.view);
  }
  if (handle.view && !handle.view.webContents.isDestroyed()) handle.view.webContents.close();
  handle.view = null;
  handle.window = null;
}

async function normalizeLaunch(
  session: SandboxSession,
  input: StartSandboxPreviewInput,
): Promise<PreviewLaunch> {
  const executable = normalizeExecutable(input.executable);
  const args = normalizeArgs(input.args);
  const cwd = input.cwd?.trim() || ".";
  const cwdPath = resolveSandboxPath(session.root_path, cwd);
  const cwdStat = await stat(cwdPath);
  if (!cwdStat.isDirectory()) throw new Error("Preview cwd is not a directory.");
  if (
    input.port !== undefined &&
    (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535)
  ) {
    throw new Error("Preview port is invalid.");
  }
  return { executable, args, cwd, port: input.port, env: normalizeEnv(input.env) };
}

function normalizeExecutable(value: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Preview executable is required.");
  const executable = value.trim();
  if (
    executable.length > MAX_ARG_LENGTH ||
    executable.includes(String.fromCharCode(0)) ||
    /[\r\n|;&><]/.test(executable) ||
    /\s/.test(executable) ||
    path.isAbsolute(executable) ||
    /^[a-zA-Z]:[\\/]/.test(executable) ||
    executable.startsWith("\\\\") ||
    /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(executable)
  ) {
    throw new Error("Preview executable must be one structured executable token.");
  }
  return executable;
}

function resolvePreviewExecutable(
  session: SandboxSession,
  cwd: string,
  executable: string,
): string {
  if (!isPreviewPathLike(executable)) return executable;
  return resolveSandboxPath(session.root_path, path.join(cwd, executable));
}

function isPreviewPathLike(executable: string): boolean {
  return executable.startsWith(".") || executable.includes("/") || executable.includes("\\");
}

function normalizeArgs(value: string[] | undefined): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > MAX_ARGS ||
    value.some((item) => typeof item !== "string")
  ) {
    throw new Error("Preview args must be a string array with at most 64 items.");
  }
  return value.map((item) => {
    if (item.length > MAX_ARG_LENGTH || item.includes("\0"))
      throw new Error("Preview argument is invalid.");
    return item;
  });
}

function normalizeEnv(value: Record<string, string> | undefined): Record<string, string> {
  if (value === undefined) return {};
  const entries = Object.entries(value);
  if (entries.length > MAX_ENV_ENTRIES) throw new Error("Preview env has too many entries.");
  const env: Record<string, string> = {};
  const allow = new Set(["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]);
  for (const [key, raw] of entries) {
    if (
      !allow.has(key) ||
      typeof raw !== "string" ||
      raw.length > MAX_ENV_VALUE_LENGTH ||
      raw.includes("\0")
    ) {
      throw new Error(`Preview environment variable '${key}' is not allowed.`);
    }
    env[key] = raw;
  }
  return env;
}

function buildPreviewEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "Path", "SystemRoot", "TEMP", "TMP", "HOME", "USERPROFILE"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, extra);
  return env;
}

async function findAvailablePort(requested?: number): Promise<number> {
  if (requested !== undefined) {
    const available = await canListen(requested);
    if (!available) throw new Error(`Preview port ${requested} is already in use.`);
    return requested;
  }
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function canListen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function waitForHealthy(handle: PreviewHandle): Promise<void> {
  const deadline = Date.now() + PREVIEW_START_TIMEOUT_MS;
  let lastError = "Preview did not respond.";
  while (Date.now() < deadline) {
    if (handle.stopping) throw new Error("Preview was stopped during startup.");
    if (handle.child?.exitCode !== null && handle.child?.exitCode !== undefined) {
      throw new Error(`Preview exited with code ${handle.child.exitCode}.`);
    }
    try {
      const response = await fetch(handle.url, { signal: AbortSignal.timeout(800) });
      if (response.status >= 200 && response.status < 500) return;
      lastError = `Preview returned HTTP ${response.status}.`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_HEALTH_INTERVAL_MS));
  }
  throw new Error(`Preview health check timed out: ${lastError}`);
}

function getHandle(previewId: string): PreviewHandle {
  const handle = handles.get(previewId);
  if (!handle) throw new Error("Preview not found.");
  return handle;
}

function assertPreviewConversation(
  handle: PreviewHandle,
  conversationId: string | undefined,
): void {
  if (conversationId !== undefined && handle.conversation_id !== conversationId) {
    throw new Error("Preview does not belong to this conversation.");
  }
}

function publicPreview(handle: PreviewHandle): SandboxPreview {
  return {
    id: handle.id,
    artifact_id: handle.artifact_id,
    conversation_id: handle.conversation_id,
    port: handle.port,
    url: handle.url,
    status: handle.status,
    error: handle.error,
    updated_at: handle.updated_at,
  };
}

function emitPreview(handle: PreviewHandle): void {
  const preview = publicPreview(handle);
  for (const listener of listeners) listener(preview);
}

export function isAllowedPreviewUrl(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    const expected = new URL(origin);
    if (url.username || url.password) return false;
    const sameLoopback =
      url.hostname === expected.hostname &&
      url.port === expected.port &&
      (url.protocol === expected.protocol ||
        (expected.protocol === "http:" && url.protocol === "ws:") ||
        (expected.protocol === "https:" && url.protocol === "wss:"));
    return (
      sameLoopback &&
      (url.protocol === "http:" ||
        url.protocol === "https:" ||
        url.protocol === "ws:" ||
        url.protocol === "wss:")
    );
  } catch {
    return false;
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
}

function redactPreviewError(message: string): string {
  return message.replace(/[A-Za-z]:\\[^\s)]+/g, "<sandbox-path>").slice(0, 500);
}

function getPreviewDockerContainerName(previewId: string): string {
  return `ayaka-preview-${previewId.slice(0, 12)}`;
}

async function removePreviewDockerContainer(handle: PreviewHandle): Promise<void> {
  const name = handle.dockerContainerName;
  if (!name) return;
  handle.dockerContainerName = null;
  await new Promise<void>((resolve) => {
    const cleanup = spawn("docker", ["rm", "-f", name], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    cleanup.once("error", () => resolve());
    cleanup.once("close", () => resolve());
  });
}
