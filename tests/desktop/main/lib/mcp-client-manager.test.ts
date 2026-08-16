import assert from "node:assert/strict";
import test from "node:test";
import { redactMcpError, validateMcpUrl } from "@desktop-main/lib/mcp-client-manager";

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
