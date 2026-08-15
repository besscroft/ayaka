import type { UIMessage } from "ai";
import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  type AgentRunInput,
  type AgentRunInputKind,
  type AgentRunInputSource,
  type AgentRunOrigin,
  type AgentRuntimeConfig,
  type AgentLoopControlMetadata,
  type AgentCompletionCandidate,
  type RuntimeRun,
} from "../../shared/types";
import {
  consumeAgentRunInputs,
  createRuntimeRun,
  discardAgentRunInputs,
  enqueueAgentRunInput,
  getRuntimeRun,
  insertRuntimeEvent,
  listRuntimeRuns,
  updateRuntimeRun,
} from "./db";

const ACTIVE_STATUSES = new Set<RuntimeRun["status"]>([
  "queued",
  "running",
  "waiting_approval",
  "waiting_handoff",
]);

export type AgentLoopMode = "start" | "resume";
export type AgentLoopBudgetReason = "max_turns" | "max_duration" | "max_tool_calls";
export type AgentLoopAbsoluteLimitReason = "absolute_duration" | "absolute_tool_calls";

export class AgentLoopSessionError extends Error {
  constructor(
    readonly code:
      | "run_conflict"
      | "run_not_found"
      | "run_not_active"
      | "conversation_mismatch"
      | "conversation_busy"
      | "absolute_limit_reached",
    message: string,
  ) {
    super(message);
    this.name = "AgentLoopSessionError";
  }
}

export interface AgentLoopSessionOptions {
  runId: string;
  conversationId?: string;
  rootAgentId: string;
  modelRef: string;
  origin?: AgentRunOrigin;
  mode?: AgentLoopMode;
  runtimeConfig?: AgentRuntimeConfig;
  inputSummary?: string;
  messages?: UIMessage[];
}

export class AgentLoopSession {
  readonly runId: string;
  readonly conversationId?: string;
  readonly origin: AgentRunOrigin;
  readonly controller = new AbortController();
  readonly startedAt: number;
  readonly messageTrace: UIMessage[] = [];

  private readonly maxTurns: number;
  private readonly maxDurationMs: number;
  private readonly maxToolCalls: number;
  private readonly absoluteMaxDurationMs: number;
  private readonly absoluteMaxToolCalls: number;
  private readonly maxNoProgressRounds: number;
  private readonly persistedResumable: boolean;
  private windowCount = 0;
  private windowStartedAt: number;
  private noProgressRounds = 0;
  private turnCount = 0;
  private toolCallCount = 0;
  private closed = false;
  private budgetReason: AgentLoopBudgetReason | null = null;
  private absoluteLimitReason: AgentLoopAbsoluteLimitReason | null = null;
  private completionCandidate: AgentCompletionCandidate | undefined;
  private readonly streamCompletions = new Set<Promise<void>>();
  runtimeHandles: { coordinator: unknown; recorder: unknown } | null = null;

