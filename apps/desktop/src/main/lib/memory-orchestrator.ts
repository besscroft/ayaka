import { createHash, randomUUID } from "node:crypto";
import {
  DEFAULT_AGENT_ID,
  type MemoryKind,
  type MemoryObservation,
  type MemoryRecord,
  type MemoryScope,
} from "../../shared/types";
import {
  deleteMemory,
  expireMemoryObservations,
  getMemoryById,
  getMemoryByMem0Id,
  insertRuntimeEvent,
  listMemories,
  listMemoryObservations,
  markMemoriesUsed,
  queueMemoryJob,
  saveMemory,
  saveMemoryObservation,
  searchMemories,
  updateMemoryObservation,
  updateMemorySyncState,
} from "./db";
import {
  deleteMemoryFromMem0,
  resetMem0Index,
  searchMem0,
  upsertMemoryInMem0,
} from "./mem0-service";
import { dreamMemoryFiles, incorporateNewMemories } from "./agent-memory-files";

const OBSERVATION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const RETRIEVAL_CANDIDATES = 24;
const RETRIEVAL_LIMIT = 6;
const PROMOTION_CONFIDENCE = 85;
const MIN_PROMOTION_EVIDENCE = 2;
const DECAY_ARCHIVE_THRESHOLD = 25;

export interface ObserveTurnInput {
  conversationId: string;
  runId?: string | null;
  agentId?: string | null;
  messages: Array<{ id?: string; role: string; content: string }>;
}

export interface RetrieveMemoryInput {
  query: string;
  agentId?: string | null;
  limit?: number;
  scope?: MemoryScope | null;
  kind?: MemoryKind | null;
}

export interface ExplicitMemoryInput {
  id?: string;
  title: string;
  content: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  agentId?: string | null;
  sourceConversationId?: string | null;
  sourceRunId?: string | null;
  salience?: number;
  pinned?: boolean;
}

export class MemoryOrchestrator {
  async observeTurn(input: ObserveTurnInput): Promise<MemoryObservation[]> {
    const latestUser = [...input.messages].reverse().find((message) => message.role === "user");
    if (!latestUser?.content.trim()) return [];
    const candidates = extractObservationCandidates(latestUser.content);
    const observations: MemoryObservation[] = [];
    for (const candidate of candidates) {
      const observation = await saveMemoryObservation({
        dedupeKey: observationKey(candidate.content, candidate.kind),
        title: titleFromContent(candidate.content),
        content: candidate.content,
        kind: candidate.kind,
        sourceConversationId: input.conversationId,
        sourceRunId: input.runId,
        sourceAgentId: input.agentId ?? DEFAULT_AGENT_ID,
        confidence: candidate.confidence,
        evidence: [
          {
            conversationId: input.conversationId,
            turnId: latestUser.id ?? null,
            runId: input.runId ?? null,
            agentId: input.agentId ?? DEFAULT_AGENT_ID,
            explicit: candidate.explicit,
            correction: candidate.correction,
            at: Date.now(),
          },
        ],
        expiresAt: Date.now() + OBSERVATION_TTL_MS,
      });
      observations.push(observation);
      if (
        candidate.explicit ||
        candidate.confidence >= PROMOTION_CONFIDENCE ||
        observation.evidence_count >= MIN_PROMOTION_EVIDENCE
      ) {
        await this.promoteObservation(observation, candidate.correction);
      }
    }

    if (observations.length > 0) {
      await queueMemoryJob({
        kind: "consolidate",
        agentId: input.agentId ?? DEFAULT_AGENT_ID,
        idempotencyKey: `consolidate:${input.conversationId}`,
        payload: { reason: "turn-observed" },
        scheduledAt: Date.now() + 10_000,
      });
    }
    return observations;
  }

