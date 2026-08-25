import type { ChatPermissionMode } from "../../shared/types";

/** Tools whose normal operation reads external data or changes files. */
const SENSITIVE_TOOL_NAMES = new Set([
  "web_search",
  "google_search",
  "web_open",
  "file_search",
  "code_interpreter",
  "sandbox_write_file",
  "sandbox_run_command",
  "sandbox_restore",
  "sandbox_preview_port",
  "sandbox_publish_artifact",
  "sandbox_start_preview",
  "workspace_run_command",
]);

export function isChatPermissionSensitiveTool(toolName: string): boolean {
  return SENSITIVE_TOOL_NAMES.has(toolName);
}

export function bypassesChatPermissionApproval(mode: ChatPermissionMode): boolean {
  return mode === "full_access";
}

/**
 * The conversation-level "ask" mode adds approval to operations that cross
 * the local-only boundary. Risk classification, agent policy, and dynamic
 * tool settings remain separate layers for approve_risky mode.
 */
export function requiresChatPermissionApproval(
  mode: ChatPermissionMode,
  toolName: string,
): boolean {
  return mode === "ask" && isChatPermissionSensitiveTool(toolName);
}
