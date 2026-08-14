import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeRun, RuntimeStep } from "@shared/types";
import {
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
});
