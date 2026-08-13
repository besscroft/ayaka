import { rmSync } from "node:fs";
import { join } from "node:path";

export function resolveUserDataDir(): string {
  const configured = process.env.VOID_AI_USER_DATA_DIR;
  if (configured) return configured;
  const appData = process.env.APPDATA;
  if (appData) return join(appData, "paimon");
  return join(process.cwd(), ".void-ai");
}

export function resolveAppPath(): string {
  return process.env.VOID_AI_APP_PATH || process.cwd();
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
