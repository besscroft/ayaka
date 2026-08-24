import assert from "node:assert/strict";
import test from "node:test";
import {
  getUvxToolInstallArgs,
  normalizeUvxArgs,
  parseNpxPackages,
  parseUvxPackages,
  parseMcpCommand,
} from "@desktop-main/lib/mcp-command";

test("parses safe npx package forms", () => {
  assert.deepEqual(parseNpxPackages(["-y", "-p", "foo@1.0.0", "server"]), ["foo@1.0.0"]);
  assert.deepEqual(parseNpxPackages(["--package=foo", "server"]), ["foo"]);
  assert.deepEqual(parseNpxPackages(["--", "server"]), ["server"]);
});

test("parses uvx dependency flags", () => {
  assert.deepEqual(parseUvxPackages(["--from", "pkg==1.0", "server"]), ["pkg==1.0"]);
  assert.deepEqual(parseUvxPackages(["--with=extra", "server"]), ["extra", "server"]);
  assert.deepEqual(getUvxToolInstallArgs(["--with=extra", "server"]), [
    "--with",
    "extra",
    "server",
  ]);
});

test("constrains the legacy SQLite MCP server to MCP v1", () => {
  const args = ["mcp-server-sqlite==2025.4.25", "--db-path", "database.db"];
  const normalized = normalizeUvxArgs(args);

  assert.deepEqual(normalized, ["--with", "mcp<2", ...args]);
  assert.deepEqual(getUvxToolInstallArgs(args), [
    "--with",
    "mcp<2",
    "mcp-server-sqlite==2025.4.25",
  ]);
  assert.deepEqual(getUvxToolInstallArgs(normalized), [
    "--with",
    "mcp<2",
    "mcp-server-sqlite==2025.4.25",
  ]);
});

test("leaves unrelated commands unchanged", () => {
  const parsed = parseMcpCommand("python", ["server.py"]);
  assert.equal(parsed.manager, "none");
  assert.equal(parsed.resolvedCommand, "python");
  assert.deepEqual(parsed.resolvedArgs, ["server.py"]);
  assert.equal(parsed.canInstall, false);
});

test("does not reinterpret unknown npx or uvx flags", () => {
  assert.deepEqual(parseNpxPackages(["--prefix", "C:/other", "server"]), []);
  assert.deepEqual(parseUvxPackages(["--custom-shell", "server"]), []);
  const parsed = parseMcpCommand("npx", ["--custom-shell", "server"]);
  assert.equal(parsed.resolvedCommand, "npx");
  assert.deepEqual(parsed.resolvedArgs, ["--custom-shell", "server"]);
  assert.equal(parsed.installStatus, "needs_confirmation");
});
