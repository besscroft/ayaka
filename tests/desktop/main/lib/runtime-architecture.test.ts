import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_TOOL_IDS,
  MEDIA_GENERATION_TOOL_NAME,
  type AgentProfile,
  type ModelCapabilities,
} from "@shared/types";
import { isRoutableAgent } from "@desktop-main/lib/agent-routing";
import { commandLooksDangerous, inputHasPathEscape } from "@desktop-main/lib/approval-policy";
import {
  DEFAULT_BUILTIN_TOOL_SEEDS,
  DEFAULT_CHILD_AGENT_SEEDS,
  DEFAULT_ROOT_AGENT_SEED,
} from "@desktop-main/lib/runtime-defaults";
import { DEFAULT_AGENT_AVATAR_ID } from "@shared/agent-avatar";
import { getSandboxSessionOrThrow } from "@desktop-main/lib/sandbox-runtime";
import { buildToolRegistryPreview } from "@desktop-main/lib/tool-registry";
import { ROOT_AGENT_STOP_WHEN } from "@desktop-main/lib/agent-run-policy";
import { rootToolRequiresApproval } from "@desktop-main/lib/root-tool-approval";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

void describe("runtime architecture", () => {
  void it("generates a single initial schema migration with runtime event storage", () => {
    const migration = readFileSync(path.join(process.cwd(), "drizzle", "0000_initial.sql"), "utf8");

    assert.match(migration, /CREATE TABLE `runtime_runs`/);
    assert.match(migration, /CREATE TABLE `runtime_steps`/);
    assert.match(migration, /CREATE TABLE `runtime_events`/);
    assert.match(migration, /`content_json` text NOT NULL/);
    assert.match(migration, /`metadata_json` text DEFAULT '\{\}' NOT NULL/);
    assert.equal(migration.toLowerCase().includes("harn" + "ess"), false);
    for (const legacyName of [
      ["agent", "runs"],
      ["agent", "run", "steps"],
      ["mcp", "servers"],
      ["mcp", "tools"],
      ["server", "nodes"],
      ["sync", "state"],
    ].map((parts) => parts.join("_"))) {
      assert.equal(migration.includes(legacyName), false);
    }
  });

  void it("includes the complete current runtime schema in the initial migration", () => {
    const migration = readFileSync(path.join(process.cwd(), "drizzle", "0000_initial.sql"), "utf8");

    assert.match(migration, /CREATE TABLE `agent_instances`/);
    assert.match(migration, /CREATE TABLE `agent_collaboration_messages`/);
    assert.match(migration, /CREATE TABLE `agent_context_checkpoints`/);
    assert.match(migration, /CREATE TABLE `memory_jobs`/);
    assert.match(migration, /`event_type` text/);
    assert.match(migration, /`agent_path` text/);
    assert.equal(migration.includes("ALTER TABLE"), false);
  });

  void it("keeps the greenfield database history ordered and explicit", () => {
    const migrations = readdirSync(path.join(process.cwd(), "drizzle")).filter((file) =>
      file.endsWith(".sql"),
    );
    assert.deepEqual(migrations, [
      "0000_initial.sql",
      "0001_romantic_blob.sql",
      "0002_remove_desktop_pet.sql",
      "0003_remove_mcp_marketplace.sql",
      "0004_deep_the_spike.sql",
      "0005_rare_prodigy.sql",
      "0006_lazy_hitman.sql",
      "0007_military_white_queen.sql",
      "0008_dapper_captain_midlands.sql",
      "0009_chubby_doctor_spectrum.sql",
    ]);
  });

  void it("adds MCP runtime state without deleting existing configuration", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle", "0004_deep_the_spike.sql"),
      "utf8",
    );
    assert.match(migration, /CREATE TABLE `managed_runtimes`/);
    assert.match(migration, /CREATE TABLE `runtime_preferences`/);
    assert.match(migration, /CREATE TABLE `mcp_runtime_states`/);
    assert.match(migration, /CREATE TABLE `mcp_dependency_installations`/);
    assert.match(migration, /ALTER TABLE `tool_servers` ADD `config_source`/);
    assert.match(migration, /ALTER TABLE `tool_servers` ADD `config_version`/);
    assert.match(migration, /UPDATE `tool_servers`/);
    assert.match(migration, /SET `enabled` = 0, `status` = 'disabled'/);
    assert.doesNotMatch(migration, /DELETE FROM `tool_servers`/);
    assert.doesNotMatch(migration, /DELETE FROM `tool_secrets`/);
  });

  void it("adds uv target identity and verified command metadata without replacing runtimes", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle", "0005_rare_prodigy.sql"),
      "utf8",
    );
    assert.match(migration, /ALTER TABLE `managed_runtimes` ADD `libc`/);
    assert.match(migration, /ALTER TABLE `managed_runtimes` ADD `verified_commands_json`/);
    assert.match(migration, /idx_managed_runtimes_identity/);
    assert.doesNotMatch(migration, /DELETE FROM `managed_runtimes`/);
  });

  void it("adds bounded generated artifact metadata", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle", "0006_lazy_hitman.sql"),
      "utf8",
    );
    assert.match(migration, /ALTER TABLE `sandbox_artifacts` ADD `entry_path`/);
    assert.match(migration, /ALTER TABLE `sandbox_artifacts` ADD `mime_type`/);
    assert.match(migration, /ALTER TABLE `sandbox_artifacts` ADD `sha256`/);
    assert.match(migration, /ALTER TABLE `sandbox_artifacts` ADD `status`/);
    assert.match(migration, /ALTER TABLE `sandbox_artifacts` ADD `updated_at`/);
  });

  void it("removes the retired MCP catalog while preserving installed MCP state", () => {
    const migration = readFileSync(
      path.join(process.cwd(), "drizzle", "0003_remove_mcp_marketplace.sql"),
      "utf8",
    );
    assert.match(migration, /UPDATE [`"]artifact_installations[`"]?/);
    assert.match(migration, /SET [`"]item_id[`"]? = NULL, [`"]source_id[`"]? = NULL/);
    assert.match(migration, /WHERE [`"]source_id[`"]? = 'catalog-mcp-so'/);
    assert.match(
      migration,
      /SELECT [`"]id[`"]? FROM [`"]catalog_items[`"]? WHERE [`"]source_id[`"]? = 'catalog-mcp-so'/,
    );
    assert.match(
      migration,
      /DELETE FROM [`"]catalog_items[`"]? WHERE [`"]source_id[`"]? = 'catalog-mcp-so'/,
    );
    assert.match(
      migration,
      /DELETE FROM [`"]catalog_sources[`"]? WHERE [`"]id[`"]? = 'catalog-mcp-so'/,
    );
    assert.doesNotMatch(
      migration,
      /DELETE FROM [`"]tool_servers[`"]?|DELETE FROM [`"]tool_secrets[`"]?/,
    );
  });

  void it("defines default seed data for agents and tools", () => {
    assert.equal(DEFAULT_ROOT_AGENT_SEED.name, "Ayaka");
    assert.ok(DEFAULT_ROOT_AGENT_SEED.description.trim().length > 0);
    const researcher = DEFAULT_CHILD_AGENT_SEEDS.find((agent) => agent.id === "agent-researcher");
    assert.equal(researcher?.name, "Fairy");
    assert.equal(researcher?.avatar, DEFAULT_AGENT_AVATAR_ID);
    assert.ok(researcher?.description.trim().length > 0);
    /*
      //
      DEFAULT_CHILD_AGENT_SEEDS.some(
        (agent) =>
          agent.id === "agent-researcher" &&
          agent.name === "Fairy" &&
          agent.description === "Ⅲ型总序式集成泛用人工智能，开发代号Fairy",
      ),
      true); */
    assert.equal(
      DEFAULT_CHILD_AGENT_SEEDS.some((agent) => agent.id === "agent-operator"),
      false,
    );
    assert.ok(DEFAULT_BUILTIN_TOOL_SEEDS.some((tool) => tool.id === "runtime_snapshot"));
    assert.ok(DEFAULT_BUILTIN_TOOL_SEEDS.some((tool) => tool.id === "sandbox_run_command"));
    assert.ok(
      DEFAULT_BUILTIN_TOOL_SEEDS.filter(
        (tool) => !["workspace_run_command", "sandbox_start_preview"].includes(tool.id),
      ).every((tool) => tool.requiresApproval === 0),
    );
    assert.equal(
      DEFAULT_BUILTIN_TOOL_SEEDS.find((tool) => tool.id === "workspace_run_command")
        ?.requiresApproval,
      1,
    );
    assert.equal(
      DEFAULT_BUILTIN_TOOL_SEEDS.find((tool) => tool.id === "sandbox_start_preview")
        ?.requiresApproval,
      1,
    );
    assert.equal(
      DEFAULT_BUILTIN_TOOL_SEEDS.find((tool) => tool.id === "workspace_run_command")?.defaultAuto,
      1,
    );
    assert.equal(
      DEFAULT_BUILTIN_TOOL_SEEDS.find((tool) => tool.id === "sandbox_run_command")?.defaultAuto,
      1,
    );
    assert.ok(
      DEFAULT_BUILTIN_TOOL_SEEDS.some((tool) => tool.id === "cron" && tool.defaultAuto === 1),
    );
  });

  void it("routes only active, unlocked, enabled child agents", () => {
    const base = {
      id: "agent-test",
      name: "Test",
      role: "Test",
      description: "",
      avatar: "T",
      model_ref: null,
      voice: null,
      created_at: 0,
      updated_at: 0,
      personality: "",
      soul_prompt: "",
      instructions: "",
      persona: "",
      runtime_config_json: "{}",
      tool_policy_json: "{}",
      handoff_config_json: "{}",
    } satisfies Omit<AgentProfile, "kind" | "status" | "locked" | "enabled" | "parent_agent_id">;

    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "active",
        locked: 0,
        enabled: 1,
      }),
      true,
    );
    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "archived",
        locked: 0,
        enabled: 1,
      }),
      false,
    );
    assert.equal(
      isRoutableAgent({
        ...base,
        kind: "child",
        status: "active",
        locked: 1,
        enabled: 1,
      }),
      false,
    );
  });

  void it("builds the tool registry for runtime execution", () => {
    const runtime = buildToolRegistryPreview({
      selection: { mode: "auto", selectedToolIds: [] },
      model: {
        providerId: "test",
        providerKind: "openai-compatible",
        modelId: "model",
        capabilities,
        nativeTools: [],
      },
    });

    assert.equal(runtime.toolChoice, "auto");
    assert.ok(runtime.activeTools?.includes("web_open"));
    assert.ok(runtime.activeTools?.includes("runtime_snapshot"));
    assert.ok(runtime.activeTools?.includes("sandbox_run_command"));
    assert.ok(runtime.activeTools?.includes("cron"));
    assert.equal(runtime.activeTools?.includes("browser_screenshot"), false);

    const visionRuntime = buildToolRegistryPreview({
      selection: { mode: "auto", selectedToolIds: [] },
      model: {
        providerId: "test",
        providerKind: "openai-compatible",
        modelId: "model",
        capabilities: { ...capabilities, vision: true },
        nativeTools: [],
      },
    });
    assert.ok(visionRuntime.activeTools?.includes("browser_screenshot"));
  });

  void it("classifies approval and sandbox policy risks", () => {
    assert.equal(inputHasPathEscape({ path: "../outside.txt" }), true);
    assert.equal(commandLooksDangerous({ command: "npm", args: ["install"] }), true);
    assert.equal(commandLooksDangerous({ command: "node", args: ["--version"] }), false);
  });

  void it("keeps built-in root tools approval-free and preserves dynamic approvals", () => {
    assert.equal((CHAT_TOOL_IDS as readonly string[]).includes(MEDIA_GENERATION_TOOL_NAME), false);
    for (const toolName of [
      ...CHAT_TOOL_IDS,
      MEDIA_GENERATION_TOOL_NAME,
      "agent_create",
      "agent_update",
    ]) {
      assert.equal(
        rootToolRequiresApproval({
          toolName,
          toolInput: { action: "create" },
          reviewAll: true,
          dynamicallyRequiresApproval: true,
          policyRequiresApproval: true,
        }),
        false,
      );
    }
    assert.equal(
      rootToolRequiresApproval({
        toolName: "mcp:server:tool",
        reviewAll: false,
        dynamicallyRequiresApproval: true,
        policyRequiresApproval: false,
      }),
      true,
    );
    assert.equal(
      rootToolRequiresApproval({
        toolName: "skill:custom",
        reviewAll: false,
        dynamicallyRequiresApproval: true,
        policyRequiresApproval: false,
      }),
      true,
    );
    assert.equal(
      rootToolRequiresApproval({
        toolName: "google_search",
        reviewAll: true,
        dynamicallyRequiresApproval: true,
        policyRequiresApproval: true,
        builtinToolNames: new Set(["google_search"]),
      }),
      false,
    );
    assert.equal(
      rootToolRequiresApproval({
        toolName: "sandbox_run_command",
        toolInput: { command: "npm", args: ["install"] },
        reviewAll: true,
        dynamicallyRequiresApproval: true,
        policyRequiresApproval: true,
      }),
      false,
    );
  });

  void it("guards sandbox runtime access before a session exists", () => {
    assert.throws(() => getSandboxSessionOrThrow(undefined), /Sandbox session/);
  });

  void it("does not stop the root agent because of tool-loop step count", async () => {
    for (const stepCount of [1, 20, 100, 1_000]) {
      const steps = Array.from({ length: stepCount }, () => ({}));
      assert.equal(await ROOT_AGENT_STOP_WHEN({ steps } as never), false);
    }
  });
});
