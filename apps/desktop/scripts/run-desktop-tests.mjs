import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsRoot = resolve(desktopRoot, "../../tests/desktop");
const group = process.argv[2];

const manifestByGroup = {
  main: "main.test.ts",
  electron: "electron.test.ts",
};

if (!group || !(group in manifestByGroup)) {
  throw new Error(`Unknown desktop test group: ${group ?? "<missing>"}`);
}

const manifestPath = resolve(testsRoot, manifestByGroup[group]);
const manifest = await readFile(manifestPath, "utf8");
const testFiles = [...manifest.matchAll(/^import\s+"(\.\/[^"']+)";?/gm)].map((match) =>
  resolve(testsRoot, match[1]),
);

if (testFiles.length === 0) {
  throw new Error(`No tests registered in ${manifestPath}`);
}

const isElectron = group === "electron";
const tsxCli = require.resolve("tsx/cli");
const runner = isElectron ? require("electron") : process.execPath;
const args = [tsxCli, "--tsconfig", "tsconfig.test.node.json"];

args.push("--experimental-test-module-mocks", "--test", ...testFiles);

const result = spawnSync(runner, args, {
  cwd: desktopRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    ...(isElectron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
  },
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
