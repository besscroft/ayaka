import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ArtifactInstallation, CatalogItem, ToolRecord } from "@shared/types";
import { applyCatalogInstallation } from "./ToolsPanel";
import { filterToolRecords } from "../lib/tools-filter";
import {
  buildMcpInput,
  buildSkillInput,
  buildSkillInputFromMarkdown,
  parseSkillMarkdown,
} from "../lib/tools-form";

void describe("ToolsPanel data helpers", () => {
  void it("updates only the installed catalog item", () => {
    const items = [catalogItem("one"), catalogItem("two")];
    const installation = catalogInstallation("two");

    assert.deepEqual(applyCatalogInstallation(items, installation), [
      catalogItem("one"),
      { ...catalogItem("two"), installed: true, updateAvailable: false },
    ]);
  });

  void it("clears update state when reinstalling an existing catalog item", () => {
    const item = { ...catalogItem("one"), installed: true, updateAvailable: true };

    assert.deepEqual(applyCatalogInstallation([item], catalogInstallation("one")), [
      { ...item, installed: true, updateAvailable: false },
    ]);
  });

  void it("preserves the original list when the installation has no matching item", () => {
    const items = [catalogItem("one"), catalogItem("two")];

    assert.strictEqual(applyCatalogInstallation(items, catalogInstallation("missing")), items);
  });

  void it("filters tools by kind, approval state, enabled state, and search query", () => {
    const records = [
      toolRecord("builtin-time", "builtin", "current_time", "system", 1, 0),
      toolRecord("mcp-search", "mcp", "search", "web", 1, 1),
      toolRecord("skill-research", "skill", "research", "general", 0, 1),
      toolRecord("sandbox-command", "sandbox", "sandbox_run_command", "sandbox", 1, 1),
    ];

    assert.deepEqual(
      filterToolRecords(records, { kind: "mcp" }).map((tool) => tool.id),
      ["mcp-search"],
    );
    assert.deepEqual(
      filterToolRecords(records, { status: "enabled" }).map((tool) => tool.id),
      ["builtin-time", "mcp-search", "sandbox-command"],
    );
    assert.deepEqual(
      filterToolRecords(records, { status: "approval" }).map((tool) => tool.id),
      ["mcp-search", "skill-research"],
    );

    assert.deepEqual(
      filterToolRecords(
        [toolRecord("legacy-builtin", "builtin", "sandbox_run_command", "sandbox", 1, 1)],
        { status: "approval" },
      ),
      [],
    );
    assert.deepEqual(
      filterToolRecords(records, { query: "command" }).map((tool) => tool.id),
      ["sandbox-command"],
    );
  });

  void it("builds MCP server input for stdio and remote transports", () => {
    const stdioForm = {
      name: " Local files ",
      description: "File tools",
      transport: "stdio",
      enabled: true,
      auto_use: false,
      requires_approval: true,
      command: " npx ",
      args: '["-y","@modelcontextprotocol/server-filesystem"]',
      url: "",
      headers: "{}",
      env: '{"ROOT":"C:/tmp"}',
      cwd: " C:/tmp ",
    } as const;
    const stdio = buildMcpInput(stdioForm);

    assert.equal(stdio.name, "Local files");
    assert.equal(stdio.command, "npx");
    assert.equal(stdio.url, null);
    assert.equal(stdio.args, '["-y","@modelcontextprotocol/server-filesystem"]');
    assert.equal(stdio.env, '{"ROOT":"C:/tmp"}');

    const remote = buildMcpInput({
      ...stdioForm,
      transport: "http",
      command: "",
      url: " https://example.test/mcp ",
      headers: '{"Authorization":"Bearer ${API_KEY}"}',
    });

    assert.equal(remote.transport, "http");
    assert.equal(remote.command, null);
    assert.equal(remote.url, "https://example.test/mcp");
    assert.equal(remote.headers, '{"Authorization":"Bearer ${API_KEY}"}');
  });

  void it("parses MCP command lines, KEY=value maps, and timeout values", () => {
    const input = buildMcpInput({
      name: "Filesystem with long root",
      description: "",
      transport: "stdio",
      enabled: true,
      auto_use: false,
      requires_approval: true,
      commandLine: 'npx -y "@modelcontextprotocol/server-filesystem" "C:/Long Path"',
      command: "",
      args: "[]",
      url: "",
      headers: "",
      env: "ROOT=C:/Long Path\nTOKEN=${MCP_TOKEN}",
      cwd: "",
      timeoutSeconds: "45",
    });

    assert.equal(input.command, "npx");
    assert.equal(input.args, '["-y","@modelcontextprotocol/server-filesystem","C:/Long Path"]');
    assert.equal(input.env, '{"ROOT":"C:/Long Path","TOKEN":"${MCP_TOKEN}"}');
    assert.equal(input.timeout_seconds, 45);
  });

  void it("builds Skill input without executable steps", () => {
    const input = buildSkillInput({
      name: " Research brief ",
      description: "Summarize sources",
      category: "analysis",
      enabled: true,
      auto_use: true,
      requires_approval: false,
      triggerKeywords: '["research","brief"]',
      tags: '["docs"]',
      configSchema: '{"type":"object"}',
      config: '{"depth":"fast"}',
    });

    assert.equal(input.name, "Research brief");
    assert.equal(input.category, "analysis");
    assert.equal(input.config, '{"depth":"fast"}');
  });

  void it("rejects invalid MCP and Skill JSON fields", () => {
    assert.throws(
      () =>
        buildMcpInput({
          name: "Remote",
          description: "",
          transport: "http",
          enabled: true,
          auto_use: true,
          requires_approval: true,
          command: "",
          args: "[]",
          url: "https://example.test/mcp",
          headers: "{bad json",
          env: "{}",
          cwd: "",
        }),
      /headers must be a JSON object/,
    );

    assert.throws(
      () =>
        buildMcpInput({
          name: "Slow",
          description: "",
          transport: "stdio",
          enabled: true,
          auto_use: true,
          requires_approval: true,
          commandLine: "npx server",
          command: "",
          args: "[]",
          url: "",
          headers: "{}",
          env: "{}",
          cwd: "",
          timeoutSeconds: "0",
        }),
      /Timeout must be between 1 and 600 seconds/,
    );
  });

  void it("parses SKILL.md packages and converts them to install input", () => {
    const markdown = [
      "---",
      "name: research-brief",
      'description: "Use when a user needs a grounded research brief."',
      "---",
      "# Research Brief",
      "Collect sources and summarize the key tradeoffs.",
    ].join("\n");

    const draft = parseSkillMarkdown(markdown, "upload");
    assert.equal(draft.name, "research-brief");
    assert.equal(draft.description, "Use when a user needs a grounded research brief.");
    assert.match(draft.instructions, /Collect sources/);

    const input = buildSkillInputFromMarkdown(markdown, "upload");
    assert.equal(input.name, "research-brief");
    assert.equal(input.category, "skill");
    assert.deepEqual(input.tags, ["skill", "upload"]);
    assert.deepEqual(input.triggerKeywords, ["research-brief"]);
    assert.equal((input.config as Record<string, unknown>).source, "upload");
    assert.match(String(input.instructions), /tradeoffs/);
  });

  void it("rejects invalid SKILL.md packages", () => {
    assert.throws(
      () => parseSkillMarkdown("# Missing frontmatter\nBody", "upload"),
      /YAML frontmatter/,
    );
    assert.throws(
      () => parseSkillMarkdown("---\nname: missing-description\n---\nBody", "upload"),
      /description/,
    );
    assert.throws(
      () => parseSkillMarkdown("---\nname: empty\ndescription: Empty\n---\n", "ai"),
      /body cannot be empty/,
    );
  });
});

