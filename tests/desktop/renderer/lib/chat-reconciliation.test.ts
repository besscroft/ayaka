import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  isTerminalRunStatus,
  mergeChatMessages,
  reconcileChatMessages,
  selectLiveChatMessages,
  snapshotUIMessage,
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
      shouldReconcileCompletedRun({
        ...base,
        runConversationId: "conversation-2",
      }),
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

  void it("rejects an empty automatic snapshot without clearing the current stream", () => {
    const current = [user("u1", "Question"), assistant("a1", "Partial answer")];
    assert.equal(mergeChatMessages(current, []), null);
  });

  void it("rejects an older assistant snapshot even when it has the same message id", () => {
    const current = [user("u1", "Question"), assistant("a1", "A complete answer")];
    const older = [user("u1", "Question"), assistant("a1", "A")];
    assert.equal(mergeChatMessages(current, older), null);
  });

  void it("prefers live stream messages over the previous renderer snapshot", () => {
    const previous = [user("u1", "Question"), assistant("a1", "old")];
    const live: UIMessage[] = [
      user("u1", "Question"),
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "reasoning", text: "first", state: "streaming" }],
      },
    ];

    const selected = selectLiveChatMessages(live, previous);
    assert.equal(selected.at(-1)?.parts[0]?.type, "reasoning");
    assert.notEqual(selected, live);
    assert.notEqual(selected.at(-1), live.at(-1));
  });

  void it("replaces only the changed tail during a stream", () => {
    const firstUser = user("u1", "Question");
    const secondUser = user("u2", "Follow-up");
    const previous = [firstUser, assistant("a1", "Answer"), secondUser];
    const live = [
      firstUser,
      previous[1],
      secondUser,
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "Streaming" }] },
    ] as UIMessage[];

    const selected = selectLiveChatMessages(live, previous);
    assert.equal(selected[0], firstUser);
    assert.equal(selected[1], previous[1]);
    assert.equal(selected[2], secondUser);
    assert.notEqual(selected[3], live[3]);
    assert.equal(selected[3]?.parts[0]?.type, "text");
  });

  void it("keeps the last non-empty snapshot during a transient empty stream state", () => {
    const previous = [user("u1", "Question"), assistant("a1", "partial reasoning")];
    assert.equal(selectLiveChatMessages([], previous), previous);
  });

  void it("keeps locally edited user text when an automatic snapshot is stale", () => {
    const current = [user("u1", "Edited question"), assistant("a1", "Answer")];
    const persisted = [user("u1", "Original question"), assistant("a1", "Answer, more")];
    const part = mergeChatMessages(current, persisted)?.[0]?.parts[0];
    assert.equal(part?.type === "text" ? part.text : undefined, "Edited question");
  });

  void it("hydrates a complete assistant message with tool, reasoning, and media parts", () => {
    const persisted: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Checking the workspace" },
        { type: "text", text: "Done" },
        {
          type: "file",
          mediaType: "image/png",
          filename: "result.png",
          url: "workspace://result.png",
        },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "generate_media",
          input: { prompt: "result" },
        } as never,
      ],
    };
    const merged = mergeChatMessages([user("u1", "Question")], [user("u1", "Question"), persisted]);
    assert.equal(merged?.at(-1)?.parts.length, 4);
    assert.equal(merged?.at(-1)?.parts[2]?.type, "file");
  });

  void it("creates a new assistant snapshot when the stream mutates a message in place", () => {
    const streamed: UIMessage = {
      id: "a1",
      role: "assistant",
      parts: [{ type: "reasoning", text: "first" }],
    };
    const first = mergeChatMessages([user("u1", "Question")], [user("u1", "Question"), streamed]);
    assert.ok(first);
    assert.notEqual(first[1], streamed);

    (streamed.parts[0] as { text: string }).text = "first second";
    const second = mergeChatMessages(first, [user("u1", "Question"), streamed]);
    assert.ok(second);
    assert.notEqual(second[1], first[1]);
    assert.equal(
      second[1]?.parts[0]?.type === "reasoning" ? second[1].parts[0].text : undefined,
      "first second",
    );
  });

  void it("copies each part while preserving the message content", () => {
    const message = assistant("a1", "Answer");
    const snapshot = snapshotUIMessage(message);
    assert.deepEqual(snapshot, message);
    assert.notEqual(snapshot, message);
    assert.notEqual(snapshot.parts, message.parts);
    assert.notEqual(snapshot.parts[0], message.parts[0]);
  });
});
