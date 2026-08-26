import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Fragment, createElement } from "react";
import type { UIMessage } from "ai";
import {
  areMessageItemPropsEqual,
  getMessageRenderItems,
  hasRenderableActivity,
  getMessageActivityStatus,
  getReasoningDisplays,
  getToolDefaultOpen,
  isMessageStreaming,
  LiveThinkingPanel,
  MessageList,
  readMediaToolResult,
  saveMessageEdit,
  shouldShowLiveThinking,
} from "@renderer/components/MessageList";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@renderer/components/ai-elements";
import {
  REASONING_AUTO_STICK_THRESHOLD,
  getReasoningScrollDistance,
  shouldFollowReasoningContent,
} from "@renderer/components/ai-elements/reasoning-scroll";
import { getDisclosureScrollAdjustment } from "@renderer/components/ai-elements/use-conversation-scroll";
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
    const toolBase = {
      type: "dynamic-tool",
      toolName: "search",
      toolCallId: "tool-1",
    };
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
});

void describe("reasoning display", () => {
  void it("keeps streaming reasoning attached to the latest content near the bottom", () => {
    assert.equal(
      getReasoningScrollDistance({
        scrollHeight: 1000,
        scrollTop: 668,
        clientHeight: 300,
      }),
      REASONING_AUTO_STICK_THRESHOLD,
    );
    assert.equal(
      shouldFollowReasoningContent({
        scrollHeight: 1000,
        scrollTop: 668,
        clientHeight: 300,
      }),
      true,
    );
    assert.equal(
      shouldFollowReasoningContent({
        scrollHeight: 1000,
        scrollTop: 667,
        clientHeight: 300,
      }),
      false,
    );
  });

  void it("keeps reasoning segments separate and in order", () => {
    const displays = getReasoningDisplays(
      [
        { type: "reasoning", text: "first thought", state: "done" },
        { type: "reasoning", text: "second thought", state: "streaming" },
      ],
      true,
    );

    assert.deepEqual(displays, [
      { partIndex: 0, text: "first thought", isStreaming: false },
      { partIndex: 1, text: "second thought", isStreaming: true },
    ]);
  });

  void it("does not replay completed segments as streaming", () => {
    const displays = getReasoningDisplays(
      [
        { type: "reasoning", text: "old stream", state: "streaming" },
        { type: "reasoning", text: "finished", state: "done" },
      ],
      true,
    );

    assert.deepEqual(displays, [
      { partIndex: 0, text: "old stream", isStreaming: false },
      { partIndex: 1, text: "finished", isStreaming: false },
    ]);
  });

  void it("keeps original part indexes across silent internal parts", () => {
    const displays = getReasoningDisplays(
      [
        { type: "reasoning", text: "first thought", state: "done" },
        {
          type: "dynamic-tool",
          toolName: "complete_task",
          toolCallId: "silent-1",
        } as never,
        { type: "reasoning", text: "second thought", state: "streaming" },
      ],
      true,
    );

    assert.deepEqual(displays, [
      { partIndex: 0, text: "first thought", isStreaming: false },
      { partIndex: 2, text: "second thought", isStreaming: true },
    ]);
  });

  void it("does not render an empty completed reasoning part", () => {
    const displays = getReasoningDisplays(
      [
        { type: "reasoning", text: "", state: "done" },
        { type: "reasoning", text: "visible", state: "done" },
      ],
      false,
    );

    assert.deepEqual(displays, [{ partIndex: 1, text: "visible", isStreaming: false }]);
  });

  void it("renders an empty reasoning part as soon as streaming starts", () => {
    assert.deepEqual(
      getReasoningDisplays([{ type: "reasoning", text: "", state: "streaming" }], true),
      [{ partIndex: 0, text: "", isStreaming: true }],
    );
    assert.equal(
      shouldShowLiveThinking(
        assistant([{ type: "reasoning", text: "", state: "streaming" }]),
        true,
        "streaming",
      ),
      false,
    );
  });

  void it("marks completed reasoning as no longer streaming", () => {
    const displays = getReasoningDisplays(
      [{ type: "reasoning", text: "final thought", state: "done" }],
      false,
    );

    assert.deepEqual(displays, [{ partIndex: 0, text: "final thought", isStreaming: false }]);
  });

  void it("stops reasoning when the answer is the latest streaming part", () => {
    const displays = getReasoningDisplays(
      [
        { type: "reasoning", text: "final thought", state: "done" },
        { type: "text", text: "The answer" },
      ],
      true,
    );

    assert.deepEqual(displays, [{ partIndex: 0, text: "final thought", isStreaming: false }]);
  });

  void it("does not animate persisted streaming parts after a stopped run", () => {
    const displays = getReasoningDisplays(
      [{ type: "reasoning", text: "partial thought", state: "streaming" }],
      false,
    );

    assert.deepEqual(displays, [{ partIndex: 0, text: "partial thought", isStreaming: false }]);
  });
});

