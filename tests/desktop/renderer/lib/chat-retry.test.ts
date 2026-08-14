import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuntimeRun } from "@shared/types";
import {
  isResumableBlockedRun,
  selectChatRetryRun,
  shouldFallbackToFreshRun,
} from "@renderer/lib/chat-retry";

function run(status: RuntimeRun["status"], metadata_json?: string): RuntimeRun {
  return {
    id: "run-1",
    conversation_id: "conversation-1",
    root_agent_id: "agent-1",
    final_agent_id: "agent-1",
    origin: "chat",
    finish_reason: null,
    status,
    model_ref: "mock/chat",
    started_at: 1,
    finished_at: null,
    trace_id: "trace-1",
    input_summary: null,
    output_summary: null,
    error: null,
    usage_json: null,
    metadata_json,
  };
}

void describe("chat retry", () => {
  void it("starts a new run after every non-blocked terminal state", () => {
    for (const status of ["succeeded", "failed", "cancelled", "interrupted"] as const) {
      assert.deepEqual(
        selectChatRetryRun({
          currentRunId: "run-1",
          currentRun: run(status),
          newRunId: "run-2",
        }),
        { runId: "run-2", mode: "start" },
      );
    }
  });

  void it("resumes a resumable blocked run", () => {
    const blocked = run("blocked", JSON.stringify({ resumable: true }));
    assert.equal(isResumableBlockedRun(blocked), true);
    assert.deepEqual(
      selectChatRetryRun({ currentRunId: "run-1", currentRun: blocked, newRunId: "run-2" }),
      { runId: "run-1", mode: "resume" },
    );
  });

  void it("starts a new run for an exhausted or malformed blocked run", () => {
    assert.equal(
      isResumableBlockedRun(run("blocked", JSON.stringify({ resumable: false }))),
      false,
    );
    assert.equal(isResumableBlockedRun(run("blocked", "not-json")), false);
    assert.deepEqual(
      selectChatRetryRun({
        currentRunId: "run-1",
        currentRun: run("blocked", JSON.stringify({ resumable: false })),
        newRunId: "run-2",
      }),
      { runId: "run-2", mode: "start" },
    );
  });

  void it("falls back from a stale run error only once", () => {
    assert.equal(shouldFallbackToFreshRun("run_not_active", false), true);
    assert.equal(shouldFallbackToFreshRun("run_not_found", false), true);
    assert.equal(shouldFallbackToFreshRun("run_not_active", true), false);
    assert.equal(shouldFallbackToFreshRun("provider", false), false);
  });
});
