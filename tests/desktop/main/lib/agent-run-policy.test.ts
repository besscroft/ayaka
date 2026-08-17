import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAgentStepDisposition } from "@desktop-main/lib/agent-run-policy";

void describe("agent step completion policy", () => {
  void it("completes a naturally stopped text response", () => {
    assert.equal(
      resolveAgentStepDisposition({
        finishReason: "stop",
        toolCallCount: 0,
        concludesTurn: false,
      }),
      "complete",
    );
  });

  void it("completes a tool step that explicitly concludes the turn", () => {
    assert.equal(
      resolveAgentStepDisposition({
        finishReason: "tool-calls",
        toolCallCount: 1,
        concludesTurn: true,
      }),
      "complete",
    );
  });

  void it("continues after ordinary tool calls", () => {
    assert.equal(
      resolveAgentStepDisposition({
        finishReason: "tool-calls",
        toolCallCount: 1,
        concludesTurn: false,
      }),
      "continue",
    );
  });

  void it("does not force another step after a non-tool terminal finish", () => {
    assert.equal(
      resolveAgentStepDisposition({
        finishReason: "length",
        toolCallCount: 0,
        concludesTurn: false,
      }),
      "complete",
    );
  });
});
