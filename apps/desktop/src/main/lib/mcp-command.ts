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
  packageSpecs: string[];
  canInstall: boolean;
  installStatus: McpDependencyStatus;
}

export function parseMcpCommand(command: string | null, args: string[]): ParsedMcpCommand {
  const originalCommand = command?.trim() ?? "";
  const originalArgs = [...args];
  const name = basename(originalCommand)
    .replace(/\.(?:cmd|exe)$/i, "")
    .toLowerCase();
  const manager: McpCommandManager = name === "npx" ? "npx" : name === "uvx" ? "uvx" : "none";
  const packages =
    manager === "npx" ? parseNpxPackages(args) : manager === "uvx" ? parseUvxPackages(args) : [];
  const canSafelyResolve = manager === "none" || packages.length > 0;
  const resolved = canSafelyResolve
    ? resolveMcpCommand(originalCommand)
    : { command: originalCommand, runtimeId: null };
  const resolvedArgs = canSafelyResolve
    ? resolveAliasArgs(manager, resolved.command, originalArgs)
    : originalArgs;
  return {
    manager,
    originalCommand,
    originalArgs,
    resolvedCommand: resolved.command,
    resolvedArgs,
    packageSpecs: packages,
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
  const packages: string[] = [];
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
      packages.push(arg.slice("--with=".length));
      continue;
    }
    if (!endOfOptions && arg.startsWith("-")) return [];
    if (!fromPackage && !primarySeen) {
      packages.push(arg);
      primarySeen = true;
    }
    break;
  }
  return packages.filter(Boolean);
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
