import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bypassesChatPermissionApproval,
  isChatPermissionSensitiveTool,
  requiresChatPermissionApproval,
} from "@desktop-main/lib/chat-permission-policy";

void describe("chat permission policy", () => {
  void it("asks for approval for network, external writes, and high-risk tools", () => {
    for (const toolName of [
      "web_search",
      "google_search",
      "web_open",
      "sandbox_write_file",
      "sandbox_run_command",
      "workspace_run_command",
      "sandbox_start_preview",
    ]) {
      assert.equal(isChatPermissionSensitiveTool(toolName), true, toolName);
      assert.equal(requiresChatPermissionApproval("ask", toolName), true, toolName);
    }
    assert.equal(requiresChatPermissionApproval("ask", "current_time"), false);
  });

  void it("keeps approve_risky on existing risk and tool-level approval layers", () => {
    assert.equal(requiresChatPermissionApproval("approve_risky", "web_search"), false);
    assert.equal(requiresChatPermissionApproval("approve_risky", "mcp__server__tool"), false);
    assert.equal(bypassesChatPermissionApproval("approve_risky"), false);
  });

  void it("only full_access bypasses soft conversation approval", () => {
    assert.equal(bypassesChatPermissionApproval("full_access"), true);
    assert.equal(requiresChatPermissionApproval("full_access", "workspace_run_command"), false);
  });
});
