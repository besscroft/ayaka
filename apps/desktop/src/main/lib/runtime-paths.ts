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
