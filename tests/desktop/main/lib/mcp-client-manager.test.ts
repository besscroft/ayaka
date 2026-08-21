import assert from "node:assert/strict";
import test from "node:test";
import type { ToolServer } from "@shared/types";
import {
  decodeMcpStderr,
  redactMcpError,
  validateMcpUrl,
} from "@desktop-main/lib/mcp-client-manager";

void test("allows HTTPS and loopback HTTP MCP endpoints", () => {
  assert.equal(validateMcpUrl("https://example.com/mcp").protocol, "https:");
  assert.equal(validateMcpUrl("http://localhost:3000/mcp").hostname, "localhost");
  assert.equal(validateMcpUrl("http://127.0.0.1:3000/mcp").hostname, "127.0.0.1");
  assert.equal(validateMcpUrl("http://[::1]:3000/mcp").hostname, "[::1]");
});

void test("rejects public HTTP MCP endpoints", () => {
  assert.throws(() => validateMcpUrl("http://example.com/mcp"), /HTTPS/);
  assert.throws(() => validateMcpUrl("ftp://example.com/mcp"), /HTTPS/);
});

void test("redacts authorization details from MCP errors", () => {
  assert.equal(
    redactMcpError(new Error("authorization: Bearer secret-value")),
    "authorization: Bearer [REDACTED]",
  );
});

void test("turns a missing stdio executable into an actionable error", () => {
  const error = Object.assign(new Error("spawn uvx ENOENT"), { code: "ENOENT" });
  const server = { transport: "stdio", command: "uvx" } as ToolServer;
  const message = redactMcpError(error, server);

  assert.match(message, /MCP command "uvx" was not found/);
  assert.match(message, /PATH/);
  assert.match(message, /restart Ayaka/);
  assert.doesNotMatch(message, /spawn uvx ENOENT/);
});

void test("decodes Windows Chinese MCP stderr when it is not UTF-8", () => {
  const bytes = Buffer.from([0x75, 0x76, 0x78, 0x20, 0xd6, 0xd0, 0xce, 0xc4]);
  assert.equal(decodeMcpStderr(bytes), "uvx 中文");
});