void describe("execution details", () => {
  void it("renders estimated rows while the virtualizer is measuring", () => {
    const messages = [userMessage("u1", "one"), userMessage("u2", "two")];

    assert.deepEqual(getMessageRenderItems(messages, []), [
      { index: 0, start: 0 },
      { index: 1, start: 112 },
    ]);
    assert.deepEqual(getMessageRenderItems(messages, [{ index: 1, start: 248 }]), [
      { index: 1, start: 248 },
    ]);
    assert.deepEqual(getMessageRenderItems([], []), []);
  });

  void it("renders reasoning at its original message part positions", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: assistant([
          { type: "reasoning", text: "first thought", state: "done" },
          { type: "text", text: "first answer" },
          {
            type: "dynamic-tool",
            toolName: "search",
            toolCallId: "tool-1",
            state: "output-available",
            input: {},
            output: "tool result",
          } as never,
          { type: "reasoning", text: "second thought", state: "done" },
          { type: "text", text: "final answer" },
        ]),
        isLoading: false,
        status: "ready",
      }),
    );
    const firstReasoning = html.indexOf('data-slot="reasoning"');
    const firstAnswer = html.indexOf("first answer");
    const tool = html.indexOf('data-slot="tool"');
    const secondReasoning = html.indexOf('data-slot="reasoning"', firstReasoning + 1);
    const finalAnswer = html.indexOf("final answer");

    assert.ok(firstReasoning < firstAnswer);
    assert.ok(firstAnswer < tool);
    assert.ok(tool < secondReasoning);
    assert.ok(secondReasoning < finalAnswer);
    assert.equal((html.match(/data-slot="reasoning"/g) ?? []).length, 2);
  });

  void it("detects independently renderable tools, sources, and attachments", () => {
    assert.equal(
      hasRenderableActivity([
        {
          type: "dynamic-tool",
          toolName: "search",
          toolCallId: "tool-1",
        } as never,
      ]),
      true,
    );
    assert.equal(
      hasRenderableActivity([
        {
          type: "source-url",
          sourceId: "source-1",
          url: "https://example.com",
        },
      ]),
      true,
    );
    assert.equal(
      hasRenderableActivity([{ type: "custom", kind: "openai.compaction" } as never]),
      false,
    );
  });

  void it("renders Reasoning and Sources without an execution summary", () => {
    const html = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(
          Reasoning,
          { isStreaming: false, defaultOpen: true },
          createElement(ReasoningTrigger),
          createElement(ReasoningContent, null, "first thought"),
        ),
        createElement(
          Reasoning,
          { isStreaming: false, defaultOpen: false },
          createElement(ReasoningTrigger),
          createElement(ReasoningContent, null, "second thought"),
        ),
        createElement(
          Sources,
          { open: true },
          createElement(SourcesTrigger, { count: 2 }),
          createElement(
            SourcesContent,
            null,
            createElement(Source, {
              href: "javascript:alert(1)",
              title: "Unsafe source",
            }),
            createElement(Source, {
              href: "https://example.com",
              title: "Safe source",
            }),
          ),
        ),
      ),
    );

    assert.equal((html.match(/data-slot="reasoning"/g) ?? []).length, 2);
    assert.match(html, /aria-expanded="true"/);
    assert.match(html, /Unsafe source/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.match(html, /Safe source/);
    assert.doesNotMatch(html, /Activity summary/);
    assert.doesNotMatch(html, /Thought for/);
  });

  void it("renders one final execution duration from assistant metadata", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [
          {
            id: "assistant-with-execution",
            role: "assistant",
            parts: [{ type: "text", text: "Done" }],
            metadata: { execution: { durationMs: 1250 } },
          },
        ],
        isLoading: false,
        status: "ready",
      }),
    );

    assert.equal((html.match(/1\.3/g) ?? []).length, 1);
  });

  void it("renders rich content while the response is still streaming", () => {
    const streamingHtml = renderToStaticMarkup(
      createElement(MessageList, {
        messages: assistant([{ type: "text", text: "**streaming**\nnext line" }]),
        isLoading: true,
        status: "streaming",
      }),
    );
    const completedHtml = renderToStaticMarkup(
      createElement(MessageList, {
        messages: assistant([{ type: "text", text: "**completed**" }]),
        isLoading: false,
        status: "ready",
      }),
    );

    assert.match(streamingHtml, /data-streaming="true"/);
    assert.match(streamingHtml, /class="rich-content/);
    assert.match(streamingHtml, /<strong class="font-semibold">streaming<\/strong>/);
    assert.match(completedHtml, /class="rich-content/);
  });

  void it("renders virtual rows with stable message ids", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        messages: [
          userMessage("u1", "one"),
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "two" }] },
        ],
        isLoading: false,
        status: "ready",
      }),
    );

    assert.match(html, /data-slot="message-list" data-virtualized="true"/);
    assert.match(html, /data-message-id="u1"/);
    assert.match(html, /data-message-id="a1"/);
  });

  void it("renders the live fallback as a non-interactive status row", () => {
    const html = renderToStaticMarkup(
      createElement(LiveThinkingPanel, {
        status: "thinking",
      }),
    );

    assert.match(html, /data-slot="live-thinking-status"/);
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /data-slot="reasoning"/);
    assert.doesNotMatch(html, /<button/);
    assert.doesNotMatch(html, /data-slot="message-activity"/);
    assert.doesNotMatch(html, /Waiting \d+s|已等待/);
  });
});

