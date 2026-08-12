import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import {
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  normalizeAgentHandoffConfig,
  normalizeAgentRuntimeConfig,
  normalizeAgentToolPolicy,
  type AgentContextPolicy,
  type AgentHandoffConfig,
  type AgentInput,
  type AgentProfile,
  type AgentRuntimeConfig,
  type AgentToolPolicy,
} from "../../shared/types";
import { createAgent, getAgent, insertRuntimeEvent, updateAgent } from "./db";

export const AGENT_CREATE_TOOL_NAME = "agent_create";
export const AGENT_UPDATE_TOOL_NAME = "agent_update";

interface AgentRuntimePatch extends Omit<Partial<AgentRuntimeConfig>, "contextPolicy"> {
  contextPolicy?: Partial<AgentContextPolicy>;
}

interface AgentHandoffPatch extends Partial<AgentHandoffConfig> {}

interface AgentToolPolicyPatch extends Partial<AgentToolPolicy> {}

export interface AgentCreateToolInput {
  name: string;
  role: string;
  description?: string;
  personality?: string;
  soulPrompt?: string;
  avatar?: string;
  modelRef?: string | null;
  voice?: string | null;
  status?: AgentProfile["status"];
  enabled?: boolean;
  runtime?: AgentRuntimePatch;
  handoff?: AgentHandoffPatch;
  toolPolicy?: AgentToolPolicyPatch;
}

export interface AgentUpdateToolInput extends Partial<AgentCreateToolInput> {
  agentId: string;
}

export interface AgentManagementToolContext {
  runId?: string;
  conversationId?: string;
  actorAgentId: string;
}

const runtimeProperties = {
  maxTurns: { type: "integer", minimum: 1, maximum: 20 },
  maxDurationMs: { type: "integer", minimum: 10_000, maximum: 3_600_000 },
  maxToolCalls: { type: "integer", minimum: 1, maximum: 500 },
  maxConcurrentSubagents: { type: "integer", minimum: 1, maximum: 8 },
  totalTimeoutMs: { type: "integer", minimum: 10_000, maximum: 900_000 },
  contextPolicy: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["off", "prune", "semantic"] },
      pruneThreshold: { type: "number", minimum: 0, maximum: 1 },
      compactThreshold: { type: "number", minimum: 0, maximum: 1 },
      targetRatio: { type: "number", minimum: 0, maximum: 1 },
      keepRecentTokens: { type: "integer", minimum: 1_000, maximum: 200_000 },
    },
    additionalProperties: false,
  },
  compactionModelRef: { type: "string" },
  temperature: { type: "number", minimum: 0, maximum: 2 },
  topP: { type: "number", minimum: 0, maximum: 1 },
  maxOutputTokens: { type: "integer", minimum: 1, maximum: 32_768 },
  reasoning: {
    type: "string",
    enum: ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"],
  },
  reviewPolicy: { type: "string", enum: ["inherit", "auto", "review_sensitive", "review_all"] },
  sandboxPolicy: { type: "string", enum: ["inherit", "disabled", "local", "docker"] },
} satisfies NonNullable<JSONSchema7["properties"]>;

const handoffProperties = {
  mode: { type: "string", enum: ["handoff", "consult", "both"] },
  priority: { type: "string", enum: ["low", "normal", "high"] },
  accepts: { type: "array", items: { type: "string" }, maxItems: 12 },
  expectedOutput: { type: "string" },
} satisfies NonNullable<JSONSchema7["properties"]>;

const toolPolicyProperties = {
  mode: { type: "string", enum: ["inherit", "custom"] },
  allowedToolIds: { type: "array", items: { type: "string" } },
  requireApprovalToolIds: { type: "array", items: { type: "string" } },
} satisfies NonNullable<JSONSchema7["properties"]>;

