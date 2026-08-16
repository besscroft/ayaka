import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isMcpOAuthTransport, type ToolServer } from "@shared/types";
import { McpWorkspace } from "@renderer/components/McpWorkspace";

void describe("MCP workspace", () => {
  void it("renders the server list beside the capability workspace", () => {
    const html = renderToStaticMarkup(
      <McpWorkspace
        servers={[server()]}
        toolsByServer={new Map()}
        busy={false}
        discoveringServerIds={new Set()}
        onRefresh={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onToggle={() => undefined}
      />,
    );

    assert.match(html, /lg:grid-cols-\[250px_minmax\(0,1fr\)\]/);
    assert.match(html, />Weather MCP</);
    assert.match(html, />概览</);
    assert.match(html, />工具发现</);
    assert.match(html, />资源</);
    assert.match(html, />提示词</);
  });

  void it("only enables OAuth for remote transports", () => {
    assert.equal(isMcpOAuthTransport("stdio"), false);
    assert.equal(isMcpOAuthTransport("http"), true);
    assert.equal(isMcpOAuthTransport("sse"), true);
  });
});

function server(): ToolServer {
  return {
    id: "server-weather",
    name: "Weather MCP",
    description: "Weather tools",
    kind: "mcp",
    transport: "http",
    enabled: 1,
    auto_use: 0,
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
    last_connected_at: null,
    created_at: 0,
    updated_at: 0,
    deleted_at: null,
    purge_after_at: null,
  };
}
