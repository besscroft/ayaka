import { createHash } from "node:crypto";
import { execFile as execFileCallback, execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync, unzipSync } from "fflate";
import type {
  ManagedRuntime,
  ManagedRuntimeSnapshot,
  RuntimeExecutableCommand,
  RuntimeLibc,
  RuntimeArchitecture,
  RuntimeKind,
  RuntimeManifestAsset,
  RuntimePlatform,
  RuntimeTarget,
  SystemRuntimeInfo,
} from "../../shared/types";
import { UV_RUNTIME_MANIFEST } from "../config/uv-runtime-manifest";
import {
  listAvailableManagedRuntimes,
  getRuntimePreference,
  listManagedRuntimes,
  listMcpRuntimeStates,
  markManagedRuntimeStatusAsync,
  upsertManagedRuntimeAsync,
  upsertRuntimePreferenceAsync,
} from "./db";
import {
  isPathWithin,
  resolveManagedRuntimeRoot,
  resolveManagedRuntimeVersionRoot,
} from "./runtime-paths";

const execFile = promisify(execFileCallback);
const MAX_RUNTIME_ARCHIVE_BYTES = 500 * 1024 * 1024;
const RUNTIME_VERIFICATION_RETRY_DELAYS = [100, 250];
const runtimeStateListeners = new Set<(snapshot: ManagedRuntimeSnapshot) => void>();

export const DEFAULT_RUNTIME_MANIFEST_URLS: Record<RuntimeKind, string> = {
  node: "https://nodejs.org/dist/index.json",
  uv: "https://api.github.com/repos/astral-sh/uv/releases/latest",
};

export function onManagedRuntimeStateChanged(
  listener: (snapshot: ManagedRuntimeSnapshot) => void,
): () => void {
  runtimeStateListeners.add(listener);
  return () => runtimeStateListeners.delete(listener);
}

export function getRuntimeSnapshot(): ManagedRuntimeSnapshot {
  return {
    runtimes: listManagedRuntimes(),
    preferences: (["node", "uv"] as RuntimeKind[]).map(
      (kind) =>
        getRuntimePreference(kind) ?? {
          kind,
          manifestUrl: DEFAULT_RUNTIME_MANIFEST_URLS[kind],
          channel: "stable" as const,
          updatedAt: 0,
        },
    ),
    system: [probeSystemRuntimeSync("node"), probeSystemRuntimeSync("uv")],
    target: detectRuntimeTarget(),
  };
}

export async function probeSystemRuntimes(): Promise<SystemRuntimeInfo[]> {
  return Promise.all([probeSystemRuntime("node"), probeSystemRuntime("uv")]);
}

export async function setRuntimeManifestSource(
  kind: RuntimeKind,
  manifestUrl: string,
): Promise<ManagedRuntimeSnapshot> {
  const normalized = manifestUrl.trim() || DEFAULT_RUNTIME_MANIFEST_URLS[kind];
  validateManifestUrl(normalized);
  await upsertRuntimePreferenceAsync({ kind, manifestUrl: normalized });
  return emitRuntimeStateChanged();
}

export function resolveRuntimePlatform(): RuntimePlatform {
  if (process.platform === "win32" || process.platform === "darwin" || process.platform === "linux")
    return process.platform;
  throw new Error(`Unsupported operating system: ${process.platform}.`);
}

export function resolveRuntimeArchitecture(): RuntimeArchitecture {
  if (process.arch === "x64" || process.arch === "arm64") return process.arch;
  throw new Error(`Unsupported CPU architecture: ${process.arch}.`);
}

export function detectRuntimeTarget(): RuntimeTarget {
  const platform = resolveRuntimePlatform();
  const architecture = resolveRuntimeArchitecture();
  if (platform !== "linux") return { platform, architecture, libc: null, glibcVersion: null };

  const report = process.report?.getReport?.() as
    | {
        header?: { glibcVersionRuntime?: unknown };
        sharedObjects?: unknown;
      }
    | undefined;
  const glibcVersion =
    typeof report?.header?.glibcVersionRuntime === "string"
      ? report.header.glibcVersionRuntime
      : null;
  if (glibcVersion) return { platform, architecture, libc: "gnu", glibcVersion };

  const sharedObjects = Array.isArray(report?.sharedObjects) ? report.sharedObjects : [];
  const hasMusl = sharedObjects.some((item) => typeof item === "string" && /musl/i.test(item));
  return { platform, architecture, libc: hasMusl ? "musl" : null, glibcVersion: null };
}

export function managedRuntimeForCommand(command: string): {
  kind: RuntimeKind;
  runtime: ManagedRuntime;
  executablePath: string;
  argsPrefix: string[];
} | null {
  const normalized = commandBasename(command);
  const kind = runtimeKindForCommand(command);
  if (!kind) return null;
  const runtime = selectLatestManagedRuntime(kind);
  if (!runtime) return null;
  const executable = resolveManagedRuntimeCommand(runtime, normalized);
  return executable ? { kind, runtime, ...executable } : null;
}

