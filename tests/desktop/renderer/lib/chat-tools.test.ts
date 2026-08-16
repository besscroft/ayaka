import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getChatToolSelectionForConversation,
  withChatToolSelectionForConversation,
  type ToolsSnapshot,
  type ModelCapabilities,
  type ProviderInfo,
} from "@shared/types";
import {
  createClientChatToolDescriptors,
  filterUserVisibleChatToolDescriptors,
  getActiveChatToolIds,
} from "@renderer/lib/chat-tools";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("chat tool UI helpers", () => {
  void it("defaults per-conversation tool settings to auto and persists manual choices", () => {
    const first = getChatToolSelectionForConversation(null, "c1");
    assert.equal(first.mode, "auto");
    assert.deepEqual(first.selectedToolIds, []);

    const saved = withChatToolSelectionForConversation(null, "c1", {
      mode: "manual",
      selectedToolIds: ["web_search", "memory_save", "web_search"],
    });

    const parsed = getChatToolSelectionForConversation(JSON.stringify(saved), "c1");
    assert.equal(parsed.mode, "manual");
    assert.deepEqual(parsed.selectedToolIds, ["web_search", "memory_save"]);
    assert.equal(getChatToolSelectionForConversation(JSON.stringify(saved), "c2").mode, "auto");
  });

  void it("enables native web search for supported providers", () => {
    const providers = [provider("openai", "openai")];
    const descriptors = createClientChatToolDescriptors({
      selectedModel: "openai/gpt-test",
      providers,
    });
    const web = descriptors.find((descriptor) => descriptor.id === "web_search");

    assert.equal(web?.available, true);
    assert.equal(web?.execution, "provider");
    assert.deepEqual(getActiveChatToolIds({ mode: "auto", selectedToolIds: [] }, descriptors), [
      "web_search",
      "web_open",
      "current_time",
      "runtime_snapshot",
      "model_capabilities",
      "sandbox_list_files",
      "sandbox_read_file",
      "sandbox_snapshot",
      "sandbox_list_artifacts",
      "cron",
    ]);
  });

  void it("enables host fallback web search after switching to a compatible provider", () => {
    const providers = [provider("custom", "openai-compatible")];
    const descriptors = createClientChatToolDescriptors({
      selectedModel: "custom/local-model",
      providers,
    });
    const web = descriptors.find((descriptor) => descriptor.id === "web_search");
    const memory = descriptors.find((descriptor) => descriptor.id === "memory_search");

    assert.equal(web?.available, true);
    assert.equal(web?.execution, "host");
    assert.equal(memory?.available, true);
    assert.equal(memory?.defaultAuto, false);
    assert.deepEqual(
      getActiveChatToolIds(
        { mode: "manual", selectedToolIds: ["web_search", "current_time", "memory_search"] },
        descriptors,
      ),
      ["web_search", "current_time", "memory_search"],
    );
  });

  void it("only exposes hosted tools when their OpenAI configuration is present", () => {
    const configured = provider("openai", "openai");
    configured.models[0].providerOptions = {
      openaiTools: { vectorStoreIds: ["vs-test"], toolSearch: true },
    };
    const configuredDescriptors = createClientChatToolDescriptors({
      selectedModel: "openai/gpt-test",
      providers: [configured],
    });
    assert.equal(configuredDescriptors.find((item) => item.id === "file_search")?.available, true);
    assert.equal(configuredDescriptors.find((item) => item.id === "tool_search")?.available, true);
    assert.equal(
      configuredDescriptors.find((item) => item.id === "code_interpreter")?.available,
      true,
    );

    const unconfiguredDescriptors = createClientChatToolDescriptors({
      selectedModel: "openai/gpt-test",
      providers: [provider("openai", "openai")],
    });
    assert.equal(
      unconfiguredDescriptors.find((item) => item.id === "file_search")?.available,
      false,
    );
    assert.equal(
      unconfiguredDescriptors.find((item) => item.id === "tool_search")?.available,
      false,
    );
    assert.equal(
      unconfiguredDescriptors.find((item) => item.id === "file_search")?.unavailableReason,
      "chatTools.unavailable.fileSearchConfig",
    );
    assert.equal(
      unconfiguredDescriptors.find((item) => item.id === "tool_search")?.unavailableReason,
      "chatTools.unavailable.toolSearchConfig",
    );
  });

  void it("disables every tool when the selected model cannot call tools", () => {
    const providers = [provider("openai", "openai", { ...capabilities, toolCalling: false })];
    const descriptors = createClientChatToolDescriptors({
      selectedModel: "openai/gpt-no-tools",
      providers,
    });

    assert.equal(
      descriptors.every((descriptor) => !descriptor.available),
      true,
    );
    assert.deepEqual(getActiveChatToolIds({ mode: "auto", selectedToolIds: [] }, descriptors), []);
    assert.deepEqual(
      getActiveChatToolIds({ mode: "manual", selectedToolIds: ["web_search"] }, descriptors),
      [],
    );
  });

  void it("mixes MCP and Skill tool descriptors with built-in tools", () => {
    const providers = [provider("custom", "openai-compatible")];
    const descriptors = createClientChatToolDescriptors({
      selectedModel: "custom/local-model",
      providers,
      tools: toolsnapshot(),
    });

    const mcp = descriptors.find((descriptor) => descriptor.id === "mcp:srv-1:search");
    const skill = descriptors.find((descriptor) => descriptor.id === "skill:skill-1");

    assert.equal(mcp?.available, true);
    assert.equal(mcp?.defaultAuto, true);
    assert.equal(mcp?.requiresApproval, true);
    assert.equal(skill?.available, false);
    assert.equal(skill?.defaultAuto, false);
    assert.equal(skill?.unavailableReason, "chatTools.unavailable.skillInstructionsOnly");
    assert.deepEqual(
      getActiveChatToolIds(
        { mode: "manual", selectedToolIds: ["memory_search", mcp!.id, skill!.id] },
        descriptors,
      ),
      ["memory_search", "mcp:srv-1:search"],
    );
    assert.equal(
      getActiveChatToolIds({ mode: "auto", selectedToolIds: [] }, descriptors).includes(
        "mcp:srv-1:search",
      ),
      true,
    );
  });

  void it("keeps silent memory tools out of the user-facing selector", () => {
    const providers = [provider("openai", "openai")];
    const visible = filterUserVisibleChatToolDescriptors(
      createClientChatToolDescriptors({
        selectedModel: "openai/gpt-test",
        providers,
        tools: null,
      }),
    );

    assert.equal(
      visible.some((descriptor) => descriptor.category === "memory"),
      false,
    );
    assert.equal(
      visible.some((descriptor) => descriptor.id === "conversation_search"),
      false,
    );
    assert.deepEqual(
      getActiveChatToolIds(
        {
          mode: "manual",
          selectedToolIds: [
            "memory_search",
            "memory_save",
            "memory_update",
            "memory_delete",
            "current_time",
          ],
        },
        visible,
      ),
      ["current_time"],
    );
  });
});

