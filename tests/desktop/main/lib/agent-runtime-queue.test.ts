import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import { Chat } from "@ai-sdk/react";
import { DefaultChatTransport, simulateReadableStream, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createApp } from "@desktop-main/server/index";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
if (!process.versions.electron) {
  const electronModule = new Module(electronPath);
  electronModule.filename = electronPath;
  electronModule.paths = [];
  electronModule.loaded = true;
  electronModule.exports = {
    app: { isPackaged: false, getPath: () => process.env.AYAKA_USER_DATA_DIR ?? process.cwd() },
  };
  require.cache[electronPath] = electronModule;
}

let db: typeof import("@desktop-main/lib/db");
let runAgentChat: typeof import("@desktop-main/lib/agent-runtime").runAgentChat;
let agentLoopSessions: typeof import("@desktop-main/lib/agent-loop-session").agentLoopSessions;
let persistChatStreamSnapshot: typeof import("@desktop-main/lib/chat-history").persistChatStreamSnapshot;
let testRoot = "";
let conversationId = "";

before(async () => {
  db = await import("@desktop-main/lib/db");
  ({ runAgentChat } = await import("@desktop-main/lib/agent-runtime"));
  ({ agentLoopSessions } = await import("@desktop-main/lib/agent-loop-session"));
  ({ persistChatStreamSnapshot } = await import("@desktop-main/lib/chat-history"));
});

beforeEach(async () => {
  await db.closeDb();
  testRoot = await mkdtemp(path.join(tmpdir(), "ayaka-agent-runtime-queue-"));
  process.env.AYAKA_USER_DATA_DIR = testRoot;
  db.initDb();
  conversationId = randomUUID();
  await db.createConversation(conversationId);
});

afterEach(async () => {
  await db.closeDb();
  delete process.env.AYAKA_USER_DATA_DIR;
  await rm(testRoot, { recursive: true, force: true });
});

