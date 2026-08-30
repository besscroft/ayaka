import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  DefaultChatTransport,
  type UIMessage,
} from "ai";
import {
  MockImageModelV4,
  MockLanguageModelV4,
  MockSpeechModelV4,
  MockTranscriptionModelV4,
} from "ai/test";
import { createApp } from "@desktop-main/server/index";
import {
  CHAT_RUN_ID_HEADER,
  CHAT_REASONING_LEVELS,
  CHAT_SESSION_HEADER,
  type MediaGenerationErrorResponse,
  type MediaGenerationKind,
  type ModelCapabilities,
  type ModelProviderKind,
} from "@shared/types";

const token = "test-session-token";
const validMessages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }];
type RunAgentChat = typeof import("@desktop-main/lib/agent-runtime").runAgentChat;
type RunAgentChatOptions = Parameters<RunAgentChat>[0];

void describe("local chat server", () => {
  void it("answers chat CORS preflight for allowed renderer origins", async () => {
    const app = createApp({ sessionToken: token, getAssignedPort: () => 4321 });

    const response = await app.request("/api/chat", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": `content-type, ${CHAT_SESSION_HEADER}`,
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /POST/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /content-type/i);
    assert.match(
      response.headers.get("access-control-allow-headers") ?? "",
      new RegExp(CHAT_SESSION_HEADER, "i"),
    );
    assert.match(
      response.headers.get("access-control-expose-headers") ?? "",
      new RegExp(CHAT_RUN_ID_HEADER, "i"),
    );
  });

  void it("rejects chat posts without the active session token", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: validMessages }),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "The anonymous model service or chat session rejected the request. Try again later.",
      code: "unauthorized",
      retryable: false,
    });
  });

  void it("rejects empty message arrays", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: [] }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "The chat request is invalid. Check the message and try again.",
      code: "invalid_request",
      retryable: false,
    });
  });

  void it("returns a safe response for malformed chat JSON", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: "{",
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  });

  void it("rejects invalid media references as a structured non-retryable error", async () => {
    const app = createApp({ sessionToken: token });
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: [
          {
            id: "image-1",
            role: "user",
            parts: [{ type: "file", mediaType: "image/png", url: "blob:local-image" }],
          },
        ],
        model: "mock/chat",
      }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "The attached image could not be read. Choose it again and try again.",
      code: "invalid_media_input",
      retryable: false,
    });
  });

  void it("rejects requests without a model reference", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "No available model is selected. Choose or configure a model first.",
      code: "missing_model",
      retryable: false,
    });
  });

  void it("rejects unsupported chat reasoning levels", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat", reasoning: "extreme" }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as { code: string; retryable: boolean };
    assert.equal(body.code, "invalid_request");
    assert.equal(body.retryable, false);
  });

  void it("rejects unsupported chat permission modes", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        permissionMode: "always_allow",
      }),
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "invalid_request");
  });

  void it("validates agent run identity and mode", async () => {
    const app = createApp({ sessionToken: token });
    const headers = {
      "Content-Type": "application/json",
      [CHAT_SESSION_HEADER]: token,
    };
    const invalidId = await app.request("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: validMessages, model: "mock/chat", runId: "bad" }),
    });
    assert.equal(invalidId.status, 400);
    assert.equal((await invalidId.json()).code, "invalid_run_id");

    const invalidMode = await app.request("/api/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        runId: "018f8896-bef7-7051-8c30-1f862a28d31a",
        mode: "continue",
      }),
    });
    assert.equal(invalidMode.status, 400);
    assert.equal((await invalidMode.json()).code, "invalid_mode");
  });

  void it("preserves every supported top-level reasoning value including none", async () => {
    const captured: RunAgentChatOptions[] = [];
    const model = new MockLanguageModelV4({});
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({
        model,
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 256,
      }),
      buildAgentSystemPrompt: async () => "test",
      runAgentChat: async (options) => {
        captured.push(options);
        return agentRuntimeResponse("runtime-stream");
      },
    });

    for (const reasoning of CHAT_REASONING_LEVELS) {
      const response = await app.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CHAT_SESSION_HEADER]: token,
        },
        body: JSON.stringify({ messages: validMessages, model: "mock/chat", reasoning }),
      });
      assert.equal(response.status, 200);
    }

    assert.deepEqual(
      captured.map((options) => options.reasoning),
      [...CHAT_REASONING_LEVELS],
    );
    assert.equal(
      captured.every((options) => options.permissionMode === undefined),
      true,
    );
  });

  void it("routes chat responses through the provider-neutral agent runtime", async () => {
    const providerOptions = { mock: { reasoningEffort: "low" } };
    const model = new MockLanguageModelV4({});
    const captured: { value?: RunAgentChatOptions } = {};
    const app = createApp({
      sessionToken: token,
      resolveModel: (modelRef) => {
        assert.equal(modelRef, "mock/chat");
        return { model, temperature: 0.7, topP: 1, maxOutputTokens: 256, providerOptions };
      },
      buildAgentSystemPrompt: async () => "You are a test assistant.",
      runAgentChat: async (options) => {
        captured.value = options;
        return agentRuntimeResponse("runtime-stream");
      },
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        conversationId: "c-stream",
        reasoning: "high",
        permissionMode: "full_access",
        runId: "018f8896-bef7-7051-8c30-1f862a28d31a",
        mode: "resume",
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    assert.equal(response.headers.get(CHAT_RUN_ID_HEADER), "018f8896-bef7-7051-8c30-1f862a28d31a");
    assert.match(
      response.headers.get("access-control-expose-headers") ?? "",
      new RegExp(CHAT_RUN_ID_HEADER, "i"),
    );
    assert.equal(await response.text(), "runtime-stream");
    assert.equal(captured.value?.modelRef, "mock/chat");
    assert.equal(captured.value?.conversationId, "c-stream");
    assert.equal(captured.value?.reasoning, "high");
    assert.equal(captured.value?.permissionMode, "full_access");
    assert.equal(captured.value?.runId, "018f8896-bef7-7051-8c30-1f862a28d31a");
    assert.equal(captured.value?.mode, "resume");
    assert.deepEqual(captured.value?.resolved.providerOptions, providerOptions);
    assert.equal(
      await captured.value?.buildAgentSystemPrompt("agent-ayaka", "c-stream"),
      "You are a test assistant.",
    );
  });

  void it("routes image input through the configured vision model", async () => {
    const model = new MockLanguageModelV4({});
    const captured: { value?: RunAgentChatOptions } = {};
    const app = createApp({
      sessionToken: token,
      resolveConfiguredVisionModelRef: async (messages) => {
        assert.equal(messages[0]?.parts[0]?.type, "file");
        return "mock/vision";
      },
      resolveModel: (modelRef) => {
        assert.equal(modelRef, "mock/vision");
        return {
          model,
          providerId: "mock",
          modelId: "vision",
          capabilities: { ...mediaCapabilities, textGeneration: true, vision: true },
          temperature: 0.7,
          topP: 1,
          maxOutputTokens: 256,
        };
      },
      buildAgentSystemPrompt: async () => "test",
      runAgentChat: async (options) => {
        captured.value = options;
        return agentRuntimeResponse("vision-stream");
      },
    });
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        model: "mock/chat",
        messages: [
          {
            id: "u-vision",
            role: "user",
            parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" }],
          },
        ],
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "vision-stream");
    assert.equal(captured.value?.modelRef, "mock/vision");
    assert.equal(captured.value?.overrideAgentModel, true);
  });

  void it("rejects image input when the inherited chat model lacks vision", async () => {
    const app = createApp({
      sessionToken: token,
      resolveConfiguredVisionModelRef: async () => null,
      resolveModel: () => ({
        model: new MockLanguageModelV4({}),
        capabilities: { ...mediaCapabilities, textGeneration: true, vision: false },
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 256,
      }),
      buildAgentSystemPrompt: async () => "test",
      runAgentChat: async () => agentRuntimeResponse("should-not-run"),
    });
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        model: "mock/chat",
        messages: [
          {
            id: "u-vision",
            role: "user",
            parts: [{ type: "file", mediaType: "image/png", url: "data:image/png;base64,AA==" }],
          },
        ],
      }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "vision_model_unavailable");
  });

  void it("restarts stale resume requests with a fresh authoritative run id", async () => {
    for (const code of ["run_not_active", "run_not_found"] as const) {
      const calls: RunAgentChatOptions[] = [];
      const model = new MockLanguageModelV4({});
      const app = createApp({
        sessionToken: token,
        resolveModel: () => ({
          model,
          temperature: 0.7,
          topP: 1,
          maxOutputTokens: 256,
        }),
        buildAgentSystemPrompt: async () => "test",
        runAgentChat: async (options) => {
          calls.push(options);
          if (calls.length === 1) {
            throw Object.assign(new Error("Run is stale."), {
              name: "AgentLoopSessionError",
              code,
            });
          }
          return agentRuntimeResponse("recovered-stream");
        },
      });
      const previousRunId = "018f8896-bef7-7051-8c30-1f862a28d31a";
      const response = await app.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CHAT_SESSION_HEADER]: token,
        },
        body: JSON.stringify({
          messages: validMessages,
          model: "mock/chat",
          conversationId: "conversation-stale",
          reasoning: "high",
          runId: previousRunId,
          mode: "resume",
        }),
      });

      assert.equal(response.status, 200);
      assert.equal(await response.text(), "recovered-stream");
      assert.equal(calls.length, 2);
      assert.equal(calls[0]?.runId, previousRunId);
      assert.equal(calls[0]?.mode, "resume");
      assert.equal(calls[1]?.mode, "start");
      assert.notEqual(calls[1]?.runId, previousRunId);
      assert.equal(calls[1]?.conversationId, "conversation-stale");
      assert.equal(calls[1]?.reasoning, "high");
      assert.deepEqual(calls[1]?.messages, validMessages);
      assert.deepEqual(calls[1]?.recovery, { previousRunId, reason: code });
      assert.equal(response.headers.get(CHAT_RUN_ID_HEADER), calls[1]?.runId);
    }
  });

  void it("normalizes resume without a run id to one fresh start", async () => {
    const calls: RunAgentChatOptions[] = [];
    const model = new MockLanguageModelV4({});
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildAgentSystemPrompt: async () => "test",
      runAgentChat: async (options) => {
        calls.push(options);
        return agentRuntimeResponse("fresh-stream");
      },
    });
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat", mode: "resume" }),
    });

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.mode, "start");
    assert.match(calls[0]?.runId ?? "", /^[0-9a-f-]{36}$/i);
    assert.equal(response.headers.get(CHAT_RUN_ID_HEADER), calls[0]?.runId);
  });

  void it("does not retry a failed fresh replacement", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({});
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildAgentSystemPrompt: async () => "test",
      runAgentChat: async () => {
        calls += 1;
        throw Object.assign(new Error(calls === 1 ? "Run is no longer active." : "Busy."), {
          name: "AgentLoopSessionError",
          code: calls === 1 ? "run_not_active" : "conversation_busy",
        });
      },
    });
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        runId: "018f8896-bef7-7051-8c30-1f862a28d31a",
        mode: "resume",
      }),
    });

    assert.equal(calls, 2);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "conversation_busy");
  });

  void it("returns safe chat failures without exposing provider diagnostics", async () => {
    const model = new MockLanguageModelV4({});
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildAgentSystemPrompt: async () => "test",
      runAgentChat: async () => {
        throw Object.assign(new Error("provider response api_key=sk-super-secret"), {
          status: 429,
        });
      },
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat" }),
    });

    const body = (await response.json()) as { error: string; code: string; retryable: boolean };
    assert.equal(response.status, 429);
    assert.equal(body.code, "rate_limited");
    assert.equal(body.retryable, true);
    assert.equal(body.error.includes("sk-super-secret"), false);
  });

  void it("filters legacy empty assistant messages before invoking the runtime", async () => {
    const model = new MockLanguageModelV4({});
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildAgentSystemPrompt: async () => "Ayaka root prompt",
      runAgentChat: async (options) => {
        assert.deepEqual(options.messages, validMessages);
        return agentRuntimeResponse("sanitized-stream");
      },
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: [validMessages[0], { id: "a-empty", role: "assistant", parts: [] }],
        model: "mock/chat",
      }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "sanitized-stream");
  });

  void it("forwards reasoning chunks to Chat before the response finishes", async () => {
    const model = new MockLanguageModelV4({});
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({
        model,
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 256,
      }),
      buildAgentSystemPrompt: async () => "Ayaka root prompt",
      runAgentChat: async () => delayedReasoningResponse(),
    });

    const snapshots: UIMessage[][] = [];
    let finished = false;
    const chat = new Chat<UIMessage>({
      id: "chat-stream",
      messages: validMessages as UIMessage[],
      transport: new DefaultChatTransport<UIMessage>({
        api: "http://ayaka.test/api/chat",
        headers: { [CHAT_SESSION_HEADER]: token },
        body: { model: "mock/chat" },
        fetch: async (input, init) => app.request(new Request(String(input), init)),
      }),
      onFinish: () => {
        finished = true;
      },
    });
    const unregister = chat["~registerMessagesCallback"](() => {
      snapshots.push(structuredClone(chat.messages) as UIMessage[]);
    });

    let resolveFirstDelta!: () => void;
    let rejectFirstDelta!: (error: Error) => void;
    const firstDelta = new Promise<void>((resolve, reject) => {
      resolveFirstDelta = resolve;
      rejectFirstDelta = reject;
    });
    const firstDeltaTimeout = setTimeout(
      () => rejectFirstDelta(new Error("Timed out waiting for the first reasoning delta.")),
      2_000,
    );
    const sendPromise = chat.sendMessage();
    const waitForFirstDelta = (async () => {
      while (
        !snapshots.some((messages) =>
          messages.some((message) =>
            message.parts.some((part) => part.type === "reasoning" && part.text === "first"),
          ),
        )
      ) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      resolveFirstDelta();
    })();

    await Promise.race([firstDelta, waitForFirstDelta]);
    clearTimeout(firstDeltaTimeout);

    const firstSnapshot = snapshots.find((messages) =>
      messages.some((message) =>
        message.parts.some((part) => part.type === "reasoning" && part.text === "first"),
      ),
    );
    assert.ok(firstSnapshot);
    assert.equal(finished, false);
    assert.equal(chat.status, "streaming");

    await sendPromise;
    unregister();

    assert.equal(finished, true);
    assert.equal(chat.status, "ready");
    assert.ok(
      snapshots.some((messages) =>
        messages.some((message) =>
          message.parts.some((part) => part.type === "reasoning" && part.text === "first second"),
        ),
      ),
    );
  });

  void it("routes OpenAI and non-OpenAI providers through the same agent runtime", async () => {
    const model = new MockLanguageModelV4({});
    const toolSelection = { mode: "manual" as const, selectedToolIds: ["memory_search" as const] };
    const providerCases: Array<[string, ModelProviderKind]> = [
      ["openai/gpt-test", "openai"],
      ["anthropic/claude-test", "anthropic"],
      ["google/gemini-test", "google"],
      ["openrouter/deepseek-test", "openai-compatible"],
    ];

    for (const [modelRef, providerKind] of providerCases) {
      let called = false;
      const app = createApp({
        sessionToken: token,
        resolveModel: (requestedRef) => {
          assert.equal(requestedRef, modelRef);
          return {
            model,
            providerId: modelRef.split("/")[0],
            providerKind,
            modelId: modelRef.split("/")[1],
            temperature: 0.7,
            topP: 1,
            maxOutputTokens: 256,
          };
        },
        buildAgentSystemPrompt: async () => "Ayaka root prompt",
        runAgentChat: async (options) => {
          called = true;
          assert.equal(options.modelRef, modelRef);
          assert.equal(options.conversationId, "c-neutral");
          assert.equal(options.preferredAgentId, "agent-analyst");
          assert.equal(options.reasoning, "high");
          assert.deepEqual(options.toolSelection, toolSelection);
          assert.equal(options.resolved.providerKind, providerKind);
          assert.equal(
            await options.buildAgentSystemPrompt("agent-ayaka", "c-neutral"),
            "Ayaka root prompt",
          );
          return agentRuntimeResponse("agents-stream");
        },
      });

      const response = await app.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CHAT_SESSION_HEADER]: token,
        },
        body: JSON.stringify({
          messages: validMessages,
          model: modelRef,
          agentId: "agent-analyst",
          conversationId: "c-neutral",
          reasoning: "high",
          toolSelection,
        }),
      });

      assert.equal(called, true);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
      assert.equal(await response.text(), "agents-stream");
    }
  });

  void it("passes prior assistant reactions to the agent runtime", async () => {
    const model = new MockLanguageModelV4({});
    const messages: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "Explain streams" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "text", text: "This answer used a terse explanation." }],
        metadata: {
          reaction: { emoji: "\u{1F44D}", label: "helpful", createdAt: 123 },
        },
      },
      { id: "u2", role: "user", parts: [{ type: "text", text: "Continue" }] },
    ];
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
      buildAgentSystemPrompt: async () => "Base instructions.",
      runAgentChat: async (options) => {
        assert.deepEqual(options.messages, messages);
        assert.equal(
          await options.buildAgentSystemPrompt("agent-ayaka", undefined),
          "Base instructions.",
        );
        return agentRuntimeResponse("reaction-stream");
      },
    });

    const response = await app.request("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages, model: "mock/chat" }),
    });

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "reaction-stream");
  });

  void it("keeps provider-default, none, and compatible-provider minimal reasoning", async () => {
    const model = new MockLanguageModelV4({});
    const cases: Array<{
      reasoning: string;
      providerKind?: ModelProviderKind;
      expected: RunAgentChatOptions["reasoning"];
    }> = [
      { reasoning: "provider-default", expected: "provider-default" },
      { reasoning: "none", expected: "none" },
      { reasoning: "minimal", providerKind: "openai-compatible", expected: "minimal" },
    ];

    for (const testCase of cases) {
      const captured: { value?: RunAgentChatOptions } = {};
      const app = createApp({
        sessionToken: token,
        resolveModel: () => ({
          model,
          providerKind: testCase.providerKind,
          temperature: 0.7,
          topP: 1,
          maxOutputTokens: 256,
        }),
        buildAgentSystemPrompt: async () => "You are a test assistant.",
        runAgentChat: async (options) => {
          captured.value = options;
          return agentRuntimeResponse("reasoning-stream");
        },
      });

      const response = await app.request("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CHAT_SESSION_HEADER]: token,
        },
        body: JSON.stringify({
          messages: validMessages,
          model: "mock/chat",
          reasoning: testCase.reasoning,
        }),
      });

      assert.equal(response.status, 200);
      await response.text();
      assert.equal(captured.value?.reasoning, testCase.expected);
    }
  });
});

