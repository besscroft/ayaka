import { execFileSync } from "node:child_process";
import type { RuntimeKind, SkillDependencyStatus, SkillPackage } from "../../shared/types";
import {
  getSkillInspection,
  getSkillPackage,
  getMcpDependencyInstallation,
  listMcpServers,
  setSkillPackageStatusAsync,
} from "./db";
import { discoverMcpServer } from "./mcp-manager";
import { installMcpDependencies } from "./mcp-dependencies";
import { installManagedRuntime, isRuntimeCommandAvailable } from "./runtime-manager";
import { isSkillPackageHashCurrent } from "./skill-executor-policy";
import { notifySkillChanged } from "./skill-events";

const CHROME_DEBUG_URL = "http://127.0.0.1:9222/json/version";
const CHROME_DEBUG_TIMEOUT_MS = 2_000;

/**
 * Resolve the current state of declared Skill dependencies. This is deliberately
 * a diagnostic operation: it never installs a package, starts an undeclared
 * process, or changes the Skill's enabled state.
 */
export async function inspectSkillDependencies(skillId: string): Promise<SkillDependencyStatus[]> {
  const inspection = getSkillInspection(skillId);
  return Promise.all(inspection.dependencies.map((dependency) => inspectDependency(dependency)));
}

/**
 * Confirm and, where the declaration is actionable, prepare dependencies. MCP
 * installation is delegated to the existing MCP dependency manager and runtime
 * installation is delegated to the existing managed-runtime manager.
 */
export async function confirmSkillDependencies(
  skillId: string,
  options: { allowScripts?: boolean } = {},
): Promise<SkillPackage | null> {
  const inspection = getSkillInspection(skillId);
  if (!inspection.package) throw new Error("This Skill does not contain a package.");

  for (const dependency of inspection.dependencies) {
    if (dependency.kind === "runtime") {
      const runtime = runtimeKindForDependency(dependency.name);
      if (runtime === "node" || runtime === "uv") {
        if (!isRuntimeReady(runtime)) await installManagedRuntime(runtime);
      } else if (runtime === "python" && !isRuntimeReady("python")) {
        // Python Skills run through managed uv when it is available. Installing
        // uv here keeps dependency preparation explicit without adding a second
        // unmanaged Python installer.
        if (!isRuntimeReady("uv")) await installManagedRuntime("uv");
      }
      continue;
    }

    if (dependency.kind !== "mcp" && dependency.kind !== "browser") continue;
    const server = findMcpServer(dependency.name);
    if (!server) continue;
    const installation = await installMcpDependencies(server.id, {
      allowScripts: options.allowScripts === true,
    });
    if (installation.status === "failed") {
      throw new Error(
        installation.lastError ?? `MCP dependency installation failed for ${server.name}.`,
      );
    }
  }

  const statuses = await inspectSkillDependencies(skillId);
  const result = await setSkillPackageStatusAsync(skillId, packageStatusForDependencies(statuses));
  notifySkillChanged({ skillId, reason: "dependencies" });
  return result;
}

/** Update the persisted executable status without installing anything. */
export async function refreshSkillPackageStatus(skillId: string): Promise<SkillPackage | null> {
  const packageRow = getSkillPackage(skillId);
  if (!packageRow) return packageRow;
  const inspection = getSkillInspection(skillId);
  if (inspection.skill.enabled === 0 || packageRow.status === "error") return packageRow;
  if (!isSkillPackageHashCurrent(packageRow.rootPath, packageRow.contentHash)) {
    const result = await setSkillPackageStatusAsync(
      skillId,
      "error",
      "Skill package content changed; review it again.",
    );
    notifySkillChanged({ skillId, reason: "package" });
    return result;
  }
  const statuses = await inspectSkillDependencies(skillId);
  const result = await setSkillPackageStatusAsync(skillId, packageStatusForDependencies(statuses));
  notifySkillChanged({ skillId, reason: "dependencies" });
  return result;
}

function packageStatusForDependencies(
  dependencies: SkillDependencyStatus[],
): "ready" | "needs_confirmation" | "needs_runtime" {
  const failed = dependencies.find((dependency) => dependency.status === "failed");
  if (failed) return "needs_confirmation";
  if (dependencies.some((dependency) => dependency.status === "needs_runtime")) {
    return "needs_runtime";
  }
  if (
    dependencies.some(
      (dependency) =>
        dependency.status === "needs_confirmation" || dependency.status === "needs_install",
    )
  ) {
    return "needs_confirmation";
  }
  return "ready";
}

async function inspectDependency(
  dependency: SkillDependencyStatus,
): Promise<SkillDependencyStatus> {
  if (dependency.kind === "runtime") return inspectRuntimeDependency(dependency);
  if (dependency.kind === "browser") return inspectBrowserDependency(dependency);
  return inspectMcpDependency(dependency);
}

