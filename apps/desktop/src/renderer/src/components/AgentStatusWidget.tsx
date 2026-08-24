import { useEffect, useMemo, useState } from "react";
import type {
  AgentProfile,
  ChatReasoningLevel,
  ChatToolSelectionRequest,
  ProviderInfo,
  RuntimeRun,
  RuntimeSnapshot,
  RuntimeStep,
  ToolsSnapshot,
} from "@shared/types";
import { DEFAULT_AGENT_ID } from "@shared/types";
import { motion, useReducedMotion } from "motion/react";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import {
  buildAgentActivityItems,
  buildAgentTree,
  createAgentToolGroups,
  getAgentExpectedOutput,
  getAgentInstructions,
  getAgentToolPolicy,
  type AgentActivityItem,
  type AgentTreeNode,
} from "../lib/agent-drawer-model";
import {
  AnimatedDisclosure,
  AnimatedDisclosureChevron,
  AnimatedDisclosureContent,
  AnimatedDisclosureTrigger,
} from "./ai-elements/animated-disclosure";
import { Button } from "./ui";
import {
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconPanelRightClose,
  IconPanelRightOpen,
} from "./icons";
import { AgentAvatar } from "./AgentAvatar";

type RuntimeSnapshotSubset = Pick<
  RuntimeSnapshot,
  | "runtimeRuns"
  | "runtimeSteps"
  | "runtimeEvents"
  | "agentInstances"
  | "agentRunInputs"
  | "conversationAgentStates"
>;

export interface AgentStatusWidgetProps {
  conversationId: string;
  snapshot: RuntimeSnapshotSubset | null;
  profiles: AgentProfile[];
  providers: ProviderInfo[];
  selectedModel: string | null;
  reasoningLevel: ChatReasoningLevel;
  toolSelection: ChatToolSelectionRequest;
  tools: ToolsSnapshot | null;
  chatStatus: "submitted" | "streaming" | "ready" | "stopped" | "error";
  isChatActive: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStop: () => void;
  embedded?: boolean;
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

export function getAgentPanelAnimation(open: boolean): { width: number; opacity: number } {
  return { width: open ? 320 : 80, opacity: 1 };
}

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
  if (runStatus === "blocked") return "blocked";
  if (chatStatus === "error" || runStatus === "failed") return "failed";
  if (isChatActive || (runStatus ? ACTIVE_RUN_STATUSES.has(runStatus) : false)) return "running";
  return runStatus ?? "idle";
}

