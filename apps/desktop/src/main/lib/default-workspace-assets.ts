import { constants } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveUserDataDir } from "./runtime-paths";

export const DEFAULT_WORKSPACE_ASSET_NAME = "ayaka.png";

export function resolveBundledDefaultAssetPath(options?: {
  isDev?: boolean;
  appPath?: string;
  resourcesPath?: string;
  cwd?: string;
}): string {
  const isDev = options?.isDev ?? process.env.AYAKA_DEV !== "0";
  if (isDev) {
    const appPath = options?.appPath ?? process.env.AYAKA_APP_PATH ?? options?.cwd ?? process.cwd();
    return path.resolve(appPath, "..", "..", DEFAULT_WORKSPACE_ASSET_NAME);
  }

  return path.join(
    options?.resourcesPath ?? process.resourcesPath,
    "default",
    DEFAULT_WORKSPACE_ASSET_NAME,
  );
}

export function resolveDefaultWorkspaceAssetPath(userDataDir = resolveUserDataDir()): string {
  return path.join(userDataDir, "data", "workspaces", DEFAULT_WORKSPACE_ASSET_NAME);
}

export async function ensureDefaultWorkspaceAsset(options?: {
  sourcePath?: string;
  targetPath?: string;
}): Promise<{ sourcePath: string; targetPath: string; copied: boolean }> {
  const sourcePath = options?.sourcePath ?? resolveBundledDefaultAssetPath();
  const targetPath = options?.targetPath ?? resolveDefaultWorkspaceAssetPath();
  await mkdir(path.dirname(targetPath), { recursive: true });
  const copied = await copyFileIfMissing(sourcePath, targetPath);
  return { sourcePath, targetPath, copied };
}

export async function seedDefaultWorkspaceAsset(
  sandboxRoot: string,
  options?: { sourcePath?: string },
): Promise<{ sourcePath: string; targetPath: string; copied: boolean }> {
  const sourcePath = options?.sourcePath ?? (await ensureDefaultWorkspaceAsset()).targetPath;
  const targetPath = path.join(sandboxRoot, DEFAULT_WORKSPACE_ASSET_NAME);
  const copied = await copyFileIfMissing(sourcePath, targetPath);
  return { sourcePath, targetPath, copied };
}

async function copyFileIfMissing(sourcePath: string, targetPath: string): Promise<boolean> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}
