import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import {
  MockImageModelV4,
  MockLanguageModelV4,
  MockSpeechModelV4,
  MockTranscriptionModelV4,
  MockVideoModelV4,
} from "ai/test";
import { createApp } from "./index";
import {
  CHAT_REASONING_LEVELS,
  CHAT_SESSION_HEADER,
  type MediaGenerationErrorResponse,
  type MediaGenerationKind,
  type ModelCapabilities,
  type ModelProviderKind,
} from "../../shared/types";

const token = "test-session-token";
const validMessages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }];
type RunAgentChat = typeof import("../lib/agent-runtime").runAgentChat;
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
      error: "The chat session expired. Restart the app and try again.",
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
    const captured: Array<RunAgentChatOptions["reasoning"]> = [];
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
        captured.push(options.reasoning);
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

    assert.deepEqual(captured, [...CHAT_REASONING_LEVELS]);
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
        [CHAT_SESSION_HEADER]: token,
      },
      body: JSON.stringify({
        messages: validMessages,
        model: "mock/chat",
        conversationId: "c-stream",
        reasoning: "high",
        runId: "018f8896-bef7-7051-8c30-1f862a28d31a",
        mode: "resume",
      }),
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
    assert.equal(await response.text(), "runtime-stream");
    assert.equal(captured.value?.modelRef, "mock/chat");
    assert.equal(captured.value?.conversationId, "c-stream");
    assert.equal(captured.value?.reasoning, "high");
    assert.equal(captured.value?.runId, "018f8896-bef7-7051-8c30-1f862a28d31a");
    assert.equal(captured.value?.mode, "resume");
    assert.deepEqual(captured.value?.resolved.providerOptions, providerOptions);
    assert.equal(
      await captured.value?.buildAgentSystemPrompt("agent-void", "c-stream"),
      "You are a test assistant.",
    );
  });

  void it("returns stable run conflict codes", async () => {
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
      runAgentChat: async () => {
        throw Object.assign(new Error("Run is no longer active."), {
          name: "AgentLoopSessionError",
          code: "run_not_active",
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
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "run_not_active");
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
      buildAgentSystemPrompt: async () => "Void root prompt",
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
        buildAgentSystemPrompt: async () => "Void root prompt",
        runAgentChat: async (options) => {
          called = true;
          assert.equal(options.modelRef, modelRef);
          assert.equal(options.conversationId, "c-neutral");
          assert.equal(options.preferredAgentId, "agent-analyst");
          assert.equal(options.reasoning, "high");
          assert.deepEqual(options.toolSelection, toolSelection);
          assert.equal(options.resolved.providerKind, providerKind);
          assert.equal(
            await options.buildAgentSystemPrompt("agent-void", "c-neutral"),
            "Void root prompt",
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
          await options.buildAgentSystemPrompt("agent-void", undefined),
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
  videoOutput: true,
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
      }) as typeof import("../lib/providers").resolveMediaModel,
      writeMediaAsset: ({ data, mediaType, kind, filename }) => ({
        type: "file" as const,
        mediaType,
        filename: `${filename ?? kind}.bin`,
        url: `void-media://asset/${kind}.bin`,
        size: data.byteLength,
      }),
    });

    const response = await postMedia(app, { kind: "image", model: "mock/image", prompt: "draw" });

    assert.equal(response.status, 403);
    const body = (await response.json()) as MediaGenerationErrorResponse;
    assert.equal(body.code, "permission_denied");
    assert.match(body.error, /not enabled for this group/);
  });

  void it("generates image, speech, transcription, and video responses", async () => {
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
    const videoModel = new MockVideoModelV4({
      doGenerate: async () => ({
        videos: [
          { type: "binary" as const, data: new Uint8Array([1, 2, 3]), mediaType: "video/mp4" },
        ],
        warnings: [],
        response: mockResponse("video"),
        providerMetadata: {},
      }),
    });
    const app = createApp({
      sessionToken: token,
      resolveMediaModel: ((modelRef: string, kind: MediaGenerationKind) => {
        assert.match(modelRef, /^mock\//);
        const model =
          kind === "image"
            ? imageModel
            : kind === "speech"
              ? speechModel
              : kind === "transcription"
                ? transcriptionModel
                : videoModel;
        return {
          kind,
          model,
          providerId: "mock",
          providerKind: "openai-compatible",
          modelId: kind,
          capabilities: mediaCapabilities,
          providerOptions: {},
        };
      }) as typeof import("../lib/providers").resolveMediaModel,
      writeMediaAsset: ({ data, mediaType, kind, filename }) => ({
        type: "file" as const,
        mediaType,
        filename: `${filename ?? kind}.bin`,
        url: `void-media://asset/${kind}.bin`,
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

    const video = await postMedia(app, {
      kind: "video",
      model: "mock/video",
      prompt: "make video",
    });
    assert.equal(video.status, 200);
    const videoBody = (await video.json()) as { files: Array<{ mediaType: string }> };
    assert.equal(videoBody.files[0]?.mediaType, "video/mp4");
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