const agentProperties = {
  name: { type: "string", description: "Display name for the child agent." },
  role: { type: "string", description: "Short specialist role." },
  description: { type: "string" },
  personality: { type: "string" },
  soulPrompt: { type: "string" },
  avatar: { type: "string" },
  modelRef: {
    anyOf: [{ type: "string" }, { type: "null" }] as Array<{ type: "string" | "null" }>,
  },
  voice: {
    anyOf: [{ type: "string" }, { type: "null" }] as Array<{ type: "string" | "null" }>,
  },
  status: { type: "string", enum: ["active", "draft", "archived"] },
  enabled: { type: "boolean" },
  runtime: { type: "object", properties: runtimeProperties, additionalProperties: false },
  handoff: { type: "object", properties: handoffProperties, additionalProperties: false },
  toolPolicy: {
    type: "object",
    properties: toolPolicyProperties,
    additionalProperties: false,
  },
} satisfies NonNullable<JSONSchema7["properties"]>;

const createInputSchema = jsonSchema<AgentCreateToolInput>({
  type: "object",
  properties: agentProperties,
  required: ["name", "role"],
  additionalProperties: false,
});

const updateInputSchema = jsonSchema<AgentUpdateToolInput>({
  type: "object",
  properties: {
    agentId: { type: "string", description: "Existing child agent id." },
    ...agentProperties,
  },
  required: ["agentId"],
  additionalProperties: false,
});

export function createAgentManagementTools(context: AgentManagementToolContext): ToolSet {
  if (context.actorAgentId !== DEFAULT_AGENT_ID) {
    throw new Error("Agent management tools are only available to the root agent.");
  }

  return {
    [AGENT_CREATE_TOOL_NAME]: tool({
      description:
        "Create a child agent under the root agent. The new agent is active and enabled by default.",
      inputSchema: createInputSchema,
      execute: (input) => executeCreate(input, context),
    }),
    [AGENT_UPDATE_TOOL_NAME]: tool({
      description:
        "Update an existing child agent. Omitted fields stay unchanged; nested configuration objects are merged by field.",
      inputSchema: updateInputSchema,
      execute: (input) => executeUpdate(input, context),
    }),
  };
}

export function addAgentManagementTools(
  target: ToolSet,
  activeTools: Set<string>,
  context: AgentManagementToolContext,
): void {
  for (const [toolName, value] of Object.entries(createAgentManagementTools(context))) {
    (target as Record<string, ToolSet[string]>)[toolName] = value;
    activeTools.add(toolName);
  }
}

async function executeCreate(
  input: AgentCreateToolInput,
  context: AgentManagementToolContext,
): Promise<AgentProfile> {
  return executeWithAudit(
    AGENT_CREATE_TOOL_NAME,
    context,
    async () => {
      const status = input.status ?? "active";
      const agent = await createAgent(
        toAgentInput(input, {
          status,
          enabled: input.enabled ?? status === "active",
        }),
      );
      return agent;
    },
    (agent) => ({ targetAgentId: agent.id }),
  );
}

async function executeUpdate(
  input: AgentUpdateToolInput,
  context: AgentManagementToolContext,
): Promise<AgentProfile> {
  return executeWithAudit(
    AGENT_UPDATE_TOOL_NAME,
    context,
    async () => {
      assertEditableChild(input.agentId);
      const existing = getAgent(input.agentId);
      if (!existing) throw new Error("Agent not found.");
      const patch = toAgentInputPatch(input, existing);
      return updateAgent(input.agentId, patch);
    },
    (agent) => ({ targetAgentId: agent.id }),
  );
}

function assertEditableChild(agentId: string): void {
  if (agentId === DEFAULT_AGENT_ID) {
    throw new Error("The root agent cannot be edited by agent tools.");
  }
  const agent = getAgent(agentId);
  if (!agent) throw new Error("Agent not found.");
  if (agent.kind === "main") {
    throw new Error("Main agents cannot be edited by agent tools.");
  }
}

function toAgentInput(
  input: AgentCreateToolInput,
  defaults: Pick<AgentInput, "status" | "enabled">,
): AgentInput {
  return {
    name: input.name,
    role: input.role,
    description: input.description ?? "",
    personality: input.personality ?? "",
    soul_prompt: input.soulPrompt ?? "",
    avatar: input.avatar ?? "",
    model_ref: input.modelRef ?? null,
    voice: input.voice ?? null,
    status: defaults.status,
    enabled: defaults.enabled,
    runtime_config_json: input.runtime ? JSON.stringify(input.runtime) : undefined,
    handoff_config_json: input.handoff ? JSON.stringify(input.handoff) : undefined,
    tool_policy_json: input.toolPolicy ? JSON.stringify(input.toolPolicy) : undefined,
  };
}