const mediaCapabilities: ModelCapabilities = {
  textGeneration: false,
  vision: false,
  imageOutput: true,
  speechOutput: true,
  transcription: true,
  toolCalling: false,
  reasoning: false,
  embedding: false,
};

void describe("local chat server /api/media/generate", () => {
  void it("rejects media generation without the active session token", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/media/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "image", model: "mock/image", prompt: "hi" }),
    });

    assert.equal(response.status, 401);
    const body = (await response.json()) as MediaGenerationErrorResponse;
    assert.equal(body.code, "unauthorized");
  });

  void it("rejects missing media request parameters", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/media/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ kind: "image", model: "mock/image" }),
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as MediaGenerationErrorResponse;
    assert.equal(body.code, "invalid_request");
    assert.match(body.error, /prompt is required/);
  });

  void it("rejects video generation requests", async () => {
    const app = createApp({ sessionToken: token });

    const response = await postMedia(app, {
      kind: "video",
      model: "mock/video",
      prompt: "make video",
    });

    assert.equal(response.status, 400);
    const body = (await response.json()) as MediaGenerationErrorResponse;
    assert.equal(body.code, "invalid_request");
    assert.match(body.error, /image, speech, transcription/);
  });

  void it("returns structured permission errors for disabled image generation groups", async () => {
    const imageModel = new MockImageModelV4({
      doGenerate: async () => {
        throw new Error("Image generation is not enabled for this group");
      },
    });
    const app = createApp({
      sessionToken: token,
      resolveMediaModel: ((modelRef: string, kind: MediaGenerationKind) => {
        assert.equal(modelRef, "mock/image");
        assert.equal(kind, "image");
        return {
          kind,
          model: imageModel,
          providerId: "mock",
          providerKind: "openai-compatible",
          modelId: "image",
          capabilities: mediaCapabilities,
          providerOptions: {},
        };
      }) as typeof import("@desktop-main/lib/providers").resolveMediaModel,
      writeMediaAsset: ({ data, mediaType, kind, filename }) => ({
        type: "file" as const,
        mediaType,
        filename: `${filename ?? kind}.bin`,
        url: `ayaka-media://asset/${kind}.bin`,
        size: data.byteLength,
      }),
    });

    const response = await postMedia(app, { kind: "image", model: "mock/image", prompt: "draw" });

    assert.equal(response.status, 403);
    const body = (await response.json()) as MediaGenerationErrorResponse;
    assert.equal(body.code, "permission_denied");
    assert.match(body.error, /not enabled for this group/);
  });

  void it("generates image, speech, and transcription responses", async () => {
    const imageModel = new MockImageModelV4({
      doGenerate: async () => ({
        images: [new Uint8Array([1, 2, 3])],
        warnings: [],
        response: mockResponse("image"),
        providerMetadata: {},
      }),
    });
    const speechModel = new MockSpeechModelV4({
      doGenerate: async () => ({
        audio: new Uint8Array([1, 2, 3, 4]),
        warnings: [],
        response: mockResponse("speech"),
        providerMetadata: {},
      }),
    });
    const transcriptionModel = new MockTranscriptionModelV4({
      doGenerate: async () => ({
        text: "hello transcript",
        segments: [{ text: "hello", startSecond: 0, endSecond: 1 }],
        language: "en",
        durationInSeconds: 1,
        warnings: [],
        response: mockResponse("transcription"),
        providerMetadata: {},
      }),
    });
    const app = createApp({
      sessionToken: token,
      resolveMediaModel: ((modelRef: string, kind: MediaGenerationKind) => {
        assert.match(modelRef, /^mock\//);
        const model =
          kind === "image" ? imageModel : kind === "speech" ? speechModel : transcriptionModel;
        return {
          kind,
          model,
          providerId: "mock",
          providerKind: "openai-compatible",
          modelId: kind,
          capabilities: mediaCapabilities,
          providerOptions: {},
        };
      }) as typeof import("@desktop-main/lib/providers").resolveMediaModel,
      writeMediaAsset: ({ data, mediaType, kind, filename }) => ({
        type: "file" as const,
        mediaType,
        filename: `${filename ?? kind}.bin`,
        url: `ayaka-media://asset/${kind}.bin`,
        size: data.byteLength,
      }),
    });

    const image = await postMedia(app, { kind: "image", model: "mock/image", prompt: "draw" });
    assert.equal(image.status, 200);
    assert.equal(((await image.json()) as { files: unknown[] }).files.length, 1);

    const speech = await postMedia(app, { kind: "speech", model: "mock/speech", text: "hello" });
    assert.equal(speech.status, 200);
    const speechBody = (await speech.json()) as { files: Array<{ mediaType: string }> };
    assert.equal(speechBody.files[0]?.mediaType.startsWith("audio/"), true);

    const transcription = await postMedia(app, {
      kind: "transcription",
      model: "mock/transcription",
      audio: { url: "data:audio/wav;base64,AA==", mediaType: "audio/wav", filename: "clip.wav" },
    });
    assert.equal(transcription.status, 200);
    const transcriptionBody = (await transcription.json()) as {
      text: string;
      metadata: { language?: string };
    };
    assert.equal(transcriptionBody.text, "hello transcript");
    assert.equal(transcriptionBody.metadata.language, "en");
  });
});

function agentRuntimeResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
  });
}

function delayedReasoningResponse(): Response {
  const stream = createUIMessageStream<UIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: "assistant-stream" });
      writer.write({ type: "reasoning-start", id: "reasoning-stream" });
      await new Promise((resolve) => setTimeout(resolve, 25));
      writer.write({
        type: "reasoning-delta",
        id: "reasoning-stream",
        delta: "first",
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      writer.write({
        type: "reasoning-delta",
        id: "reasoning-stream",
        delta: " second",
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      writer.write({ type: "reasoning-end", id: "reasoning-stream" });
      writer.write({ type: "finish", finishReason: "stop" });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function postMedia(app: ReturnType<typeof createApp>, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request("/api/media/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify(body),
    }),
  );
}

function mockResponse(modelId: string): {
  modelId: string;
  timestamp: Date;
  headers: Record<string, string>;
} {
  return { modelId, timestamp: new Date(0), headers: {} };
}

void describe("local chat server /api/title", () => {
  void it("rejects title posts without the active session token", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat" }),
    });

    assert.equal(response.status, 401);
  });

  void it("rejects title posts without a model reference", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/title", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages }),
    });

    assert.equal(response.status, 400);
  });

  void it("generates a sanitized title from the model", async () => {
    const providerOptions = { mock: { textVerbosity: "low" } };
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text" as const, text: '  "\u91cf\u5b50\u8ba1\u7b97\u5165\u95e8"  ' }],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: 3, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const app = createApp({
      sessionToken: token,
      resolveModel: (modelRef) => {
        assert.equal(modelRef, "mock/chat");
        return { model, temperature: 0.4, topP: 1, maxOutputTokens: 64, providerOptions };
      },
      buildAgentSystemPrompt: async () => "",
    });

    const response = await app.request("/api/title", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat" }),
    });

    assert.equal(response.status, 200);
    const body = (await response.json()) as { title: string };
    assert.equal(body.title, "\u91cf\u5b50\u8ba1\u7b97\u5165\u95e8");
    assert.deepEqual(model.doGenerateCalls[0]?.providerOptions, providerOptions);
  });
});

void describe("local chat server /api/followups", () => {
  void it("rejects follow-up posts without the active session token", async () => {
    const app = createApp({ sessionToken: token });

    const response = await app.request("/api/followups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: validMessages, model: "mock/chat" }),
    });

    assert.equal(response.status, 401);
  });

  void it("does not return suggestions that were shown in the previous turn", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: {
        content: [
          {
            type: "text" as const,
            text: '["上一轮建议", "本轮建议"]',
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 3, text: 3, reasoning: undefined },
        },
        warnings: [],
      },
    });
    const app = createApp({
      sessionToken: token,
      resolveModel: () => ({ model, temperature: 0.7, topP: 1, maxOutputTokens: 256 }),
    });

    const response = await app.request("/api/followups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        model: "mock/chat",
        generationId: "followup-test-1",
        messages: [
          { id: "u1", role: "user", parts: [{ type: "text", text: "解释流式响应" }] },
          { id: "a1", role: "assistant", parts: [{ type: "text", text: "流式响应会逐步返回" }] },
        ],
        previousSuggestions: ["上一轮建议"],
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { suggestions: ["本轮建议"] });
  });
});