  constructor(
    run: RuntimeRun,
    runtimeConfig: AgentRuntimeConfig,
    private readonly onClosed: (runId: string) => void,
    initialMessages: UIMessage[] = [],
  ) {
    this.runId = run.id;
    this.conversationId = run.conversation_id ?? undefined;
    this.origin = run.origin;
    this.startedAt = run.started_at;
    this.maxTurns = runtimeConfig.maxTurns;
    this.maxDurationMs = runtimeConfig.maxDurationMs ?? 600_000;
    this.maxToolCalls = runtimeConfig.maxToolCalls ?? 50;
    this.absoluteMaxDurationMs = runtimeConfig.absoluteMaxDurationMs ?? 3_600_000;
    this.absoluteMaxToolCalls = runtimeConfig.absoluteMaxToolCalls ?? 250;
    this.maxNoProgressRounds = runtimeConfig.maxNoProgressRounds ?? 3;
    const metadata = parseControlMetadata(run.metadata_json);
    this.persistedResumable = metadata.resumable;
    this.windowCount = metadata.windowCount;
    this.windowStartedAt = metadata.windowStartedAt ?? Date.now();
    this.turnCount = metadata.totalTurns;
    this.toolCallCount = metadata.totalToolCalls;
    this.noProgressRounds = metadata.noProgressRounds;
    this.completionCandidate = metadata.completionCandidate;
    this.appendMessages(initialMessages);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  registerStreamCompletion(): () => void {
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    this.streamCompletions.add(completion);
    return () => {
      this.streamCompletions.delete(completion);
      resolveCompletion();
    };
  }

  async waitForStreamCompletions(): Promise<void> {
    await Promise.all(this.streamCompletions);
  }

  get isActive(): boolean {
    return !this.closed && !this.controller.signal.aborted;
  }

  get budgetExceededReason(): AgentLoopBudgetReason | null {
    this.budgetReason ??= this.checkBudget();
    return this.budgetReason;
  }

  get absoluteLimitExceededReason(): AgentLoopAbsoluteLimitReason | null {
    this.absoluteLimitReason ??= this.checkAbsoluteLimit();
    return this.absoluteLimitReason;
  }

  get isResumable(): boolean {
    return this.persistedResumable && this.absoluteLimitExceededReason === null;
  }

  get controlMetadata(): AgentLoopControlMetadata {
    return {
      windowCount: this.windowCount,
      totalTurns: this.turnCount,
      totalToolCalls: this.toolCallCount,
      noProgressRounds: this.noProgressRounds,
      absoluteDeadline: this.startedAt + this.absoluteMaxDurationMs,
      windowStartedAt: this.windowStartedAt,
      completionCandidate: this.completionCandidate,
      resumable: this.isResumable,
    };
  }

  get usage(): { turnCount: number; toolCallCount: number; elapsedMs: number } {
    return {
      turnCount: this.turnCount,
      toolCallCount: this.toolCallCount,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
    };
  }

  get remainingDurationMs(): number {
    return Math.max(
      1,
      Math.min(
        this.maxDurationMs - (Date.now() - this.windowStartedAt),
        this.absoluteMaxDurationMs - (Date.now() - this.startedAt),
      ),
    );
  }

  async enqueue(
    kind: AgentRunInputKind,
    source: AgentRunInputSource,
    message: UIMessage,
  ): Promise<AgentRunInput> {
    this.assertActive();
    this.clearCompletionCandidate();
    this.appendMessages([message]);
    const queued = await enqueueAgentRunInput({ runId: this.runId, kind, source, message });
    insertRuntimeEvent({
      runId: this.runId,
      conversationId: this.conversationId,
      kind: "loop_input",
      status: "queued",
      title: `${kind} input queued`,
      detail: { inputId: queued.id, source, sequence: queued.sequence },
    });
    return queued;
  }

  async drain(kind: AgentRunInputKind): Promise<UIMessage[]> {
    this.assertActive();
    const inputs = await consumeAgentRunInputs(this.runId, kind);
    for (const input of inputs) {
      insertRuntimeEvent({
        runId: this.runId,
        conversationId: this.conversationId,
        kind: "loop_input",
        status: "succeeded",
        title: `${kind} input consumed`,
        detail: { inputId: input.id, source: input.source, sequence: input.sequence },
      });
    }
    return inputs.map(parseInputMessage);
  }

  recordStep(): AgentLoopBudgetReason | null {
    this.turnCount += 1;
    this.noProgressRounds += 1;
    this.budgetReason = this.checkBudget();
    void this.persistControlMetadata();
    return this.budgetReason;
  }

  beginToolCall(): boolean {
    if (this.absoluteLimitExceededReason || !this.isActive) return false;
    if (this.toolCallCount >= this.absoluteMaxToolCalls) {
      this.absoluteLimitReason = "absolute_tool_calls";
      void this.persistControlMetadata();
      return false;
    }
    this.toolCallCount += 1;
    this.budgetReason = this.checkBudget();
    void this.persistControlMetadata();
    return true;
  }

  recordProgress(): void {
    this.noProgressRounds = 0;
    this.budgetReason = null;
    void this.persistControlMetadata();
  }

  get noProgressExceeded(): boolean {
    return this.noProgressRounds >= this.maxNoProgressRounds;
  }

  setCompletionCandidate(candidate: AgentCompletionCandidate | undefined): void {
    this.completionCandidate = candidate;
    void this.persistControlMetadata();
  }

  clearCompletionCandidate(): void {
    this.setCompletionCandidate(undefined);
  }

  beginNextWindow(): void {
    this.windowCount += 1;
    this.windowStartedAt = Date.now();
    this.budgetReason = null;
    void this.persistControlMetadata();
  }

  async markWaitingApproval(): Promise<void> {
    if (!this.isActive) return;
    await updateRuntimeRun(this.runId, { status: "waiting_approval" });
  }

  async markRunning(): Promise<void> {
    if (!this.isActive) return;
    await updateRuntimeRun(this.runId, { status: "running" });
  }

  attachRuntime(handles: { coordinator: unknown; recorder: unknown }): void {
    this.runtimeHandles = handles;
  }

  appendMessages(messages: UIMessage[]): void {
    const known = new Set(this.messageTrace.map((message) => message.id));
    for (const message of messages) {
      if (known.has(message.id)) continue;
      known.add(message.id);
      this.messageTrace.push(message);
    }
  }

  async cancel(reason = "user_cancelled"): Promise<void> {
    if (this.closed) return;
    this.controller.abort(reason);
    await this.close("cancelled", "cancelled", reason);
  }

  async interrupt(reason = "application_interrupted"): Promise<void> {
    if (this.closed) return;
    this.controller.abort(reason);
    await this.close("interrupted", "interrupted", reason);
  }

  async complete(outputSummary?: string, usage?: unknown): Promise<void> {
    await this.close(
      "succeeded",
      this.budgetReason ? "budget_exhausted" : "natural",
      this.budgetReason ?? undefined,
      outputSummary,
      usage,
    );
  }

  async block(reason: string, outputSummary?: string): Promise<void> {
    await this.close("blocked", "absolute_limit", reason, outputSummary);
  }

  async fail(error: string): Promise<void> {
    await this.close("failed", "error", error);
  }

  private checkBudget(): AgentLoopBudgetReason | null {
    if (this.turnCount >= this.maxTurns) return "max_turns";
    if (this.toolCallCount >= this.maxToolCalls) return "max_tool_calls";
    if (Date.now() - this.windowStartedAt >= this.maxDurationMs) return "max_duration";
    return null;
  }

  private checkAbsoluteLimit(): AgentLoopAbsoluteLimitReason | null {
    if (Date.now() - this.startedAt >= this.absoluteMaxDurationMs) return "absolute_duration";
    if (this.toolCallCount >= this.absoluteMaxToolCalls) return "absolute_tool_calls";
    return null;
  }

  private async persistControlMetadata(blockedReason?: string): Promise<void> {
    await updateRuntimeRun(this.runId, {
      metadata_json: JSON.stringify({ ...this.controlMetadata, blockedReason }),
    });
  }

  private assertActive(): void {
    if (!this.isActive) {
      throw new AgentLoopSessionError("run_not_active", `Agent run '${this.runId}' is not active.`);
    }
  }

  private async close(
    status: "succeeded" | "failed" | "cancelled" | "interrupted" | "blocked",
    finishReason: NonNullable<RuntimeRun["finish_reason"]>,
    detail?: string,
    outputSummary?: string,
    usage?: unknown,
  ): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const now = Date.now();
    await discardAgentRunInputs(this.runId, detail ?? finishReason, now);
    await updateRuntimeRun(this.runId, {
      status,
      finish_reason: finishReason,
      output_summary: outputSummary,
      error:
        status === "failed" || status === "blocked"
          ? (detail ?? (status === "blocked" ? "Agent run blocked" : "Agent run failed"))
          : null,
      usage_json: usage === undefined ? undefined : JSON.stringify(usage),
      metadata_json: JSON.stringify({ ...this.controlMetadata, blockedReason: detail }),
      finished_at: now,
    });
    if (finishReason === "budget_exhausted" || finishReason === "absolute_limit") {
      insertRuntimeEvent({
        runId: this.runId,
        conversationId: this.conversationId,
        kind: "budget",
        status: "succeeded",
        title:
          finishReason === "absolute_limit"
            ? "Agent run blocked by absolute limit"
            : "Agent run budget window exhausted",
        detail: { reason: detail, ...this.usage },
      });
    }
    this.onClosed(this.runId);
  }
}

