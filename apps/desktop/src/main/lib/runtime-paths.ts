import { existsSync, mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

export function resolveUserDataDir(): string {
  const configured = process.env.AYAKA_USER_DATA_DIR;
  if (configured) return configured;
  const appData = process.env.APPDATA;
  if (appData) return join(appData, "ayaka");
  return join(process.cwd(), ".ayaka");
}

export function resolveAppPath(): string {
  return process.env.AYAKA_APP_PATH || process.cwd();
}

export function resolveManagedRuntimeRoot(): string {
  const root = join(resolveUserDataDir(), "runtimes");
  mkdirSync(root, { recursive: true });
  return root;
}

export function resolveManagedRuntimeVersionRoot(
  kind: "node" | "uv",
  version: string,
  platform = process.platform,
  architecture = process.arch,
  libc: "gnu" | "musl" | null = null,
): string {
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
    throw new Error("Invalid managed Runtime version.");
  }
  const target =
    kind === "uv" ? `${platform}-${architecture}-${libc ?? "none"}` : `${platform}-${architecture}`;
  const root = join(resolveManagedRuntimeRoot(), kind, version, target);
  mkdirSync(join(root, ".."), { recursive: true });
  return root;
}

export function resolveMcpServerRoot(serverId: string): string {
  if (!/^[A-Za-z0-9_.-]{1,160}$/.test(serverId)) throw new Error("Invalid MCP server id.");
  const root = join(resolveUserDataDir(), "mcp", "servers", serverId);
  mkdirSync(root, { recursive: true });
  return root;
}

export function isPathWithin(root: string, candidate: string): boolean {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const remainder = relative(rootPath, candidatePath);
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}

export function hasPath(path: string): boolean {
  return existsSync(path);
}

/** Remove data owned by the retired animated companion feature. */
export function removeLegacyCompanionData(userDataDir = resolveUserDataDir()): void {
  const legacyDataPath = join(userDataDir, "data", "pets");
  try {
    rmSync(legacyDataPath, { recursive: true, force: true });
  } catch (error) {
    console.warn(`[main] Failed to remove legacy companion data at ${legacyDataPath}:`, error);
  }
}
