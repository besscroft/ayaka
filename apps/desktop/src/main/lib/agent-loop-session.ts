import type { UIMessage } from "ai";
import {
  DEFAULT_AGENT_RUNTIME_CONFIG,
  type AgentRunInput,
  type AgentRunInputKind,
  type AgentRunInputSource,
  type AgentRunOrigin,
  type AgentRuntimeConfig,
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

export class AgentLoopSessionError extends Error {
  constructor(
    readonly code:
      | "run_conflict"
      | "run_not_found"
      | "run_not_active"
      | "conversation_mismatch"
      | "conversation_busy",
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
  private turnCount = 0;
  private toolCallCount = 0;
  private closed = false;
  private budgetReason: AgentLoopBudgetReason | null = null;
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
    this.appendMessages(initialMessages);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get isActive(): boolean {
    return !this.closed && !this.controller.signal.aborted;
  }

  get budgetExceededReason(): AgentLoopBudgetReason | null {
    this.budgetReason ??= this.checkBudget();
    return this.budgetReason;
  }

  get usage(): { turnCount: number; toolCallCount: number; elapsedMs: number } {
    return {
      turnCount: this.turnCount,
      toolCallCount: this.toolCallCount,
      elapsedMs: Math.max(0, Date.now() - this.startedAt),
    };
  }

  get remainingDurationMs(): number {
    return Math.max(1, this.maxDurationMs - (Date.now() - this.startedAt));
  }

  enqueue(kind: AgentRunInputKind, source: AgentRunInputSource, message: UIMessage): AgentRunInput {
    this.assertActive();
    this.appendMessages([message]);
    const queued = enqueueAgentRunInput({ runId: this.runId, kind, source, message });
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

  drain(kind: AgentRunInputKind): UIMessage[] {
    this.assertActive();
    const inputs = consumeAgentRunInputs(this.runId, kind);
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
    this.budgetReason = this.checkBudget();
    return this.budgetReason;
  }

  beginToolCall(): boolean {
    if (this.toolCallCount >= this.maxToolCalls || !this.isActive) return false;
    this.toolCallCount += 1;
    this.budgetReason = this.checkBudget();
    return true;
  }

  markWaitingApproval(): void {
    if (!this.isActive) return;
    updateRuntimeRun(this.runId, { status: "waiting_approval" });
  }

  markRunning(): void {
    if (!this.isActive) return;
    updateRuntimeRun(this.runId, { status: "running" });
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

  cancel(reason = "user_cancelled"): void {
    if (this.closed) return;
    this.controller.abort(reason);
    this.close("cancelled", "cancelled", reason);
  }

  interrupt(reason = "application_interrupted"): void {
    if (this.closed) return;
    this.controller.abort(reason);
    this.close("interrupted", "interrupted", reason);
  }

  complete(outputSummary?: string, usage?: unknown): void {
    this.close(
      "succeeded",
      this.budgetReason ? "budget_exhausted" : "natural",
      this.budgetReason ?? undefined,
      outputSummary,
      usage,
    );
  }

  fail(error: string): void {
    this.close("failed", "error", error);
  }

  private checkBudget(): AgentLoopBudgetReason | null {
    if (this.turnCount >= this.maxTurns) return "max_turns";
    if (this.toolCallCount >= this.maxToolCalls) return "max_tool_calls";
    if (Date.now() - this.startedAt >= this.maxDurationMs) return "max_duration";
    return null;
  }

  private assertActive(): void {
    if (!this.isActive) {
      throw new AgentLoopSessionError("run_not_active", `Agent run '${this.runId}' is not active.`);
    }
  }

  private close(
    status: "succeeded" | "failed" | "cancelled" | "interrupted",
    finishReason: NonNullable<RuntimeRun["finish_reason"]>,
    detail?: string,
    outputSummary?: string,
    usage?: unknown,
  ): void {
    if (this.closed) return;
    this.closed = true;
    const now = Date.now();
    discardAgentRunInputs(this.runId, detail ?? finishReason, now);
    updateRuntimeRun(this.runId, {
      status,
      finish_reason: finishReason,
      output_summary: outputSummary,
      error: status === "failed" ? (detail ?? "Agent run failed") : null,
      usage_json: usage === undefined ? undefined : JSON.stringify(usage),
      finished_at: now,
    });
    if (finishReason === "budget_exhausted") {
      insertRuntimeEvent({
        runId: this.runId,
        conversationId: this.conversationId,
        kind: "budget",
        status: "succeeded",
        title: "Agent run budget exhausted",
        detail: { reason: detail, ...this.usage },
      });
    }
    this.onClosed(this.runId);
  }
}

export class AgentLoopSessionManager {
  private readonly sessions = new Map<string, AgentLoopSession>();

  start(options: AgentLoopSessionOptions): AgentLoopSession {
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
      active.markRunning();
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
      throw new AgentLoopSessionError(
        "run_not_active",
        `Agent run '${options.runId}' cannot be resumed after its process ended.`,
      );
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
    const run = createRuntimeRun({
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

  enqueue(
    runId: string,
    kind: AgentRunInputKind,
    source: AgentRunInputSource,
    message: UIMessage,
  ): AgentRunInput {
    const session = this.sessions.get(runId);
    if (!session) {
      throw new AgentLoopSessionError("run_not_active", `Agent run '${runId}' is not active.`);
    }
    return session.enqueue(kind, source, message);
  }

  enqueueFollowUp(runId: string, message: UIMessage, source: AgentRunInputSource = "system") {
    return this.enqueue(runId, "follow_up", source, message);
  }

  cancel(runId: string): boolean {
    const session = this.sessions.get(runId);
    if (!session) return false;
    session.cancel();
    return true;
  }

  interruptAll(): void {
    for (const session of this.sessions.values()) session.interrupt();
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
