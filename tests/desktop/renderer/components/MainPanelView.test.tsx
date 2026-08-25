import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentMemoryFileSnapshot, AgentProfile } from "@shared/types";
import { MemoryFilePanel } from "@renderer/components/MainPanelView";

const snapshot: AgentMemoryFileSnapshot = {
  kind: "soul",
  content: "# SOUL\n\n**Important**",
  charLimit: 4_000,
  charCount: 21,
  updatedAt: 0,
};

const agents: AgentProfile[] = [
  {
    id: "agent-root",
    name: "Fairy",
    role: "Main agent",
    instructions: "",
    persona: "",
    description: "",
    personality: "",
    soul_prompt: "",
    avatar: "F",
    status: "active",
    kind: "main",
    parent_agent_id: null,
    locked: 1,
    enabled: 1,
    tool_policy_json: "{}",
    handoff_config_json: "{}",
    runtime_config_json: "{}",
    model_ref: null,
    voice: null,
    created_at: 0,
    updated_at: 0,
  },
];

void describe("MemoryFilePanel agent selector", () => {
  void it("renders memory file content as Markdown in view mode", () => {
    const html = renderPanel("user");

    assert.match(html, /data-slot="rich-content"/);
    assert.match(html, /<h1[^>]*>SOUL<\/h1>/);
    assert.match(html, /<strong[^>]*>Important<\/strong>/);
    assert.doesNotMatch(html, /data-slot="code-surface"/);
  });

  void it("renders the current agent selector in the Soul file header", () => {
    const html = renderPanel("soul");

    assert.match(html, /aria-label="智能体"/);
    assert.match(html, /data-slot="select-value"[^>]*>Fairy</);
    assert.doesNotMatch(html, /data-slot="select-value"[^>]*>agent-root</);
  });

  void it("does not render the agent selector for other memory files", () => {
    const html = renderPanel("user");

    assert.doesNotMatch(html, /aria-label="智能体"/);
  });

  void it("disables the Soul selector when no agents are available", () => {
    const html = renderPanel("soul", []);

    assert.match(html, /aria-label="智能体"[^>]*disabled/);
  });
});

function renderPanel(
  kind: AgentMemoryFileSnapshot["kind"],
  availableAgents: AgentProfile[] = agents,
): string {
  return renderToStaticMarkup(
    <MemoryFilePanel
      kind={kind}
      snapshot={{ ...snapshot, kind }}
      onRefresh={() => undefined}
      agentId="agent-root"
      agents={availableAgents}
      onAgentChange={() => undefined}
    />,
  );
}
