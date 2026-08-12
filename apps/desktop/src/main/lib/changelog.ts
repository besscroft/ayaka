import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface ChangelogPathOptions {
  isDev: boolean;
  appPath: string;
  resourcesPath: string;
}

export function resolveChangelogPath({
  isDev,
  appPath,
  resourcesPath,
}: ChangelogPathOptions): string {
  if (!isDev) return join(resourcesPath, "CHANGELOG.md");

  return join(resolve(dirname(appPath), ".."), "CHANGELOG.md");
}

export async function readChangelog(options: ChangelogPathOptions): Promise<string> {
  return readFile(resolveChangelogPath(options), "utf8");
}