function parseControlMetadata(raw: string | undefined): AgentLoopControlMetadata & {
  windowStartedAt?: number;
} {
  if (!raw) {
    return {
      windowCount: 0,
      totalTurns: 0,
      totalToolCalls: 0,
      noProgressRounds: 0,
      absoluteDeadline: 0,
      resumable: true,
    };
  }
  try {
    const value = JSON.parse(raw) as Partial<AgentLoopControlMetadata> & {
      windowStartedAt?: number;
    };
    return {
      windowCount: typeof value.windowCount === "number" ? value.windowCount : 0,
      totalTurns: typeof value.totalTurns === "number" ? value.totalTurns : 0,
      totalToolCalls: typeof value.totalToolCalls === "number" ? value.totalToolCalls : 0,
      noProgressRounds: typeof value.noProgressRounds === "number" ? value.noProgressRounds : 0,
      absoluteDeadline: typeof value.absoluteDeadline === "number" ? value.absoluteDeadline : 0,
      completionCandidate: value.completionCandidate,
      blockedReason: value.blockedReason,
      resumable: value.resumable !== false,
      windowStartedAt: value.windowStartedAt,
    };
  } catch {
    return {
      windowCount: 0,
      totalTurns: 0,
      totalToolCalls: 0,
      noProgressRounds: 0,
      absoluteDeadline: 0,
      resumable: true,
    };
  }
}

