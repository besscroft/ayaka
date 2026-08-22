import assert from "node:assert/strict";
import test from "node:test";
import { parseMcpConfigText, prepareImportedConfig } from "@desktop-main/lib/mcp-config-manager";

test("parses Claude JSON and warns about unsupported fields", () => {
  const result = parseMcpConfigText(
    "claude-json",
    JSON.stringify({
      mcpServers: {
        weather: {
          command: "npx",
          args: ["-y", "weather-mcp"],
          env: { WEATHER_TOKEN: "secret-value" },
          customField: true,
        },
      },
      metadata: { source: "test" },
    }),
  );

  assert.equal(result.configs[0]?.name, "weather");
  assert.equal(result.configs[0]?.transport, "stdio");
  assert.ok(result.warnings.some((warning) => warning.includes("customField")));
  assert.ok(result.warnings.some((warning) => warning.includes("metadata")));
});

test("parses the supported Codex TOML MCP subset", () => {
  const result = parseMcpConfigText(
    "codex-toml",
    [
      '[mcp_servers."filesystem"]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-filesystem"]',
      'env = { API_TOKEN = "$secret:API_TOKEN" }',
      "tool_timeout_sec = 45",
    ].join("\n"),
  );

  assert.equal(result.configs[0]?.name, "filesystem");
  assert.equal(result.configs[0]?.timeoutSeconds, 45);
  assert.equal(result.configs[0]?.env?.API_TOKEN, "$secret:API_TOKEN");
});

test("redacts imported sensitive values into encrypted-secret references", () => {
  const prepared = prepareImportedConfig({
    name: "secure",
    transport: "http",
    url: "https://example.com/mcp",
    env: { API_TOKEN: "env-secret" },
    headers: { Authorization: "header-secret" },
  });

  assert.equal(prepared.input.env?.API_TOKEN, "$secret:env_API_TOKEN");
  assert.equal(prepared.input.headers?.Authorization, "$secret:header_Authorization");
  assert.deepEqual(prepared.secrets, {
    env_API_TOKEN: "env-secret",
    header_Authorization: "header-secret",
  });
});
