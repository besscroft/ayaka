import { jsonSchema, tool, type ToolSet } from "ai";
import type { ChatToolDescriptor, ToolSkill, JsonObject } from "../../shared/types";
import {
  getSkillPackage,
  getSkillTool,
  insertRuntimeEvent,
  listSkillTools,
  markSkillToolRunAsync,
} from "./db";
import type { ChatToolModelContext } from "./chat-tools";
import { runSkill, isPackageHashCurrent } from "./skill-executor";
import { validateSkillArgs } from "./skill-executor-policy";

export function skillToolReference(skillId: string): string {
  return "skill:" + skillId;
}

export function parseSkillToolReference(reference: string): string | null {
  const match = reference.match(/^skill:([A-Za-z0-9_.-]+)$/);
  return match?.[1] ?? null;
}

export function skillToolRuntimeName(skillId: string): string {
  return "skill_" + toolNamePart(skillId);
}

export function createSkillToolDescriptors(prompt?: string): ChatToolDescriptor[] {
  try {
    return listSkillTools().map((skill) => {
      const availability = getSkillAvailability(skill);
      const triggers = safeJsonArray(skill.trigger_keywords_json).filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      );
      const keywordHit =
        triggers.length > 0 &&
        Boolean(prompt?.trim()) &&
        triggers.some((keyword) => prompt!.toLowerCase().includes(keyword.toLowerCase()));
      return {
        id: skillToolReference(skill.id),
        label: skill.name,
        description: skill.description || "Agent skill",
        kind: "host",
        execution: "host",
        category: "skill",
        defaultAuto: skill.auto_use !== 0 && keywordHit,
        requiresApproval: skill.requires_approval !== 0,
        available: availability.available,
        unavailableReason: availability.reason,
        sourceId: skill.id,
        sourceName: skill.category,
      };
    });
  } catch {
    return [];
  }
}

export function getSelectedSkillInstructions(references: string[]): string {
  const selectedIds = new Set(
    references.map(parseSkillToolReference).filter((value): value is string => Boolean(value)),
  );
  if (selectedIds.size === 0) return "";
  const loaded: string[] = [];
  for (const skill of listSkillTools()) {
    if (!selectedIds.has(skill.id) || skill.enabled === 0) continue;
    if (!getSkillAvailability(skill).available) continue;
    const instructions = readSkillInstructions(skill);
    if (!instructions) continue;
    loaded.push("## Skill: " + skill.name + "\n" + instructions);
    insertRuntimeEvent({
      kind: "skill",
      title: "Skill activated: " + skill.name,
      status: "succeeded",
      tool_id: skill.id,
      detail: { skillId: skill.id, mode: "instructions" },
    });
    insertRuntimeEvent({
      kind: "skill",
      title: "Skill instructions loaded: " + skill.name,
      status: "succeeded",
      tool_id: skill.id,
      detail: { skillId: skill.id, mode: "instructions" },
    });
    void markSkillToolRunAsync(skill.id);
  }
  return loaded.join("\n\n");
}

