import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UIMessage } from "ai";
import {
  getMessageActivityStatus,
  getReasoningDisplay,
  getToolDefaultOpen,
  readMediaToolResult,
} from "./MessageList";
import { normalizeToolState } from "../lib/generated-tool-ui";

function assistant(parts: UIMessage["parts"]): UIMessage[] {
  return [{ id: "assistant", role: "assistant", parts }];
}

void describe("chat message activity", () => {
  void it("distinguishes submitted and reasoning states", () => {
    assert.equal(getMessageActivityStatus([], true, "submitted"), "submitted");
    assert.equal(
      getMessageActivityStatus(
        assistant([{ type: "reasoning", text: "private model reasoning" }]),
        true,
        "streaming",
      ),
      "thinking",
    );
  });

  void it("distinguishes tool execution, approval, and text output", () => {
    const toolBase = { type: "dynamic-tool", toolName: "search", toolCallId: "tool-1" };
    assert.equal(
      getMessageActivityStatus(
        assistant([{ ...toolBase, state: "input-available", input: {} } as never]),
        true,
        "streaming",
      ),
      "tool-calling",
    );
    assert.equal(
      getMessageActivityStatus(
        assistant([
          {
            ...toolBase,
            state: "approval-requested",
            input: {},
            approval: { id: "approval-1" },
          } as never,
        ]),
        true,
        "streaming",
      ),
      "waiting-approval",
    );
    assert.equal(
      getMessageActivityStatus(
        assistant([{ type: "text", text: "Streaming answer" }]),
        true,
        "streaming",
      ),
      "responding",
    );
  });

  void it("hides activity after generation completes", () => {
    assert.equal(
      getMessageActivityStatus(assistant([{ type: "text", text: "Done" }]), false, "ready"),
      null,
    );
  });
});

void describe("reasoning display", () => {
  void it("keeps the original reasoning text and streaming state", () => {
    const display = getReasoningDisplay(
      [
        { type: "reasoning", text: "first thought", state: "done" },
        { type: "reasoning", text: "second thought", state: "streaming" },
      ],
      true,
    );

    assert.deepEqual(display, {
      text: "first thought\n\nsecond thought",
      isStreaming: true,
    });
  });

  void it("marks completed reasoning as no longer streaming", () => {
    const display = getReasoningDisplay(
      [{ type: "reasoning", text: "final thought", state: "done" }],
      false,
    );

    assert.equal(display?.text, "final thought");
    assert.equal(display?.isStreaming, false);
  });
});

void describe("media tool output", () => {
  void it("recognizes persisted generate_media results", () => {
    const result = readMediaToolResult({
      type: "tool-generate_media",
      state: "output-available",
      output: {
        kind: "image",
        text: "Image generated.",
        files: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "image-1.png",
            url: "void-media://asset/image-1.png",
          },
        ],
      },
    });

    assert.equal(result?.kind, "image");
    assert.equal(result?.files[0]?.url, "void-media://asset/image-1.png");
    assert.equal(readMediaToolResult({ type: "tool-web_search", output: result }), null);
  });
});

void describe("generated tool disclosure", () => {
  void it("collapses completed tool output but keeps active and failure states open", () => {
    assert.equal(getToolDefaultOpen(normalizeToolState("output-available")), false);
    assert.equal(getToolDefaultOpen(normalizeToolState("approval-responded")), false);
    assert.equal(getToolDefaultOpen(normalizeToolState("input-available")), true);
    assert.equal(getToolDefaultOpen(normalizeToolState("approval-requested")), true);
    assert.equal(getToolDefaultOpen(normalizeToolState("output-error")), true);
    assert.equal(getToolDefaultOpen(normalizeToolState("output-denied")), true);
  });
});
