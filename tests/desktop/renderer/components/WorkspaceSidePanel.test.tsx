import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_CHAT_TOOL_SELECTION } from "@shared/types";
import { WorkspaceSidePanel } from "@renderer/components/WorkspaceSidePanel";

void describe("workspace side panel", () => {
  void it("renders the runtime and generated app tabs in one accessible container", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceSidePanel, {
        conversationId: "conversation-1",
        snapshot: null,
        profiles: [],
        providers: [],
        selectedModel: null,
        reasoningLevel: "provider-default",
        toolSelection: DEFAULT_CHAT_TOOL_SELECTION,
        tools: null,
        chatStatus: "ready",
        isChatActive: false,
        onStop: () => undefined,
      }),
    );

    assert.match(html, /data-slot="workspace-side-panel"/);
    assert.match(html, /data-slot="tabs-list"/);
    assert.match(html, /data-slot="tabs-list"[^>]*class="inline-flex w-fit shrink-0/);
    assert.equal((html.match(/data-slot="tabs-trigger"/g) ?? []).length, 2);
    assert.match(html, /data-slot="tabs-trigger"[^>]*data-active/);
    assert.match(html, /role="tablist"/);
    assert.match(html, /role="tab"/g);
    assert.match(html, /运行状态|Runtime/);
    assert.match(html, /生成应用|Generated app/);
    assert.match(html, /role="tabpanel"/g);
    assert.match(html, /aria-controls="conversation-1-workspace-runtime-panel"/);
    assert.match(html, /aria-controls="conversation-1-workspace-generated-app-panel"/);
    assert.match(html, /aria-labelledby="conversation-1-workspace-runtime-tab"/);
    assert.match(html, /aria-labelledby="conversation-1-workspace-generated-app-tab"/);
    assert.match(
      html,
      /id="conversation-1-workspace-generated-app-panel"[^>]*class="flex h-full min-h-0 flex-col"/,
    );
    assert.match(html, /hidden=""/);
  });
});
