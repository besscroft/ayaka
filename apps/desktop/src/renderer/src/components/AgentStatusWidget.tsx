import { useEffect, useMemo, useState } from "react";
import type { AgentInstanceRecord, RuntimeSnapshot } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import {
  IconBrain,
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
} from "./icons";

type RuntimeSnapshotSubset = Pick<
  RuntimeSnapshot,
  "runtimeRuns" | "runtimeSteps" | "runtimeEvents" | "agentInstances" | "agentRunInputs"
>;

interface AgentStatusWidgetProps {
  conversationId: string;
  snapshot: RuntimeSnapshotSubset | null;
  chatStatus: "submitted" | "streaming" | "ready" | "stopped" | "error";
  isChatActive: boolean;
}

const ACTIVE = new Set(["queued", "running", "waiting_approval", "waiting_handoff"]);

export function AgentStatusWidget({
  conversationId,
  snapshot,
  chatStatus,
  isChatActive,
}: AgentStatusWidgetProps): React.JSX.Element | null {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const [, setClock] = useState(0);
  const run = useMemo(
    () =>
      (snapshot?.runtimeRuns ?? [])
        .filter((item) => item.conversation_id === conversationId)
        .sort((a, b) => b.started_at - a.started_at)[0],
    [conversationId, snapshot],
  );
  const active = isChatActive || (run ? ACTIVE.has(run.status) : false);
  const inputs = (snapshot?.agentRunInputs ?? []).filter((item) => item.run_id === run?.id);
  const children = (snapshot?.agentInstances ?? [])
    .filter((item) => item.run_id === run?.id)
    .sort((a, b) => a.created_at - b.created_at);
  const turns = (snapshot?.runtimeSteps ?? []).filter(
    (item) => item.run_id === run?.id && item.kind === "model",
  );
  const toolCalls = (snapshot?.runtimeSteps ?? []).filter(
    (item) => item.run_id === run?.id && item.kind === "tool",
  );
  const budget = (snapshot?.runtimeEvents ?? []).find(
    (item) => item.run_id === run?.id && item.kind === "budget",
  );

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!run && !isChatActive) return null;
  const failed = chatStatus === "error" || run?.status === "failed";
  const waiting = run?.status === "waiting_approval";
  const status = waiting
    ? "waiting_approval"
    : active
      ? "running"
      : failed
        ? "failed"
        : (run?.status ?? "queued");
  const elapsed = formatElapsed((run?.finished_at ?? Date.now()) - (run?.started_at ?? Date.now()));
  const title = waiting
    ? t("agentStatus.waitingApproval")
    : active
      ? t("agentStatus.running", {
          count: children.filter((item) => item.status === "running").length + 1,
        })
      : failed
        ? t("agentStatus.failed")
        : t("agentStatus.completed");

  return (
    <aside
      className={cn(
        "relative w-full min-w-0 rounded-md border border-border/70 bg-background/90 transition-transform duration-150 ease-out hover:-translate-y-px motion-reduce:transition-none",
        active && "border-accent/25",
      )}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <StatusIcon status={status} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <span className="shrink-0 text-xs tabular-nums text-foreground/50">{elapsed}</span>
        <IconChevronDown
          className={cn(
            "size-3.5 shrink-0 text-foreground/45 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded ? (
        <div className="absolute inset-x-0 top-[calc(100%-1px)] z-50 max-h-[min(460px,60vh)] w-full overflow-y-auto rounded-b-md border border-border/70 bg-background/98 p-2">
          <AgentRow
            name="Paimon"
            path="/root"
            status={status}
            summary={run?.output_summary ?? null}
            error={run?.error ?? null}
          />
          {children.map((item) => (
            <InstanceRow key={item.id} instance={item} />
          ))}
          <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border/50 pt-2 text-xs text-foreground/60">
            <span>{t("agentStatus.turns", { count: turns.length })}</span>
            <span>{t("agentStatus.inputs", { count: inputs.length })}</span>
            <span>
              {t("agentStatus.budget")}:{" "}
              {budget ? t("agentStatus.exhausted") : `${turns.length}/8 · ${toolCalls.length}/50`}
            </span>
            <span>
              {t("agentStatus.queue")}: {inputs.filter((item) => item.status === "queued").length}
            </span>
          </div>
          {inputs.length ? (
            <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
              {inputs.map((input) => (
                <div
                  key={input.id}
                  className="flex justify-between gap-2 px-2 py-1 text-[11px] text-foreground/55"
                >
                  <span>
                    {input.kind} · {input.source}
                  </span>
                  <span>{input.status}</span>
                </div>
              ))}
            </div>
          ) : null}
          {active ? (
            <div className="flex justify-end px-2 pt-2">
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => run && void api.runtime.cancelRun(run.id)}
              >
                {t("input.stop")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
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
    <div className="flex items-start gap-2 rounded-md px-2 py-2">
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{name}</span>
          <span className="font-mono text-[10px] text-foreground/40">{path}</span>
        </div>
        {summary ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] text-foreground/55">{summary}</p>
        ) : null}
        {error ? <p className="mt-0.5 text-[11px] text-danger">{error}</p> : null}
      </div>
      <span className="text-[10px] text-foreground/45">{statusLabel(status, t)}</span>
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

function StatusIcon({ status }: { status: string }): React.JSX.Element {
  if (status === "succeeded" || status === "completed")
    return <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-success" />;
  if (status === "failed") return <IconCircleX className="mt-0.5 size-4 shrink-0 text-danger" />;
  if (status === "cancelled" || status === "interrupted")
    return <IconCircleDashed className="mt-0.5 size-4 shrink-0 text-foreground/45" />;
  if (status === "waiting_approval")
    return <IconBrain className="mt-0.5 size-4 shrink-0 animate-pulse text-warning" />;
  return (
    <span className="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center">
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
    </span>
  );
}

function statusLabel(status: string, t: ReturnType<typeof useT>["t"]): string {
  const key =
    status === "waiting_approval"
      ? "waitingApproval"
      : status === "running"
        ? "running"
        : status === "failed"
          ? "failed"
          : status === "succeeded"
            ? "completed"
            : "interrupted";
  return t(`agentStatus.status.${key}`);
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
