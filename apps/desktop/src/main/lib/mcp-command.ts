import { basename } from "node:path";
import type { McpDependencyStatus } from "../../shared/types";
import { resolveMcpCommand } from "./runtime-manager";

export type McpCommandManager = "npx" | "uvx" | "none";

export interface ParsedMcpCommand {
  manager: McpCommandManager;
  originalCommand: string;
  originalArgs: string[];
  resolvedCommand: string;
  resolvedArgs: string[];
  runtimeArgsPrefix: string[];
  packageSpecs: string[];
  installArgs: string[];
  canInstall: boolean;
  installStatus: McpDependencyStatus;
}

const SQLITE_SERVER_PACKAGE = "mcp-server-sqlite==2025.4.25";
const SQLITE_MCP_COMPATIBILITY = "mcp<2";

export function parseMcpCommand(command: string | null, args: string[]): ParsedMcpCommand {
  const originalCommand = command?.trim() ?? "";
  const originalArgs = [...args];
  const name = basename(originalCommand)
    .replace(/\.(?:cmd|exe)$/i, "")
    .toLowerCase();
  const manager: McpCommandManager = name === "npx" ? "npx" : name === "uvx" ? "uvx" : "none";
  const normalizedArgs = manager === "uvx" ? normalizeUvxArgs(originalArgs) : originalArgs;
  const packages =
    manager === "npx"
      ? parseNpxPackages(normalizedArgs)
      : manager === "uvx"
        ? parseUvxPackages(normalizedArgs)
        : [];
  const canSafelyResolve = manager === "none" || packages.length > 0;
  const resolved = canSafelyResolve
    ? resolveMcpCommand(originalCommand)
    : { command: originalCommand, argsPrefix: [], runtimeId: null };
  const aliasArgs = canSafelyResolve
    ? resolveAliasArgs(manager, resolved.command, normalizedArgs)
    : normalizedArgs;
  const resolvedArgs = canSafelyResolve ? [...resolved.argsPrefix, ...aliasArgs] : originalArgs;
  return {
    manager,
    originalCommand,
    originalArgs,
    resolvedCommand: resolved.command,
    resolvedArgs,
    runtimeArgsPrefix: resolved.argsPrefix,
    packageSpecs: packages,
    installArgs: manager === "uvx" ? getUvxToolInstallArgs(normalizedArgs) : packages,
    canInstall: manager !== "none" && packages.length > 0,
    installStatus:
      manager === "none"
        ? "not_applicable"
        : packages.length > 0
          ? "not_installed"
          : "needs_confirmation",
  };
}

export function parseNpxPackages(args: string[]): string[] {
  const packages: string[] = [];
  let endOfOptions = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && (arg === "-p" || arg === "--package")) {
      const value = args[++index];
      if (value) packages.push(value);
      continue;
    }
    if (!endOfOptions && (arg === "-y" || arg === "--yes" || arg === "--no-install")) continue;
    if (!endOfOptions && arg.startsWith("-")) {
      if (arg.startsWith("--package=")) {
        const value = arg.slice("--package=".length);
        if (value) packages.push(value);
        continue;
      }
      // Unknown flags can change npx's resolution or execute shell-like
      // behavior. Leave the command untouched instead of guessing.
      return [];
    }
    if (packages.length === 0) packages.push(arg);
    break;
  }
  return packages.filter(Boolean);
}

export function parseUvxPackages(args: string[]): string[] {
  return parseUvxPackageInvocation(args).packageSpecs;
}

export function getUvxToolInstallArgs(args: string[]): string[] {
  const normalizedArgs = normalizeUvxArgs(args);
  const parsed = parseUvxPackageInvocation(normalizedArgs);
  if (!parsed.safe || parsed.packageSpecs.length === 0) return [];

  const packageSpecs = [...parsed.packageSpecs];
  for (const withPackage of parsed.withPackages) {
    const index = packageSpecs.indexOf(withPackage);
    if (index >= 0) packageSpecs.splice(index, 1);
  }
  return [...parsed.withPackages.flatMap((value) => ["--with", value]), ...packageSpecs];
}

export function normalizeUvxArgs(args: string[]): string[] {
  const parsed = parseUvxPackageInvocation(args);
  if (
    !parsed.safe ||
    !parsed.packageSpecs.includes(SQLITE_SERVER_PACKAGE) ||
    parsed.withPackages.some(isMcpRequirement)
  ) {
    return [...args];
  }
  return ["--with", SQLITE_MCP_COMPATIBILITY, ...args];
}

interface UvxPackageInvocation {
  packageSpecs: string[];
  withPackages: string[];
  safe: boolean;
}

function parseUvxPackageInvocation(args: string[]): UvxPackageInvocation {
  const packages: string[] = [];
  const withPackages: string[] = [];
  let endOfOptions = false;
  let fromPackage: string | null = null;
  let primarySeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && (arg === "--from" || arg === "--with")) {
      const value = args[++index];
      if (value) {
        if (arg === "--from") fromPackage = value;
        else withPackages.push(value);
        packages.push(value);
      }
      continue;
    }
    if (!endOfOptions && (arg === "--python" || arg === "--index" || arg === "--default-index")) {
      index += 1;
      continue;
    }
    if (!endOfOptions && arg.startsWith("--from=")) {
      fromPackage = arg.slice("--from=".length);
      packages.push(fromPackage);
      continue;
    }
    if (!endOfOptions && arg.startsWith("--with=")) {
      const value = arg.slice("--with=".length);
      if (value) {
        withPackages.push(value);
        packages.push(value);
      }
      continue;
    }
    if (!endOfOptions && arg.startsWith("-")) {
      return { packageSpecs: [], withPackages: [], safe: false };
    }
    if (!fromPackage && !primarySeen) {
      packages.push(arg);
      primarySeen = true;
    }
    break;
  }
  return { packageSpecs: packages.filter(Boolean), withPackages, safe: true };
}

function isMcpRequirement(value: string): boolean {
  return /^mcp(?:\[[^\]]+\])?(?:[<>=!~].*)?$/i.test(value.trim());
}

export function resolveAliasArgs(
  manager: McpCommandManager,
  resolvedCommand: string,
  args: string[],
): string[] {
  const resolvedName = basename(resolvedCommand)
    .replace(/\.(?:cmd|exe)$/i, "")
    .toLowerCase();
  if (manager === "uvx" && resolvedName === "uv") return ["tool", "run", ...args];
  return [...args];
}

export function redactMcpCommandArgs(args: string[]): string[] {
  return args.map((value) =>
    /token|secret|password|authorization|api[-_]?key/i.test(value) ? "[REDACTED]" : value,
  );
}
