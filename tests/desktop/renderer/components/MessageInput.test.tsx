import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelCapabilities, ProviderInfo } from "@shared/types";
import { MessageInput } from "@renderer/components/MessageInput";
import { CHAT_PERMISSION_MODE_OPTIONS } from "@renderer/components/ChatPermissionSelector";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: true,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  toolCalling: true,
  reasoning: true,
  embedding: false,
};

void describe("message input media routing", () => {
  void it("keeps attachments but does not render a media type selector", () => {
    const html = renderToStaticMarkup(
      <MessageInput
        isLoading={false}
        onSend={() => undefined}
        selectedModel="mock/chat"
        reasoningLevel="provider-default"
        toolSelection={{ mode: "auto", selectedToolIds: [] }}
        permissionMode="approve_risky"
        permissionInherited
        onModelChange={() => undefined}
        onReasoningLevelChange={() => undefined}
        onToolSelectionChange={() => undefined}
        onPermissionChange={() => undefined}
        onPermissionReset={() => undefined}
        providers={[provider()]}
      />,
    );

    assert.match(html, /type="file"/);
    assert.doesNotMatch(html, /aria-label="(?:媒体生成|Media)"/);
    assert.doesNotMatch(html, />图片<|>语音合成<|>语音转录<|>视频</);
  });

  void it("renders the session permission selector with all three modes", () => {
    const html = renderToStaticMarkup(
      <MessageInput
        isLoading={false}
        onSend={() => undefined}
        selectedModel="mock/chat"
        reasoningLevel="provider-default"
        toolSelection={{ mode: "auto", selectedToolIds: [] }}
        permissionMode="full_access"
        permissionInherited={false}
        onModelChange={() => undefined}
        onReasoningLevelChange={() => undefined}
        onToolSelectionChange={() => undefined}
        onPermissionChange={() => undefined}
        onPermissionReset={() => undefined}
        providers={[provider()]}
      />,
    );

    assert.match(html, /会话权限/);
    assert.match(html, /完全访问/);
    assert.deepEqual(
      CHAT_PERMISSION_MODE_OPTIONS.map((option) => option.mode),
      ["ask", "approve_risky", "full_access"],
    );
  });

  void it("disables the session permission trigger while a run is active", () => {
    const html = renderToStaticMarkup(
      <MessageInput
        isLoading
        isRunActive
        onSend={() => undefined}
        selectedModel="mock/chat"
        reasoningLevel="provider-default"
        toolSelection={{ mode: "auto", selectedToolIds: [] }}
        permissionMode="approve_risky"
        permissionInherited
        onModelChange={() => undefined}
        onReasoningLevelChange={() => undefined}
        onToolSelectionChange={() => undefined}
        onPermissionChange={() => undefined}
        onPermissionReset={() => undefined}
        providers={[provider()]}
      />,
    );
    const trigger = html.match(/<button[^>]*aria-label="会话权限"[^>]*>/)?.[0];
    assert.ok(trigger);
    assert.match(trigger, /disabled/);
  });
});

function provider(): ProviderInfo {
  return {
    id: "mock",
    label: "Mock",
    kind: "openai-compatible",
    source: "custom",
    models: [
      {
        id: "chat",
        enabled: true,
        source: "custom",
        temperature: 0.7,
        topP: 1,
        maxOutputTokens: 4096,
        contextWindow: 32_000,
        capabilities,
        providerOptions: {},
      },
    ],
    helpUrl: "https://example.com",
    hasApiKey: true,
    hasProviderApiKey: true,
  };
}