export function resolveManagedRuntimeCommand(
  runtime: ManagedRuntime,
  command: string,
): { executablePath: string; argsPrefix: string[] } | null {
  if (command === "node" || command === "uv") {
    return { executablePath: runtime.executablePath, argsPrefix: [] };
  }
  // Windows ships npm/npx as .cmd launchers. They require a shell and cannot
  // be passed directly to child_process.execFile. Invoke their JavaScript CLI
  // through the managed node.exe instead so MCP keeps the no-shell boundary.
  if (
    process.platform === "win32" &&
    runtime.kind === "node" &&
    (command === "npm" || command === "npx")
  ) {
    const cliPath = join(
      dirname(runtime.executablePath),
      "node_modules",
      "npm",
      "bin",
      `${command}-cli.js`,
    );
    if (existsSync(cliPath)) {
      return { executablePath: runtime.executablePath, argsPrefix: [cliPath] };
    }
  }
  const candidates =
    process.platform === "win32"
      ? [`${command}.exe`, `${command}.cmd`, command]
      : [command, `bin/${command}`];
  for (const candidate of candidates) {
    const path = join(runtime.rootPath, candidate);
    if (existsSync(path)) return { executablePath: path, argsPrefix: [] };
    const sibling = join(dirname(runtime.executablePath), candidate);
    if (existsSync(sibling)) return { executablePath: sibling, argsPrefix: [] };
  }
  // uv distributes `uvx` as an alias of the same executable. A managed
  // archive therefore commonly contains `uv` but no separate `uvx` file.
  if (command === "uvx" && runtime.kind === "uv" && existsSync(runtime.executablePath)) {
    return { executablePath: runtime.executablePath, argsPrefix: [] };
  }
  return null;
}

/** Return the Runtime family only for an explicit executable basename. */
export function runtimeKindForCommand(command: string): RuntimeKind | null {
  const normalized = commandBasename(command);
  return normalized === "node" || normalized === "npx" || normalized === "npm"
    ? "node"
    : normalized === "uv" || normalized === "uvx"
      ? "uv"
      : null;
}

/**
 * Check a Runtime executable without invoking a shell. Managed installations
 * are checked first; otherwise this probes the command resolved by PATH.
 */
