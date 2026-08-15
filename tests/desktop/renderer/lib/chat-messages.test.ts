import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";
import type { MessageRow } from "@shared/types";
import {
  appendOrReplaceMessage,
  buildMessageSnapshotRows,
  buildUserMessage,
  getAgentLearningQueueKey,
  hasPendingToolApproval,
  hydrateStoredMessage,
  isNonEmptyUIMessage,
  prepareFailedChatSnapshot,
  readChatMessageMetadata,
  toFileUIParts,
  updateMessageReaction,
} from "@renderer/lib/chat-messages";
import { hasMeaningfulConversationTitle } from "@renderer/lib/conversation-title";
import { getChatErrorInfo } from "@renderer/lib/errors";
import { translate } from "@renderer/lib/i18n";
import { shouldFallbackToFreshRun } from "@renderer/lib/chat-retry";

void describe("chat message helpers", () => {
  void it("builds text-only user UI messages", () => {
    const message = buildUserMessage({ id: "u1", text: "  Hello  ", files: [] });

    assert.deepEqual(message, {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "Hello" }],
    });
  });

  void it("builds attachment-only user UI messages with FileUIPart.url", () => {
    const files = toFileUIParts([
      {
        mediaType: "image/png",
        filename: "chart.png",
        url: "data:image/png;base64,AA==",
      },
    ]);
    const message = buildUserMessage({ id: "u2", text: "", files });

    assert.deepEqual(message.parts, [
      {
        type: "file",
        mediaType: "image/png",
        filename: "chart.png",
        url: "data:image/png;base64,AA==",
      },
    ]);
  });

  void it("builds text plus attachment messages", () => {
    const files = toFileUIParts([
      {
        mediaType: "application/pdf",
        filename: "spec.pdf",
        data: "data:application/pdf;base64,AA==",
      },
    ]);
    const message = buildUserMessage({ id: "u3", text: "Summarize", files });

    assert.deepEqual(message.parts, [
      { type: "text", text: "Summarize" },
      {
        type: "file",
        mediaType: "application/pdf",
        filename: "spec.pdf",
        url: "data:application/pdf;base64,AA==",
      },
    ]);
  });

  void it("hydrates full UIMessage JSON and falls back to legacy plain text rows", () => {
    const saved: UIMessage = {
      id: "m1",
      role: "assistant",
      parts: [{ type: "text", text: "Saved" }],
    };
    const hydrated = hydrateStoredMessage({
      id: "m1",
      conversation_id: "c1",
      role: "assistant",
      content: JSON.stringify(saved),
      created_at: 100,
    });
    const fallback = hydrateStoredMessage({
      id: "m2",
      conversation_id: "c1",
      role: "user",
      content: "legacy text",
      created_at: 101,
    });

    assert.deepEqual(hydrated, saved);
    assert.deepEqual(fallback, {
      id: "m2",
      role: "user",
      parts: [{ type: "text", text: "legacy text" }],
    });
  });

  void it("creates snapshot upsert rows while preserving existing created_at values", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Updated question" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Updated answer" }] },
      { id: "a2", role: "assistant", parts: [{ type: "text", text: "New answer" }] },
    ];
    const rows = buildMessageSnapshotRows({
      conversationId: "c1",
      messages,
      createdAtById: new Map([
        ["u1", 10],
        ["a1", 11],
      ]),
      now: 100,
    });

    assert.deepEqual(
      rows.map((row) => row.created_at),
      [10, 11, 100],
    );
    assert.equal(JSON.parse(rows[1].content).parts[0].text, "Updated answer");
  });

  void it("omits transient assistant messages that have no parts", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Question" }] },
      { id: "a-empty", role: "assistant", parts: [] },
    ];

    const rows = buildMessageSnapshotRows({
      conversationId: "c1",
      messages,
      createdAtById: new Map(),
      now: 100,
    });

    assert.deepEqual(
      rows.map((row) => row.id),
      ["u1"],
    );
    assert.equal(isNonEmptyUIMessage(messages[0]), true);
    assert.equal(isNonEmptyUIMessage(messages[1]), false);
  });

  void it("removes the incomplete assistant response while preserving the user retry message", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Question" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Partial" }] },
    ];

    assert.deepEqual(prepareFailedChatSnapshot(messages), {
      messages: [messages[0]],
      deleteIds: ["a1"],
    });
  });

  void it("queues learning only for successful final responses without pending approvals", () => {
    const completed: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Question" }] },
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "Answer" }] },
    ];
    const pending: UIMessage[] = [
      completed[0],
      {
        id: "a2",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "sandbox_run_command",
            toolCallId: "call-1",
            state: "approval-requested",
            input: {},
            approval: { id: "approval-1" },
          },
        ],
      },
    ];

    assert.equal(hasPendingToolApproval(completed), false);
    assert.equal(getAgentLearningQueueKey("c1", completed, false), "c1:a1");
    assert.equal(hasPendingToolApproval(pending), true);
    assert.equal(getAgentLearningQueueKey("c1", pending, false), null);
    assert.equal(getAgentLearningQueueKey("c1", completed, true), null);
    assert.equal(getAgentLearningQueueKey("c1", [completed[0]], false), null);
  });

  void it("updates assistant reaction metadata and keeps it in persisted snapshots", () => {
    const reaction = { emoji: "\u{1F44D}", label: "helpful", createdAt: 123 };
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Question" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "Answer" }],
        metadata: {
          execution: {
            startedAt: 1,
            finishedAt: 3,
            durationMs: 2,
            model: "mock/chat",
          },
        },
      },
    ];

    const next = updateMessageReaction({ messages, messageId: "a1", reaction });

    assert.equal(next[0], messages[0]);
    assert.notEqual(next[1], messages[1]);
    assert.deepEqual(readChatMessageMetadata(next[1]).reaction, reaction);
    assert.equal(readChatMessageMetadata(next[1]).execution?.durationMs, 2);

    const [row] = buildMessageSnapshotRows({
      conversationId: "c1",
      messages: [next[1]],
      createdAtById: new Map([["a1", 10]]),
      now: 100,
    });
    const hydrated = hydrateStoredMessage(row);
    assert.deepEqual(readChatMessageMetadata(hydrated).reaction, reaction);
  });

  void it("does not attach reactions to user messages", () => {
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Question" }] },
    ];

    const next = updateMessageReaction({
      messages,
      messageId: "u1",
      reaction: { emoji: "\u{1F44D}", label: "helpful", createdAt: 123 },
    });

    assert.deepEqual(next, messages);
  });
  void it("replaces pending messages by id before snapshot persistence", () => {
    const original: MessageRow[] = [];
    assert.deepEqual(original, []);

    const oldMessage: UIMessage = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "old" }],
    };
    const newMessage: UIMessage = {
      id: "u1",
      role: "user",
      parts: [{ type: "text", text: "new" }],
    };

    assert.deepEqual(appendOrReplaceMessage([oldMessage], newMessage), [newMessage]);
  });

  void it("documents that AI SDK messageId replaces an existing user message", async () => {
    let sendCalled = false;
    const chat = new Chat<UIMessage>({
      transport: {
        sendMessages: async () => {
          sendCalled = true;
          return createFinishedStream();
        },
        reconnectToStream: async () => null,
      },
    });

    await assert.rejects(
      () => chat.sendMessage({ text: "Hello", messageId: "u-new" }),
      /message with id u-new not found/,
    );
    assert.equal(sendCalled, false);
  });

  void it("sends fixed-id UIMessage instances as new user messages", async () => {
    const sentBatches: UIMessage[][] = [];
    const chat = new Chat<UIMessage>({
      transport: createCapturingTransport((messages) => sentBatches.push(messages)),
    });
    const message = buildUserMessage({ id: "u-fixed", text: "  Hello  ", files: [] });

    await chat.sendMessage(message);

    assert.equal(sentBatches.length, 1);
    assert.deepEqual(stripMetadata(sentBatches[0]), [message]);
    assert.deepEqual(stripMetadata(chat.messages), [message]);
  });

  void it("retries a stale transport run with the existing user message id", async () => {
    const sentBatches: UIMessage[][] = [];
    let sendCount = 0;
    let resolveRecovery!: () => void;
    const recovery = new Promise<void>((resolve) => {
      resolveRecovery = resolve;
    });
    let chat!: Chat<UIMessage>;
    chat = new Chat<UIMessage>({
      transport: {
        sendMessages: async ({ messages }) => {
          sentBatches.push(messages);
          sendCount += 1;
          if (sendCount === 1) {
            throw new Error(
              JSON.stringify({
                error: "Agent run cannot be resumed after its process ended.",
                code: "run_not_active",
                retryable: true,
              }),
            );
          }
          return createFinishedStream();
        },
        reconnectToStream: async () => null,
      },
      onError: (error) => {
        const info = getChatErrorInfo(error, "en");
        if (shouldFallbackToFreshRun(info.code, false)) {
          queueMicrotask(() => {
            void chat.regenerate().finally(resolveRecovery);
          });
        }
      },
    });

    const message = buildUserMessage({ id: "u-stale", text: "Continue", files: [] });
    await chat.sendMessage(message);
    await recovery;

    assert.equal(sentBatches.length, 2);
    assert.deepEqual(stripMetadata(sentBatches[0]), [message]);
    assert.deepEqual(stripMetadata(sentBatches[1]), [message]);
    assert.deepEqual(stripMetadata(chat.messages), [message]);
  });
});

