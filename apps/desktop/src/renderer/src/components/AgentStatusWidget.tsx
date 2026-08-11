import { useEffect, useMemo, useState } from "react";
import type { AgentInstanceRecord, RuntimeRun, RuntimeSnapshot, RuntimeStep } from "@shared/types";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import {
  IconBrain,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconPanelRightClose,
  IconPanelRightOpen,
} from "./icons";

type RuntimeSnapshotSubset = Pick<
  RuntimeSnapshot,
  | "runtimeRuns"
  | "runtimeSteps"
  | "runtimeEvents"
  | "agentInstances"
  | "agentRunInputs"
  | "conversationAgentStates"
>;

interface AgentStatusWidgetProps {
  conversationId: string;
  snapshot: RuntimeSnapshotSubset | null;
  chatStatus: "submitted" | "streaming" | "ready" | "stopped" | "error";
  isChatActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStop: () => void;
}

const ACTIVE_RUN_STATUSES = new Set(["queued", "running", "waiting_approval", "waiting_handoff"]);
const ACTIVE_INSTANCE_STATUSES = new Set([
  "queued",
  "running",
  "reviewing",
  "handoff",
  "tool_calling",
  "sandbox",
  "learning",
]);

export function selectLatestConversationRun(
  runs: RuntimeRun[],
  conversationId: string,
): RuntimeRun | undefined {
  return runs
    .filter((item) => item.conversation_id === conversationId)
    .sort((a, b) => b.started_at - a.started_at)[0];
}

export function getRecentRuntimeSteps(
  steps: RuntimeStep[],
  runId: string | undefined,
  limit = 6,
): RuntimeStep[] {
  return steps
    .filter((item) => item.run_id === runId)
    .sort((a, b) => b.started_at - a.started_at)
    .slice(0, limit);
}

export function resolveAgentPanelStatus({
  chatStatus,
  isChatActive,
  runStatus,
  conversationStatus,
}: {
  chatStatus: AgentStatusWidgetProps["chatStatus"];
  isChatActive: boolean;
  runStatus?: string;
  conversationStatus?: string;
}): string {
  if (runStatus === "waiting_approval" || conversationStatus === "reviewing") {
    return "waiting_approval";
  }
  if (runStatus === "waiting_handoff") return "waiting_handoff";
  if (chatStatus === "error" || runStatus === "failed") return "failed";
  if (isChatActive || (runStatus ? ACTIVE_RUN_STATUSES.has(runStatus) : false)) return "running";
  return runStatus ?? "idle";
}