  async retrieve(input: RetrieveMemoryInput): Promise<MemoryRecord[]> {
    const query = input.query.trim();
    if (!query) return [];
    const limit = Math.max(1, Math.min(input.limit ?? RETRIEVAL_LIMIT, 12));
    let semanticAvailable = false;
    const scored = new Map<string, { memory: MemoryRecord; semantic: number }>();

    try {
      const hits = await searchMem0(query, RETRIEVAL_CANDIDATES);
      semanticAvailable = hits !== null;
      for (const hit of hits ?? []) {
        const sqliteId = typeof hit.metadata.sqliteId === "string" ? hit.metadata.sqliteId : null;
        const memory = sqliteId ? getMemoryById(sqliteId) : getMemoryByMem0Id(hit.id);
        if (!memory || !isVisibleMemory(memory, input.agentId, input.scope, input.kind)) continue;
        scored.set(memory.id, { memory, semantic: normalizeSemanticScore(hit.score) });
      }
    } catch (error) {
      insertRuntimeEvent({
        kind: "memory",
        title: "Memory retrieval fallback",
        status: "failed",
        severity: "warning",
        detail: { error: error instanceof Error ? error.message : String(error) },
      });
    }

    if (!semanticAvailable || scored.size < limit) {
      const lexical = await searchMemories({
        query,
        scope: input.scope,
        kind: input.kind,
        status: "active",
        agentId: input.agentId,
        limit: RETRIEVAL_CANDIDATES,
      });
      for (const memory of lexical) {
        if (!isVisibleMemory(memory, input.agentId, input.scope, input.kind)) continue;
        if (!scored.has(memory.id)) scored.set(memory.id, { memory, semantic: 0 });
      }
    }

    const selected = [...scored.values()]
      .sort((a, b) => rankMemory(b.memory, b.semantic) - rankMemory(a.memory, a.semantic))
      .slice(0, limit)
      .map((item) => item.memory);
    await markMemoriesUsed(selected.map((memory) => memory.id));
    void insertRuntimeEvent({
      kind: "memory",
      title: "Memory retrieval completed",
      status: "succeeded",
      detail: {
        count: selected.length,
        semantic: semanticAvailable,
        agentId: input.agentId ?? null,
      },
    });
    return selected;
  }

  async saveExplicit(input: ExplicitMemoryInput): Promise<MemoryRecord> {
    const now = Date.now();
    const scope = input.scope ?? "global";
    const memory: MemoryRecord = {
      id: input.id ?? randomUUID(),
      scope,
      kind: input.kind ?? "fact",
      title: input.title.trim().slice(0, 120),
      content: input.content.trim().slice(0, 4_000),
      agent_id: scope === "agent" ? (input.agentId ?? DEFAULT_AGENT_ID) : null,
      conversation_id: null,
      source_run_id: input.sourceRunId ?? null,
      salience: clamp(input.salience ?? 90, 1, 100),
      pinned: input.pinned ? 1 : 0,
      confidence: 100,
      origin: "manual",
      status: "active",
      evidence_json: JSON.stringify([
        {
          source: "explicit",
          conversationId: input.sourceConversationId ?? null,
          at: now,
        },
      ]),
      last_used_at: null,
      expires_at: null,
      supersedes_id: null,
      mem0_id: null,
      sync_status: "pending",
      strength: 100,
      last_reinforced_at: now,
      created_at: now,
      updated_at: now,
    };
    if (!memory.title || !memory.content) throw new Error("title and content are required.");
    await saveMemory(memory);
    void incorporateMemoryFile(memory);
    return memory;
  }