export function isRuntimeCommandAvailable(command: string): boolean {
  if (!runtimeKindForCommand(command)) return false;
  const managed = managedRuntimeForCommand(command);
  const executable = managed?.executablePath ?? command;
  const args = [...(managed?.argsPrefix ?? []), "--version"];
  try {
    execFileSync(executable, args, {
      timeout: 5_000,
      windowsHide: true,
      encoding: "utf8",
      env: buildRuntimeProcessEnv(),
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveMcpCommand(command: string): {
  command: string;
  argsPrefix: string[];
  runtimeId: string | null;
} {
  const managed = managedRuntimeForCommand(command);
  return managed
    ? {
        command: managed.executablePath,
        argsPrefix: managed.argsPrefix,
        runtimeId: managed.runtime.id,
      }
    : { command, argsPrefix: [], runtimeId: null };
}

export async function installManagedRuntime(
  kind: RuntimeKind,
  requestedAsset?: RuntimeManifestAsset,
): Promise<ManagedRuntime> {
  const asset = requestedAsset ?? (await fetchLatestRuntimeAsset(kind));
  validateAsset(asset, kind);
  const platform = resolveRuntimePlatform();
  const architecture = resolveRuntimeArchitecture();
  const target = detectRuntimeTarget();
  if (
    asset.platform !== platform ||
    asset.architecture !== architecture ||
    (kind === "uv" && !isUvAssetCompatible(asset, target))
  ) {
    throw new Error(
      `Runtime asset is for ${asset.platform}-${asset.architecture}, not this device.`,
    );
  }

  const existing = selectLatestManagedRuntime(kind, asset.version);
  if (existing && (await hasVerifiedRuntimeBinaries(existing, asset))) return existing;

  const libc = kind === "uv" ? (asset.libc ?? target.libc) : null;
  const root = resolveManagedRuntimeVersionRoot(kind, asset.version, platform, architecture, libc);
  const tempRoot = join(
    dirname(root),
    `.install-${asset.version}-${platform}-${architecture}-${libc ?? "none"}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const runtimeId = runtimeIdentity(kind, asset.version, platform, architecture, libc);
  const executablePath = join(root, asset.executableRelativePath);
  const rootExistedAtStart = existsSync(root);
  const previousRuntime = listManagedRuntimes().find((runtime) => runtime.id === runtimeId) ?? null;
  let backupRoot: string | null = null;
  let swapped = false;
  await upsertManagedRuntimeAsync({
    id: runtimeId,
    kind,
    version: asset.version,
    platform,
    architecture,
    libc,
    rootPath: root,
    executablePath,
    sourceUrl: asset.archiveUrl,
    sha256: asset.sha256,
    status: "installing",
    installedAt: null,
  });

  try {
    mkdirSync(tempRoot, { recursive: true });
    // GitHub's browser_download_url intentionally redirects to a signed
    // release-asset URL. Follow that redirect, but keep the final destination
    // inside the HTTPS-only download policy.
    const { response, sourceUrl } = await fetchRuntimeArchive(asset);
    if (!response.ok) throw new Error(`Runtime download failed with HTTP ${response.status}.`);
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_RUNTIME_ARCHIVE_BYTES) {
      throw new Error("Runtime archive is too large.");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RUNTIME_ARCHIVE_BYTES)
      throw new Error("Runtime archive is too large.");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest.toLowerCase() !== asset.sha256.toLowerCase()) {
      throw new Error("Runtime archive SHA-256 does not match the manifest.");
    }
    extractRuntimeArchive(bytes, asset.archiveType, tempRoot);
    if (process.platform !== "win32") {
      for (const relativePath of executablePaths(asset))
        chmodSync(join(tempRoot, relativePath), 0o755);
    }
    await verifyRuntimeBinaries(tempRoot, asset);
    // The version/platform/architecture directory is the stable installation
    // path. Install into a sibling and swap the directory only after every
    // file and the executable have been verified, so a failed upgrade cannot
    // leave a half-populated runtime behind.
    if (existsSync(root)) {
      backupRoot = join(
        dirname(root),
        `.backup-${asset.version}-${platform}-${architecture}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      renameSync(root, backupRoot);
    }
    try {
      renameSync(tempRoot, root);
      swapped = true;
    } catch (error) {
      if (backupRoot && !existsSync(root) && existsSync(backupRoot)) renameSync(backupRoot, root);
      throw error;
    }
    const installedRoot = root;
    const installedExecutable = join(installedRoot, asset.executableRelativePath);
    const verifiedCommands = await verifyRuntimeBinaries(installedRoot, asset);
    if (process.platform !== "win32") {
      for (const relativePath of executablePaths(asset))
        chmodSync(join(installedRoot, relativePath), 0o755);
    }
    const installed = await upsertManagedRuntimeAsync({
      id: runtimeId,
      kind,
      version: asset.version,
      platform,
      architecture,
      libc,
      rootPath: installedRoot,
      executablePath: installedExecutable,
      sourceUrl,
      sha256: asset.sha256,
      verifiedCommands,
      status: "available",
      installedAt: Date.now(),
      lastError: null,
    });
    if (backupRoot) {
      try {
        rmSync(backupRoot, { recursive: true, force: true });
      } catch {
        // Cleanup is best effort; the verified installation is already live.
      }
    }
    emitRuntimeStateChanged();
    return installed;
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    if (swapped && existsSync(root)) rmSync(root, { recursive: true, force: true });
    if (backupRoot && existsSync(backupRoot) && !existsSync(root)) {
      renameSync(backupRoot, root);
    } else if (!swapped && !backupRoot && !rootExistedAtStart && existsSync(root)) {
      // Remove only a directory created by this failed first installation.
      rmSync(root, { recursive: true, force: true });
    }
    if (previousRuntime && !swapped) {
      await upsertManagedRuntimeAsync({
        id: previousRuntime.id,
        kind: previousRuntime.kind,
        version: previousRuntime.version,
        platform: previousRuntime.platform,
        architecture: previousRuntime.architecture,
        libc: previousRuntime.libc,
        rootPath: previousRuntime.rootPath,
        executablePath: previousRuntime.executablePath,
        sourceUrl: previousRuntime.sourceUrl,
        sha256: previousRuntime.sha256,
        verifiedCommands: previousRuntime.verifiedCommands,
        status: previousRuntime.status,
        installedAt: previousRuntime.installedAt,
        lastError: previousRuntime.lastError,
      });
    } else {
      await markManagedRuntimeStatusAsync(runtimeId, {
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
    emitRuntimeStateChanged();
    throw error;
  }
}

export async function upgradeManagedRuntime(kind: RuntimeKind): Promise<ManagedRuntime> {
  return installManagedRuntime(kind);
}

export async function uninstallManagedRuntime(runtimeId: string): Promise<boolean> {
  const runtime = listManagedRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Managed Runtime not found.");
  const inUse = listMcpRuntimeStates().some(
    (state) =>
      state.runtimeInstallationId === runtimeId &&
      (state.desiredState === "running" ||
        ["starting", "running", "stopping", "reconnecting"].includes(state.state)),
  );
  if (inUse) throw new Error("Runtime is used by a running MCP server. Stop it first.");
  const runtimeRoot = resolveManagedRuntimeRoot();
  if (!isPathWithin(runtimeRoot, runtime.rootPath))
    throw new Error("Runtime path is outside App Data.");
  if (existsSync(runtime.rootPath)) rmSync(runtime.rootPath, { recursive: true, force: true });
  await markManagedRuntimeStatusAsync(runtimeId, { status: "uninstalled", lastError: null });
  emitRuntimeStateChanged();
  return true;
}

export async function fetchLatestRuntimeAsset(kind: RuntimeKind): Promise<RuntimeManifestAsset> {
  const preference = getRuntimePreference(kind);
  const candidates =
    preference && isExplicitRuntimeSource(kind, preference.manifestUrl)
      ? [preference.manifestUrl]
      : [];
  if (kind === "uv") candidates.push("bundled:uv", DEFAULT_RUNTIME_MANIFEST_URLS.uv);
  else candidates.push(DEFAULT_RUNTIME_MANIFEST_URLS.node);

  let lastError: unknown = null;
  for (const source of candidates) {
    try {
      if (source === "bundled:uv") return selectBundledUvAsset();
      const url = normalizeRuntimeManifestUrl(kind, source);
      validateManifestUrl(url);
      const response = await fetch(url, {
        redirect: "error",
        headers: kind === "uv" ? { Accept: "application/vnd.github+json" } : undefined,
      });
      if (!response.ok)
        throw new Error(`Runtime manifest request failed with HTTP ${response.status}.`);
      const value = (await response.json()) as unknown;
      if (hasCustomRuntimeAssets(value, kind)) return normalizeManifestAsset(kind, value);
      if (kind === "node") return await normalizeOfficialNodeAsset(value);
      return normalizeManifestAsset(kind, value);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No usable Runtime manifest was found.");
}

/** Accept the official uv release page as a convenience URL for Runtime settings. */
export function normalizeRuntimeManifestUrl(kind: RuntimeKind, manifestUrl: string): string {
  if (kind !== "uv") return manifestUrl;
  const url = new URL(manifestUrl);
  if (url.hostname !== "github.com") return manifestUrl;

  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/astral-sh/uv/releases" || path === "/astral-sh/uv/releases/latest") {
    return "https://api.github.com/repos/astral-sh/uv/releases/latest";
  }

  const tagMatch = path.match(/^\/astral-sh\/uv\/releases\/tag\/([^/]+)$/);
  if (!tagMatch) return manifestUrl;
  return `https://api.github.com/repos/astral-sh/uv/releases/tags/${encodeURIComponent(tagMatch[1]!)}`;
}

function isExplicitRuntimeSource(kind: RuntimeKind, manifestUrl: string): boolean {
  const normalized = normalizeRuntimeManifestUrl(kind, manifestUrl);
  return normalized !== DEFAULT_RUNTIME_MANIFEST_URLS[kind] && manifestUrl !== "";
}

function selectBundledUvAsset(): RuntimeManifestAsset {
  const target = detectRuntimeTarget();
  const assets = UV_RUNTIME_MANIFEST.releases
    .flatMap((release) => release.assets)
    .filter(
      (item) => item.platform === target.platform && item.architecture === target.architecture,
    )
    .sort((left, right) => (left.libc === target.libc ? -1 : right.libc === target.libc ? 1 : 0));
  const asset = assets.find((item) => isUvAssetCompatible(item, target));
  if (!asset) {
    const targetLabel = `${target.platform}-${target.architecture}${target.libc ? `-${target.libc}` : ""}`;
    throw new Error(`Bundled uv manifest has no asset for ${targetLabel}.`);
  }
  return validateAsset(asset, "uv");
}

async function normalizeOfficialNodeAsset(value: unknown): Promise<RuntimeManifestAsset> {
  const identity = normalizeNodeAssetIdentity(value);
  const checksumUrl = `https://nodejs.org/dist/v${identity.version}/SHASUMS256.txt`;
  const checksumResponse = await fetch(checksumUrl, { redirect: "error" });
  if (!checksumResponse.ok)
    throw new Error(`Node checksum request failed with HTTP ${checksumResponse.status}.`);
  const checksumText = await checksumResponse.text();
  const archiveName = identity.archiveUrl.split("/").pop() ?? "";
  const line = checksumText.split(/\r?\n/).find((item) => item.endsWith(`  ${archiveName}`));
  if (!line) throw new Error(`Node checksum manifest does not contain ${archiveName}.`);
  return validateAsset({ ...identity, sha256: line.split(/\s+/)[0] }, "node");
}

async function fetchRuntimeArchive(
  asset: RuntimeManifestAsset,
): Promise<{ response: Response; sourceUrl: string }> {
  const urls = [asset.archiveUrl, ...(asset.fallbackArchiveUrls ?? [])];
  let lastError: unknown = null;
  for (const rawUrl of urls) {
    try {
      const response = await fetchRuntimeResource(rawUrl);
      if (response.ok) return { response, sourceUrl: rawUrl };
      lastError = new Error(`Runtime download failed with HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Runtime download failed.");
}

export async function verifyRuntimeBinaries(
  root: string,
  asset: RuntimeManifestAsset,
): Promise<RuntimeExecutableCommand[]> {
  const executables = asset.executables ?? [
    {
      command: asset.runtime === "uv" ? "uv" : "node",
      relativePath: asset.executableRelativePath,
    } satisfies { command: RuntimeExecutableCommand; relativePath: string },
  ];
  const verified: RuntimeExecutableCommand[] = [];
  for (const executable of executables) {
    const path = join(root, executable.relativePath);
    if (!isPathWithin(root, path) || !existsSync(path)) {
      throw new Error(`Runtime archive does not contain ${executable.relativePath}.`);
    }
    await verifyRuntimeExecutable(path, executable.command);
    verified.push(executable.command);
  }
  return verified;
}

async function verifyRuntimeExecutable(
  executablePath: string,
  command: RuntimeExecutableCommand,
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= RUNTIME_VERIFICATION_RETRY_DELAYS.length; attempt += 1) {
    try {
      await execFile(executablePath, ["--version"], {
        timeout: 5_000,
        windowsHide: true,
        env: buildRuntimeProcessEnv(),
      });
      return;
    } catch (error) {
      lastError = error;
      if (
        !isRetryableRuntimeVerificationError(error) ||
        attempt >= RUNTIME_VERIFICATION_RETRY_DELAYS.length
      )
        break;
      await new Promise((resolve) =>
        setTimeout(resolve, RUNTIME_VERIFICATION_RETRY_DELAYS[attempt]),
      );
    }
  }
  throw formatRuntimeVerificationError(command, executablePath, lastError);
}

function isRetryableRuntimeVerificationError(error: unknown): boolean {
  if (process.platform !== "win32") return false;
  const code = (error as { code?: unknown }).code;
  return ["EACCES", "EBUSY", "ENOEXEC", "EPERM", "ETXTBSY", "UNKNOWN"].includes(String(code));
}

function formatRuntimeVerificationError(
  command: RuntimeExecutableCommand,
  executablePath: string,
  error: unknown,
): Error {
  const record = error as {
    code?: unknown;
    status?: unknown;
    signal?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };
  const details = [
    typeof record.code === "string" ? `code=${record.code}` : null,
    typeof record.status === "number" ? `exit=${record.status}` : null,
    typeof record.signal === "string" ? `signal=${record.signal}` : null,
    formatRuntimeVerificationOutput(record.stderr, "stderr"),
    formatRuntimeVerificationOutput(record.stdout, "stdout"),
  ].filter((value): value is string => Boolean(value));
  const suffix = details.length ? ` (${details.join(", ")})` : "";
  return new Error(
    `Runtime executable verification failed for ${command} at ${executablePath}${suffix}.`,
    { cause: error },
  );
}

function formatRuntimeVerificationOutput(
  value: unknown,
  label: "stderr" | "stdout",
): string | null {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) return null;
  const output = value.toString("utf8").replace(/\s+/g, " ").trim();
  if (!output) return null;
  const redacted = output.replace(
    /((?:bearer|token|secret|password|api[_-]?key)\s*[:=]\s*)\S+/gi,
    "$1[redacted]",
  );
  return `${label}=${redacted.slice(0, 500)}`;
}

export function buildRuntimeProcessEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = { ...source };
  for (const key of Object.keys(environment)) {
    const normalizedKey = key.toUpperCase();
    if (
      normalizedKey.startsWith("ELECTRON_") ||
      normalizedKey === "NODE_OPTIONS" ||
      normalizedKey === "NODE_PATH"
    ) {
      delete environment[key];
    }
  }
  return environment;
}

function selectLatestManagedRuntime(
  kind: RuntimeKind,
  exactVersion?: string,
): ManagedRuntime | null {
  const platform = resolveRuntimePlatform();
  const architecture = resolveRuntimeArchitecture();
  const libc = kind === "uv" ? detectRuntimeTarget().libc : null;
  return (
    listAvailableManagedRuntimes()
      .filter(
        (runtime) =>
          runtime.kind === kind &&
          runtime.platform === platform &&
          runtime.architecture === architecture &&
          (kind !== "uv" || runtime.libc === libc || (libc === "gnu" && runtime.libc === null)) &&
          (!exactVersion || runtime.version === exactVersion),
      )
      .sort((left, right) => compareVersions(right.version, left.version))[0] ?? null
  );
}

function executablePaths(asset: RuntimeManifestAsset): string[] {
  return asset.executables?.map((item) => item.relativePath) ?? [asset.executableRelativePath];
}

async function hasVerifiedRuntimeBinaries(
  runtime: ManagedRuntime,
  asset: RuntimeManifestAsset,
): Promise<boolean> {
  const commands =
    asset.executables?.map((item) => item.command) ??
    (asset.runtime === "uv" ? ["uv", "uvx"] : ["node"]);
  if (
    runtime.verifiedCommands?.length &&
    commands.every((command) => runtime.verifiedCommands.includes(command))
  ) {
    return executablePaths(asset).every((relativePath) =>
      existsSync(join(runtime.rootPath, relativePath)),
    );
  }
  try {
    return (await verifyRuntimeBinaries(runtime.rootPath, asset)).length === commands.length;
  } catch {
    return false;
  }
}

function commandBasename(command: string): string {
  const value = command.trim().replaceAll("\\", "/").split("/").pop() ?? command;
  return value.replace(/\.(?:cmd|exe)$/i, "").toLowerCase();
}

async function probeSystemRuntime(kind: RuntimeKind): Promise<SystemRuntimeInfo> {
  const command = kind === "node" ? "node" : "uv";
  const companion = kind === "node" ? "npx" : "uvx";
  try {
    const result = await execFile(command, ["--version"], {
      timeout: 5_000,
      windowsHide: true,
      env: buildRuntimeProcessEnv(),
    });
    return {
      kind,
      command,
      available: true,
      version: extractVersion(`${result.stdout}\n${result.stderr}`),
      companion: probeSystemCompanion(companion),
    };
  } catch {
    return {
      kind,
      command,
      available: false,
      version: null,
      companion: probeSystemCompanion(companion),
    };
  }
}

function probeSystemRuntimeSync(kind: RuntimeKind): SystemRuntimeInfo {
  const command = kind === "node" ? "node" : "uv";
  const companion = kind === "node" ? "npx" : "uvx";
  try {
    const output = execFileSync(command, ["--version"], {
      timeout: 5_000,
      windowsHide: true,
      encoding: "utf8",
      env: buildRuntimeProcessEnv(),
    });
    return {
      kind,
      command,
      available: true,
      version: extractVersion(output),
      companion: probeSystemCompanionSync(companion),
    };
  } catch {
    return {
      kind,
      command,
      available: false,
      version: null,
      companion: probeSystemCompanionSync(companion),
    };
  }
}

function probeSystemCompanion(command: string): SystemRuntimeInfo["companion"] {
  try {
    return {
      command,
      available: true,
      version: extractVersion(
        execFileSync(command, ["--version"], {
          encoding: "utf8",
          timeout: 5_000,
          windowsHide: true,
          env: buildRuntimeProcessEnv(),
        }),
      ),
    };
  } catch {
    return { command, available: false, version: null };
  }
}

function probeSystemCompanionSync(command: string): SystemRuntimeInfo["companion"] {
  return probeSystemCompanion(command);
}

export function normalizeManifestAsset(kind: RuntimeKind, value: unknown): RuntimeManifestAsset {
  const record = asRecord(value);
  const customAssets = manifestAssets(value, kind);
  if (customAssets) {
    if (record.schema !== undefined && record.schema !== "ayaka-runtime-manifest-v2") {
      throw new Error("Runtime manifest schema is unsupported.");
    }
    const platform = resolveRuntimePlatform();
    const architecture = resolveRuntimeArchitecture();
    const libc = kind === "uv" ? detectRuntimeTarget().libc : null;
    const asset = customAssets.find((item) => {
      const row = asRecord(item);
      const rowLibc =
        row.libc === undefined
          ? kind === "uv"
            ? libc === "gnu"
              ? "gnu"
              : libc
            : null
          : row.libc;
      return (
        row.runtime === kind &&
        row.platform === platform &&
        row.architecture === architecture &&
        rowLibc === libc
      );
    });
    if (!asset) throw new Error(`Manifest has no ${kind} asset for this device.`);
    return validateAsset(asset, kind);
  }
  return kind === "node" ? normalizeNodeAsset(value) : normalizeUvAsset(record);
}

function hasCustomRuntimeAssets(value: unknown, kind: RuntimeKind): boolean {
  return manifestAssets(value, kind) !== null;
}

function manifestAssets(value: unknown, kind: RuntimeKind): unknown[] | null {
  const record = asRecord(value);
  if (record.runtime === kind && Array.isArray(record.assets)) {
    return record.assets.map((item) => ({ ...asRecord(item), runtime: kind }));
  }
  if (
    Array.isArray(record.assets) &&
    record.assets.some((item) => asRecord(item).runtime === kind)
  ) {
    return record.assets;
  }
  if (Array.isArray(record.releases)) {
    const assets: unknown[] = [];
    for (const release of record.releases) {
      const releaseRecord = asRecord(release);
      if (typeof releaseRecord.version !== "string" || !Array.isArray(releaseRecord.assets))
        continue;
      for (const item of releaseRecord.assets) {
        const row = asRecord(item);
        if (record.runtime === kind || row.runtime === kind) {
          assets.push({ ...row, runtime: kind, version: row.version ?? releaseRecord.version });
        }
      }
    }
    return assets.length ? assets : null;
  }
  return null;
}

function normalizeNodeAsset(value: unknown): RuntimeManifestAsset {
  return normalizeNodeAssetIdentity(value) as RuntimeManifestAsset;
}

function normalizeNodeAssetIdentity(
  value: unknown,
): Omit<RuntimeManifestAsset, "sha256"> & { sha256?: string } {
  const entries = Array.isArray(value) ? value : [];
  const platform = resolveRuntimePlatform();
  const architecture = resolveRuntimeArchitecture();
  const entry = entries.find(
    (item) => asRecord(item).lts && typeof asRecord(item).version === "string",
  ) as unknown;
  const version = String(asRecord(entry).version ?? "").replace(/^v/, "");
  if (!version) throw new Error("Node manifest did not provide a stable version.");
  const suffix = nodeAssetSuffix(platform, architecture);
  const archiveType = platform === "win32" ? "zip" : "tar.gz";
  const archiveUrl = `https://nodejs.org/dist/v${version}/node-v${version}-${suffix}.${archiveType}`;
  return {
    runtime: "node",
    version,
    platform,
    architecture,
    archiveUrl,
    archiveType,
    executableRelativePath:
      platform === "win32"
        ? `node-v${version}-${suffix}/node.exe`
        : `node-v${version}-${suffix}/bin/node`,
    providedCommands: ["node", "npx", "npm"],
  };
}

function normalizeUvAsset(record: Record<string, unknown>): RuntimeManifestAsset {
  const platform = resolveRuntimePlatform();
  const architecture = resolveRuntimeArchitecture();
  const target = detectRuntimeTarget();
  const libc = selectUvLibcForOfficialAsset(target);
  if (platform === "linux" && !libc) throw new Error("Linux libc could not be detected for uv.");
  const versionValue = record.tag_name ?? record.name;
  const version = (typeof versionValue === "string" ? versionValue : "").replace(/^v/, "");
  const assets = Array.isArray(record.assets) ? record.assets : [];
  const suffix = uvAssetSuffix(platform, architecture, libc);
  const asset = assets.find((item) => {
    const name = String(asRecord(item).name ?? "");
    return name.includes(suffix) && (name.endsWith(".zip") || name.endsWith(".tar.gz"));
  });
  if (!asset) throw new Error(`uv manifest has no downloadable ${suffix} asset for this device.`);
  const name = String(asRecord(asset).name ?? "");
  const archiveType = name.endsWith(".zip") ? "zip" : "tar.gz";
  const archiveUrl = String(asRecord(asset).browser_download_url ?? "");
  const digest = String(asRecord(asset).digest ?? "").replace(/^sha256:/, "");
  if (!version || !archiveUrl || !digest) {
    throw new Error("uv manifest did not provide a downloadable SHA-256 verified asset.");
  }
  const archiveLayout = archiveType === "zip" ? "flat" : "top-level-directory";
  const topLevel = name.replace(/\.(?:zip|tar\.gz)$/, "");
  const executablePrefix = archiveLayout === "flat" ? "" : `${topLevel}/`;
  const extension = platform === "win32" ? ".exe" : "";
  const executableRelativePath = `${executablePrefix}uv${extension}`;
  return validateAsset(
    {
      runtime: "uv",
      version,
      platform,
      architecture,
      libc,
      archiveUrl,
      archiveType,
      archiveLayout,
      sha256: digest,
      executableRelativePath,
      providedCommands: ["uv", "uvx"],
      executables: [
        { command: "uv", relativePath: executableRelativePath },
        { command: "uvx", relativePath: `${executablePrefix}uvx${extension}` },
      ],
    },
    "uv",
  );
}

function validateAsset(value: unknown, kind: RuntimeKind): RuntimeManifestAsset {
  const row = asRecord(value);
  const asset = {
    runtime: kind,
    version: String(row.version ?? "").replace(/^v/, ""),
    platform: row.platform,
    architecture: row.architecture,
    libc:
      row.libc ??
      (kind === "uv" && resolveRuntimePlatform() === "linux" ? detectRuntimeTarget().libc : null),
    minimumGlibc: row.minimumGlibc ?? null,
    archiveUrl: String(row.archiveUrl ?? ""),
    fallbackArchiveUrls: Array.isArray(row.fallbackArchiveUrls)
      ? row.fallbackArchiveUrls.map(String)
      : [],
    archiveType: row.archiveType,
    archiveLayout:
      row.archiveLayout ?? (row.archiveType === "zip" ? "flat" : "top-level-directory"),
    sha256: String(row.sha256 ?? "").toLowerCase(),
    executableRelativePath: String(row.executableRelativePath ?? ""),
    providedCommands: Array.isArray(row.providedCommands) ? row.providedCommands.map(String) : [],
    executables: Array.isArray(row.executables)
      ? row.executables.map((item) => ({
          command: asRecord(item).command,
          relativePath: String(asRecord(item).relativePath ?? ""),
        }))
      : undefined,
  } as RuntimeManifestAsset;
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(asset.version))
    throw new Error("Runtime manifest version is invalid.");
  if (!asset.archiveUrl || !/^[a-f0-9]{64}$/.test(asset.sha256))
    throw new Error("Runtime manifest asset is missing version, URL, or SHA-256.");
  if (asset.archiveType !== "zip" && asset.archiveType !== "tar.gz")
    throw new Error("Runtime manifest archive type is unsupported.");
  if (asset.archiveLayout !== "flat" && asset.archiveLayout !== "top-level-directory")
    throw new Error("Runtime manifest archive layout is unsupported.");
  if (
    asset.platform !== resolveRuntimePlatform() ||
    asset.architecture !== resolveRuntimeArchitecture()
  )
    throw new Error("Runtime manifest asset does not target this device.");
  if (asset.runtime === "uv" && !isUvAssetCompatible(asset, detectRuntimeTarget()))
    throw new Error("Runtime manifest asset does not match the Linux libc target.");
  const executableEntries = asset.executables?.length
    ? asset.executables
    : [
        {
          command: asset.runtime === "uv" ? "uv" : "node",
          relativePath: asset.executableRelativePath,
        },
      ];
  const commands = new Set<string>();
  for (const executable of executableEntries) {
    const executablePath = executable.relativePath.replaceAll("\\", "/");
    if (
      !executablePath ||
      isAbsolute(executablePath) ||
      executablePath.split("/").some((part) => part === "..")
    )
      throw new Error("Runtime manifest executable path is unsafe.");
    if (commands.has(executable.command))
      throw new Error("Runtime manifest contains duplicate executable commands.");
    commands.add(executable.command);
  }
  if (!asset.executableRelativePath)
    asset.executableRelativePath = executableEntries[0]!.relativePath;
  if (!asset.providedCommands.length) asset.providedCommands = [...commands];
  asset.executables = executableEntries as RuntimeManifestAsset["executables"];
  validateManifestUrl(asset.archiveUrl);
  for (const url of asset.fallbackArchiveUrls ?? []) validateManifestUrl(url);
  return asset;
}

export function validateRuntimeManifestAsset(
  value: unknown,
  kind: RuntimeKind,
): RuntimeManifestAsset {
  return validateAsset(value, kind);
}

function selectUvLibcForOfficialAsset(target: RuntimeTarget): RuntimeLibc {
  if (target.platform !== "linux" || target.libc !== "gnu") return target.libc;
  const minimum = target.architecture === "x64" ? "2.17" : "2.28";
  return target.glibcVersion && compareVersions(target.glibcVersion, minimum) < 0 ? "musl" : "gnu";
}

function isUvAssetCompatible(asset: Partial<RuntimeManifestAsset>, target: RuntimeTarget): boolean {
  if (asset.platform !== target.platform || asset.architecture !== target.architecture)
    return false;
  if (target.platform !== "linux") return asset.libc === null || asset.libc === undefined;
  if (!asset.libc || !target.libc) return false;
  if (asset.libc === "musl" && target.libc === "gnu") return true;
  if (asset.libc !== target.libc) return false;
  if (asset.libc === "gnu" && asset.minimumGlibc && target.glibcVersion) {
    return compareVersions(target.glibcVersion, asset.minimumGlibc) >= 0;
  }
  return true;
}

function validateManifestUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  if (url.protocol === "https:") return;
  if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    return;
  throw new Error("Runtime sources must use HTTPS or loopback HTTP.");
}

async function fetchRuntimeResource(rawUrl: string): Promise<Response> {
  let url = rawUrl;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    validateManifestUrl(url);
    const response = await fetch(url, { redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("Runtime download redirect did not provide a location.");
    url = new URL(location, url).toString();
  }
  throw new Error("Runtime download followed too many redirects.");
}

export function extractRuntimeArchive(
  bytes: Uint8Array,
  type: RuntimeManifestAsset["archiveType"],
  target: string,
): void {
  if (type === "zip") {
    const files = unzipSync(bytes);
    for (const [name, value] of Object.entries(files)) {
      // ZIP directory entries are represented by fflate as zero-byte values.
      // Their trailing slash is the reliable distinction from an empty file.
      if (/[\\/]$/.test(name)) mkdirArchiveEntry(target, name);
      else writeArchiveEntry(target, name, value);
    }
    return;
  }
  extractTar(gunzipSync(bytes), target);
}

function extractTar(bytes: Uint8Array, target: string): void {
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) break;
    const name = decodeAscii(header.subarray(0, 100));
    const size = Number.parseInt(decodeAscii(header.subarray(124, 136)).trim() || "0", 8);
    const type = header[156];
    if (
      type === 49 ||
      type === 50 ||
      type === 51 ||
      type === 52 ||
      type === 54 ||
      type === 55 ||
      type === 56 ||
      type === 120
    ) {
      throw new Error("Runtime archives must not contain links or special files.");
    }
    if (type === 53) mkdirArchiveEntry(target, name);
    else if (type === 0 || type === 48)
      writeArchiveEntry(target, name, bytes.subarray(offset + 512, offset + 512 + size));
    else throw new Error("Runtime archive contains an unsupported entry type.");
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

function writeArchiveEntry(target: string, rawName: string, bytes: Uint8Array): void {
  const name = normalizeArchivePath(rawName);
  const destination = join(target, name);
  if (!isPathWithin(target, destination))
    throw new Error("Runtime archive contains an unsafe path.");
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}

function mkdirArchiveEntry(target: string, rawName: string): void {
  const name = normalizeArchivePath(rawName);
  const destination = join(target, name);
  if (!isPathWithin(target, destination))
    throw new Error("Runtime archive contains an unsafe path.");
  mkdirSync(destination, { recursive: true });
}

function normalizeArchivePath(rawName: string): string {
  const name = rawName.replaceAll("\\", "/");
  if (
    !name ||
    name.startsWith("/") ||
    /^[A-Za-z]:\//.test(name) ||
    name.split("/").some((part) => part === "..")
  ) {
    throw new Error("Runtime archive contains an unsafe path.");
  }
  return name;
}

function runtimeIdentity(
  kind: RuntimeKind,
  version: string,
  platform: RuntimePlatform,
  architecture: RuntimeArchitecture,
  libc: RuntimeLibc,
): string {
  return `${kind}-${version}-${platform}-${architecture}-${libc ?? "none"}`;
}

function nodeAssetSuffix(platform: RuntimePlatform, architecture: RuntimeArchitecture): string {
  return `${platform === "win32" ? "win" : platform}-${architecture === "x64" ? "x64" : "arm64"}`;
}

function uvAssetSuffix(
  platform: RuntimePlatform,
  architecture: RuntimeArchitecture,
  libc: RuntimeLibc,
): string {
  if (platform === "win32")
    return architecture === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc";
  if (platform === "darwin")
    return architecture === "x64" ? "x86_64-apple-darwin" : "aarch64-apple-darwin";
  const suffix = libc === "musl" ? "musl" : "gnu";
  return architecture === "x64"
    ? `x86_64-unknown-linux-${suffix}`
    : `aarch64-unknown-linux-${suffix}`;
}

function extractVersion(value: string): string | null {
  return value.match(/v?(\d+(?:\.\d+){1,3})/)?.[1] ?? null;
}

function compareVersions(left: string, right: string): number {
  const a = left.replace(/^v/, "").split(".").map(Number);
  const b = right.replace(/^v/, "").split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function decodeAscii(bytes: Uint8Array): string {
  const nullCharacter = String.fromCharCode(0);
  let decoded = new TextDecoder().decode(bytes);
  while (decoded.endsWith(nullCharacter)) decoded = decoded.slice(0, -1);
  return decoded.trim();
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? (value as Record<string, any>) : {};
}

function emitRuntimeStateChanged(): ManagedRuntimeSnapshot {
  const snapshot = getRuntimeSnapshot();
  for (const listener of runtimeStateListeners) {
    try {
      listener(snapshot);
    } catch {
      // Observers must never affect runtime installation state.
    }
  }
  return snapshot;
}
