import React from "react";
void React;
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { isMcpOAuthTransport, type ToolServer } from "@shared/types";
import { McpWorkspace } from "@renderer/components/McpWorkspace";
import { getMcpErrorMessage } from "@renderer/lib/mcp-errors";

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
    assert.match(html, /lg:grid-rows-\[minmax\(0,1fr\)\]/);
    assert.match(html, /class="[^\"]*h-full min-h-0 overflow-hidden"/);
    assert.match(html, />Weather MCP</);
    assert.match(html, />概览</);
    assert.match(html, /尚未读取服务器能力，请先点击刷新/);
    assert.match(html, />工具发现</);
    assert.doesNotMatch(html, />资源</);
    assert.match(html, />提示词</);
  });

  void it("only enables OAuth for remote transports", () => {
    assert.equal(isMcpOAuthTransport("stdio"), false);
    assert.equal(isMcpOAuthTransport("http"), true);
    assert.equal(isMcpOAuthTransport("sse"), true);
  });

  void it("renders missing stdio runtime errors inside the workspace", () => {
    const html = renderToStaticMarkup(
      <McpWorkspace
        servers={[
          {
            ...server(),
            transport: "stdio",
            command: "uvx",
            status: "error",
            last_error: 'MCP command "uvx" was not found. Install it and ensure it is on PATH.',
          },
        ]}
        toolsByServer={new Map()}
        busy={false}
        discoveringServerIds={new Set()}
        onRefresh={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onToggle={() => undefined}
      />,
    );

    assert.match(html, /role="alert"/);
    assert.match(html, /uvx/);
    assert.doesNotMatch(html, /spawn uvx ENOENT/);
    assert.match(getMcpErrorMessage('MCP command "uvx" was not found.', "en"), /PATH/);
    assert.doesNotMatch(
      getMcpErrorMessage(
        "Error invoking remote method 'mcp:capabilities': Error: Connection closed (MCP server stderr: uvx 中文)",
        "zh-CN",
      ),
      /Error invoking remote method/,
    );
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