export function createSkillToolSet({
  references,
  model,
  conversationId,
  agentId,
}: {
  references: string[];
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): { tools: ToolSet; activeTools: string[]; approvalToolNames: string[] } {
  const tools: ToolSet = {};
  const activeTools: string[] = [];
  const approvalToolNames: string[] = [];
  for (const reference of references) {
    const skillId = parseSkillToolReference(reference);
    if (!skillId) continue;
    const skill = getSkillTool(skillId);
    if (!skill || skill.enabled === 0) continue;
    const toolName = skillToolRuntimeName(skill.id);
    tools[toolName] = createSkillTool({ skill, model, conversationId, agentId });
    activeTools.push(toolName);
    if (skill.requires_approval !== 0) approvalToolNames.push(toolName);
  }
  return { tools, activeTools, approvalToolNames };
}

export async function runToolSkill({
  skillId,
  input,
  model,
  conversationId,
  agentId,
}: {
  skillId: string;
  input?: unknown;
  model?: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): Promise<unknown> {
  const skill = getSkillTool(skillId);
  if (!skill || skill.enabled === 0) throw new Error("Skill is unavailable: " + skillId);
  const started = Date.now();
  insertRuntimeEvent({
    kind: "skill",
    title: "Skill activated: " + skill.name,
    status: "running",
    tool_id: skill.id,
    detail: { skillId: skill.id, conversationId, agentId },
  });

  try {
    const value = normalizeInput(input);
    const entryId = typeof value.entryId === "string" ? value.entryId : null;
    const args = value.args === undefined ? [] : validateSkillArgs(value.args);
    if (entryId) {
      return await runSkill({
        skillId: skill.id,
        entryId,
        args,
        cwd: value.cwd === "skill" ? "skill" : "workspace",
        conversationId,
        agentId,
      });
    }
    const result = {
      skillId: skill.id,
      name: skill.name,
      execution: "instructions" as const,
      executed: false,
      instructions: readSkillInstructions(skill),
      input: value,
      config: safeJson(skill.config_json, {}) as JsonObject,
      model: model ? { providerId: model.providerId, modelId: model.modelId } : null,
    };
    await markSkillToolRunAsync(skill.id);
    insertRuntimeEvent({
      kind: "skill",
      title: "Skill instructions loaded: " + skill.name,
      status: "succeeded",
      tool_id: skill.id,
      detail: { skillId: skill.id, durationMs: Date.now() - started, conversationId, agentId },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    insertRuntimeEvent({
      kind: "error",
      title: "Skill failed: " + skill.name,
      status: "failed",
      tool_id: skill.id,
      detail: { skillId: skill.id, error: message, conversationId, agentId },
    });
    throw error;
  }
}

function createSkillTool({
  skill,
  model,
  conversationId,
  agentId,
}: {
  skill: ToolSkill;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): ToolSet[string] {
  return tool({
    description: createToolDescription(skill),
    inputSchema: jsonSchema<Record<string, unknown>>(safeJsonSchema(skill.config_schema_json)),
    execute: (input) =>
      runToolSkill({
        skillId: skill.id,
        input,
        model,
        conversationId,
        agentId,
      }),
  });
}

function createToolDescription(skill: ToolSkill): string {
  const triggers = safeJsonArray(skill.trigger_keywords_json).join(", ");
  const instructions = readSkillInstructions(skill);
  return [
    skill.description,
    instructions ? "Instructions:\n" + instructions : "",
    "For script execution, provide entryId from the discovered scripts and args as a string array.",
    triggers ? "Triggers: " + triggers : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function readSkillInstructions(skill: ToolSkill): string {
  return skill.instructions.trim();
}

function getSkillAvailability(skill: ToolSkill): {
  available: boolean;
  reason?: string;
} {
  if (skill.enabled === 0) return { available: false, reason: "Skill is disabled." };
  const pkg = getSkillPackage(skill.id);
  if (!pkg) {
    return readSkillInstructions(skill)
      ? { available: true }
      : { available: false, reason: "Skill has no instructions or executable entries." };
  }
  if (pkg.status === "error") {
    return readSkillInstructions(skill)
      ? {
          available: true,
          reason:
            pkg.lastError ||
            "Skill package execution is unavailable; instructions remain available.",
        }
      : { available: false, reason: pkg.lastError || "Skill package failed safety review." };
  }
  if (!isPackageHashCurrent(pkg.rootPath, pkg.contentHash)) {
    return { available: false, reason: "Skill package content changed; review it again." };
  }
  if (pkg.status === "disabled") return { available: false, reason: "Skill package is disabled." };
  if (pkg.status === "needs_runtime") {
    return readSkillInstructions(skill)
      ? {
          available: true,
          reason: "Executable runtime is unavailable; instructions remain available.",
        }
      : { available: false, reason: pkg.lastError || "Skill runtime is unavailable." };
  }
  if (pkg.status === "needs_confirmation") {
    return readSkillInstructions(skill)
      ? {
          available: true,
          reason: "Skill dependencies are not ready; instructions remain available.",
        }
      : {
          available: false,
          reason: pkg.lastError || "Skill dependencies require confirmation before execution.",
        };
  }
  return { available: true };
}

function normalizeInput(input: unknown): JsonObject {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as JsonObject;
}

function safeJsonSchema(raw: string): Record<string, unknown> {
  const parsed = safeJson(raw, {});
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const schema = parsed as Record<string, unknown>;
    if (Object.keys(schema).length > 0) return schema;
  }
  return {
    type: "object",
    properties: {
      request: { type: "string", description: "What the skill should accomplish." },
    },
    additionalProperties: true,
  };
}

function safeJsonArray(raw: string): unknown[] {
  const parsed = safeJson(raw, []);
  return Array.isArray(parsed) ? parsed : [];
}

function safeJson(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fallback;
  }
}

function toolNamePart(value: string): string {
  const part = value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return part || "skill";
}