void describe("disclosure scroll preservation", () => {
  void it("compensates for height changes above the viewport", () => {
    assert.equal(getDisclosureScrollAdjustment(true, 240, 80), -160);
    assert.equal(getDisclosureScrollAdjustment(true, 80, 240), 160);
  });

  void it("does not move the viewport for visible or lower disclosures", () => {
    assert.equal(getDisclosureScrollAdjustment(false, 240, 80), 0);
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
            url: "ayaka-media://asset/image-1.png",
          },
        ],
      },
    });

    assert.equal(result?.kind, "image");
    assert.equal(result?.files[0]?.url, "ayaka-media://asset/image-1.png");
    assert.equal(readMediaToolResult({ type: "tool-web_search", output: result }), null);
    assert.equal(
      readMediaToolResult({
        type: "tool-generate_media",
        state: "output-available",
        output: { kind: "video", text: "Video generated.", files: [] },
      }),
      null,
    );
  });
});

void describe("generated tool disclosure", () => {
  void it("opens approval requests while collapsing completed tool cards", () => {
    assert.equal(getToolDefaultOpen(normalizeToolState("output-available")), false);
    assert.equal(getToolDefaultOpen(normalizeToolState("approval-responded")), false);
    assert.equal(getToolDefaultOpen(normalizeToolState("input-available")), false);
    assert.equal(getToolDefaultOpen(normalizeToolState("approval-requested")), true);
    assert.equal(getToolDefaultOpen(normalizeToolState("output-error")), false);
    assert.equal(getToolDefaultOpen(normalizeToolState("output-denied")), false);
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

void describe("message editing", () => {
  void it("closes the editor before the async edit finishes", async () => {
    const events: string[] = [];
    let resolveEdit!: () => void;
    const editFinished = new Promise<void>((resolve) => {
      resolveEdit = resolve;
    });

    const editPromise = saveMessageEdit({
      messageId: "u1",
      editValue: "Edited question",
      originalText: "Question",
      onEdit: async () => {
        events.push("edit-started");
        await editFinished;
        events.push("edit-finished");
      },
      onSaved: () => events.push("editor-closed"),
      onInvalid: () => events.push("edit-cancelled"),
    });

    await Promise.resolve();
    assert.deepEqual(events, ["editor-closed", "edit-started"]);

    resolveEdit();
    await editPromise;
    assert.deepEqual(events, ["editor-closed", "edit-started", "edit-finished"]);
  });
});

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}
