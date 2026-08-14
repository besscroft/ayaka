import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelCapabilities, ProviderInfo } from "@shared/types";
import { MessageInput } from "@renderer/components/MessageInput";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: true,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
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
        onModelChange={() => undefined}
        onReasoningLevelChange={() => undefined}
        onToolSelectionChange={() => undefined}
        providers={[provider()]}
      />,
    );

    assert.match(html, /type="file"/);
    assert.doesNotMatch(html, /aria-label="(?:媒体生成|Media)"/);
    assert.doesNotMatch(html, />图片<|>语音合成<|>语音转录<|>视频</);
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