void describe("agent runtime queued follow-ups", () => {
  void it("keeps a queued message after the assistant response it follows", async () => {
    const initialMessage = makeUserMessage("history-user", "start task");
    const existingAssistant = makeAssistantMessage("history-assistant", "initial answer");
    await db.saveMessagesBatch([
      {
        id: initialMessage.id,
        conversation_id: conversationId,
        role: initialMessage.role,
        content: JSON.stringify(initialMessage),
        created_at: 100,
      },
      {
        id: existingAssistant.id,
        conversation_id: conversationId,
        role: existingAssistant.role,
        content: JSON.stringify(existingAssistant),
        created_at: 200,
      },
    ]);

    const queuedMessage = makeUserMessage("history-queued", "please follow up");
    const updatedAssistant = makeAssistantMessage("history-assistant", "queued answer");
    await persistChatStreamSnapshot(conversationId, [
      initialMessage,
      updatedAssistant,
      queuedMessage,
    ]);

    const persistedMessages = db
      .getMessagesSnapshot(conversationId)
      .messages.map((row) => JSON.parse(row.content_json ?? row.content) as UIMessage);
    assert.deepEqual(
      persistedMessages.map((message) => message.id),
      [initialMessage.id, updatedAssistant.id, queuedMessage.id],
    );
    const persistedRows = db.getMessagesSnapshot(conversationId).messages;
    assert.ok((persistedRows[1]?.created_at ?? 0) < (persistedRows[2]?.created_at ?? 0));
  });

  void it("keeps queued responses in user/assistant order across requests", async () => {
    let signalFirstCallStarted!: () => void;
    const firstCallStarted = new Promise<void>((resolve) => {
      signalFirstCallStarted = resolve;
    });
    let releaseFirstCall!: () => void;
    const firstCallGate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const callNumber = model.doStreamCalls.length;
        if (callNumber === 1) {
          signalFirstCallStarted();
          await firstCallGate;
        }
        const chunks = [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "text-0" },
          {
            type: "text-delta" as const,
            id: "text-0",
            delta:
              callNumber === 1
                ? "initial answer"
                : callNumber === 2
                  ? "queued answer 1"
                  : "queued answer 2",
          },
          { type: "text-end" as const, id: "text-0" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ];
        return {
          stream: simulateReadableStream({ chunks }),
        };
      },
    });
    const initialMessage = makeUserMessage("initial-user", "start task");
    const queuedMessages = [
      makeUserMessage("queued-user-1", "please follow up"),
      makeUserMessage("queued-user-2", "also check this"),
    ];
    const consumedInputs: Array<{ inputId: string; message: UIMessage }> = [];
    const runId = randomUUID();
    const runOptions = {
      modelRef: "mock/chat",
      resolved: {
        model,
        capabilities: {
          textGeneration: true,
          vision: false,
          imageOutput: false,
          speechOutput: false,
          transcription: false,
          toolCalling: false,
          reasoning: false,
          embedding: false,
        },
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 128,
        contextWindow: 32_000,
      },
      conversationId,
      overrideAgentModel: true,
      toolSelection: { mode: "off", selectedToolIds: [] },
      buildAgentSystemPrompt: async () => "Test instructions.",
    } satisfies Omit<Parameters<typeof runAgentChat>[0], "messages" | "runId" | "mode">;
    let requestCount = 0;
    let continueAfterFinish = false;
    const pendingConsumedMessages: UIMessage[] = [];
    let resolveCompleted!: () => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    let chat!: Chat<UIMessage>;
    chat = new Chat<UIMessage>({
      id: "queued-follow-up-runtime",
      messages: [initialMessage],
      onData: (part) => {
        if (part.type !== "data-run-input-consumed") return;
        const data = part.data as {
          continueRun?: unknown;
          inputId?: unknown;
          message?: unknown;
        };
        if (typeof data.inputId === "string" && data.message) {
          consumedInputs.push({ inputId: data.inputId, message: data.message as UIMessage });
          pendingConsumedMessages.push(data.message as UIMessage);
          continueAfterFinish = data.continueRun === true;
        }
      },
      onFinish: () => {
        if (pendingConsumedMessages.length > 0) {
          chat.messages = [...chat.messages, ...pendingConsumedMessages.splice(0)];
        }
        if (continueAfterFinish) {
          continueAfterFinish = false;
          queueMicrotask(() => void chat.sendMessage().catch(rejectCompleted));
        } else {
          resolveCompleted();
        }
      },
      onError: rejectCompleted,
      transport: new DefaultChatTransport<UIMessage>({
        api: "http://ayaka.test/api/chat",
        body: { model: "mock/chat", conversationId, runId },
        fetch: async (_input, init) => {
          requestCount += 1;
          const body = JSON.parse(String(init?.body)) as { messages: UIMessage[] };
          return runAgentChat({
            ...runOptions,
            messages: body.messages,
            runId,
            mode: requestCount === 1 ? "start" : "resume",
          });
        },
      }),
    });
    const sendPromise = chat.sendMessage();
    try {
      await firstCallStarted;
      await agentLoopSessions.enqueueFollowUp(runId, queuedMessages[0]!, "user");
      await agentLoopSessions.enqueueFollowUp(runId, queuedMessages[1]!, "user");
      releaseFirstCall();
      await completed;
      await sendPromise;

      assert.equal(model.doStreamCalls.length, 3);
      assert.deepEqual(
        consumedInputs.map((event) => event.message.id),
        queuedMessages.map((message) => message.id),
      );
      assert.match(JSON.stringify(model.doStreamCalls[1]?.prompt), /please follow up/);
      assert.doesNotMatch(JSON.stringify(model.doStreamCalls[1]?.prompt), /also check this/);
      assert.match(JSON.stringify(model.doStreamCalls[2]?.prompt), /also check this/);
      assert.deepEqual(
        chat.messages.map((message) => message.role),
        ["user", "assistant", "user", "assistant", "user", "assistant"],
      );
      assert.deepEqual(
        chat.messages.map((message) => message.id),
        [
          "initial-user",
          chat.messages[1]!.id,
          "queued-user-1",
          chat.messages[3]!.id,
          "queued-user-2",
          chat.messages[5]!.id,
        ],
      );
      assert.deepEqual(
        chat.messages.filter((message) => message.role === "assistant").map(readText),
        ["initial answer", "queued answer 1", "queued answer 2"],
      );
      assert.equal(db.getRuntimeRun(runId)?.status, "succeeded");
      const persistedMessages = db
        .getMessagesSnapshot(conversationId)
        .messages.map((row) => JSON.parse(row.content_json ?? row.content) as UIMessage);
      assert.deepEqual(
        persistedMessages.map((message) => message.role),
        ["user", "assistant", "user", "assistant", "user", "assistant"],
      );
      assert.deepEqual(persistedMessages.map(readText), [
        "start task",
        "initial answer",
        "please follow up",
        "queued answer 1",
        "also check this",
        "queued answer 2",
      ]);
    } finally {
      releaseFirstCall();
    }
  });

  void it("streams queued output through the local HTTP chat transport", async () => {
    let signalFirstCallStarted!: () => void;
    const firstCallStarted = new Promise<void>((resolve) => {
      signalFirstCallStarted = resolve;
    });
    let releaseFirstCall!: () => void;
    const firstCallGate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const callNumber = model.doStreamCalls.length;
        if (callNumber === 1) {
          signalFirstCallStarted();
          await firstCallGate;
        }
        const chunks = [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "text-0" },
          {
            type: "text-delta" as const,
            id: "text-0",
            delta: callNumber === 1 ? "initial answer" : "queued answer",
          },
          { type: "text-end" as const, id: "text-0" },
          {
            type: "finish" as const,
            finishReason: { unified: "stop" as const, raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ];
        return { stream: simulateReadableStream({ chunks }) };
      },
    });
    const app = createApp({
      sessionToken: "queue-http-token",
      resolveModel: () => ({
        model,
        capabilities: {
          textGeneration: true,
          vision: false,
          imageOutput: false,
          speechOutput: false,
          transcription: false,
          toolCalling: false,
          reasoning: false,
          embedding: false,
        },
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 128,
        contextWindow: 32_000,
      }),
      buildAgentSystemPrompt: async () => "Test instructions.",
    });
    const initialMessage = makeUserMessage("http-user", "start task");
    const queuedMessage = makeUserMessage("http-queued-user", "please follow up");
    const runId = randomUUID();
    let requestCount = 0;
    let continueAfterFinish = false;
    const pendingConsumedMessages: UIMessage[] = [];
    let resolveCompleted!: () => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    let chat!: Chat<UIMessage>;
    chat = new Chat<UIMessage>({
      id: "queued-follow-up-http",
      messages: [initialMessage],
      onData: (part) => {
        if (part.type !== "data-run-input-consumed") return;
        const data = part.data as { continueRun?: unknown; message?: unknown };
        if (!data.message || data.continueRun !== true) return;
        pendingConsumedMessages.push(data.message as UIMessage);
        continueAfterFinish = true;
      },
      onFinish: () => {
        if (pendingConsumedMessages.length > 0) {
          chat.messages = [...chat.messages, ...pendingConsumedMessages.splice(0)];
        }
        if (continueAfterFinish) {
          continueAfterFinish = false;
          queueMicrotask(() => void chat.sendMessage().catch(rejectCompleted));
        } else {
          resolveCompleted();
        }
      },
      onError: rejectCompleted,
      transport: new DefaultChatTransport<UIMessage>({
        api: "http://ayaka.test/api/chat",
        headers: { "x-ayaka-session": "queue-http-token" },
        body: () => ({
          model: "mock/chat",
          conversationId,
          runId,
          mode: requestCount === 0 ? "start" : "resume",
        }),
        fetch: async (input, init) => {
          requestCount += 1;
          return app.request(new Request(String(input), init));
        },
      }),
    });

    const sendPromise = chat.sendMessage();
    try {
      await firstCallStarted;
      await agentLoopSessions.enqueueFollowUp(runId, queuedMessage, "user");
      releaseFirstCall();
      await completed;
      await sendPromise;

      assert.equal(model.doStreamCalls.length, 2);
      assert.deepEqual(
        chat.messages.map((message) => message.role),
        ["user", "assistant", "user", "assistant"],
      );
      assert.deepEqual(chat.messages.map(readText), [
        "start task",
        "initial answer",
        "please follow up",
        "queued answer",
      ]);
      assert.equal(chat.status, "ready");
    } finally {
      releaseFirstCall();
    }
  });
});

function makeUserMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function makeAssistantMessage(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

function readText(message: UIMessage): string {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}