void describe("conversation title helpers", () => {
  void it("treats built-in placeholder titles as not yet summarized", () => {
    assert.equal(hasMeaningfulConversationTitle("新会话"), false);
    assert.equal(hasMeaningfulConversationTitle("新建会话"), false);
    assert.equal(hasMeaningfulConversationTitle("新建对话"), false);
    assert.equal(hasMeaningfulConversationTitle("New chat"), false);
    assert.equal(hasMeaningfulConversationTitle("New conversation"), false);
    assert.equal(
      hasMeaningfulConversationTitle(translate("zh-CN", "shell.newConversation")),
      false,
    );
    assert.equal(hasMeaningfulConversationTitle(translate("en", "shell.newConversation")), false);
  });

  void it("accepts real generated titles", () => {
    assert.equal(hasMeaningfulConversationTitle("量子计算入门"), true);
    assert.equal(hasMeaningfulConversationTitle("Debugging Electron IPC"), true);
  });
});

function stripMetadata(messages: UIMessage[]): UIMessage[] {
  return messages.map(({ metadata, ...message }) => {
    void metadata;
    return message;
  });
}

function createCapturingTransport(
  onSend: (messages: UIMessage[]) => void,
): ChatTransport<UIMessage> {
  return {
    sendMessages: async ({ messages }) => {
      onSend(messages);
      return createFinishedStream();
    },
    reconnectToStream: async () => null,
  };
}

function createFinishedStream(): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: "finish", finishReason: "stop" });
      controller.close();
    },
  });
}
