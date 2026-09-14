import {
  CHAT_CAPABILITY_TOOL_IDS,
  DEFAULT_AGENT_ID,
  getChatToolSelectionForConversation,
  SettingKey,
  type MemoryJob,
} from "../../shared/types";
import {
  claimNextMemoryJob,
  finishMemoryJob,
  getSetting,
  insertRuntimeEvent,
  listMessages,
  queueMemoryJob,
  updateAyakaLearningState,
} from "./db";
import { memoryOrchestrator } from "./memory-orchestrator";
import { hasUsableMemoryConfiguration } from "./providers";
import { resetMemoryInstance } from "./mem0-service";

const LEARNING_DELAY_MS = 1_200;
const WORKER_INTERVAL_MS = 60_000;
const DAILY_MAINTENANCE_MS = 24 * 60 * 60 * 1_000;

let workerTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let workerActive = false;

export function queueAgentLearning(conversationId: string): boolean {
  if (!isConversationMemoryEnabled(conversationId)) return false;
  void queueMemoryJob({
    kind: "learn",
    conversationId,
    agentId: DEFAULT_AGENT_ID,
    idempotencyKey: `learn:${conversationId}`,
    payload: { reason: "chat-finished" },
    scheduledAt: Date.now() + LEARNING_DELAY_MS,
  });
  scheduleMemoryWorker(LEARNING_DELAY_MS);
  return true;
}

export function startMemoryWorker(): void {
  if (intervalTimer) return;
  queueMemoryRehydrateIfAvailable("startup");
  void queueMemoryJob({
    kind: "consolidate",
    agentId: DEFAULT_AGENT_ID,
    idempotencyKey: "consolidate:startup",
    payload: { reason: "startup" },
    scheduledAt: Date.now() + 15_000,
  });
  void queueMemoryJob({
    kind: "decay",
    agentId: DEFAULT_AGENT_ID,
    idempotencyKey: "decay:daily",
    payload: { reason: "daily" },
    scheduledAt: Date.now() + 30_000,
  });
  scheduleMemoryWorker(100);
  intervalTimer = setInterval(() => scheduleMemoryWorker(0), WORKER_INTERVAL_MS);
}

export function notifyMemoryConfigurationChanged(): void {
  resetMemoryInstance();
  queueMemoryRehydrateIfAvailable("configuration-changed");
}

function queueMemoryRehydrateIfAvailable(reason: string): void {
  if (!hasUsableMemoryConfiguration()) return;
  void queueMemoryJob({
    kind: "rehydrate",
    agentId: DEFAULT_AGENT_ID,
    idempotencyKey: "rehydrate:startup",
    payload: { reason },
    scheduledAt: Date.now() + (reason === "startup" ? 5_000 : 0),
  });
  scheduleMemoryWorker(reason === "startup" ? 100 : 0);
}

export function clearMemoryWorker(): void {
  if (workerTimer) clearTimeout(workerTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  workerTimer = null;
  intervalTimer = null;
  workerActive = false;
}

export async function runMemoryWorkerOnce(): Promise<boolean> {
  if (workerActive) return false;
  workerActive = true;
  let hadJob = false;
  try {
    const job = await claimNextMemoryJob();
    if (!job) return false;
    hadJob = true;
    try {
      if ((job.kind === "sync" || job.kind === "rehydrate") && !hasUsableMemoryConfiguration()) {
        await finishMemoryJob(job.id, "cancelled");
      } else {
        await runJob(job);
        await finishMemoryJob(job.id, "succeeded");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await finishMemoryJob(job.id, "failed", message);
      void insertRuntimeEvent({
        kind: "memory",
        title: "Memory job failed",
        status: "failed",
        detail: { jobId: job.id, kind: job.kind, error: message },
      });
    }
    return true;
  } finally {
    workerActive = false;
    if (hadJob) scheduleMemoryWorker(0);
  }
}

async function runJob(job: MemoryJob): Promise<void> {
  const payload = parsePayload(job.payload_json);
  if (job.kind === "learn") return runLearningJob(job);
  if (job.kind === "consolidate") {
    await memoryOrchestrator.consolidate(job.agent_id ?? DEFAULT_AGENT_ID);
    return;
  }
  if (job.kind === "sync") return memoryOrchestrator.syncJob(payload);
  if (job.kind === "decay") {
    const archived = await memoryOrchestrator.decay();
    void insertRuntimeEvent({
      kind: "memory",
      title: "Memory decay completed",
      status: "succeeded",
      detail: { archived },
    });
    void queueMemoryJob({
      kind: "decay",
      agentId: DEFAULT_AGENT_ID,
      idempotencyKey: "decay:daily",
      payload: { reason: "daily" },
      scheduledAt: Date.now() + DAILY_MAINTENANCE_MS,
    });
    return;
  }
  await memoryOrchestrator.rehydrate();
}

async function runLearningJob(job: MemoryJob): Promise<void> {
  if (!job.conversation_id) return;
  if (!isConversationMemoryEnabled(job.conversation_id)) return;
  const started = Date.now();
  updateAyakaLearningState({ status: "learning" });
  try {
    const messages = listMessages(job.conversation_id).map((message) => ({
      id: message.id,
      role: message.role,
      content: extractMessageText(message.content),
    }));
    const observations = await memoryOrchestrator.observeTurn({
      conversationId: job.conversation_id,
      runId: job.run_id,
      agentId: job.agent_id ?? DEFAULT_AGENT_ID,
      messages,
    });
    updateAyakaLearningState({ status: "idle", lastLearningAt: Date.now(), lastError: null });
    insertRuntimeEvent({
      kind: "memory",
      title: "Silent memory learning completed",
      status: "succeeded",
      detail: {
        jobId: job.id,
        conversationId: job.conversation_id,
        observedCount: observations.length,
        durationMs: Date.now() - started,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateAyakaLearningState({ status: "failed", lastLearningAt: Date.now(), lastError: message });
    throw error;
  }
}

function isConversationMemoryEnabled(conversationId: string): boolean {
  const selection = getChatToolSelectionForConversation(
    getSetting(SettingKey.ChatTools),
    conversationId,
  );
  const disabledToolIds = new Set(selection.disabledToolIds ?? []);
  return !CHAT_CAPABILITY_TOOL_IDS.memory.some((id) => disabledToolIds.has(id));
}

function scheduleMemoryWorker(delayMs: number): void {
  if (workerTimer) return;
  workerTimer = setTimeout(
    () => {
      workerTimer = null;
      void runMemoryWorkerOnce();
    },
    Math.max(0, delayMs),
  );
}

function extractMessageText(content: string): string {
  try {
    const parsed = JSON.parse(content) as { parts?: Array<{ type?: string; text?: string }> };
    if (!Array.isArray(parsed.parts)) return content;
    return parsed.parts
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  } catch {
    return content;
  }
}

function parsePayload(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