function catalogItem(id: string): CatalogItem {
  return {
    id,
    sourceId: "source-1",
    sourceKind: "skills-sh",
    sourceLabel: "skills.sh",
    artifactType: "skill",
    externalId: id,
    canonicalKey: null,
    name: id,
    description: "",
    version: "1.0.0",
    installUrl: null,
    catalogUrl: null,
    metrics: {},
    detail: {},
    contentHash: "hash-1",
    cachedAt: 1,
    installed: false,
    updateAvailable: false,
  };
}

function catalogInstallation(itemId: string): ArtifactInstallation {
  return {
    id: `installation-${itemId}`,
    itemId,
    sourceId: "source-1",
    artifactType: "skill",
    name: itemId,
    version: "1.0.0",
    contentHash: "hash-1",
    installPath: null,
    status: "disabled",
    safety: {},
    config: {},
    toolServerId: null,
    skillId: `skill-${itemId}`,
    lastError: null,
    installedAt: 1,
    updatedAt: 1,
  };
}

function toolRecord(
  id: string,
  kind: ToolRecord["kind"],
  name: string,
  category: string,
  enabled: number,
  requiresApproval: number,
): ToolRecord {
  const now = Date.now();
  return {
    id,
    server_id: kind === "mcp" ? "server-1" : null,
    name,
    title: name,
    description: `${name} ${category}`,
    instructions: kind === "skill" ? "Follow the skill instructions." : "",
    kind,
    category,
    reference: name,
    input_schema_json: "{}",
    output_schema_json: "{}",
    config_json: "{}",
    trigger_keywords_json: "[]",
    tags_json: "[]",
    enabled,
    auto_use: 1,
    requires_approval: requiresApproval,
    discovered_at: now,
    last_run_at: null,
    updated_at: now,
    deleted_at: null,
    purge_after_at: null,
  };
}
