import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hideCompletionToolStream,
  validateCompletion,
  validateCompletionText,
} from "@desktop-main/lib/agent-completion";

void describe("agent completion protocol", () => {
  void it("accepts a verified completion with no remaining work", () => {
    const result = validateCompletion({
      result: "Implemented and verified.",
      completedItems: ["Implemented the change"],
      verificationEvidence: ["Tests passed"],
      remainingItems: [],
    });
    assert.equal(result.accepted, true);
  });

  void it("rejects incomplete, unverified, or blocked completion", () => {
    const result = validateCompletion(
      {
        result: "Partial work",
        completedItems: ["Started"],
        verificationEvidence: [],
        remainingItems: ["Finish"],
      },
      { hasPendingApproval: true, hasRunningSubagents: true, hasRecentToolError: true },
    );
    assert.equal(result.accepted, false);
    assert.ok(result.reasons.length >= 5);
  });

  void it("parses the no-tool JSON fallback", () => {
    const result = validateCompletionText(
      '```json\n{"result":"Done","completedItems":["Work"],"verificationEvidence":["Checked"],"remainingItems":[]}\n```',
    );
    assert.equal(result?.accepted, true);
  });

  void it("keeps completion tool calls out of the UI stream", async () => {
    const stream = new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue({ type: "tool-input-start", id: "call-1", toolName: "complete_task" });
        controller.enqueue({ type: "tool-input-delta", id: "call-1", delta: "{}" });
        controller.enqueue({
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "complete_task",
          input: {},
          output: { accepted: true },
        });
        controller.enqueue({
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "web_search",
          input: {},
        });
        controller.close();
      },
    });

    const visible: unknown[] = [];
    for await (const part of hideCompletionToolStream(
      stream as Parameters<typeof hideCompletionToolStream>[0],
    ))
      visible.push(part);
    assert.deepEqual(visible, [
      { type: "tool-call", toolCallId: "call-2", toolName: "web_search", input: {} },
    ]);
  });
});
