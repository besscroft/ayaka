import type { WorkspaceInfo } from "@shared/types";

/** Keep a workspace from a previous conversation out of the current header. */
export function getConversationWorkspaceForHeader(
  workspace: WorkspaceInfo | null,
  conversationId: string,
): WorkspaceInfo | null {
  return workspace?.conversationId === conversationId ? workspace : null;
}
