import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_TOOL_IDS,
  MEDIA_GENERATION_TOOL_NAME,
  type AgentProfile,
  type ModelCapabilities,
} from "../../shared/types";
import { isRoutableAgent } from "./agent-routing";
import { commandLooksDangerous, inputHasPathEscape } from "./approval-policy";
import {
  DEFAULT_BUILTIN_TOOL_SEEDS,
  DEFAULT_CHILD_AGENT_SEEDS,
  DEFAULT_ROOT_AGENT_SEED,
} from "./runtime-defaults";
import { getSandboxSessionOrThrow } from "./sandbox-runtime";
import { buildToolRegistryPreview } from "./tool-registry";
import { ROOT_AGENT_STOP_WHEN } from "./agent-run-policy";
import { rootToolRequiresApproval } from "./root-tool-approval";

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
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

  void it("keeps the greenfield database history to one migration", () => {
    const migrations = readdirSync(path.join(process.cwd(), "drizzle")).filter((file) =>
      file.endsWith(".sql"),
    );
    assert.deepEqual(migrations, ["0000_initial.sql"]);
  });

  void it("defines default seed data for agents and tools", () => {
    assert.equal(DEFAULT_ROOT_AGENT_SEED.name, "Paimon");
    assert.ok(DEFAULT_ROOT_AGENT_SEED.description.trim().length > 0);
    const researcher = DEFAULT_CHILD_AGENT_SEEDS.find((agent) => agent.id === "agent-researcher");
    assert.equal(researcher?.name, "Fairy");
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
    assert.ok(DEFAULT_BUILTIN_TOOL_SEEDS.every((tool) => tool.requiresApproval === 0));
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
    assert.ok(runtime.activeTools?.includes("cron"));
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
