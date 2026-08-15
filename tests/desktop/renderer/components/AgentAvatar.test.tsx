import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AgentProfile } from "@shared/types";
import { AgentAvatar } from "@renderer/components/AgentAvatar";

function makeAgent(kind: AgentProfile["kind"], avatar: string): AgentProfile {
  return {
    id: kind === "main" ? "agent-ayaka" : "agent-child",
    name: kind === "main" ? "Ayaka" : "Fairy",
    role: "Test agent",
    instructions: "",
    persona: "",
    description: "",
    personality: "",
    soul_prompt: "",
    avatar,
    status: "active",
    kind,
    parent_agent_id: kind === "main" ? null : "agent-ayaka",
    locked: kind === "main" ? 1 : 0,
    enabled: 1,
    tool_policy_json: "{}",
    handoff_config_json: "{}",
    runtime_config_json: "{}",
    model_ref: null,
    voice: null,
    created_at: 0,
    updated_at: 0,
  };
}

void describe("AgentAvatar", () => {
  void it("renders the shared image for the main agent", () => {
    const html = renderToStaticMarkup(
      <AgentAvatar profile={makeAgent("main", "P")} className="size-8" />,
    );

    assert.match(html, /<img /);
    assert.match(html, /alt=""/);
  });

  void it("keeps child agent avatars as text", () => {
    const html = renderToStaticMarkup(
      <AgentAvatar profile={makeAgent("child", "F")} className="size-8" />,
    );

    assert.doesNotMatch(html, /<img /);
    assert.match(html, />F<\/span>/);
  });
});
