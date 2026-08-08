import { randomUUID } from "node:crypto";
import { DefaultChatTransport, readUIMessageStream, type UIMessage } from "ai";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_CHAT_TOOL_SELECTION,
  SettingKey,
  normalizeChatToolSelection,
  type ChatToolSelectionRequest,
  type CronJob,
  type CronRun,
  type MessageRow,
} from "../../shared/types";
import { applyMessagesPatch, buildAgentSystemPrompt, getMessagesSnapshot, getSetting } from "./db";
import { runAgentChat } from "./agent-runtime";
import { resolveModel } from "./providers";
import {
  claimCronJobNow,
  claimDueCronJobs,
  completeCronRun,
  recoverCronJobs,
  type ClaimedCronRun,
} from "./cron-store";
import { isTransientCronError } from "./cron-schedule";

export interface CronSchedulerOptions {
  maxConcurrency?: number;
  pollIntervalMs?: number;
  execute?: (
    job: CronJob,
    run: CronRun,
    signal: AbortSignal,
  ) => Promise<string | { output: string; runtimeRunId: string }>;
}

export class CronScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly running = new Map<string, AbortController>();
  private readonly maxConcurrency: number;
  private readonly pollIntervalMs: number;
  private readonly execute: NonNullable<CronSchedulerOptions["execute"]>;

  constructor(options: CronSchedulerOptions = {}) {
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 2);
    this.pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 1_000);
    this.execute = options.execute ?? executeCronAgentTurn;
  }

  start(): void {
    if (this.timer) return;
    recoverCronJobs();
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
  }

  async runNow(jobId: string): Promise<CronRun> {
    if (this.running.size >= this.maxConcurrency) {
      throw new Error("The automation concurrency limit is currently full.");
    }
    const claim = claimCronJobNow(jobId);
    this.launch(claim);
    return claim.run;
  }

  async tick(now = Date.now()): Promise<void> {
    const capacity = this.maxConcurrency - this.running.size;
    if (capacity <= 0) return;
    for (const claim of claimDueCronJobs(now, capacity)) this.launch(claim);
  }

  private launch(claim: ClaimedCronRun): void {
    const controller = new AbortController();
    this.running.set(claim.job.id, controller);
    void this.execute(claim.job, claim.run, controller.signal)
      .then((result) => {
        if (this.timer) {
          completeCronRun(
            claim,
            typeof result === "string"
              ? { output: result }
              : { output: result.output, runtimeRunId: result.runtimeRunId },
          );
        }
      })
      .catch((error) => {
        if (!this.timer) return;
        const message = error instanceof Error ? error.message : String(error);
        completeCronRun(claim, { error: message, transient: isTransientCronError(error) });
      })
      .finally(() => {
        this.running.delete(claim.job.id);
        if (this.timer) void this.tick();
      });
  }
}

let scheduler: CronScheduler | null = null;

export function startCronScheduler(): CronScheduler {
  scheduler ??= new CronScheduler();
  scheduler.start();
  return scheduler;
}

export function getCronScheduler(): CronScheduler {
  scheduler ??= new CronScheduler();
  return scheduler;
}

export function stopCronScheduler(): void {
  scheduler?.stop();
  scheduler = null;
}

async function executeCronAgentTurn(
  job: CronJob,
  _run: CronRun,
  signal: AbortSignal,
): Promise<{ output: string; runtimeRunId: string }> {
  const modelRef = job.payload.modelRef ?? getSetting(SettingKey.SelectedModel);
  if (!modelRef) throw new Error("Automation has no model configured.");
  const snapshot = getMessagesSnapshot(job.conversationId);
  const history = snapshot.messages.map(hydrateMessageRow);
  const userMessage: UIMessage = {
    id: randomUUID(),
    role: "user",
    parts: [{ type: "text", text: job.payload.prompt }],
    metadata: { automation: { jobId: job.id, scheduled: true } },
  };
  const runtimeRunId = randomUUID();
  await persistCronMessages(job.conversationId, [userMessage]);

  const transport = new DefaultChatTransport<UIMessage>({
    api: "agent-loop://automation",
    fetch: async (_input, init) =>
      runAgentChat({
        messages: [...history, userMessage],
        modelRef,
        resolved: resolveModel(modelRef),
        conversationId: job.conversationId,
        preferredAgentId: job.payload.agentId ?? DEFAULT_AGENT_ID,
        reasoning: job.payload.reasoning,
        toolSelection: cronToolSelection(job),
        disableCronTools: true,
        runId: runtimeRunId,
        mode: "start",
        origin: "automation",
        buildAgentSystemPrompt,
        resolveModel,
        abortSignal: init?.signal ?? signal,
      }),
  });
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId: job.conversationId,
    messageId: undefined,
    messages: [...history, userMessage],
    abortSignal: signal,
  });
  let assistant: UIMessage | undefined;
  for await (const message of readUIMessageStream<UIMessage>({
    stream,
    terminateOnError: true,
  })) {
    assistant = message;
  }
  if (!assistant) throw new Error("Automation completed without an assistant response.");
  await persistCronMessages(job.conversationId, [assistant]);
  const output = assistant.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n\n")
    .trim();
  return { output, runtimeRunId };
}

function cronToolSelection(job: CronJob): ChatToolSelectionRequest {
  const configured = normalizeChatToolSelection(
    job.payload.toolSelection ?? DEFAULT_CHAT_TOOL_SELECTION,
  );
  const skillIds = (job.payload.skillIds ?? []).map((id) =>
    id.startsWith("skill:") ? id : `skill:${id}`,
  );
  if (skillIds.length === 0) return configured;
  return {
    mode: "manual",
    selectedToolIds: [...new Set([...configured.selectedToolIds, ...skillIds])],
  };
}

async function persistCronMessages(conversationId: string, messages: UIMessage[]): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const snapshot = getMessagesSnapshot(conversationId);
    const now = Date.now();
    const rows: MessageRow[] = messages.map((message, index) => ({
      id: message.id,
      conversation_id: conversationId,
      role: message.role,
      content: JSON.stringify(message),
      created_at: now + index,
    }));
    const result = applyMessagesPatch({
      conversationId,
      baseRevision: snapshot.revision,
      upserts: rows,
      deleteIds: [],
    });
    if (result.applied) return;
  }
  throw new Error("Automation could not persist its chat after repeated revision conflicts.");
}

function hydrateMessageRow(row: MessageRow): UIMessage {
  try {
    const parsed = JSON.parse(row.content) as UIMessage;
    if (parsed && typeof parsed.id === "string" && Array.isArray(parsed.parts)) return parsed;
  } catch {
    // Preserve malformed legacy content as visible compatibility text.
  }
  return { id: row.id, role: row.role, parts: [{ type: "text", text: row.content }] };
}
