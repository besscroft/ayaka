import { execFile as execFileCallback } from "node:child_process";
import { join } from "node:path";
import { existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { promisify } from "node:util";
import type { McpDependencyInstallation } from "../../shared/types";
import {
  getMcpDependencyInstallation,
  getMcpServer,
  getMcpRuntimeState,
  setToolServerEnabledAsync,
  upsertMcpDependencyInstallationAsync,
} from "./db";
import { parseMcpCommand } from "./mcp-command";
import {
  isRuntimeCommandAvailable,
  resolveMcpCommand,
  runtimeKindForCommand,
} from "./runtime-manager";
import { isPathWithin, resolveMcpServerRoot } from "./runtime-paths";

const execFile = promisify(execFileCallback);
const INSTALL_TIMEOUT_MS = 10 * 60 * 1_000;

export async function installMcpDependencies(
  serverId: string,
  options: { allowScripts?: boolean } = {},
): Promise<McpDependencyInstallation> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found.");
  const runtimeState = getMcpRuntimeState(serverId);
  if (
    runtimeState &&
    ["starting", "running", "stopping", "reconnecting"].includes(runtimeState.state)
  ) {
    throw new Error("Stop the MCP server before changing its dependencies.");
  }
  if (server.transport !== "stdio") {
    return upsertMcpDependencyInstallationAsync({
      serverId,
      manager: "none",
      status: "not_applicable",
    });
  }
  const command = parseMcpCommand(server.command, parseArray(server.args_json));
  if (!command.canInstall) {
    return upsertMcpDependencyInstallationAsync({
      serverId,
      manager: command.manager,
      packageSpecs: command.packageSpecs,
      status: command.manager === "none" ? "not_applicable" : "needs_confirmation",
      lastError:
        command.manager === "none"
          ? null
          : "Could not safely identify a package from this command.",
    });
  }
  // uv may execute Python build hooks while creating an isolated tool. There
  // is no portable, package-independent equivalent of npm's --ignore-scripts,
  // so keep the default path review-only and require an explicit confirmation.
  if (command.manager === "uvx" && options.allowScripts !== true) {
    return upsertMcpDependencyInstallationAsync({
      serverId,
      manager: command.manager,
      packageSpecs: command.packageSpecs,
      status: "needs_confirmation",
      lastError: "uvx installation may execute Python build scripts; confirm before continuing.",
    });
  }
  const runtimeCommand = command.manager === "npx" ? "npm" : "uv";
  const runtimeKind = runtimeKindForCommand(runtimeCommand);
  if (!runtimeKind || !isRuntimeCommandAvailable(runtimeCommand)) {
    return upsertMcpDependencyInstallationAsync({
      serverId,
      manager: command.manager,
      packageSpecs: command.packageSpecs,
      status: "failed",
      lastError: `${runtimeCommand === "npm" ? "Node.js" : "uv"} Runtime is not available. Install it from Ayaka Settings or add it to PATH.`,
    });
  }
  // `allowScripts` is only accepted from an explicit confirmation action.
  // The default path below always passes the package-manager safety flag.
  const root = resolveMcpServerRoot(serverId);
  const installRoot = join(root, "dependencies");
  const tempRoot = join(root, `.install-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const runtime = resolveMcpCommand(runtimeCommand);
  const current = getMcpDependencyInstallation(serverId);
  await upsertMcpDependencyInstallationAsync({
    serverId,
    manager: command.manager,
    packageSpecs: command.packageSpecs,
    installRoot,
    status: "installing",
    scriptsAllowed: options.allowScripts === true,
    lastError: null,
  });
  try {
    mkdirSync(tempRoot, { recursive: true });
    if (command.manager === "npx") {
      await execFile(
        runtime.command,
        [
          "install",
          ...(options.allowScripts ? [] : ["--ignore-scripts"]),
          "--no-package-lock",
          "--no-save",
          "--prefix",
          tempRoot,
          ...command.packageSpecs,
        ],
        { timeout: INSTALL_TIMEOUT_MS, windowsHide: true, env: dependencyEnv(tempRoot) },
      );
    } else {
      await execFile(runtime.command, ["tool", "install", ...command.packageSpecs], {
        timeout: INSTALL_TIMEOUT_MS,
        windowsHide: true,
        env: dependencyEnv(tempRoot),
      });
    }
    if (!isPathWithin(root, installRoot) || !isPathWithin(root, tempRoot)) {
      throw new Error("MCP dependency path is outside App Data.");
    }
    if (current?.installRoot && current.installRoot !== installRoot) {
      throw new Error("MCP dependency installation path changed unexpectedly.");
    }
    let backupRoot: string | null = null;
    if (existsSync(installRoot)) {
      backupRoot = join(
        root,
        `.backup-dependencies-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      );
      renameSync(installRoot, backupRoot);
    }
    try {
      renameSync(tempRoot, installRoot);
    } catch (error) {
      if (backupRoot && !existsSync(installRoot) && existsSync(backupRoot))
        renameSync(backupRoot, installRoot);
      throw error;
    }
    if (backupRoot) {
      try {
        rmSync(backupRoot, { recursive: true, force: true });
      } catch {
        // A stale backup is safer than deleting a verified installation.
      }
    }
    const installed = await upsertMcpDependencyInstallationAsync({
      serverId,
      manager: command.manager,
      packageSpecs: command.packageSpecs,
      installRoot,
      status: "installed",
      scriptsAllowed: options.allowScripts === true,
      runtimeInstallationId: runtime.runtimeId,
      installedAt: Date.now(),
      lastError: null,
    });
    // A dependency install is preparation only. Keep the server disabled
    // until the user reviews its command, secrets, and approval policy.
    await setToolServerEnabledAsync(serverId, false);
    return installed;
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    const message = error instanceof Error ? error.message.slice(0, 2_000) : String(error);
    const needsConfirmation =
      !options.allowScripts && /script|lifecycle|postinstall|preinstall/i.test(message);
    return upsertMcpDependencyInstallationAsync({
      serverId,
      manager: command.manager,
      packageSpecs: command.packageSpecs,
      installRoot: current?.installRoot ?? null,
      status: needsConfirmation ? "needs_confirmation" : "failed",
      scriptsAllowed: current?.scriptsAllowed ?? false,
      lastError: message,
    });
  }
}

