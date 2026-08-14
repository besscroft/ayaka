import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement } from "react";
import type { UIMessage } from "ai";
import {
  areMessageItemPropsEqual,
  getExecutionSummary,
  getLiveThinkingSteps,
  getMessageActivityStatus,
  getReasoningDisplay,
  getToolDefaultOpen,
  isMessageStreaming,
  LiveThinkingPanel,
  readMediaToolResult,
  shouldRenderExecutionSummary,
  shouldShowLiveThinking,
} from "@renderer/components/MessageList";
import {
  ChainOfThought,
  ChainOfThoughtImage,
  ChainOfThoughtSearchResult,
  ChainOfThoughtStep,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@renderer/components/ai-elements";
import { normalizeToolState } from "@renderer/lib/generated-tool-ui";

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

  void it("uses an AI Elements fallback before the first assistant part", () => {
    assert.equal(shouldShowLiveThinking([], true, "submitted"), true);
    assert.equal(
      shouldShowLiveThinking(
        assistant([{ type: "reasoning", text: "Visible reasoning", state: "streaming" }]),
        true,
        "streaming",
      ),
      false,
    );
    assert.equal(
      shouldShowLiveThinking(
        assistant([
          {
            type: "dynamic-tool",
            toolName: "search",
            toolCallId: "tool-1",
            state: "input-available",
            input: {},
          } as never,
        ]),
        true,
        "streaming",
      ),
      false,
    );
    assert.equal(
      shouldShowLiveThinking(assistant([{ type: "text", text: "Done" }]), false, "ready"),
      false,
    );
  });

  void it("maps runtime steps into visible statuses and adds current waiting state", () => {
    const steps = getLiveThinkingSteps(
      [
        {
          id: "model-1",
          kind: "model",
          status: "succeeded",
          title: "Model step",
          started_at: 1,
        } as never,
        {
          id: "tool-1",
          kind: "tool",
          status: "running",
          title: "Tool step",
          started_at: 2,
        } as never,
      ],
      "tool-calling",
    );

    assert.deepEqual(
      steps.map(({ id, kind, status, title }) => ({ id, kind, status, title })),
      [
        { id: "model-1", kind: "model", status: "complete", title: "Model step" },
        { id: "tool-1", kind: "tool", status: "active", title: "Tool step" },
      ],
    );

    const approvalSteps = getLiveThinkingSteps([], "waiting-approval");
    assert.deepEqual(
      approvalSteps.map(({ id, kind, status }) => ({ id, kind, status })),
      [
        { id: "live-thinking", kind: "thinking", status: "active" },
        { id: "live-approval", kind: "approval", status: "active" },
      ],
    );
  });

  void it("treats cancelled and interrupted runtime steps as errors", () => {
    const steps = getLiveThinkingSteps(
      [
        {
          id: "cancelled",
          kind: "tool",
          status: "cancelled",
          title: "Stopped",
          started_at: 1,
        } as never,
        {
          id: "interrupted",
          kind: "model",
          status: "interrupted",
          title: "Interrupted",
          started_at: 2,
        } as never,
      ],
      "thinking",
    );

    assert.deepEqual(
      steps.map(({ id, status }) => ({ id, status })),
      [
        { id: "cancelled", status: "error" },
        { id: "interrupted", status: "error" },
        { id: "live-thinking", status: "active" },
      ],
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

  void it("uses only the final reasoning part status", () => {
    const display = getReasoningDisplay(
      [
        { type: "reasoning", text: "old stream", state: "streaming" },
        { type: "reasoning", text: "finished", state: "done" },
      ],
      true,
    );

    assert.equal(display?.isStreaming, false);
  });

  void it("keeps empty reasoning content renderable without adding separators", () => {
    const display = getReasoningDisplay(
      [
        { type: "reasoning", text: "", state: "done" },
        { type: "reasoning", text: "", state: "done" },
      ],
      false,
    );

    assert.equal(display?.text, "");
  });

  void it("marks completed reasoning as no longer streaming", () => {
    const display = getReasoningDisplay(
      [{ type: "reasoning", text: "final thought", state: "done" }],
      false,
    );

    assert.equal(display?.text, "final thought");
    assert.equal(display?.isStreaming, false);
  });

  void it("stops reasoning when the answer is the latest streaming part", () => {
    const display = getReasoningDisplay(
      [
        { type: "reasoning", text: "final thought", state: "done" },
        { type: "text", text: "The answer" },
      ],
      true,
    );

    assert.equal(display?.isStreaming, false);
  });

  void it("does not animate persisted streaming parts after a stopped run", () => {
    const display = getReasoningDisplay(
      [{ type: "reasoning", text: "partial thought", state: "streaming" }],
      false,
    );

    assert.equal(display?.isStreaming, false);
  });
});

void describe("execution summary", () => {
  void it("only renders for assistant messages", () => {
    assert.equal(shouldRenderExecutionSummary("user", true), false);
    assert.equal(shouldRenderExecutionSummary("assistant", true), true);
    assert.equal(shouldRenderExecutionSummary("assistant", false), false);
  });

  void it("aggregates activity counts and blocking states", () => {
    const summary = getExecutionSummary([
      {
        type: "dynamic-tool",
        toolName: "search",
        toolCallId: "tool-1",
        state: "approval-requested",
        input: {},
      } as never,
      {
        type: "tool-web_search",
        toolCallId: "tool-2",
        state: "output-error",
        input: {},
      } as never,
      { type: "source-url", sourceId: "source-1", url: "https://example.com" },
      { type: "custom", kind: "openai.compaction" } as never,
      { type: "file", mediaType: "image/png", url: "https://example.com/image.png" },
    ]);

    assert.deepEqual(summary, {
      toolCount: 2,
      activeToolCount: 1,
      pendingToolCount: 0,
      errorToolCount: 1,
      sourceCount: 1,
      compactionCount: 1,
      imageCount: 1,
      hasActivity: true,
      hasAttention: true,
    });

    const legacySummary = getExecutionSummary([
      { type: "tool-legacy", toolCallId: "legacy-1", input: {} } as never,
    ]);
    assert.equal(legacySummary.pendingToolCount, 1);
    assert.equal(legacySummary.hasAttention, false);
  });

  void it("renders localized disclosures and filters unsafe source links", () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(
          Reasoning,
          { isStreaming: true, defaultOpen: true },
          createElement(ReasoningTrigger),
          createElement(ReasoningContent, null, "first thought"),
        ),
        createElement(
          ChainOfThought,
          { defaultOpen: true },
          createElement(ChainOfThoughtStep, {
            icon: "tool",
            status: "error",
            label: "Tool failed",
          }),
          createElement(ChainOfThoughtSearchResult, {
            href: "javascript:alert(1)",
            title: "Unsafe source",
          }),
          createElement(ChainOfThoughtImage, {
            src: "javascript:alert(1)",
            alt: "Unsafe image",
          }),
        ),
      ),
    );

    assert.match(html, /data-slot="reasoning"/);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /data-status="error"/);
    assert.match(html, /Unsafe source/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.match(html, /Unsafe image/);
    assert.doesNotMatch(html, /src="javascript:/);
  });

  void it("renders the live fallback as a ChainOfThought disclosure", () => {
    const html = renderToStaticMarkup(
      createElement(LiveThinkingPanel, {
        status: "thinking",
        steps: [],
      }),
    );

    assert.match(html, /data-slot="chain-of-thought"/);
    assert.match(html, /data-slot="chain-of-thought-step"/);
    assert.match(html, /data-status="active"/);
    assert.doesNotMatch(html, /data-slot="message-activity"/);
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

void describe("message render memoization", () => {
  void it("marks only the latest message as streaming", () => {
    assert.equal(isMessageStreaming(true, 0, 1), false);
    assert.equal(isMessageStreaming(true, 1, 1), true);
    assert.equal(isMessageStreaming(false, 1, 1), false);
  });

  void it("skips unchanged message props and rerenders changed message references", () => {
    const message: UIMessage = userMessage("u1", "Question");
    const props = {
      message,
      isLastMessage: true,
      isStreaming: false,
    };

    assert.equal(areMessageItemPropsEqual(props, { ...props }), true);
    assert.equal(
      areMessageItemPropsEqual(props, {
        ...props,
        message: { ...message, parts: [{ type: "text", text: "Changed" }] },
      }),
      false,
    );
  });
});

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}
