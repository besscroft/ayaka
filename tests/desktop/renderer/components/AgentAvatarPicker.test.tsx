import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AGENT_AVATAR_IDS } from "@shared/agent-avatar";
import { AgentAvatarPicker } from "@renderer/components/AgentAvatarPicker";
import { AGENT_AVATAR_ASSETS } from "@renderer/lib/agent-avatar-assets";

void describe("AgentAvatarPicker", () => {
  void it("renders every shared SVG asset and the selected preview", () => {
    const html = renderToStaticMarkup(
      <AgentAvatarPicker value="bloub-cercle-surpris-bleu-anime" onChange={() => undefined} />,
    );

    assert.deepEqual(
      AGENT_AVATAR_ASSETS.map((asset) => asset.id),
      AGENT_AVATAR_IDS,
    );
    assert.match(html, /bloub-cercle-surpris-bleu-anime\.svg/);
  });
});
