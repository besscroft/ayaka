import { CHAT_TOOL_IDS, MEDIA_GENERATION_TOOL_NAME } from "../../shared/types";

export interface RootToolApprovalInput {
  toolName: string;
  toolInput?: unknown;
  reviewAll: boolean;
  dynamicallyRequiresApproval: boolean;
  policyRequiresApproval: boolean;
  builtinToolNames?: ReadonlySet<string>;
}

const BUILTIN_TOOL_NAMES = new Set<string>([
  ...CHAT_TOOL_IDS,
  MEDIA_GENERATION_TOOL_NAME,
  "agent_create",
  "agent_update",
]);

export function isBuiltinToolName(toolName: string): boolean {
  return BUILTIN_TOOL_NAMES.has(toolName);
}

export function rootToolRequiresApproval(input: RootToolApprovalInput): boolean {
  if (isBuiltinToolName(input.toolName) || input.builtinToolNames?.has(input.toolName)) {
    return false;
  }
  return input.reviewAll || input.dynamicallyRequiresApproval || input.policyRequiresApproval;
}
