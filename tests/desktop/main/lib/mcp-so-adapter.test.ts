import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMcpSoDetailUrl,
  filterMcpSoItems,
  parseMcpSoDetailHtml,
  parseMcpSoListHtml,
} from "@desktop-main/lib/mcp-so-adapter";

void test("uses the canonical server route for remote server details", () => {
  assert.equal(
    buildMcpSoDetailUrl("remote:adwhispr-research-clone-launch-ads-from-claude-chatgpt"),
    "https://mcp.so/zh/servers/adwhispr-research-clone-launch-ads-from-claude-chatgpt",
  );
});

const listFixture = `
  <main>
    <a href="/zh/servers/github">
      <h3>GitHub</h3><p>@octocat</p><p>Repository tools</p>
      <span>Developer tools</span><span>12.3K</span>
      <a href="/zh/tags/featured">featured</a>
    </a>
    <a href="/zh/servers/notion">
      <h3>Notion</h3><p>@notion</p><p>Workspace tools</p>
      <span>Productivity</span><span>842</span>
    </a>
    <a href="/zh/categories/developer?category=Developer"><span>Developer</span> 2</a>
    <a href="?page=2">Next</a>
  </main>`;

void test("parses mcp.so SSR list metadata and facets", () => {
  const result = parseMcpSoListHtml(listFixture);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.externalId, "server:github");
  assert.equal(result.items[0]?.artifactType, "mcp");
  assert.equal(result.items[0]?.detail.featured, false);
  assert.equal(result.items[0]?.detail.author, "@octocat");
  assert.equal(result.hasMore, true);
  assert.equal(result.facets.categories[0]?.id, "Developer");
});

void test("filters search results by MCP name only", () => {
  const result = parseMcpSoListHtml(listFixture);
  const matches = filterMcpSoItems(result.items, "GITHUB");
  assert.deepEqual(
    matches.map((item) => item.name),
    ["GitHub"],
  );
  assert.deepEqual(filterMcpSoItems(result.items, "repository"), []);
});

void test("keeps remote server identities from search results", () => {
  const result = parseMcpSoListHtml(
    `<main><a href="/zh/remote-servers/browser"><h3>Browser</h3><p>@author</p></a></main>`,
    "server",
  );
  assert.equal(result.items[0]?.externalId, "remote:browser");
});

void test("parses stdio MCP configuration and redacts secrets", () => {
  const result = parseMcpSoDetailHtml(
    `<main><h1>GitHub</h1><p>@octocat</p><p>Repository tools</p>
      <code>{"mcpServers":{"github":{"command":"npx","args":["-y","github-mcp"],"env":{"GITHUB_TOKEN":"plain","MODE":"safe"}}}}</code>
      <h2>Tools</h2><h3>search_repositories</h3><p>Search repositories</p></main>`,
    "server:github",
    "https://mcp.so/zh/servers/github",
  );
  assert.equal(result.detail.parseStatus, "ready");
  assert.equal(result.detail.config.transport, "stdio");
  assert.equal(result.detail.config.env.GITHUB_TOKEN, "$secret:GITHUB_TOKEN");
  assert.deepEqual(result.detail.config.secretKeys, ["GITHUB_TOKEN"]);
  assert.equal(result.detail.tools[0]?.name, "search_repositories");
});

void test("parses HTTP and SSE remote configuration", () => {
  const http = parseMcpSoDetailHtml(
    `<main><h1>Remote HTTP</h1><p>@author</p><code>{"mcpServers":{"remote":{"url":"https://example.com/mcp","transport":"http","headers":{"Authorization":"token"}}}}</code></main>`,
    "remote:http-server",
    "https://mcp.so/zh/remote-servers/http-server",
  );
  const sse = parseMcpSoDetailHtml(
    `<main><h1>Remote SSE</h1><p>@author</p><code>{"mcpServers":{"remote":{"url":"https://example.com/sse","transport":"sse"}}}</code></main>`,
    "remote:sse-server",
    "https://mcp.so/zh/remote-servers/sse-server",
  );
  assert.equal(http.detail.config.transport, "http");
  assert.equal(http.detail.config.headers.Authorization, "$secret:Authorization");
  assert.equal(sse.detail.config.transport, "sse");
});

void test("marks insecure and unknown transports for review", () => {
  const insecure = parseMcpSoDetailHtml(
    `<main><h1>Insecure</h1><code>{"mcpServers":{"remote":{"url":"http://example.com/mcp","transport":"http"}}}</code></main>`,
    "remote:insecure",
    "https://mcp.so/zh/remote-servers/insecure",
  );
  const unknown = parseMcpSoDetailHtml(
    `<main><h1>Unknown</h1><code>{"mcpServers":{"remote":{"url":"https://example.com/mcp","transport":"websocket"}}}</code></main>`,
    "remote:unknown",
    "https://mcp.so/zh/remote-servers/unknown",
  );
  assert.equal(insecure.detail.parseStatus, "partial");
  assert.match(insecure.detail.warnings.join(" "), /HTTPS/);
  assert.equal(unknown.detail.parseStatus, "partial");
  assert.match(unknown.detail.warnings.join(" "), /Unknown/);
});

void test("reports missing standard configuration", () => {
  const result = parseMcpSoDetailHtml(
    `<main><h1>Manual only</h1><p>No config here</p></main>`,
    "server:manual-only",
    "https://mcp.so/zh/servers/manual-only",
  );
  assert.equal(result.detail.parseStatus, "unsupported");
  assert.equal(result.detail.config.command, null);
  assert.match(result.detail.warnings.join(" "), /standard MCP JSON/);
});