function provider(
  id: string,
  kind: ProviderInfo["kind"],
  modelCapabilities: ModelCapabilities = capabilities,
): ProviderInfo {
  const modelId =
    id === "custom" ? "local-model" : modelCapabilities.toolCalling ? "gpt-test" : "gpt-no-tools";
  return {
    id,
    label: id,
    kind,
    source: id === "custom" ? "custom" : "builtin",
    models: [
      {
        id: modelId,
        enabled: true,
        source: "custom",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        contextWindow: 32_000,
        capabilities: modelCapabilities,
        providerOptions: {},
      },
    ],
    helpUrl: "https://example.com",
    hasApiKey: true,
    hasProviderApiKey: true,
  };
}

function toolsnapshot(): ToolsSnapshot {
  const now = Date.now();
  return {
    toolServers: [
      {
        id: "srv-1",
        name: "Search MCP",
        description: "Search tools",
        kind: "mcp",
        transport: "http",
        enabled: 1,
        auto_use: 1,
        requires_approval: 1,
        status: "ready",
        command: null,
        args_json: "[]",
        url: "https://example.com/mcp",
        headers_json: "{}",
        env_json: "{}",
        cwd: null,
        timeout_seconds: 60,
        last_error: null,
        last_connected_at: now,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        purge_after_at: null,
      },
    ],
    toolRecords: [
      {
        id: "tool-1",
        server_id: "srv-1",
        name: "search",
        title: "Search",
        description: "Search through an MCP server.",
        instructions: "",
        kind: "mcp",
        category: "search",
        reference: "search",
        input_schema_json: "{}",
        output_schema_json: "{}",
        config_json: "{}",
        trigger_keywords_json: "[]",
        tags_json: "[]",
        enabled: 1,
        auto_use: 1,
        requires_approval: 1,
        discovered_at: now,
        last_run_at: null,
        updated_at: now,
        deleted_at: null,
        purge_after_at: null,
      },
    ],
    skills: [
      {
        id: "skill-1",
        name: "Research Skill",
        description: "Run a research skill.",
        instructions: "Research the request and summarize sources.",
        category: "research",
        enabled: 1,
        auto_use: 1,
        requires_approval: 1,
        trigger_keywords_json: "[]",
        tags_json: "[]",
        config_schema_json: "{}",
        config_json: "{}",
        last_run_at: null,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        purge_after_at: null,
      },
    ],
    secrets: [],
    runtimeEvents: [],
  };
}
