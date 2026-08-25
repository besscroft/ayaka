import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SandboxArtifact } from "@shared/types";
import { DEFAULT_CHAT_TOOL_SELECTION } from "@shared/types";
import { GeneratedArtifactTabs } from "@renderer/components/GeneratedAppPane";
import {
  getWorkspaceSidePanelAnimation,
  getWorkspaceSidePanelTransition,
  WorkspaceSidePanel,
} from "@renderer/components/WorkspaceSidePanel";

void describe("workspace side panel", () => {
  void it("animates between the closed and remembered widths", () => {
    assert.deepEqual(getWorkspaceSidePanelAnimation(false, 460), { width: 0, opacity: 0 });
    assert.deepEqual(getWorkspaceSidePanelAnimation(true, 460), { width: 460, opacity: 1 });
    assert.deepEqual(getWorkspaceSidePanelTransition(false, false), {
      type: "spring",
      stiffness: 320,
      damping: 34,
      mass: 0.8,
      opacity: { duration: 0.18, ease: "easeOut" },
    });
    assert.deepEqual(getWorkspaceSidePanelTransition(true, false), { duration: 0 });
    assert.deepEqual(getWorkspaceSidePanelTransition(false, true), { duration: 0 });
  });

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
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, /inert=""/);
    assert.match(html, /will-change-\[width\]/);
  });

  void it("keeps generated artifact tabs horizontally scrollable", () => {
    const artifacts = ["report.html", "chart.html", "summary.html"].map((path, index) =>
      makeArtifact(`artifact-${index}`, path),
    );
    const html = renderToStaticMarkup(
      createElement(GeneratedArtifactTabs, {
        artifacts,
        selectedId: artifacts[0].id,
        onSelect: () => undefined,
      }),
    );

    assert.match(html, /data-slot="generated-artifact-tabs-scroll"/);
    assert.match(html, /class="min-w-0 flex-1 overflow-x-auto"/);
    for (const artifact of artifacts) assert.match(html, new RegExp(artifact.path));
  });
});

function makeArtifact(id: string, path: string): SandboxArtifact {
  return {
    id,
    session_id: "session-1",
    kind: "html",
    path,
    url: null,
    size_bytes: 1,
    entry_path: null,
    mime_type: "text/html",
    sha256: null,
    status: "ready",
    created_at: 0,
    updated_at: 0,
    authorized: false,
  };
}
