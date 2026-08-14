import { randomUUID } from "node:crypto";
import { app } from "electron";
import { Memory } from "mem0ai/oss";
import { join } from "node:path";
import type { MemoryRecord } from "../../shared/types";
import { getApiKey, getSetting, setSetting } from "./db";

const MEMORY_USER_ID_SETTING = "memory.installation-user-id";

export interface Mem0SearchHit {
  id: string;
  memory: string;
  score: number;
  metadata: Record<string, unknown>;
}

let memoryInstance: Memory | null = null;

export async function getMemory(): Promise<Memory | null> {
  if (memoryInstance) return memoryInstance;
  const apiKey = getApiKey("openai");
  if (!apiKey) return null;

  const historyDbPath = join(
    process.env.AYAKA_USER_DATA_DIR || app.getPath("userData"),
    "data",
    "mem0-history.db",
  );
  memoryInstance = new Memory({
    llm: { provider: "openai", config: { apiKey, model: "gpt-5-mini" } },
    embedder: { provider: "openai", config: { apiKey, model: "text-embedding-3-small" } },
    vectorStore: {
      provider: "memory",
      config: { collectionName: "ayaka-memories", dimension: 1536 },
    },
    historyDbPath,
  });
  return memoryInstance;
}

export function getMemoryUserId(): string {
  const existing = getSetting(MEMORY_USER_ID_SETTING);
  if (existing) return existing;
  const created = randomUUID();
  void setSetting(MEMORY_USER_ID_SETTING, created);
  return created;
}

export async function searchMem0(query: string, topK = 24): Promise<Mem0SearchHit[] | null> {
  const memory = await getMemory();
  if (!memory) return null;
  const result = await memory.search(query, {
    filters: { user_id: getMemoryUserId() },
    topK,
  });
  return (result.results ?? []).map((item) => ({
    id: item.id,
    memory: item.memory,
    score: typeof item.score === "number" ? item.score : 0,
    metadata:
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : {},
  }));
}

export async function upsertMemoryInMem0(record: MemoryRecord): Promise<string | null> {
  const memory = await getMemory();
  if (!memory) return null;
  const text = `${record.title}: ${record.content}`;
  if (record.mem0_id) {
    try {
      await memory.update(record.mem0_id, text);
      return record.mem0_id;
    } catch {
      // The in-memory index may have been recreated; add a fresh binding below.
    }
  }

  const result = await memory.add([{ role: "user", content: text }], {
    userId: getMemoryUserId(),
    agentId: record.scope === "agent" ? (record.agent_id ?? undefined) : undefined,
    metadata: {
      sqliteId: record.id,
      scope: record.scope,
      kind: record.kind,
      status: record.status ?? "active",
      origin: record.origin ?? "auto",
    },
    infer: false,
  });
  const added = result?.results?.find((item) => item.id);
  return added?.id ?? null;
}

export async function deleteMemoryFromMem0(mem0Id: string | null | undefined): Promise<void> {
  if (!mem0Id) return;
  const memory = await getMemory();
  if (!memory) return;
  await memory.delete(mem0Id);
}

export async function resetMem0Index(): Promise<boolean> {
  const memory = await getMemory();
  if (!memory) return false;
  await memory.reset();
  return true;
}

export function resetMemoryInstance(): void {
  memoryInstance = null;
}
