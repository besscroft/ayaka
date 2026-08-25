import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuntimeRun } from "@shared/types";
import { getRunningConversationIds } from "@renderer/lib/agent-runtime-status";

function makeRun(conversationId: string | null, status: RuntimeRun["status"]): RuntimeRun {
  return {
    id: `${conversationId ?? "none"}-${status}`,
    conversation_id: conversationId,
    root_agent_id: null,
    final_agent_id: null,
    origin: "chat",
    finish_reason: null,
    status,
    model_ref: null,
    started_at: 0,
    finished_at: null,
    trace_id: null,
    input_summary: null,
    output_summary: null,
    error: null,
    usage_json: null,
  };
}

void describe("getRunningConversationIds", () => {
  void it("returns only conversations with active chat runs", () => {
    const running = getRunningConversationIds([
      makeRun("conversation-a", "queued"),
      makeRun("conversation-b", "waiting_approval"),
      makeRun("conversation-c", "succeeded"),
      makeRun(null, "running"),
    ]);

    assert.deepEqual([...running].sort(), ["conversation-a", "conversation-b"]);
  });
});
