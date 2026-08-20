import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_CHAT_TOOL_SELECTION, type RuntimeRun, type RuntimeStep } from "@shared/types";
import {
  AgentStatusWidget,
  getAgentPanelAnimation,
  getRecentRuntimeSteps,
  formatElapsed,
  resolveAgentPanelStatus,
  selectLatestConversationRun,
  StatusIcon,
} from "@renderer/components/AgentStatusWidget";

function makeRun(id: string, conversationId: string, startedAt: number): RuntimeRun {
  return {
    id,
    conversation_id: conversationId,
    root_agent_id: "default",
    final_agent_id: "default",
    origin: "chat",
    finish_reason: null,
    status: "running",
    model_ref: "openai/gpt-4o",
    started_at: startedAt,
    finished_at: null,
    trace_id: null,
    input_summary: null,
    output_summary: null,
    error: null,
    usage_json: null,
  };
}

function makeStep(id: string, runId: string, startedAt: number): RuntimeStep {
  return {
    id,
    run_id: runId,
    agent_id: "default",
    tool_id: null,
    kind: "model",
    status: "running",
    title: id,
    detail_json: "{}",
    started_at: startedAt,
    finished_at: null,
    error: null,
  };
}

void describe("agent status widget runtime helpers", () => {
  void it("keeps the panel visible after its expand animation starts", () => {
    assert.deepEqual(getAgentPanelAnimation(true), { width: 320, opacity: 1 });
    assert.deepEqual(getAgentPanelAnimation(false), { width: 80, opacity: 1 });
  });

  void it("selects the latest run for the active conversation only", () => {
    const runs = [
      makeRun("other", "conversation-2", 30),
      makeRun("old", "conversation-1", 10),
      makeRun("latest", "conversation-1", 20),
    ];

    assert.equal(selectLatestConversationRun(runs, "conversation-1")?.id, "latest");
    assert.equal(selectLatestConversationRun(runs, "missing"), undefined);
  });

  void it("sorts and limits recent runtime steps", () => {
    const steps = [
      makeStep("old", "run-1", 10),
      makeStep("newest", "run-1", 30),
      makeStep("other-run", "run-2", 40),
      makeStep("middle", "run-1", 20),
    ];

    assert.deepEqual(
      getRecentRuntimeSteps(steps, "run-1", 2).map((step) => step.id),
      ["newest", "middle"],
    );
  });

  void it("keeps sub-second runtime durations visible", () => {
    assert.equal(formatElapsed(0), "<1ms");
    assert.equal(formatElapsed(245), "245ms");
    assert.equal(formatElapsed(1_250), "1.3s");
    assert.equal(formatElapsed(61_200), "1:01");
  });

  void it("keeps approval and failure states ahead of streaming state", () => {
    assert.equal(
      resolveAgentPanelStatus({
        chatStatus: "streaming",
        isChatActive: true,
        runStatus: "waiting_approval",
      }),
      "waiting_approval",
    );
    assert.equal(
      resolveAgentPanelStatus({
        chatStatus: "error",
        isChatActive: false,
        runStatus: "succeeded",
      }),
      "failed",
    );
    assert.equal(resolveAgentPanelStatus({ chatStatus: "ready", isChatActive: false }), "idle");
  });

  void it("uses visible skin tokens for active loading indicators", () => {
    const html = renderToStaticMarkup(createElement(StatusIcon, { status: "running" }));

    assert.match(html, /data-slot="status-spinner"/);
    assert.match(html, /border-primary\/25/);
    assert.match(html, /border-t-primary/);
    assert.doesNotMatch(html, /border-accent/);
  });

  void it("keeps the collapsed status controls horizontal and centered in the chat header", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStatusWidget, {
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
        open: false,
        onOpenChange: () => undefined,
        onStop: () => undefined,
      }),
    );

    assert.match(html, /data-slot="agent-status-toolbar"/);
    assert.match(html, /<button[^>]*data-slot="agent-status-indicator"/);
    assert.match(html, /data-slot="agent-status-toggle"/);
    assert.match(html, /class="flex h-full items-center gap-1 px-1"/);
    assert.match(html, /relative h-10 border-l-0 bg-transparent/);
    assert.doesNotMatch(html, /top-1\/2|translate-y-1\/2/);
    assert.match(html, /border-l-0 bg-transparent/);
  });

  void it("joins the chat layout instead of floating when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(AgentStatusWidget, {
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
        open: true,
        onOpenChange: () => undefined,
        onStop: () => undefined,
      }),
    );

    assert.match(html, /data-open="true"/);
    assert.match(html, /class="[^"]*relative h-full[^"]*shadow-lg/);
    assert.doesNotMatch(html, /absolute right-0 top-0 z-40 h-10/);
  });
});