export class AgentLoopSessionManager {
  private readonly sessions = new Map<string, AgentLoopSession>();

  async start(options: AgentLoopSessionOptions): Promise<AgentLoopSession> {
    const mode = options.mode ?? "start";
    const active = this.sessions.get(options.runId);
    if (active) {
      if (mode === "start") {
        throw new AgentLoopSessionError(
          "run_conflict",
          `Agent run '${options.runId}' already exists.`,
        );
      }
      if (active.conversationId !== options.conversationId) {
        throw new AgentLoopSessionError(
          "conversation_mismatch",
          "Agent run belongs to a different conversation.",
        );
      }
      await active.markRunning();
      active.clearCompletionCandidate();
      active.appendMessages(options.messages ?? []);
      return active;
    }

    if (mode === "resume") {
      const existing = getRuntimeRun(options.runId);
      if (!existing) {
        throw new AgentLoopSessionError(
          "run_not_found",
          `Agent run '${options.runId}' was not found.`,
        );
      }
      if (existing.status !== "blocked") {
        throw new AgentLoopSessionError(
          "run_not_active",
          `Agent run '${options.runId}' cannot be resumed after its process ended.`,
        );
      }
      const resumed = new AgentLoopSession(
        existing,
        options.runtimeConfig ?? DEFAULT_AGENT_RUNTIME_CONFIG,
        (runId) => this.sessions.delete(runId),
        options.messages,
      );
      if (!resumed.isResumable) {
        throw new AgentLoopSessionError(
          "absolute_limit_reached",
          `Agent run '${options.runId}' reached its absolute safety limit.`,
        );
      }
      await resumed.markRunning();
      this.sessions.set(existing.id, resumed);
      return resumed;
    }

    if (getRuntimeRun(options.runId)) {
      throw new AgentLoopSessionError(
        "run_conflict",
        `Agent run '${options.runId}' already exists.`,
      );
    }

    const busy = options.conversationId
      ? listRuntimeRuns(1_000).find(
          (run) =>
            run.conversation_id === options.conversationId && ACTIVE_STATUSES.has(run.status),
        )
      : undefined;
    if (busy) {
      throw new AgentLoopSessionError(
        "conversation_busy",
        `Conversation already has active agent run '${busy.id}'.`,
      );
    }
    const run = await createRuntimeRun({
      id: options.runId,
      conversation_id: options.conversationId ?? null,
      root_agent_id: options.rootAgentId,
      final_agent_id: options.rootAgentId,
      origin: options.origin ?? "chat",
      status: "running",
      model_ref: options.modelRef,
      trace_id: options.runId,
      input_summary: options.inputSummary ?? null,
    });
    const session = new AgentLoopSession(
      run,
      options.runtimeConfig ?? DEFAULT_AGENT_RUNTIME_CONFIG,
      (runId) => this.sessions.delete(runId),
      options.messages,
    );
    this.sessions.set(run.id, session);
    return session;
  }

  get(runId: string): AgentLoopSession | null {
    return this.sessions.get(runId) ?? null;
  }

  hasActiveSessions(): boolean {
    for (const session of this.sessions.values()) {
      if (session.isActive) return true;
    }
    return false;
  }

  async enqueue(
    runId: string,
    kind: AgentRunInputKind,
    source: AgentRunInputSource,
    message: UIMessage,
  ): Promise<AgentRunInput> {
    const session = this.sessions.get(runId);
    if (!session) {
      throw new AgentLoopSessionError("run_not_active", `Agent run '${runId}' is not active.`);
    }
    return session.enqueue(kind, source, message);
  }

  enqueueFollowUp(runId: string, message: UIMessage, source: AgentRunInputSource = "system") {
    return this.enqueue(runId, "follow_up", source, message);
  }

  async cancel(runId: string): Promise<boolean> {
    const session = this.sessions.get(runId);
    if (!session) return false;
    await session.cancel();
    return true;
  }

  async interruptAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    await Promise.all(sessions.map((session) => session.interrupt()));
    await Promise.all(sessions.map((session) => session.waitForStreamCompletions()));
  }
}

export const agentLoopSessions = new AgentLoopSessionManager();

function parseInputMessage(input: AgentRunInput): UIMessage {
  const parsed = JSON.parse(input.message_json) as UIMessage;
  if (!parsed || typeof parsed.id !== "string" || !Array.isArray(parsed.parts)) {
    throw new Error(`Agent run input '${input.id}' does not contain a valid UI message.`);
  }
  return parsed;
}