function inspectRuntimeDependency(dependency: SkillDependencyStatus): SkillDependencyStatus {
  const runtime = runtimeKindForDependency(dependency.name);
  if (runtime === "node" || runtime === "uv") {
    return isRuntimeReady(runtime)
      ? { ...dependency, status: "ready", error: undefined }
      : {
          ...dependency,
          status: "needs_runtime",
          error: `${runtime === "node" ? "Node.js" : "uv"} runtime is not available. Confirm installation from Ayaka Settings.`,
        };
  }
  if (runtime === "python") {
    return probeExecutable("python", dependency);
  }
  return {
    ...dependency,
    status: "needs_runtime",
    error: `Unknown runtime dependency: ${dependency.name}.`,
  };
}

async function inspectMcpDependency(
  dependency: SkillDependencyStatus,
): Promise<SkillDependencyStatus> {
  const server = findMcpServer(dependency.name);
  if (!server) {
    return {
      ...dependency,
      status: "needs_install",
      error: `MCP server '${dependency.name}' is not installed. Install and enable it before using this Skill.`,
    };
  }
  if (server.enabled === 0) {
    return {
      ...dependency,
      status: "needs_confirmation",
      error: `MCP server '${server.name}' is installed but disabled. Enable it before using this Skill.`,
    };
  }
  const installation = getMcpDependencyInstallation(server.id);
  if (installation?.status === "failed") {
    return {
      ...dependency,
      status: "failed",
      error: installation.lastError ?? `MCP dependency installation failed for '${server.name}'.`,
    };
  }
  if (installation?.status === "installing" || installation?.status === "needs_confirmation") {
    return {
      ...dependency,
      status: "needs_confirmation",
      error:
        installation.lastError ??
        `MCP dependency installation for '${server.name}' requires confirmation.`,
    };
  }
  try {
    const discovery = await discoverMcpServer(server.id);
    if (discovery.server.status === "error") {
      return {
        ...dependency,
        status: "failed",
        error: discovery.message,
      };
    }
    return { ...dependency, status: "ready", error: undefined, detail: discovery.message };
  } catch (error) {
    return {
      ...dependency,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function inspectBrowserDependency(
  dependency: SkillDependencyStatus,
): Promise<SkillDependencyStatus> {
  const mcp = await inspectMcpDependency({ ...dependency, kind: "mcp" });
  if (mcp.status !== "ready") {
    return {
      ...dependency,
      status: mcp.status,
      ...(mcp.error ? { error: mcp.error } : {}),
      ...(mcp.detail ? { detail: mcp.detail } : {}),
    };
  }
  if (!isChromeDevToolsDependency(dependency.name)) return { ...dependency, status: "ready" };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CHROME_DEBUG_TIMEOUT_MS);
    try {
      const response = await fetch(CHROME_DEBUG_URL, { signal: controller.signal });
      if (!response.ok) throw new Error(`Chrome debug endpoint returned HTTP ${response.status}.`);
      return {
        ...dependency,
        status: "ready",
        error: undefined,
        detail: "Chrome DevTools MCP handshake and Chrome debugging endpoint are ready.",
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return {
      ...dependency,
      status: "needs_runtime",
      error:
        "Chrome DevTools MCP is connected, but Chrome is not exposing http://127.0.0.1:9222/json/version. Start Chrome with remote debugging enabled.",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function findMcpServer(name: string) {
  const normalized = name.trim().toLowerCase();
  return listMcpServers().find(
    (server) =>
      server.id.toLowerCase() === normalized ||
      server.name.trim().toLowerCase() === normalized ||
      (isChromeDevToolsDependency(normalized) && server.name.toLowerCase().includes("chrome")),
  );
}

function runtimeKindForDependency(name: string): RuntimeKind | "python" | null {
  const normalized = name.trim().toLowerCase();
  if (normalized === "node" || normalized === "nodejs" || normalized === "javascript")
    return "node";
  if (normalized === "uv" || normalized === "uvx") return "uv";
  if (normalized === "python" || normalized === "python3") return "python";
  return null;
}

function isRuntimeReady(runtime: RuntimeKind | "python"): boolean {
  return isRuntimeCommandAvailable(runtime);
}

function probeExecutable(
  command: string,
  dependency: SkillDependencyStatus,
): SkillDependencyStatus {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore", windowsHide: true, timeout: 5_000 });
    return { ...dependency, status: "ready", error: undefined };
  } catch {
    return {
      ...dependency,
      status: "needs_runtime",
      error: `${command} runtime is not available. Install or enable it before using this Skill.`,
    };
  }
}

function isChromeDevToolsDependency(name: string): boolean {
  return /chrome|devtools|puppeteer|playwright/i.test(name);
}
