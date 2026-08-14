import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  isTerminalRunStatus,
  reconcileChatMessages,
  shouldReconcileCompletedRun,
} from "@renderer/lib/chat-reconciliation";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

void describe("chat reconciliation", () => {
  void it("recognizes terminal runtime statuses without treating active runs as complete", () => {
    assert.equal(isTerminalRunStatus("succeeded"), true);
    assert.equal(isTerminalRunStatus("interrupted"), true);
    assert.equal(isTerminalRunStatus("running"), false);
    assert.equal(isTerminalRunStatus("waiting_approval"), false);
  });

  void it("only reconciles the tracked loading run for the current conversation", () => {
    const base = {
      trackedRunId: "run-1",
      runId: "run-1",
      conversationId: "conversation-1",
      runConversationId: "conversation-1",
      isChatLoading: true,
      status: "succeeded" as const,
    };

    assert.equal(shouldReconcileCompletedRun(base), true);
    assert.equal(shouldReconcileCompletedRun({ ...base, runId: "run-2" }), false);
    assert.equal(
      shouldReconcileCompletedRun({ ...base, runConversationId: "conversation-2" }),
      false,
    );
    assert.equal(shouldReconcileCompletedRun({ ...base, isChatLoading: false }), false);
    assert.equal(shouldReconcileCompletedRun({ ...base, status: "running" }), false);
  });

  void it("keeps the current stream when the persisted snapshot is older", () => {
    const current = [user("u1", "Question"), assistant("a1", "A longer current answer")];
    const persisted = [user("u1", "Question"), assistant("a1", "A")];

    assert.equal(reconcileChatMessages(current, persisted), null);
  });

  void it("uses a more complete persisted assistant message", () => {
    const current = [user("u1", "Question"), assistant("a1", "A")];
    const persisted = [user("u1", "Question"), assistant("a1", "A complete answer")];

    const finalPart = reconcileChatMessages(current, persisted)?.at(-1)?.parts[0];
    assert.equal(finalPart?.type === "text" ? finalPart.text : undefined, "A complete answer");
  });

  void it("appends a persisted final assistant message while preserving order", () => {
    const current = [user("u1", "Question")];
    const persisted = [user("u1", "Question"), assistant("a1", "Answer")];

    assert.deepEqual(
      reconcileChatMessages(current, persisted)?.map((message) => message.id),
      ["u1", "a1"],
    );
  });

  void it("does not recover without an assistant response", () => {
    assert.equal(reconcileChatMessages([user("u1", "Question")], [user("u1", "Question")]), null);
  });
});