export function AgentStatusWidget({
  conversationId,
  snapshot,
  profiles,
  providers,
  selectedModel,
  reasoningLevel,
  toolSelection,
  tools,
  chatStatus,
  isChatActive,
  open,
  onOpenChange,
  onStop,
  embedded = false,
}: AgentStatusWidgetProps): React.JSX.Element {
  const { t } = useT();
  const reduceMotion = useReducedMotion();
  const [clock, setClock] = useState(0);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(["/root"]));

  const run = useMemo(
    () => selectLatestConversationRun(snapshot?.runtimeRuns ?? [], conversationId),
    [conversationId, snapshot],
  );
  const conversationState = snapshot?.conversationAgentStates.find(
    (state) => state.conversation_id === conversationId,
  );
  const instances = useMemo(
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
  const conversationCurrentStep = conversationState?.current_step_id
    ? snapshot?.runtimeSteps.find((step) => step.id === conversationState.current_step_id)
    : undefined;
  const rootProfile = useMemo(
    () =>
      profiles.find((item) => item.id === (run?.root_agent_id ?? DEFAULT_AGENT_ID)) ??
      profiles[0] ??
      null,
    [profiles, run?.root_agent_id],
  );
  const activeProfile = rootProfile;
  const turns = steps.filter((item) => item.kind === "model");
  const toolCalls = steps.filter((item) => item.kind === "tool");
  const queuedInputs = (snapshot?.agentRunInputs ?? []).filter(
    (item) => item.run_id === run?.id && item.status === "queued",
  );
  const active = isChatActive || (run ? ACTIVE_RUN_STATUSES.has(run.status) : false);
  const waiting = run?.status === "waiting_approval" || conversationState?.status === "reviewing";
  const waitingHandoff = run?.status === "waiting_handoff";
  const failed = chatStatus === "error" || run?.status === "failed";
  const blocked = run?.status === "blocked";
  const status = resolveAgentPanelStatus({
    chatStatus,
    isChatActive,
    runStatus: run?.status,
    conversationStatus: conversationState?.status,
  });
  const summary = conversationState?.summary || run?.output_summary || run?.input_summary;
  const blockedReason = blocked ? run?.error : null;
  const elapsed = run?.started_at
    ? formatElapsed((run.finished_at ?? Date.now()) - run.started_at)
    : null;
  const effectiveModel = run?.model_ref ?? activeProfile?.model_ref ?? selectedModel;
  const runtimeReasoning = getRuntimeReasoning(activeProfile, reasoningLevel);
  const tree = useMemo(
    () =>
      buildAgentTree({
        run,
        instances,
        conversationState,
        currentStep: conversationCurrentStep,
        profiles,
        rootName: activeProfile?.name || t("agentStatus.rootAgent"),
        rootStatus: status,
        rootSummary: summary ?? null,
        rootError: run?.error ?? null,
      }),
    [
      activeProfile?.name,
      conversationCurrentStep,
      conversationState,
      instances,
      profiles,
      run,
      status,
      summary,
      t,
    ],
  );
  const toolGroups = useMemo(
    () =>
      createAgentToolGroups({
        selectedModel: effectiveModel,
        providers,
        tools,
        selection: toolSelection,
        policy: getAgentToolPolicy(activeProfile),
      }),
    [activeProfile, effectiveModel, providers, toolSelection, tools],
  );
  const activeAgentId = conversationCurrentStep?.agent_id ?? conversationState?.active_agent_id;
  const activityItems = useMemo(
    () =>
      buildAgentActivityItems({
        runId: run?.id,
        activeAgentPath: tree.activePath,
        steps: activeAgentId ? steps.filter((step) => step.agent_id === activeAgentId) : steps,
        events: snapshot?.runtimeEvents ?? [],
        limit: 6,
        now: Date.now(),
      }),
    [activeAgentId, clock, run?.id, snapshot?.runtimeEvents, steps, tree.activePath],
  );

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  useEffect(() => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      addPathPrefixes(next, tree.activePath);
      return next;
    });
  }, [tree.activePath]);

  const title = blocked
    ? t("agentStatus.blocked")
    : waiting
      ? t("agentStatus.waitingApproval")
      : waitingHandoff
        ? t("agentStatus.status.waitingHandoff")
        : active
          ? t("agentStatus.running", {
              count:
                instances.filter((item) => ACTIVE_INSTANCE_STATUSES.has(item.status)).length + 1,
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

  const panelContent = (
    <div className="flex h-full min-w-[320px] max-w-[calc(100vw-2.5rem)] flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-3">
        <AgentAvatar
          profile={activeProfile}
          fallback={t("agentStatus.rootAgent")}
          className="size-8 rounded-lg bg-accent/15 text-sm font-semibold text-accent-foreground"
        />
        <div className="min-w-0 flex-1 select-none">
          <p className="truncate text-sm font-medium text-foreground/90">
            {activeProfile?.name || t("agentStatus.rootAgent")}
          </p>
          <p className="truncate text-[11px] text-foreground/50">
            {activeProfile?.role || t("agentStatus.roleFallback")} ·{" "}
            {formatModel(effectiveModel, t)}
          </p>
        </div>
        {!embedded ? (
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            onClick={() => onOpenChange(false)}
            aria-label={t("agentStatus.close")}
            title={t("agentStatus.close")}
          >
            <IconPanelRightClose className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {run && (active || waiting || failed || blocked) ? (
          <AttentionBar
            status={status}
            title={title}
            error={blockedReason ?? run.error}
            elapsed={elapsed}
          />
        ) : null}

        {run ? (
          <>
            <section className="border-b border-border py-3" aria-labelledby="agent-status-agents">
              <div className="flex items-center justify-between gap-2 select-none">
                <SectionLabel id="agent-status-agents" label={t("agentStatus.agents")} />
                <span className="text-[10px] tabular-nums text-foreground/40">
                  {instances.length + 1}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-0.5 select-none">
                <AgentTree
                  node={tree.root}
                  expandedPaths={expandedPaths}
                  onToggle={(path) => setExpandedPaths((current) => togglePath(current, path))}
                  t={t}
                />
              </div>
            </section>

            <section
              className="border-b border-border py-3 select-none"
              aria-labelledby="agent-status-activity"
            >
              <SectionLabel id="agent-status-activity" label={t("agentStatus.activity")} />
              {activityItems.length === 0 ? (
                <p className="mt-2 text-xs text-foreground/45">{t("agentStatus.noActivity")}</p>
              ) : (
                <div className="mt-2 flex flex-col gap-1">
                  {activityItems.map((item) => (
                    <ActivityRow key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>

            <section className="border-b border-border py-3" aria-labelledby="agent-status-metrics">
              <SectionLabel id="agent-status-metrics" label={t("agentStatus.metrics")} />
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Metric label={t("agentStatus.metric.turns")} value={turns.length} />
                <Metric label={t("agentStatus.metric.tools")} value={toolCalls.length} />
                <Metric label={t("agentStatus.metric.pendingInputs")} value={queuedInputs.length} />
              </div>
            </section>
          </>
        ) : null}

        <ConfigurationSection
          profile={activeProfile}
          effectiveModel={effectiveModel}
          reasoning={runtimeReasoning}
          instructions={getAgentInstructions(activeProfile)}
          expectedOutput={getAgentExpectedOutput(activeProfile)}
          toolGroups={toolGroups}
          toolsUnavailable={tools === null}
          t={t}
        />
      </div>

      {active && run ? (
        <div className="shrink-0 border-t border-border px-3 py-3 select-none">
          <Button size="sm" variant="tertiary" className="w-full" onPress={onStop}>
            {t("input.stop")}
          </Button>
        </div>
      ) : null}
    </div>
  );

  if (embedded) return panelContent;

  return (
    <motion.aside
      initial={open ? { width: 0, opacity: 0 } : false}
      animate={getAgentPanelAnimation(open)}
      exit={open ? { width: 0, opacity: 0 } : { opacity: 0 }}
      transition={
        reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 34, mass: 0.8 }
      }
      className={cn(
        "max-w-[calc(100vw-2.5rem)] min-w-0 shrink-0 overflow-hidden",
        open
          ? "relative h-full border-l border-border bg-background shadow-lg"
          : "relative h-10 border-l-0 bg-transparent",
      )}
      data-open={open}
      role="complementary"
      aria-label={t("agentStatus.panel")}
    >
      {open ? (
        panelContent
      ) : (
        <div
          className="flex h-full items-center gap-1 px-1"
          data-slot="agent-status-toolbar"
          role="group"
          aria-label={title}
        >
          <button
            type="button"
            className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/50"
            data-slot="agent-status-indicator"
            data-icon-only="true"
            data-icon-tone="neutral"
            onClick={() => onOpenChange(true)}
            aria-label={t("agentStatus.open")}
            aria-expanded={false}
            title={title}
          >
            <StatusIcon status={status} />
          </button>
          <button
            type="button"
            className="relative flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/50 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
            data-slot="agent-status-toggle"
            data-icon-only="true"
            data-icon-tone="neutral"
            onClick={() => onOpenChange(true)}
            aria-label={t("agentStatus.open")}
            aria-expanded={false}
            title={t("agentStatus.open")}
          >
            <IconPanelRightOpen className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </motion.aside>
  );
}

export type AgentStatusContentProps = Omit<
  AgentStatusWidgetProps,
  "open" | "onOpenChange" | "embedded"
>;

export function AgentStatusContent(props: AgentStatusContentProps): React.JSX.Element {
  return <AgentStatusWidget {...props} open onOpenChange={() => undefined} embedded />;
}

export function AgentStatusTrigger(
  props: AgentStatusContentProps & { onOpenChange: () => void },
): React.JSX.Element {
  return <AgentStatusWidget {...props} open={false} onOpenChange={() => props.onOpenChange()} />;
}

function ConfigurationSection({
  profile,
  effectiveModel,
  reasoning,
  instructions,
  expectedOutput,
  toolGroups,
  toolsUnavailable,
  t,
}: {
  profile: AgentProfile | null;
  effectiveModel: string | null;
  reasoning: string;
  instructions: string;
  expectedOutput: string;
  toolGroups: ReturnType<typeof createAgentToolGroups>;
  toolsUnavailable: boolean;
  t: ReturnType<typeof useT>["t"];
}): React.JSX.Element {
  return (
    <div className="divide-y divide-border select-none">
      <AnimatedDisclosure defaultOpen active={false} className="py-3">
        <AnimatedDisclosureTrigger className="flex w-full items-center justify-between gap-2 text-left">
          <SectionLabel label={t("agentStatus.configuration")} />
          <AnimatedDisclosureChevron className="text-foreground/40">
            <IconChevronDown className="size-4" />
          </AnimatedDisclosureChevron>
        </AnimatedDisclosureTrigger>
        <AnimatedDisclosureContent innerClassName="pt-3">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
            <span className="text-foreground/40">{t("agentStatus.model")}</span>
            <span className="truncate text-right text-foreground/75">
              {formatModel(effectiveModel, t)}
            </span>
            <span className="text-foreground/40">{t("agentStatus.reasoning")}</span>
            <span className="text-right text-foreground/75">{reasoning}</span>
            <span className="text-foreground/40">{t("agentStatus.role")}</span>
            <span className="truncate text-right text-foreground/75">
              {profile?.role || t("agentStatus.roleFallback")}
            </span>
          </div>
        </AnimatedDisclosureContent>
      </AnimatedDisclosure>

      <AnimatedDisclosure active={false} className="py-3">
        <AnimatedDisclosureTrigger className="flex w-full items-center justify-between gap-2 text-left">
          <SectionLabel label={t("agentStatus.instructions")} />
          <AnimatedDisclosureChevron className="text-foreground/40">
            <IconChevronDown className="size-4" />
          </AnimatedDisclosureChevron>
        </AnimatedDisclosureTrigger>
        <AnimatedDisclosureContent innerClassName="pt-2">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/65">
            {instructions || t("agentStatus.notConfigured")}
          </p>
        </AnimatedDisclosureContent>
      </AnimatedDisclosure>

      <AnimatedDisclosure className="py-3">
        <AnimatedDisclosureTrigger className="flex w-full items-center justify-between gap-2 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <SectionLabel label={t("agentStatus.tools")} />
            <span className="text-[10px] tabular-nums text-foreground/40">
              {toolGroups.reduce((total, group) => total + group.tools.length, 0)}
            </span>
          </div>
          <AnimatedDisclosureChevron className="text-foreground/40">
            <IconChevronDown className="size-4" />
          </AnimatedDisclosureChevron>
        </AnimatedDisclosureTrigger>
        <AnimatedDisclosureContent innerClassName="pt-2">
          {toolsUnavailable ? (
            <p className="text-xs text-foreground/45">{t("agentStatus.toolsUnavailable")}</p>
          ) : toolGroups.length === 0 ? (
            <p className="text-xs text-foreground/45">{t("agentStatus.noTools")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {toolGroups.map((group) => (
                <ToolGroup key={group.category} group={group} t={t} />
              ))}
            </div>
          )}
        </AnimatedDisclosureContent>
      </AnimatedDisclosure>

      <AnimatedDisclosure className="py-3">
        <AnimatedDisclosureTrigger className="flex w-full items-center justify-between gap-2 text-left">
          <SectionLabel label={t("agentStatus.expectedOutput")} />
          <AnimatedDisclosureChevron className="text-foreground/40">
            <IconChevronDown className="size-4" />
          </AnimatedDisclosureChevron>
        </AnimatedDisclosureTrigger>
        <AnimatedDisclosureContent innerClassName="pt-2">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/65">
            {expectedOutput}
          </p>
        </AnimatedDisclosureContent>
      </AnimatedDisclosure>
    </div>
  );
}

function ToolGroup({
  group,
  t,
}: {
  group: ReturnType<typeof createAgentToolGroups>[number];
  t: ReturnType<typeof useT>["t"];
}): React.JSX.Element {
  return (
    <AnimatedDisclosure>
      <AnimatedDisclosureTrigger className="flex w-full select-none items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted">
        <span className="text-[10px] font-medium text-foreground/65">
          {t(`agentStatus.toolCategory.${group.category}`)}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-foreground/40">
          {group.tools.length}
          <AnimatedDisclosureChevron>
            <IconChevronDown className="size-3" />
          </AnimatedDisclosureChevron>
        </span>
      </AnimatedDisclosureTrigger>
      <AnimatedDisclosureContent innerClassName="pt-1">
        <div className="flex flex-col gap-1">
          {group.tools.map((tool) => (
            <div key={tool.id} className="rounded-md px-2 py-1.5 hover:bg-muted">
              <div className="flex min-w-0 items-center gap-2">
                {tool.active ? (
                  <IconCheck className="size-3 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <span
                    className="size-3 shrink-0 rounded-full border border-foreground/25"
                    aria-hidden="true"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-foreground/75">
                  {tool.label}
                </span>
                {tool.approvalRequired ? (
                  <span className="shrink-0 text-[10px] text-warning">
                    {t("agentStatus.approval")}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 line-clamp-2 pl-5 text-[10px] leading-relaxed text-foreground/45">
                {tool.description}
              </p>
              <p className="mt-0.5 pl-5 text-[10px] text-foreground/35">
                {tool.available ? t("agentStatus.toolAvailable") : t("agentStatus.toolUnavailable")}
                {tool.sourceName ? ` · ${tool.sourceName}` : ""}
              </p>
            </div>
          ))}
        </div>
      </AnimatedDisclosureContent>
    </AnimatedDisclosure>
  );
}

function AgentTree({
  node,
  expandedPaths,
  onToggle,
  t,
}: {
  node: AgentTreeNode;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  t: ReturnType<typeof useT>["t"];
}): React.JSX.Element {
  const hasChildren = node.children.length > 0;
  const expanded = expandedPaths.has(node.path);
  return (
    <div>
      <div
        className={cn(
          "flex select-none min-w-0 items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted",
          node.active && "bg-accent/10",
          node.depth > 0 && "ml-4 border-l border-border rounded-l-none",
        )}
      >
        <StatusIcon status={node.status} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-medium text-foreground/80">{node.name}</span>
            <span className="truncate font-mono text-[10px] text-foreground/35">{node.path}</span>
          </div>
          {node.summary ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-foreground/50">{node.summary}</p>
          ) : null}
          {node.error ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] text-danger">{node.error}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-[10px] text-foreground/40">
          {statusLabel(node.status, t)}
        </span>
        {hasChildren ? (
          <button
            type="button"
            data-icon-only="true"
            data-icon-tone="neutral"
            className="flex size-5 shrink-0 items-center justify-center rounded text-foreground/45 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={expanded ? t("agentStatus.collapseBranch") : t("agentStatus.expandBranch")}
            aria-expanded={expanded}
            onClick={() => onToggle(node.path)}
          >
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.16 }}
              className="flex"
            >
              <IconChevronDown className="size-3" aria-hidden="true" />
            </motion.span>
          </button>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        <div>
          {node.children.map((child) => (
            <AgentTree
              key={child.id}
              node={child}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              t={t}
            />
          ))}
        </div>
      ) : null}
      {!expanded && hasChildren ? (
        <p className="ml-10 text-[10px] text-foreground/35">
          {t("agentStatus.collapsedAgents", { count: node.descendantCount })}
        </p>
      ) : null}
    </div>
  );
}

function AttentionBar({
  status,
  title,
  error,
  elapsed,
}: {
  status: string;
  title: string;
  error: string | null;
  elapsed: string | null;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "mb-3 flex items-start gap-2 rounded-md border px-2.5 py-2 select-none",
        status === "failed"
          ? "border-danger/30 bg-danger/5"
          : status === "waiting_approval" || status === "waiting_handoff"
            ? "border-warning/30 bg-warning/5"
            : "border-primary/25 bg-primary/5",
      )}
    >
      <StatusIcon status={status} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-foreground/80">{title}</p>
        {error ? <p className="mt-1 line-clamp-3 text-[11px] text-danger">{error}</p> : null}
      </div>
      {elapsed ? (
        <span className="shrink-0 pt-0.5 text-xs tabular-nums text-foreground/45">{elapsed}</span>
      ) : null}
    </div>
  );
}

function SectionLabel({ id, label }: { id?: string; label: string }): React.JSX.Element {
  return (
    <p
      id={id}
      className="text-[10px] font-medium uppercase tracking-wide text-foreground/40 select-none"
    >
      {label}
    </p>
  );
}

function ActivityRow({ item }: { item: AgentActivityItem }): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted select-none">
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-foreground/75">{item.title}</p>
        <p className="mt-0.5 truncate text-[10px] text-foreground/40">
          {t(`runtime.kind.${item.kind}`)} · {formatElapsed(item.durationMs)}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-foreground/40">{statusLabel(item.status, t)}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-md border border-border px-2 py-2 select-none">
      <p className="truncate text-[10px] text-foreground/40">{label}</p>
      <p className="mt-1 text-sm font-medium tabular-nums text-foreground/75">{value}</p>
    </div>
  );
}

export function StatusIcon({ status }: { status: string }): React.JSX.Element {
  if (status === "succeeded" || status === "completed") {
    return <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-success" />;
  }
  if (status === "failed") return <IconCircleX className="mt-0.5 size-4 shrink-0 text-danger" />;
  if (status === "cancelled" || status === "interrupted" || status === "idle") {
    return <IconCircleDashed className="mt-0.5 size-4 shrink-0 text-foreground/40" />;
  }
  if (status === "waiting_approval" || status === "waiting_handoff" || status === "reviewing") {
    return (
      <IconBrain className="mt-0.5 size-4 shrink-0 animate-pulse text-warning motion-reduce:animate-none" />
    );
  }
  return (
    <span
      className="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center"
      data-slot="status-spinner"
      aria-hidden="true"
    >
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" />
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

function togglePath(current: Set<string>, path: string): Set<string> {
  const next = new Set(current);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

function addPathPrefixes(paths: Set<string>, path: string): void {
  const parts = path.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    paths.add(current);
  }
}

function formatModel(model: string | null, t: ReturnType<typeof useT>["t"]): string {
  return model || t("agentStatus.modelInherited");
}

function getRuntimeReasoning(profile: AgentProfile | null, fallback: ChatReasoningLevel): string {
  try {
    const raw = profile?.runtime_config_json ? JSON.parse(profile.runtime_config_json) : null;
    return typeof raw?.reasoning === "string" ? raw.reasoning : fallback;
  } catch {
    return fallback;
  }
}

export function formatElapsed(ms: number): string {
  const milliseconds = Math.max(0, Math.round(ms));
  if (milliseconds < 1_000) return milliseconds === 0 ? "<1ms" : `${milliseconds}ms`;

  const seconds = milliseconds / 1_000;
  return seconds < 60
    ? `${seconds < 10 ? seconds.toFixed(1) : Math.floor(seconds)}s`
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