export function AgentStatusWidget({
  conversationId,
  snapshot,
  chatStatus,
  isChatActive,
  open,
  onOpenChange,
  onStop,
}: AgentStatusWidgetProps): React.JSX.Element {
  const { t } = useT();
  const reduceMotion = useReducedMotion();
  const [, setClock] = useState(0);
  const run = useMemo(
    () => selectLatestConversationRun(snapshot?.runtimeRuns ?? [], conversationId),
    [conversationId, snapshot],
  );
  const conversationState = snapshot?.conversationAgentStates.find(
    (state) => state.conversation_id === conversationId,
  );
  const children = useMemo(
    () =>
      (snapshot?.agentInstances ?? [])
        .filter((item) => item.run_id === run?.id)
        .sort((a, b) => a.created_at - b.created_at),
    [run?.id, snapshot?.agentInstances],
  );
  const steps = useMemo(
    () => getRecentRuntimeSteps(snapshot?.runtimeSteps ?? [], run?.id, Number.MAX_SAFE_INTEGER),
    [run?.id, snapshot?.runtimeSteps],
  );
  const turns = steps.filter((item) => item.kind === "model");
  const toolCalls = steps.filter((item) => item.kind === "tool");
  const queuedInputs = (snapshot?.agentRunInputs ?? []).filter(
    (item) => item.run_id === run?.id && item.status === "queued",
  );
  const active = isChatActive || (run ? ACTIVE_RUN_STATUSES.has(run.status) : false);
  const waiting = run?.status === "waiting_approval" || conversationState?.status === "reviewing";
  const waitingHandoff = run?.status === "waiting_handoff";
  const failed = chatStatus === "error" || run?.status === "failed";
  const status = resolveAgentPanelStatus({
    chatStatus,
    isChatActive,
    runStatus: run?.status,
    conversationStatus: conversationState?.status,
  });
  const summary = conversationState?.summary || run?.output_summary || run?.input_summary;
  const currentStep = conversationState?.current_step_id
    ? snapshot?.runtimeSteps.find((step) => step.id === conversationState.current_step_id)
    : undefined;
  const elapsed = run?.started_at
    ? formatElapsed((run.finished_at ?? Date.now()) - run.started_at)
    : null;

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const title = waiting
    ? t("agentStatus.waitingApproval")
    : waitingHandoff
      ? t("agentStatus.status.waitingHandoff")
      : active
        ? t("agentStatus.running", {
            count: children.filter((item) => ACTIVE_INSTANCE_STATUSES.has(item.status)).length + 1,
          })
        : failed
          ? t("agentStatus.failed")
          : run
            ? t(
                run.status === "cancelled" || run.status === "interrupted"
                  ? "agentStatus.interrupted"
                  : "agentStatus.completed",
              )
            : t("agentStatus.ready");

  return (
    <motion.aside
      initial={false}
      animate={{ width: open ? 320 : 40 }}
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34, mass: 0.8 }
      }
      className={cn(
        "absolute inset-y-0 right-0 z-40 flex max-w-[calc(100vw-2.5rem)] shrink-0 overflow-hidden border-l border-border bg-background",
        "lg:relative lg:z-10",
        open && "shadow-lg",
      )}
      data-open={open}
      role="complementary"
      aria-label={t("agentStatus.panel")}
    >
      {open ? (
        <div className="flex h-full min-w-[320px] max-w-[calc(100vw-2.5rem)] flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3">
            <IconBrain className="size-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground/85">
                {t("agentStatus.panel")}
              </p>
              <p className="truncate text-[11px] text-foreground/45">{title}</p>
            </div>
            <button
              type="button"
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              onClick={() => onOpenChange(false)}
              aria-label={t("agentStatus.close")}
              title={t("agentStatus.close")}
            >
              <IconPanelRightClose className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <section className="border-b border-border pb-3" aria-labelledby="agent-status-current">
              <p
                id="agent-status-current"
                className="text-[10px] font-medium uppercase tracking-wide text-foreground/40"
              >
                {t("agentStatus.current")}
              </p>
              <div className="mt-2 flex items-start gap-2">
                <StatusIcon status={status} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground/85">{title}</p>
                  {currentStep ? (
                    <p className="mt-1 truncate text-xs text-foreground/60">{currentStep.title}</p>
                  ) : null}
                  {summary ? (
                    <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-foreground/50">
                      {summary}
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 text-xs tabular-nums text-foreground/45">
                  {elapsed ?? t("agentStatus.ready")}
                </span>
              </div>
            </section>

            <section className="border-b border-border py-3" aria-labelledby="agent-status-agents">
              <div className="flex items-center justify-between gap-2">
                <p
                  id="agent-status-agents"
                  className="text-[10px] font-medium uppercase tracking-wide text-foreground/40"
                >
                  {t("agentStatus.agents")}
                </p>
                <span className="text-[10px] tabular-nums text-foreground/40">
                  {children.length + 1}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <AgentRow
                  name={t("agentStatus.rootAgent")}
                  path="/root"
                  status={status}
                  summary={summary ?? null}
                  error={run?.error ?? null}
                />
                {children.map((item) => (
                  <InstanceRow key={item.id} instance={item} />
                ))}
              </div>
            </section>

            <section
              className="border-b border-border py-3"
              aria-labelledby="agent-status-activity"
            >
              <p
                id="agent-status-activity"
                className="text-[10px] font-medium uppercase tracking-wide text-foreground/40"
              >
                {t("agentStatus.activity")}
              </p>
              {steps.length === 0 ? (
                <p className="mt-2 text-xs text-foreground/45">{t("agentStatus.noActivity")}</p>
              ) : (
                <div className="mt-2 flex flex-col gap-1">
                  {steps.slice(0, 6).map((step) => (
                    <ActivityRow key={step.id} step={step} />
                  ))}
                </div>
              )}
            </section>

            <section className="py-3" aria-labelledby="agent-status-metrics">
              <p
                id="agent-status-metrics"
                className="text-[10px] font-medium uppercase tracking-wide text-foreground/40"
              >
                {t("agentStatus.metrics")}
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Metric label={t("agentStatus.metric.turns")} value={turns.length} />
                <Metric label={t("agentStatus.metric.tools")} value={toolCalls.length} />
                <Metric label={t("agentStatus.metric.pendingInputs")} value={queuedInputs.length} />
              </div>
            </section>

            {!run ? (
              <p className="border-t border-border pt-3 text-xs text-foreground/45">
                {t("agentStatus.noRun")}
              </p>
            ) : null}
          </div>

          {active && run ? (
            <div className="shrink-0 border-t border-border px-3 py-3">
              <Button size="sm" variant="tertiary" className="w-full" onPress={onStop}>
                {t("input.stop")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="flex h-full w-10 flex-col items-center gap-2 border-0 bg-background px-2 py-3 text-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
          onClick={() => onOpenChange(true)}
          aria-label={t("agentStatus.open")}
          aria-expanded={false}
          title={t("agentStatus.open")}
        >
          <StatusIcon status={status} />
          <IconPanelRightOpen className="size-4" aria-hidden="true" />
          <span className="sr-only">{title}</span>
        </button>
      )}
    </motion.aside>
  );
}

function AgentRow({
  name,
  path,
  status,
  summary,
  error,
}: {
  name: string;
  path: string;
  status: string;
  summary: string | null;
  error: string | null;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-2 py-2 hover:bg-muted">
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium text-foreground/80">{name}</span>
          <span className="truncate font-mono text-[10px] text-foreground/35">{path}</span>
        </div>
        {summary ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-foreground/50">{summary}</p>
        ) : null}
        {error ? <p className="mt-0.5 line-clamp-2 text-[11px] text-danger">{error}</p> : null}
      </div>
      <span className="shrink-0 text-[10px] text-foreground/40">{statusLabel(status, t)}</span>
    </div>
  );
}

function InstanceRow({ instance }: { instance: AgentInstanceRecord }): React.JSX.Element {
  return (
    <AgentRow
      name={instance.task_name || instance.agent_id}
      path={instance.agent_path}
      status={instance.status}
      summary={instance.task_summary || instance.last_message}
      error={instance.error}
    />
  );
}

function ActivityRow({ step }: { step: RuntimeStep }): React.JSX.Element {
  const { t } = useT();
  const duration = step.finished_at
    ? step.finished_at - step.started_at
    : Date.now() - step.started_at;
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
      <StatusIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground/75">{step.title}</p>
        <p className="mt-0.5 truncate text-[10px] text-foreground/40">
          {t(`runtime.kind.${step.kind}`)} · {formatElapsed(duration)}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-foreground/40">{statusLabel(step.status, t)}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-md border border-border px-2 py-2">
      <p className="truncate text-[10px] text-foreground/40">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums text-foreground/75">{value}</p>
    </div>
  );
}

function StatusIcon({ status }: { status: string }): React.JSX.Element {
  if (status === "succeeded" || status === "completed") {
    return <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-success" />;
  }
  if (status === "failed") return <IconCircleX className="mt-0.5 size-4 shrink-0 text-danger" />;
  if (status === "cancelled" || status === "interrupted" || status === "idle") {
    return <IconCircleDashed className="mt-0.5 size-4 shrink-0 text-foreground/40" />;
  }
  if (status === "waiting_approval" || status === "waiting_handoff" || status === "reviewing") {
    return <IconBrain className="mt-0.5 size-4 shrink-0 animate-pulse text-warning" />;
  }
  return (
    <span className="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent motion-reduce:animate-none" />
    </span>
  );
}

function statusLabel(status: string, t: ReturnType<typeof useT>["t"]): string {
  const key =
    status === "waiting_approval" || status === "reviewing"
      ? "waitingApproval"
      : status === "waiting_handoff"
        ? "waitingHandoff"
        : status === "running"
          ? "running"
          : status === "queued"
            ? "queued"
            : status === "failed"
              ? "failed"
              : status === "succeeded" || status === "completed"
                ? "completed"
                : status === "idle"
                  ? "idle"
                  : "interrupted";
  return t(`agentStatus.status.${key}`);
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
