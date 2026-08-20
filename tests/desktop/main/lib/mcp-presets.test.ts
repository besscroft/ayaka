import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_PRESETS,
  searchMcpPresets,
  searchMcpPresetDefinitions,
  toMcpPresetCatalogItem,
  validateMcpPresetDefinition,
} from "@desktop-main/lib/mcp-presets";

test("ships an explicit empty MCP preset list until presets are reviewed", () => {
  assert.deepEqual(MCP_PRESETS, []);
  const result = searchMcpPresets({ page: 1, pageSize: 24 });
  assert.deepEqual(result.items, []);
  assert.equal(result.hasMore, false);
});

test("validates stdio and remote preset boundaries", () => {
  assert.doesNotThrow(() =>
    validateMcpPresetDefinition({
      id: "filesystem",
      name: "Filesystem",
      description: "Local file access",
      version: "1.0.0",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/filesystem"],
      env: { ROOT: "$secret:ROOT" },
      secretKeys: ["ROOT"],
    }),
  );
  assert.doesNotThrow(() =>
    validateMcpPresetDefinition({
      id: "remote",
      name: "Remote",
      description: "Remote MCP",
      version: "1.0.0",
      transport: "http",
      url: "https://example.test/mcp",
    }),
  );
  assert.throws(
    () =>
      validateMcpPresetDefinition({
        id: "insecure",
        name: "Insecure",
        description: "Public HTTP",
        version: "1.0.0",
        transport: "http",
        url: "http://example.test/mcp",
      }),
    /HTTPS or loopback HTTP/,
  );
  assert.throws(
    () =>
      validateMcpPresetDefinition({
        id: "missing-secret",
        name: "Missing secret",
        description: "Invalid secret reference",
        version: "1.0.0",
        transport: "stdio",
        command: "node",
        env: { TOKEN: "$secret:TOKEN" },
      }),
    /undeclared secret/,
  );
  assert.throws(
    () =>
      validateMcpPresetDefinition({
        id: "literal-token",
        name: "Literal token",
        description: "Secrets must not ship in source",
        version: "1.0.0",
        transport: "stdio",
        command: "node",
        env: { API_TOKEN: "real-value" },
      }),
    /must reference secret/,
  );
});

test("keeps preset IDs stable while updating metadata and supports local filters", () => {
  const first = {
    id: "docs-server",
    name: "Docs Server",
    description: "Search documentation",
    version: "1.0.0",
    transport: "stdio" as const,
    command: "node",
    category: "research",
    tags: ["docs", "local"],
    featured: true,
  };
  const updated = { ...first, version: "1.1.0", description: "Search and summarize documentation" };
  const firstItem = toMcpPresetCatalogItem(first);
  const repeatedItem = toMcpPresetCatalogItem(first);
  const updatedItem = toMcpPresetCatalogItem(updated);

  assert.equal(firstItem.externalId, repeatedItem.externalId);
  assert.equal(firstItem.contentHash, repeatedItem.contentHash);
  assert.equal(firstItem.externalId, updatedItem.externalId);
  assert.notEqual(firstItem.contentHash, updatedItem.contentHash);

  const result = searchMcpPresetDefinitions(
    [first, { ...first, id: "other", name: "Other", description: "Other service" }],
    { query: "documentation", category: "research", tag: "featured" },
  );
  assert.deepEqual(
    result.items.map((item) => item.externalId),
    ["docs-server"],
  );
  const detail = result.items[0]?.detail.mcp as { config: { command: string | null } };
  assert.equal(detail.config.command, "node");

  const categoryQuery = searchMcpPresetDefinitions([first], { query: "research" });
  assert.deepEqual(
    categoryQuery.items.map((item) => item.externalId),
    ["docs-server"],
  );
});