export async function uninstallMcpDependencies(serverId: string): Promise<boolean> {
  const server = getMcpServer(serverId);
  if (!server) throw new Error("MCP server not found.");
  const installation = getMcpDependencyInstallation(serverId);
  assertMcpDependencyNotBusy(serverId);
  if (installation?.installRoot) {
    const root = resolveMcpServerRoot(serverId);
    if (!isPathWithin(root, installation.installRoot))
      throw new Error("MCP dependency path is outside App Data.");
    rmSync(installation.installRoot, { recursive: true, force: true });
  }
  await upsertMcpDependencyInstallationAsync({
    serverId,
    manager: installation?.manager ?? "none",
    packageSpecs: installation?.packageSpecs ?? [],
    installRoot: null,
    status: server.transport === "stdio" ? "not_installed" : "not_applicable",
    installedAt: null,
    lastError: null,
  });
  return true;
}

/**
 * Remove only the filesystem owned by a server whose database row may already
 * be in the recycle bin. The normal uninstall path also updates its record;
 * permanent deletion uses this narrower cleanup before cascading the row.
 */
export function removeMcpDependencyDirectory(serverId: string): boolean {
  const installation = getMcpDependencyInstallation(serverId);
  if (!installation?.installRoot) return false;
  assertMcpDependencyNotBusy(serverId);
  const root = resolveMcpServerRoot(serverId);
  if (!isPathWithin(root, installation.installRoot))
    throw new Error("MCP dependency path is outside App Data.");
  rmSync(installation.installRoot, { recursive: true, force: true });
  return true;
}

function assertMcpDependencyNotBusy(serverId: string): void {
  const state = getMcpRuntimeState(serverId);
  if (
    state &&
    (state.desiredState === "running" ||
      ["starting", "running", "stopping", "reconnecting"].includes(state.state))
  ) {
    throw new Error("Stop the MCP server before changing its dependencies.");
  }
}

function dependencyEnv(installRoot: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key, value]) =>
          typeof value === "string" &&
          !key.startsWith("ELECTRON_") &&
          key !== "ELECTRON_RUN_AS_NODE",
      ),
    ),
    NPM_CONFIG_PREFIX: installRoot,
    npm_config_prefix: installRoot,
    UV_TOOL_DIR: join(installRoot, "uv-tools"),
    UV_TOOL_BIN_DIR: join(installRoot, "bin"),
    UV_CACHE_DIR: join(installRoot, "uv-cache"),
  };
}

function parseArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}