  async update(id: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord> {
    const existing = getMemoryById(id);
    if (!existing) throw new Error(`Memory not found: ${id}`);
    const next: MemoryRecord = {
      ...existing,
      id: existing.id,
      title: patch.title ?? existing.title,
      content: patch.content ?? existing.content,
      scope: patch.scope ?? existing.scope,
      kind: patch.kind ?? existing.kind,
      salience: patch.salience ?? existing.salience,
      pinned: patch.pinned ?? existing.pinned,
      confidence: patch.confidence ?? existing.confidence,
      status: patch.status ?? existing.status,
      evidence_json: patch.evidence_json ?? existing.evidence_json,
      expires_at: patch.expires_at ?? existing.expires_at,
      agent_id:
        (patch.scope ?? existing.scope) === "agent"
          ? (patch.agent_id ?? existing.agent_id ?? DEFAULT_AGENT_ID)
          : null,
      conversation_id: null,
      sync_status: "pending",
      updated_at: Date.now(),
    };
    await saveMemory(next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await deleteMemory(id);
  }

  async consolidate(agentId = DEFAULT_AGENT_ID): Promise<number> {
    await expireMemoryObservations();
    const pending = listMemoryObservations({ status: "pending", limit: 100 });
    let promoted = 0;
    for (const observation of pending) {
      if (
        observation.confidence < PROMOTION_CONFIDENCE &&
        observation.evidence_count < MIN_PROMOTION_EVIDENCE
      ) {
        continue;
      }
      if (await this.promoteObservation(observation, false)) promoted += 1;
    }
    if (promoted > 0) {
      insertRuntimeEvent({
        kind: "memory",
        title: "Memory consolidation completed",
        status: "succeeded",
        detail: { promoted },
      });
    }
    await dreamMemoryFiles(
      "consolidation",
      agentId,
      countDistinctEvidenceConversations(agentId) >= 3,
    );
    return promoted;
  }

  async decay(now = Date.now()): Promise<number> {
    let archived = 0;
    for (const memory of listMemories()) {
      if (isDecayProtected(memory)) continue;
      const halfLifeDays = memory.kind === "episode" ? 90 : memory.kind === "skill" ? 365 : 180;
      const ageMs = now - (memory.last_reinforced_at ?? memory.updated_at);
      const factor = Math.pow(0.5, ageMs / (halfLifeDays * 24 * 60 * 60 * 1_000));
      const strength = clamp(Math.round((memory.strength ?? memory.salience) * factor), 1, 100);
      const status = strength < DECAY_ARCHIVE_THRESHOLD ? "archived" : memory.status;
      await saveMemory({ ...memory, strength, status, updated_at: now });
      if (status === "archived") archived += 1;
    }
    return archived;
  }

  async syncJob(payload: unknown): Promise<void> {
    const value = asRecord(payload);
    const action = value.action;
    if (action === "delete") {
      await deleteMemoryFromMem0(typeof value.mem0Id === "string" ? value.mem0Id : null);
      return;
    }
    if (action !== "upsert" || typeof value.memoryId !== "string") return;
    const memory = getMemoryById(value.memoryId);
    if (!memory) return;
    try {
      if (memory.status !== "active") {
        await deleteMemoryFromMem0(memory.mem0_id);
        await updateMemorySyncState(memory.id, { mem0Id: null, status: "synced" });
        return;
      }
      const mem0Id = await upsertMemoryInMem0(memory);
      if (!mem0Id) throw new Error("Mem0 is unavailable; memory sync will retry.");
      await updateMemorySyncState(memory.id, {
        mem0Id,
        status: "synced",
      });
    } catch (error) {
      await updateMemorySyncState(memory.id, { mem0Id: memory.mem0_id, status: "failed" });
      throw error;
    }
  }

  async rehydrate(): Promise<number> {
    const available = await resetMem0Index();
    if (!available) throw new Error("Mem0 is unavailable; rehydration will retry.");
    let restored = 0;
    for (const memory of listMemories()) {
      const mem0Id = await upsertMemoryInMem0({ ...memory, mem0_id: null });
      if (!mem0Id) continue;
      await updateMemorySyncState(memory.id, { mem0Id, status: "synced" });
      restored += 1;
    }
    insertRuntimeEvent({
      kind: "memory",
      title: "Memory index rehydrated",
      status: "succeeded",
      detail: { restored },
    });
    return restored;
  }

  private async promoteObservation(
    observation: MemoryObservation,
    correction: boolean,
  ): Promise<MemoryRecord | null> {
    if (observation.status !== "pending") return null;
    const duplicate = findLongTermDuplicate(observation);
    if (duplicate) {
      const evidence = appendEvidence(duplicate.evidence_json, observation.evidence_json);
      const reinforced: MemoryRecord = {
        ...duplicate,
        confidence: Math.max(duplicate.confidence ?? 70, observation.confidence),
        strength: clamp((duplicate.strength ?? duplicate.salience) + 5, 1, 100),
        salience: Math.max(duplicate.salience, observation.confidence),
        evidence_json: evidence,
        last_reinforced_at: Date.now(),
        updated_at: Date.now(),
      };
      await saveMemory(reinforced);
      await updateMemoryObservation(observation.id, {
        status: "promoted",
        promoted_memory_id: reinforced.id,
      });
      return reinforced;
    }

    const superseded = correction ? findCorrectionTarget(observation) : null;
    if (superseded) {
      await saveMemory({ ...superseded, status: "superseded", updated_at: Date.now() });
    }
    const now = Date.now();
    const memory: MemoryRecord = {
      id: randomUUID(),
      scope: "global",
      kind: observation.kind,
      title: observation.title,
      content: observation.content,
      agent_id: null,
      conversation_id: null,
      source_run_id: observation.source_run_id,
      salience: observation.confidence,
      pinned: 0,
      confidence: observation.confidence,
      origin: "auto",
      status: "active",
      evidence_json: observation.evidence_json,
      last_used_at: null,
      expires_at: null,
      supersedes_id: superseded?.id ?? null,
      mem0_id: null,
      sync_status: "pending",
      strength: observation.confidence,
      last_reinforced_at: now,
      created_at: now,
      updated_at: now,
    };
    await saveMemory(memory);
    await incorporateMemoryFile(memory);
    await updateMemoryObservation(observation.id, {
      status: "promoted",
      promoted_memory_id: memory.id,
    });
    return memory;
  }
}

export const memoryOrchestrator = new MemoryOrchestrator();

function extractObservationCandidates(text: string): Array<{
  content: string;
  kind: MemoryKind;
  confidence: number;
  explicit: boolean;
  correction: boolean;
}> {
  const lines = text
    .split(/[\n.!?;\u3002\uff01\uff1f\uff1b]+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 400);
  const candidates: Array<{
    content: string;
    kind: MemoryKind;
    confidence: number;
    explicit: boolean;
    correction: boolean;
  }> = [];
  for (const line of lines) {
    const explicit = /\bremember\b|\bkeep in mind\b|\u8bf7\u8bb0\u4f4f|\u8bb0\u4f4f/i.test(line);
    const correction =
      /\bactually\b|\bcorrection\b|\bnot .+ but\b|\u66f4\u6b63|\u4e0d\u662f.+\u800c\u662f/i.test(
        line,
      );
    const profile =
      /\bmy (name|role|job|team)\b|\bi am\b|\u6211\u53eb|\u6211\u662f|\u6211\u7684(\u804c\u4e1a|\u89d2\u8272|\u56e2\u961f)/i.test(
        line,
      );
    const preference =
      /\bi (prefer|like|want|need|dislike|hate|usually|always)\b|\u6211(\u559c\u6b22|\u5e0c\u671b|\u9700\u8981|\u8ba8\u538c|\u901a\u5e38)/i.test(
        line,
      );
    const skill =
      /\bhow to\b|\bprocedure\b|\bsteps? to\b|\u6d41\u7a0b|\u65b9\u6cd5|\u6b65\u9aa4/i.test(line);
    const episode =
      /\byesterday\b|\blast week\b|\brecently\b|\btoday\b|\u6628\u5929|\u4e0a\u5468|\u6700\u8fd1|\u4eca\u5929/i.test(
        line,
      );
    if (!explicit && !correction && !profile && !preference && !skill && !episode) continue;
    candidates.push({
      content: line,
      kind: profile
        ? "profile"
        : preference
          ? "preference"
          : skill
            ? "skill"
            : episode
              ? "episode"
              : "fact",
      confidence: explicit ? 100 : profile ? 90 : preference ? 86 : skill ? 76 : episode ? 65 : 72,
      explicit,
      correction,
    });
  }
  return candidates.slice(0, 6);
}

function findLongTermDuplicate(observation: MemoryObservation): MemoryRecord | null {
  const normalized = normalizeText(observation.content);
  return (
    listMemories().find(
      (memory) =>
        memory.kind === observation.kind &&
        (normalizeText(memory.content) === normalized ||
          tokenSimilarity(normalizeText(memory.content), normalized) >= 0.82),
    ) ?? null
  );
}

function findCorrectionTarget(observation: MemoryObservation): MemoryRecord | null {
  const normalized = normalizeText(observation.content);
  return (
    listMemories().find(
      (memory) =>
        memory.kind === observation.kind &&
        normalizeText(memory.content) !== normalized &&
        tokenSimilarity(normalizeText(memory.content), normalized) >= 0.25,
    ) ?? null
  );
}

function isVisibleMemory(
  memory: MemoryRecord,
  agentId?: string | null,
  scope?: MemoryScope | null,
  kind?: MemoryKind | null,
): boolean {
  if ((memory.status ?? "active") !== "active") return false;
  if (memory.expires_at != null && memory.expires_at <= Date.now()) return false;
  if (scope && memory.scope !== scope) return false;
  if (kind && memory.kind !== kind) return false;
  if (memory.scope === "agent" && memory.agent_id !== (agentId ?? DEFAULT_AGENT_ID)) return false;
  return true;
}

function rankMemory(memory: MemoryRecord, semantic: number): number {
  const recencyBase = memory.last_used_at ?? memory.last_reinforced_at ?? memory.updated_at;
  const recencyDays = Math.max(0, Date.now() - recencyBase) / (24 * 60 * 60 * 1_000);
  const recency = Math.exp(-recencyDays / 90) * 100;
  return (
    semantic * 55 +
    (memory.confidence ?? 70) * 0.15 +
    memory.salience * 0.15 +
    recency * 0.1 +
    (memory.pinned ? 5 : 0)
  );
}

function normalizeSemanticScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  return score <= 1 ? Math.max(0, score) : Math.min(1, score / 100);
}

function isDecayProtected(memory: MemoryRecord): boolean {
  return (
    memory.pinned === 1 ||
    memory.origin === "manual" ||
    memory.kind === "profile" ||
    memory.kind === "preference"
  );
}

function observationKey(content: string, kind: MemoryKind): string {
  return createHash("sha256")
    .update(`${kind}:${normalizeText(content)}`)
    .digest("hex");
}

function titleFromContent(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 45)}...` : compact;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSimilarity(a: string, b: string): number {
  const left = new Set(a.split(" ").filter(Boolean));
  const right = new Set(b.split(" ").filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / new Set([...left, ...right]).size;
}

function appendEvidence(left: string | undefined, right: string | undefined): string {
  return JSON.stringify([...parseArray(left), ...parseArray(right)].slice(-20));
}

function countDistinctEvidenceConversations(agentId: string): number {
  const ids = new Set<string>();
  for (const memory of listMemories()) {
    for (const item of parseArray(memory.evidence_json)) {
      if (!item || typeof item !== "object") continue;
      const evidence = item as Record<string, unknown>;
      if (typeof evidence.agentId === "string" && evidence.agentId !== agentId) continue;
      const conversationId = evidence.conversationId;
      if (typeof conversationId === "string" && conversationId) ids.add(conversationId);
    }
  }
  return ids.size;
}

function parseArray(raw: string | undefined): unknown[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

async function incorporateMemoryFile(memory: MemoryRecord): Promise<void> {
  try {
    await incorporateNewMemories([memory]);
  } catch (error) {
    insertRuntimeEvent({
      kind: "memory",
      title: "Memory file update failed",
      status: "failed",
      severity: "warning",
      detail: {
        memoryId: memory.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}
