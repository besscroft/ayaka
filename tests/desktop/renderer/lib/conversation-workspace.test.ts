import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getConversationWorkspaceForHeader } from "@renderer/lib/conversation-workspace";

void describe("conversation workspace header state", () => {
  void it("hides a workspace that belongs to the previous conversation", () => {
    const workspace = createWorkspace("old-conversation");

    assert.equal(getConversationWorkspaceForHeader(workspace, "new-conversation"), null);
  });

  void it("keeps the workspace for the active conversation", () => {
    const workspace = createWorkspace("active-conversation");

    assert.deepEqual(
      getConversationWorkspaceForHeader(workspace, "active-conversation"),
      workspace,
    );
  });
});

function createWorkspace(conversationId: string) {
  return {
    conversationId,
    relativePath: "2026-08-19-conv-example",
    status: "active" as const,
    createdAt: 1,
    updatedAt: 1,
  };
}
