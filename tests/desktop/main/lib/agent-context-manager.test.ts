import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LanguageModel, ModelMessage } from "ai";
import {
  AgentContextManager,
  ContextEngine,
  createPromptCacheKey,
  estimateMessageTokens,
  findLatestCompactionIndex,
  splitRecentMessages,
} from "@desktop-main/lib/agent-context-manager";

const fakeModel = {} as LanguageModel;

void describe("AgentContextManager", () => {
  void it("keeps short contexts unchanged", async () => {
    const manager = new AgentContextManager({
      runId: "run",
      agentPath: "/root",
      modelRef: "test/model",
      model: fakeModel,
      contextWindow: 10_000,
      policy: {
        mode: "semantic",
        pruneThreshold: 0.6,
        compactThreshold: 0.75,
        targetRatio: 0.5,
        keepRecentTokens: 2_000,
      },
      summarize: async () => "summary",
    });
    assert.equal(await manager.prepare([{ role: "user", content: "hello" }]), undefined);
  });

  void it("creates an auditable semantic checkpoint and preserves the recent tail", async () => {
    const checkpoints: string[] = [];
    const messages: ModelMessage[] = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `${index}:${"x".repeat(600)}`,
    }));
    const manager = new AgentContextManager({
      runId: "run",
      conversationId: "conversation",
      agentPath: "/root/researcher",
      modelRef: "test/model",
      model: fakeModel,
      contextWindow: 1_000,
      policy: {
        mode: "semantic",
        pruneThreshold: 0.3,
        compactThreshold: 0.4,
        targetRatio: 0.2,
        keepRecentTokens: 1_000,
      },
      summarize: async (older) => `summary:${older.length}`,
      onCheckpoint: (checkpoint) => checkpoints.push(checkpoint.summary),
    });
    const compacted = await manager.prepare(messages);
    assert.ok(compacted);
    assert.equal(compacted?.[0]?.role, "system");
    assert.match(String(compacted?.[0]?.content), /summary:/);
    assert.equal(checkpoints.length, 1);
    assert.ok(estimateMessageTokens(compacted ?? []) < estimateMessageTokens(messages));
  });

  void it("splits on whole messages", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "a".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
      { role: "user", content: "latest" },
    ];
    const split = splitRecentMessages(messages, 40);
    assert.equal(split.recent.at(-1), messages.at(-1));
    assert.equal(split.older.length + split.recent.length, messages.length);
  });

  void it("uses OpenAI server compaction and trims only model input before the latest item", async () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "old visible message" },
      {
        role: "assistant",
        content: [
          {
            type: "custom",
            kind: "openai.compaction",
            providerOptions: {
              openai: {
                itemId: "cmp_123",
                encryptedContent: "encrypted-is-never-emitted-to-diagnostics",
              },
            },
          } as never,
        ],
      },
      { role: "user", content: "latest" },
    ];
    const engine = new ContextEngine({
      runId: "run-openai",
      agentPath: "/root",
      modelRef: "openai/gpt-test",
      providerKind: "openai",
      model: fakeModel,
      contextWindow: 20_000,
      policy: {
        mode: "semantic",
        pruneThreshold: 0.6,
        compactThreshold: 0.75,
        targetRatio: 0.5,
        keepRecentTokens: 20_000,
      },
    });

    const result = await engine.prepareResult(messages);
    assert.equal(findLatestCompactionIndex(messages), 1);
    assert.deepEqual(result.messages, messages.slice(1));
    assert.equal(result.checkpoints[0]?.strategy, "server");
    assert.equal(result.checkpoints[0]?.providerItemId, "cmp_123");
    assert.equal(JSON.stringify(result.checkpoints).includes("encrypted-is-never-emitted"), false);
  });

  void it("adds stable OpenAI compaction and prompt cache options", () => {
    const engine = new ContextEngine({
      runId: "run-options",
      agentPath: "/root",
      modelRef: "openai/gpt-test",
      providerKind: "openai",
      model: fakeModel,
      contextWindow: 100_000,
      maxOutputTokens: 5_000,
      staticInstructions: "stable instructions",
      toolSchemas: ["search", "read"],
      policy: {
        mode: "semantic",
        pruneThreshold: 0.6,
        compactThreshold: 0.75,
        targetRatio: 0.5,
        keepRecentTokens: 20_000,
      },
    });
    const options = engine.withProviderOptions({ openai: { reasoningSummary: "detailed" } }) as {
      openai: Record<string, unknown>;
    };
    assert.equal(options.openai.promptCacheKey, engine.promptCacheKey);
    assert.deepEqual(options.openai.contextManagement, [
      { type: "compaction", compactThreshold: 68_178 },
    ]);
    assert.equal(
      createPromptCacheKey({
        modelRef: "openai/gpt-test",
        agentPath: "/root",
        staticInstructions: "stable instructions",
        toolSchemas: ["search", "read"],
      }),
      engine.promptCacheKey,
    );
  });

  void it("caches exact OpenAI token counts by stable request hash", async () => {
    let calls = 0;
    const engine = new ContextEngine({
      runId: "run-count",
      agentPath: "/root",
      modelRef: "openai/gpt-count-unique",
      providerKind: "openai",
      model: fakeModel,
      contextWindow: 1_500,
      maxOutputTokens: 100,
      toolReserveTokens: 100,
      policy: {
        mode: "semantic",
        pruneThreshold: 0.001,
        compactThreshold: 0.75,
        targetRatio: 0.5,
        keepRecentTokens: 20_000,
      },
      countInputTokens: async () => {
        calls += 1;
        return 321;
      },
    });
    const messages: ModelMessage[] = [{ role: "user", content: "count me" }];
    const first = await engine.prepareResult(messages);
    const second = await engine.prepareResult(messages);
    assert.equal(first.usage.accuracy, "exact");
    assert.equal(second.usage.inputTokens, 321);
    assert.equal(calls, 1);
  });
});
