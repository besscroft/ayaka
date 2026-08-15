import { jsonSchema, tool, type ToolSet } from "ai";
import {
  DEFAULT_AGENT_ID,
  type AgentMemoryFileSnapshot,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStatus,
} from "../../shared/types";
import { getAgent, getMemoryById, insertRuntimeEvent, listAgents, listMemories } from "./db";
import {
  ensureMemoryFiles,
  getMemoryFileSnapshot,
  writeMemoryFile,
  type MemoryFileKind,
} from "./agent-memory-files";

export const ROOT_MEMORY_TOOL_NAMES = [
  "soul_list",
  "soul_read",
  "soul_write",
  "memory_file_read",
  "memory_file_write",
  "memory_list",
  "memory_get",
] as const;

export interface RootMemoryToolContext {
  actorAgentId: string;
  runId?: string;
  conversationId?: string;
}

interface SoulReadInput {
  agentId: string;
}

interface SoulWriteInput extends SoulReadInput {
  content: string;
}

interface MemoryFileReadInput {
  kind: "user" | "memory";
}

interface MemoryFileWriteInput extends MemoryFileReadInput {
  content: string;
}

interface MemoryListInput {
  includeInactive?: boolean;
  status?: MemoryStatus;
  scope?: MemoryScope;
  kind?: MemoryKind;
  agentId?: string;
  limit?: number;
}

interface MemoryGetInput {
  id: string;
}

const soulReadSchema = jsonSchema<SoulReadInput>({
  type: "object",
  properties: { agentId: { type: "string", description: "Agent profile id." } },
  required: ["agentId"],
  additionalProperties: false,
});

const soulWriteSchema = jsonSchema<SoulWriteInput>({
  type: "object",
  properties: {
    agentId: { type: "string", description: "Agent profile id." },
    content: { type: "string", description: "Complete SOUL file content." },
  },
  required: ["agentId", "content"],
  additionalProperties: false,
});

const memoryFileReadSchema = jsonSchema<MemoryFileReadInput>({
  type: "object",
  properties: { kind: { type: "string", enum: ["user", "memory"] } },
  required: ["kind"],
  additionalProperties: false,
});

const memoryFileWriteSchema = jsonSchema<MemoryFileWriteInput>({
  type: "object",
  properties: {
    kind: { type: "string", enum: ["user", "memory"] },
    content: { type: "string", description: "Complete USER or MEMORY file content." },
  },
  required: ["kind", "content"],
  additionalProperties: false,
});

const memoryListSchema = jsonSchema<MemoryListInput>({
  type: "object",
  properties: {
    includeInactive: { type: "boolean" },
    status: { type: "string", enum: ["active", "superseded", "archived", "deleted"] },
    scope: { type: "string", enum: ["global", "agent"] },
    kind: { type: "string", enum: ["fact", "preference", "episode", "profile", "skill"] },
    agentId: { type: "string", description: "Exact agent-scoped memory owner." },
    limit: { type: "number", minimum: 1, maximum: 500 },
  },
  additionalProperties: false,
});

const memoryGetSchema = jsonSchema<MemoryGetInput>({
  type: "object",
  properties: { id: { type: "string", description: "Memory record id." } },
  required: ["id"],
  additionalProperties: false,
});

export function createRootMemoryTools(context: RootMemoryToolContext): ToolSet {
  assertRootActor(context.actorAgentId);
  return {
    soul_list: tool({
      description: "List every agent and the metadata for its SOUL file.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: () =>
        withAudit("soul_list", context, async () =>
          listAgents().map((agent) => {
            ensureMemoryFiles(agent);
            const snapshot = getMemoryFileSnapshot("soul", agent.id);
            return {
              agentId: agent.id,
              name: agent.name,
              kind: agent.kind,
              status: agent.status,
              charCount: snapshot.charCount,
              charLimit: snapshot.charLimit,
              updatedAt: snapshot.updatedAt,
            };
          }),
        ),
    }),
    soul_read: tool({
      description: "Read the complete SOUL file for any agent.",
      inputSchema: soulReadSchema,
      execute: (input) =>
        withAudit("soul_read", context, async () => {
          const agent = requireSoulAgent(input.agentId);
          const snapshot = getMemoryFileSnapshot("soul", agent.id);
          return { agentId: agent.id, name: agent.name, ...snapshot };
        }),
    }),
    soul_write: tool({
      description: "Write the complete SOUL file for any agent.",
      inputSchema: soulWriteSchema,
      execute: (input) =>
        withAudit("soul_write", context, async () => {
          const agent = requireSoulAgent(input.agentId);
          const snapshot = writeFileWithResult("soul", input.content, agent.id);
          return { agentId: agent.id, name: agent.name, ...snapshot };
        }),
    }),
    memory_file_read: tool({
      description: "Read the global USER profile or MEMORY long-term memory file.",
      inputSchema: memoryFileReadSchema,
      execute: (input) =>
        withAudit("memory_file_read", context, async () => getMemoryFileSnapshot(input.kind)),
    }),
    memory_file_write: tool({
      description: "Write the global USER profile or MEMORY long-term memory file.",
      inputSchema: memoryFileWriteSchema,
      execute: (input) =>
        withAudit("memory_file_write", context, async () =>
          writeFileWithResult(input.kind, input.content),
        ),
    }),
    memory_list: tool({
      description: "List structured long-term memory records with optional filters.",
      inputSchema: memoryListSchema,
      execute: (input) =>
        withAudit("memory_list", context, async () => listStructuredMemories(input)),
    }),
    memory_get: tool({
      description: "Read one complete structured long-term memory record by id.",
      inputSchema: memoryGetSchema,
      execute: (input) =>
        withAudit("memory_get", context, async () => {
          const memory = getMemoryById(input.id);
          if (!memory) throw new Error(`Memory not found: ${input.id}`);
          return memory;
        }),
    }),
  };
}

