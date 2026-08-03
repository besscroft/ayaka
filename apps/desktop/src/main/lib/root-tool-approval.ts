import { MEDIA_GENERATION_TOOL_NAME } from "../../shared/types";

export interface RootToolApprovalInput {
  toolName: string;
  toolInput?: unknown;
  reviewAll: boolean;
  dynamicallyRequiresApproval: boolean;
  policyRequiresApproval: boolean;
}

export function builtinChatToolRequiresApproval(toolName: string, input?: unknown): boolean {
  if (
    toolName === "memory_search" ||
    toolName === "current_time" ||
    toolName === "runtime_snapshot"
  ) {
    return false;
  }
  if (toolName === "conversation_search") return true;
  if (
    toolName === "memory_save" ||
    toolName === "memory_update" ||
    toolName === "memory_delete" ||
    toolName === MEDIA_GENERATION_TOOL_NAME ||
    toolName === "agent_create" ||
    toolName === "agent_update"
  ) {
    return true;
  }
  if (toolName !== "cron") return false;
  const action = readStringProperty(input, "action");
  return action !== "list" && action !== "get";
}

export function rootToolRequiresApproval(input: RootToolApprovalInput): boolean {
  if (
    input.toolName === "memory_search" ||
    input.toolName === "current_time" ||
    input.toolName === "runtime_snapshot"
  ) {
    return false;
  }
  return (
    input.reviewAll ||
    input.dynamicallyRequiresApproval ||
    input.policyRequiresApproval ||
    builtinChatToolRequiresApproval(input.toolName, input.toolInput)
  );
}

function readStringProperty(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