function toAgentInputPatch(
  input: AgentUpdateToolInput,
  existing: AgentProfile,
): Partial<AgentInput> {
  const patch: Partial<AgentInput> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.role !== undefined) patch.role = input.role;
  if (input.description !== undefined) patch.description = input.description;
  if (input.personality !== undefined) patch.personality = input.personality;
  if (input.soulPrompt !== undefined) patch.soul_prompt = input.soulPrompt;
  if (input.avatar !== undefined) patch.avatar = input.avatar;
  if (input.modelRef !== undefined) patch.model_ref = input.modelRef;
  if (input.voice !== undefined) patch.voice = input.voice;
  if (input.status !== undefined) patch.status = input.status;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.runtime !== undefined) {
    patch.runtime_config_json = JSON.stringify(
      mergeConfig(
        normalizeAgentRuntimeConfig(
          parseJson(existing.runtime_config_json),
          DEFAULT_AGENT_RUNTIME_CONFIG,
        ),
        input.runtime,
      ),
    );
  }
  if (input.handoff !== undefined) {
    patch.handoff_config_json = JSON.stringify(
      mergeConfig(
        normalizeAgentHandoffConfig(
          parseJson(existing.handoff_config_json),
          DEFAULT_AGENT_HANDOFF_CONFIG,
        ),
        input.handoff,
      ),
    );
  }
  if (input.toolPolicy !== undefined) {
    patch.tool_policy_json = JSON.stringify(
      mergeConfig(
        normalizeAgentToolPolicy(parseJson(existing.tool_policy_json), DEFAULT_AGENT_TOOL_POLICY),
        input.toolPolicy,
      ),
    );
  }
  return patch;
}

function mergeConfig<T extends object>(existing: T, patch: object): T {
  const existingContextPolicy = (existing as { contextPolicy?: AgentContextPolicy }).contextPolicy;
  const patchContextPolicy = (patch as { contextPolicy?: Partial<AgentContextPolicy> })
    .contextPolicy;
  const merged = { ...existing, ...patch } as T & { contextPolicy?: AgentContextPolicy };
  if (existingContextPolicy && patchContextPolicy) {
    merged.contextPolicy = {
      ...existingContextPolicy,
      ...patchContextPolicy,
    } as AgentContextPolicy;
  }
  return merged;
}

function parseJson(raw: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function executeWithAudit<T>(
  toolName: string,
  context: AgentManagementToolContext,
  execute: () => T | Promise<T>,
  detail: (value: T) => Record<string, unknown>,
): Promise<T> {
  const started = Date.now();
  try {
    const value = await execute();
    recordToolEvent({
      ...context,
      toolName,
      kind: "tool",
      status: "succeeded",
      durationMs: Date.now() - started,
      detail: detail(value),
    });
    return value;
  } catch (error) {
    recordToolEvent({
      ...context,
      toolName,
      kind: "error",
      status: "failed",
      durationMs: Date.now() - started,
      detail: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

function recordToolEvent(input: {
  runId?: string;
  conversationId?: string;
  actorAgentId: string;
  toolName: string;
  kind: "tool" | "error";
  status: "succeeded" | "failed";
  durationMs: number;
  detail: Record<string, unknown>;
}): void {
  try {
    insertRuntimeEvent({
      runId: input.runId,
      conversationId: input.conversationId,
      agentId: input.actorAgentId,
      toolId: input.toolName,
      kind: input.kind,
      status: input.status,
      title: input.toolName === AGENT_CREATE_TOOL_NAME ? "Create agent" : "Update agent",
      durationMs: input.durationMs,
      detail: input.detail,
    });
  } catch (error) {
    console.warn(
      "[agent-management-tools] failed to record runtime event:",
      error instanceof Error ? error.message : error,
    );
  }
}