export function addRootMemoryTools(
  target: ToolSet,
  activeTools: Set<string>,
  context: RootMemoryToolContext,
): void {
  for (const [toolName, value] of Object.entries(createRootMemoryTools(context))) {
    target[toolName] = value;
    activeTools.add(toolName);
  }
}

function assertRootActor(actorAgentId: string): void {
  if (actorAgentId !== DEFAULT_AGENT_ID) {
    throw new Error("Root memory tools are only available to the root agent.");
  }
}

function requireAgent(agentId: string) {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`Agent not found: ${agentId}`);
  return agent;
}

function requireSoulAgent(agentId: string) {
  const agent = requireAgent(agentId);
  ensureMemoryFiles(agent);
  return agent;
}

function writeFileWithResult(
  kind: MemoryFileKind,
  content: string,
  agentId?: string,
): AgentMemoryFileSnapshot & { truncated: boolean } {
  const before = content.length;
  writeMemoryFile(kind, content, { source: "system", agentId });
  const snapshot = getMemoryFileSnapshot(kind, agentId);
  return { ...snapshot, truncated: before > snapshot.charLimit };
}

function listStructuredMemories(input: MemoryListInput): MemoryRecord[] {
  if (input.agentId) requireAgent(input.agentId);
  const records = listMemories({
    includeInactive: input.includeInactive === true || !!input.status,
  });
  const filtered = records.filter((memory) => {
    if (input.status && (memory.status ?? "active") !== input.status) return false;
    if (input.scope && memory.scope !== input.scope) return false;
    if (input.kind && memory.kind !== input.kind) return false;
    if (input.agentId && (memory.scope !== "agent" || memory.agent_id !== input.agentId)) {
      return false;
    }
    return true;
  });
  return filtered.slice(0, normalizeLimit(input.limit));
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(500, Math.max(1, Math.floor(value!)));
}

async function withAudit<T>(
  toolName: string,
  context: RootMemoryToolContext,
  execute: () => T | Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await execute();
    recordAuditEvent({
      runId: context.runId,
      conversationId: context.conversationId,
      agentId: context.actorAgentId,
      toolId: toolName,
      kind: "tool",
      title: toolName,
      status: "succeeded",
      durationMs: Date.now() - started,
      detail: summarizeResult(result),
    });
    return result;
  } catch (error) {
    recordAuditEvent({
      runId: context.runId,
      conversationId: context.conversationId,
      agentId: context.actorAgentId,
      toolId: toolName,
      kind: "error",
      title: toolName,
      status: "failed",
      durationMs: Date.now() - started,
      detail: { error: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}

function recordAuditEvent(input: Parameters<typeof insertRuntimeEvent>[0]): void {
  try {
    insertRuntimeEvent(input);
  } catch (error) {
    console.warn(
      "[root-memory-tools] failed to record runtime event:",
      error instanceof Error ? error.message : error,
    );
  }
}

function summarizeResult(result: unknown): Record<string, unknown> {
  if (Array.isArray(result)) return { count: result.length };
  if (!result || typeof result !== "object") return { type: typeof result };
  const value = result as Record<string, unknown>;
  return {
    id: typeof value.id === "string" ? value.id : undefined,
    agentId: typeof value.agentId === "string" ? value.agentId : undefined,
    charCount: typeof value.charCount === "number" ? value.charCount : undefined,
    count: typeof value.count === "number" ? value.count : undefined,
  };
}
