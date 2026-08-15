import { DEFAULT_AGENT_ID, type MemoryRecord } from "../../shared/types";

export type MemoryAccessMode = "all" | "global-and-self";

export interface MemoryAccessContext {
  actorAgentId: string;
  mode: MemoryAccessMode;
}

export function createMemoryAccessContext(actorAgentId: string): MemoryAccessContext {
  if (!actorAgentId.trim()) throw new Error("Memory access requires an actor agent id.");
  return {
    actorAgentId,
    mode: actorAgentId === DEFAULT_AGENT_ID ? "all" : "global-and-self",
  };
}

export function assertCanTargetMemoryAgent(
  access: MemoryAccessContext,
  targetAgentId: string,
): void {
  if (access.mode === "all" || targetAgentId === access.actorAgentId) return;
  throw new Error(`Agent ${access.actorAgentId} cannot access memories for ${targetAgentId}.`);
}

export function canAccessMemoryRecord(
  access: MemoryAccessContext,
  memory: Pick<MemoryRecord, "scope" | "agent_id">,
): boolean {
  return (
    memory.scope === "global" || access.mode === "all" || memory.agent_id === access.actorAgentId
  );
}

export function assertCanAccessMemoryRecord(
  access: MemoryAccessContext,
  memory: Pick<MemoryRecord, "scope" | "agent_id">,
): void {
  if (canAccessMemoryRecord(access, memory)) return;
  throw new Error(`Agent ${access.actorAgentId} cannot access this memory.`);
}

export function resolveMemoryQueryAgentId(
  access: MemoryAccessContext,
  requestedAgentId?: string | null,
): string | undefined {
  if (requestedAgentId) assertCanTargetMemoryAgent(access, requestedAgentId);
  if (access.mode === "all") return requestedAgentId ?? undefined;
  return access.actorAgentId;
}

export function resolveAgentMemoryTarget(
  access: MemoryAccessContext,
  requestedAgentId?: string | null,
): string {
  const targetAgentId = requestedAgentId ?? access.actorAgentId;
  assertCanTargetMemoryAgent(access, targetAgentId);
  return targetAgentId;
}
