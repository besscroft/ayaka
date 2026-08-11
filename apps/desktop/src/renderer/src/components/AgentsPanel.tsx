import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  SelectField,
  Slider,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TextArea,
} from "./ui";
import {
  CHAT_REASONING_LEVELS,
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_ID,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  MAX_CONCURRENT_SUBAGENTS,
  MIN_CONCURRENT_SUBAGENTS,
  SettingKey,
  isAgentRuntimeBusy,
  normalizeAgentHandoffConfig,
  normalizeMaxConcurrentSubagents,
  normalizeAgentRuntimeConfig,
  normalizeAgentToolPolicy,
  isChatToolId,
  type AgentHandoffConfig,
  type AgentContextCheckpoint,
  type AgentInput,
  type AgentInstanceRecord,
  type AgentProfile,
  type AgentRuntimeConfig,
  type AgentRuntimeState,
  type AgentToolPolicy,
  type ChatReasoningLevel,
  type ChatToolDescriptor,
  type ChatToolReference,
  type ManagedModelInfo,
  type RuntimeEvent,
  type RuntimeRun,
  type RuntimeStep,
} from "@shared/types";
import { api } from "../lib/api";
import { AGENT_RUNTIME_STATUS_KEYS } from "../lib/agent-runtime-status";
import { getVisibleAgents, type AgentListTab } from "../lib/agent-list";
import { createClientChatToolDescriptors } from "../lib/chat-tools";
import { useT, type TranslationKey } from "../lib/i18n";
import { notify } from "../lib/toast";
import { cn } from "../lib/utils";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconCheck,
  IconClose,
  IconCopy,
  IconCpu,
  IconEdit,
  IconPlus,
  IconRotateCcw,
  IconTrash,
} from "./icons";

type AgentPanelTab = AgentListTab;
type AgentDetailTab = "overview" | "instructions" | "runtime" | "tools";
type AgentEditorTab = "basics" | "runtime" | "routing" | "tools";
type AgentCardAction = "archive" | "publish";

interface AgentsPanelProps {
  agents: AgentProfile[];
  events: RuntimeEvent[];
  onRefresh: () => void;
  loading?: boolean;
}

interface RuntimeSnapshotState {
  runtimeRuns: RuntimeRun[];
  runtimeSteps: RuntimeStep[];
  agentRuntimeStates: AgentRuntimeState[];
  runtimeEvents: RuntimeEvent[];
  agentInstances: AgentInstanceRecord[];
  contextCheckpoints: AgentContextCheckpoint[];
}

interface AgentFormState {
  name: string;
  role: string;
  description: string;
  avatar: string;
  status: AgentProfile["status"];
  enabled: boolean;
  model_ref: string;
  voice: string;
  persona: string;
  instructions: string;
  runtimeConfig: AgentRuntimeConfig;
  handoffConfig: AgentHandoffConfig;
  toolPolicy: AgentToolPolicy;
}

interface AgentValidation {
  name?: string;
  role?: string;
}

const STATUS_KEYS: Record<string, TranslationKey> = {
  active: "status.agent.active",
  archived: "status.agent.archived",
  draft: "status.agent.draft",
};

const RUNTIME_STATUS_KEYS: Record<string, TranslationKey> = {
  ...AGENT_RUNTIME_STATUS_KEYS,
};

const REVIEW_POLICY_KEYS: Record<
  NonNullable<AgentRuntimeConfig["reviewPolicy"]>,
  TranslationKey
> = {
  auto: "agents.option.review.auto",
  inherit: "agents.option.review.inherit",
  review_all: "agents.option.review.all",
  review_sensitive: "agents.option.review.sensitive",
};

const SANDBOX_POLICY_KEYS: Record<
  NonNullable<AgentRuntimeConfig["sandboxPolicy"]>,
  TranslationKey
> = {
  disabled: "agents.option.sandbox.disabled",
  docker: "agents.option.sandbox.docker",
  inherit: "agents.option.sandbox.inherit",
  local: "agents.option.sandbox.local",
};

const HANDOFF_MODE_KEYS: Record<AgentHandoffConfig["mode"], TranslationKey> = {
  both: "agents.option.handoff.both",
  consult: "agents.option.handoff.consult",
  handoff: "agents.option.handoff.handoff",
};

const PRIORITY_KEYS: Record<AgentHandoffConfig["priority"], TranslationKey> = {
  high: "agents.option.priority.high",
  low: "agents.option.priority.low",
  normal: "agents.option.priority.normal",
};

const CONTEXT_MODE_KEYS: Record<"off" | "prune" | "semantic", TranslationKey> = {
  off: "agents.option.context.off",
  prune: "agents.option.context.prune",
  semantic: "agents.option.context.semantic",
};

export function AgentsPanel({
  agents,
  events,
  onRefresh,
  loading = false,
}: AgentsPanelProps): React.JSX.Element {
  const { t, locale } = useT();
  const [tab, setTab] = useState<AgentPanelTab>("active");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<AgentDetailTab>("overview");
  const [detailOpen, setDetailOpen] = useState(false);
  const [editorTab, setEditorTab] = useState<AgentEditorTab>("basics");
  const [editing, setEditing] = useState<AgentProfile | null | "new">(null);
  const [form, setForm] = useState<AgentFormState>(() => createAgentForm());
  const [validation, setValidation] = useState<AgentValidation>({});
  const [busy, setBusy] = useState(false);
  const [pendingAgentActions, setPendingAgentActions] = useState<
    ReadonlyMap<string, AgentCardAction>
  >(() => new Map());
  const [agentToArchive, setAgentToArchive] = useState<AgentProfile | null>(null);
  const [concurrencyBusy, setConcurrencyBusy] = useState(false);
  const [maxConcurrentSubagents, setMaxConcurrentSubagents] = useState(
    DEFAULT_AGENT_RUNTIME_CONFIG.maxConcurrentSubagents ?? 3,
  );
  const [managedModels, setManagedModels] = useState<ManagedModelInfo[]>([]);
  const [tools, setTools] = useState<ChatToolDescriptor[]>([]);
  const [runtime, setRuntime] = useState<RuntimeSnapshotState>({
    runtimeRuns: [],
    runtimeSteps: [],
    agentRuntimeStates: [],
    runtimeEvents: [],
    agentInstances: [],
    contextCheckpoints: [],
  });

  const refreshRuntime = (): void => {
    void api.agents
      .runtimeSnapshot()
      .then((snapshot) =>
        setRuntime({
          runtimeRuns: snapshot.runtimeRuns,
          runtimeSteps: snapshot.runtimeSteps,
          agentRuntimeStates: snapshot.agentRuntimeStates,
          runtimeEvents: snapshot.runtimeEvents,
          agentInstances: snapshot.agentInstances,
          contextCheckpoints: snapshot.contextCheckpoints,
        }),
      )
      .catch((error: unknown) => {
        console.error("[agents] Failed to load runtime diagnostics", error);
      });
  };

  useEffect(() => {
    refreshRuntime();
    void api.providers
      .listManagedModels()
      .then((models) =>
        setManagedModels(
          models.filter((model) => model.enabled && model.capabilities.textGeneration),
        ),
      )
      .catch(() => setManagedModels([]));
    void Promise.all([api.tools.snapshot(), api.providers.list()])
      .then(([snapshot, providers]) =>
        setTools(
          createClientChatToolDescriptors({
            selectedModel: firstToolCallingModelRef(providers),
            providers,
            tools: snapshot,
          }),
        ),
      )
      .catch(() => setTools([]));
    void api.settings
      .get(SettingKey.MaxConcurrentSubagents)
      .then((value) => setMaxConcurrentSubagents(normalizeMaxConcurrentSubagents(value)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedId || agents.some((agent) => agent.id === selectedId)) return;
    setSelectedId(null);
    setDetailOpen(false);
  }, [agents, selectedId]);

  const runtimeByAgent = useMemo(
    () => new Map(runtime.agentRuntimeStates.map((state) => [state.agent_id, state])),
    [runtime.agentRuntimeStates],
  );
  const selected =
    agents.find((agent) => agent.id === selectedId) ??
    agents.find((agent) => agent.id === DEFAULT_AGENT_ID) ??
    agents[0] ??
    null;
  const visibleAgents = useMemo(() => getVisibleAgents(agents, tab, query), [agents, query, tab]);

  const runAction = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      notify.success(success);
      onRefresh();
      refreshRuntime();
    } catch (error) {
      notify.error(t("agents.toast.failed"), error, locale);
    } finally {
      setBusy(false);
    }
  };

  const runAgentCardAction = async (
    agentId: string,
    actionType: AgentCardAction,
    action: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> => {
    setPendingAgentActions((current) => new Map(current).set(agentId, actionType));
    try {
      await action();
      notify.success(success);
      onRefresh();
      refreshRuntime();
      return true;
    } catch (error) {
      notify.error(t("agents.toast.failed"), error, locale);
      return false;
    } finally {
      setPendingAgentActions((current) => {
        const next = new Map(current);
        next.delete(agentId);
        return next;
      });
    }
  };

  const publishAgent = (agent: AgentProfile): void => {
    if (agent.locked !== 0 || agent.status !== "draft" || pendingAgentActions.has(agent.id)) return;
    void runAgentCardAction(
      agent.id,
      "publish",
      () => api.agents.update(agent.id, { status: "active", enabled: true }),
      t("agents.toast.published"),
    );
  };

  const requestArchiveAgent = (agent: AgentProfile): void => {
    if (agent.locked !== 0 || pendingAgentActions.has(agent.id)) return;
    if (isAgentRuntimeBusy(runtimeByAgent.get(agent.id)?.status)) {
      notify.error(t("agents.delete.busy"));
      return;
    }
    setAgentToArchive(agent);
  };

  const archiveAgent = (): void => {
    const agent = agentToArchive;
    if (!agent) return;
    setAgentToArchive(null);
    if (agent.locked !== 0 || pendingAgentActions.has(agent.id)) return;
    if (isAgentRuntimeBusy(runtimeByAgent.get(agent.id)?.status)) {
      notify.error(t("agents.delete.busy"));
      return;
    }
    void runAgentCardAction(
      agent.id,
      "archive",
      () => api.agents.archive(agent.id),
      t("agents.toast.archived"),
    );
  };

  const openCreate = (): void => {
    setEditing("new");
    setForm(createAgentForm());
    setValidation({});
    setEditorTab("basics");
  };

  const openEdit = (agent: AgentProfile): void => {
    setEditing(agent);
    setForm(createAgentForm(agent));
    setValidation({});
    setEditorTab("basics");
  };

  const saveAgent = async (): Promise<void> => {
    const nextValidation = validateAgentForm(form, t);
    setValidation(nextValidation);
    if (Object.keys(nextValidation).length > 0) return;
    const input = formToAgentInput(form);
    await runAction(
      () =>
        editing === "new"
          ? api.agents.create(input)
          : editing
            ? api.agents.update(editing.id, input)
            : Promise.resolve(),
      editing === "new" ? t("agents.toast.created") : t("agents.toast.updated"),
    );
    setEditing(null);
  };

  const duplicateAgent = (agent: AgentProfile): void => {
    void runAction(() => api.agents.duplicate(agent.id), t("agents.toast.duplicated"));
  };

  const saveConcurrencyLimit = async (value?: number): Promise<void> => {
    const next = normalizeMaxConcurrentSubagents(value ?? maxConcurrentSubagents);
    setConcurrencyBusy(true);
    try {
      await api.settings.set(SettingKey.MaxConcurrentSubagents, String(next));
      setMaxConcurrentSubagents(next);
      notify.success(t("agents.toast.concurrencyUpdated"));
    } catch (error) {
      notify.error(t("agents.toast.failed"), error, locale);
    } finally {
      setConcurrencyBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 select-none grid gap-3 md:grid-cols-3">
        <MetricCard label={t("agents.metric.total")} value={agents.length} />
        <MetricCard label={t("agents.metric.running")} value={runningCount(runtime)} />
        <Card>
          <Card.Content className="flex h-full flex-col justify-between gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-foreground/45">{t("agents.concurrency.title")}</p>
              <span className="text-sm font-semibold tabular-nums">{maxConcurrentSubagents}</span>
            </div>
            <Slider
              className="w-full"
              value={[maxConcurrentSubagents]}
              min={MIN_CONCURRENT_SUBAGENTS}
              max={MAX_CONCURRENT_SUBAGENTS}
              disabled={concurrencyBusy}
              onValueChange={(values) =>
                setMaxConcurrentSubagents(Array.isArray(values) ? values[0] : values)
              }
              onValueCommitted={(values) =>
                void saveConcurrencyLimit(Array.isArray(values) ? values[0] : values)
              }
            />
          </Card.Content>
        </Card>
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <Card.Content className="flex min-h-0 flex-1 flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={(key) => setTab(agentTabKey(key))}>
              <TabsList aria-label={t("agents.tabs.label")}>
                <TabsTrigger value="active">{t("agents.tab.active")}</TabsTrigger>
                <TabsTrigger value="draft">{t("agents.tab.draft")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("agents.search.placeholder")}
                className="w-64"
              />
              <Button variant="secondary" size="sm" onPress={onRefresh} isDisabled={loading}>
                <IconRotateCcw className={cn("size-4", loading && "animate-spin")} />
                {t("main.refresh")}
              </Button>
              <Button variant="primary" size="sm" onPress={openCreate}>
                <IconPlus className="size-4" />
                {t("agents.action.new")}
              </Button>
            </div>
          </div>

          {visibleAgents.length === 0 ? (
            <EmptyState title={t("agents.empty")} />
          ) : (
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
              <div className="grid min-w-0 auto-rows-max gap-3 md:grid-cols-2">
                {visibleAgents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    selected={agent.id === selected?.id}
                    runtime={runtimeByAgent.get(agent.id)}
                    onSelect={() => {
                      setSelectedId(agent.id);
                      setDetailTab("overview");
                      setDetailOpen(true);
                    }}
                    onEdit={() => openEdit(agent)}
                    onDuplicate={() => duplicateAgent(agent)}
                    onPublish={() => publishAgent(agent)}
                    onArchive={() => requestArchiveAgent(agent)}
                    pendingAction={pendingAgentActions.get(agent.id)}
                    busy={busy}
                  />
                ))}
              </div>
            </div>
          )}
        </Card.Content>
      </Card>

      <AgentDetailModal
        open={detailOpen}
        agent={selected}
        tab={detailTab}
        setTab={setDetailTab}
        runtime={selected ? runtimeByAgent.get(selected.id) : undefined}
        runs={selected ? runsForAgent(runtime.runtimeRuns, selected.id) : []}
        steps={selected ? stepsForAgent(runtime.runtimeSteps, selected.id) : []}
        events={selected ? eventsForAgent([...runtime.runtimeEvents, ...events], selected.id) : []}
        instances={
          selected ? runtime.agentInstances.filter((item) => item.agent_id === selected.id) : []
        }
        checkpoints={
          selected
            ? checkpointsForAgent(runtime.contextCheckpoints, runtime.agentInstances, selected.id)
            : []
        }
        maxConcurrentSubagents={maxConcurrentSubagents}
        onEdit={() => selected && openEdit(selected)}
        onClose={() => setDetailOpen(false)}
      />

      <AgentEditorModal
        open={!!editing}
        mode={editing === "new" ? "create" : "edit"}
        form={form}
        setForm={setForm}
        validation={validation}
        tab={editorTab}
        setTab={setEditorTab}
        managedModels={managedModels}
        tools={tools}
        busy={busy}
        onSave={() => void saveAgent()}
        onClose={() => setEditing(null)}
      />

      <ConfirmDialog
        open={agentToArchive !== null}
        title={t("agents.delete.title")}
        message={t("agents.delete.message", { name: agentToArchive?.name ?? "" })}
        confirmLabel={t("agents.delete.confirm")}
        danger
        onConfirm={archiveAgent}
        onClose={() => setAgentToArchive(null)}
      />
    </div>
  );
}

function AgentCard({
  agent,
  selected,
  runtime,
  onSelect,
  onEdit,
  onDuplicate,
  onPublish,
  onArchive,
  pendingAction,
  busy,
}: {
  agent: AgentProfile;
  selected: boolean;
  runtime?: AgentRuntimeState;
  onSelect: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onPublish: () => void;
  onArchive: () => void;
  pendingAction?: AgentCardAction;
  busy: boolean;
}): React.JSX.Element {
  const { t, f } = useT();
  const locked = agent.locked !== 0;
  const runtimeBusy = isAgentRuntimeBusy(runtime?.status);
  const cardBusy = pendingAction !== undefined;
  return (
    <Card className={cn("flex min-w-0 flex-col", selected && "border-accent/45 bg-accent/[0.035]")}>
      <Card.Header>
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 text-left"
            onClick={onSelect}
          >
            <span className="flex size-10 shrink-0 select-none items-center justify-center rounded-md bg-accent/10 text-sm font-semibold text-primary">
              {agent.avatar || agent.name.slice(0, 1)}
            </span>
            <span className="min-w-0">
              <Card.Title className="truncate">{agent.name}</Card.Title>
              <Card.Description className="truncate">{agent.role}</Card.Description>
            </span>
          </button>
          <div className="flex flex-wrap justify-end gap-1.5">
            {locked ? (
              <Chip size="sm" variant="soft">
                {t("agents.locked")}
              </Chip>
            ) : null}
            <StatusChip status={runtime?.status ?? agent.status} />
          </div>
        </div>
      </Card.Header>
      <Card.Content className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="line-clamp-3 min-h-12 text-sm text-foreground/60">
          {agent.description || t("agents.noDescription")}
        </p>
        <div className="mt-auto grid grid-cols-2 gap-2 text-xs text-foreground/50">
          <Info label={t("agents.field.model")} value={agent.model_ref || t("agents.inherit")} />
          <Info
            label={t("agents.field.updated")}
            value={agent.updated_at ? f.dateTime(agent.updated_at) : "-"}
          />
        </div>
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap justify-between gap-2">
          <Button size="sm" variant="secondary" onPress={onSelect}>
            <IconCpu className="size-4" />
            {t("agents.action.details")}
          </Button>
          <div className="flex flex-wrap gap-1.5">
            {agent.status === "draft" && !locked ? (
              <Switch
                size="sm"
                isSelected={pendingAction === "publish"}
                isDisabled={cardBusy || busy}
                onChange={(selected) => selected && onPublish()}
                aria-label={t("agents.action.makeAvailable")}
              >
                {t("agents.action.makeAvailable")}
              </Switch>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onPress={onEdit}
              isDisabled={locked || cardBusy || busy}
            >
              <IconEdit className="size-4" />
              {t("common.edit")}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              onPress={onDuplicate}
              isDisabled={agent.status === "archived" || cardBusy || busy}
            >
              <IconCopy className="size-4" />
              {t("agents.action.duplicate")}
            </Button>
            {!locked ? (
              <span title={runtimeBusy ? t("agents.delete.busy") : undefined}>
                <Button
                  size="sm"
                  variant="danger"
                  onPress={onArchive}
                  isDisabled={runtimeBusy || cardBusy || busy}
                  isPending={pendingAction === "archive"}
                >
                  <IconTrash className="size-4" />
                  {t("agents.action.delete")}
                </Button>
              </span>
            ) : null}
          </div>
        </div>
      </Card.Footer>
    </Card>
  );
}

function AgentDetailModal({
  open,
  agent,
  tab,
  setTab,
  runtime,
  runs,
  steps,
  events,
  instances,
  checkpoints,
  maxConcurrentSubagents,
  onEdit,
  onClose,
}: {
  open: boolean;
  agent: AgentProfile | null;
  tab: AgentDetailTab;
  setTab: (tab: AgentDetailTab) => void;
  runtime?: AgentRuntimeState;
  runs: RuntimeRun[];
  steps: RuntimeStep[];
  events: RuntimeEvent[];
  instances: AgentInstanceRecord[];
  checkpoints: AgentContextCheckpoint[];
  maxConcurrentSubagents: number;
  onEdit: () => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const { t, f } = useT();
  if (!open || !agent) return null;
  const runtimeConfig = normalizeAgentRuntimeConfig(agent.runtime_config_json);
  const handoffConfig = normalizeAgentHandoffConfig(agent.handoff_config_json);
  const toolPolicy = normalizeAgentToolPolicy(agent.tool_policy_json);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-2xl p-0">
        <DialogHeader className="flex-row items-center justify-between gap-3 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 select-none items-center justify-center rounded-md bg-accent/10 text-sm font-semibold text-primary">
              {agent.avatar || agent.name.slice(0, 1)}
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold">{agent.name}</DialogTitle>
              <DialogDescription className="truncate text-sm text-foreground/50">
                {agent.role}
              </DialogDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onPress={onEdit}
              isDisabled={agent.locked !== 0 || agent.status === "archived"}
            >
              <IconEdit className="size-4" />
              {t("common.edit")}
            </Button>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={onClose}
              aria-label={t("common.close")}
            >
              <IconClose className="size-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <Tabs value={tab} onValueChange={(key) => setTab(agentDetailTabKey(key))}>
            <TabsList aria-label={t("agents.detail.tabs")}>
              <TabsTrigger value="overview">{t("agents.tab.overview")}</TabsTrigger>
              <TabsTrigger value="instructions">{t("agents.tab.instructions")}</TabsTrigger>
              <TabsTrigger value="runtime">{t("agents.tab.runtime")}</TabsTrigger>
              <TabsTrigger value="tools">{t("agents.tab.tools")}</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "overview" ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm leading-6 text-foreground/65">
                {agent.description || t("agents.noDescription")}
              </p>
              <DetailGrid
                rows={[
                  [t("agents.field.status"), labelFor(t, STATUS_KEYS, agent.status)],
                  [
                    t("agents.field.enabled"),
                    agent.enabled ? t("main.value.enabled") : t("main.value.disabled"),
                  ],
                  [t("agents.field.model"), agent.model_ref || t("agents.inherit")],
                  [t("agents.field.voice"), agent.voice || t("common.none")],
                  [t("agents.field.updated"), f.dateTime(agent.updated_at)],
                ]}
              />
            </div>
          ) : null}

          {tab === "instructions" ? (
            <div className="flex flex-col gap-3">
              <ReadBlock title={t("agents.field.persona")}>{agent.personality}</ReadBlock>
              <ReadBlock title={t("agents.field.instructions")}>{agent.soul_prompt}</ReadBlock>
            </div>
          ) : null}

          {tab === "runtime" ? (
            <div className="flex flex-col gap-4">
              <DetailGrid
                rows={[
                  [
                    t("agents.field.runtimeStatus"),
                    labelFor(t, RUNTIME_STATUS_KEYS, runtime?.status ?? "idle"),
                  ],
                  [
                    t("agents.field.maxTurns"),
                    agent.id === DEFAULT_AGENT_ID
                      ? t("agents.value.untilComplete")
                      : String(runtimeConfig.maxTurns),
                  ],
                  [
                    t("agents.field.maxConcurrentSubagents"),
                    String(
                      agent.id === DEFAULT_AGENT_ID
                        ? maxConcurrentSubagents
                        : (runtimeConfig.maxConcurrentSubagents ?? 3),
                    ),
                  ],
                  [
                    t("agents.field.totalTimeoutMs"),
                    agent.id === DEFAULT_AGENT_ID
                      ? t("agents.value.untilComplete")
                      : String(runtimeConfig.totalTimeoutMs ?? 120_000),
                  ],
                  [
                    t("agents.field.contextMode"),
                    t(CONTEXT_MODE_KEYS[runtimeConfig.contextPolicy?.mode ?? "semantic"]),
                  ],
                  [
                    t("agents.field.reviewPolicy"),
                    labelFor(
                      t,
                      REVIEW_POLICY_KEYS,
                      runtimeConfig.reviewPolicy ?? "review_sensitive",
                    ),
                  ],
                  [
                    t("agents.field.sandboxPolicy"),
                    labelFor(t, SANDBOX_POLICY_KEYS, runtimeConfig.sandboxPolicy ?? "local"),
                  ],
                  [
                    t("agents.field.handoff"),
                    `${labelFor(t, HANDOFF_MODE_KEYS, handoffConfig.mode)} / ${labelFor(
                      t,
                      PRIORITY_KEYS,
                      handoffConfig.priority,
                    )}`,
                  ],
                ]}
              />
              <MiniList
                title={t("agents.section.runs")}
                empty={t("agents.noRuns")}
                items={runs.slice(0, 5).map((run) => ({
                  id: run.id,
                  title: run.input_summary || run.output_summary || run.id,
                  detail: `${labelFor(t, RUNTIME_STATUS_KEYS, run.status)} / ${f.dateTime(run.started_at)}`,
                }))}
              />
              <MiniList
                title={t("agents.section.steps")}
                empty={t("agents.noSteps")}
                items={steps.slice(0, 5).map((step) => ({
                  id: step.id,
                  title: step.title,
                  detail: `${step.kind} / ${labelFor(t, RUNTIME_STATUS_KEYS, step.status)}`,
                }))}
              />
              <MiniList
                title={t("agents.section.instances")}
                empty={t("agents.noInstances")}
                items={instances.slice(0, 8).map((instance) => ({
                  id: instance.id,
                  title: instance.agent_path,
                  detail: `${instance.status} / ${instance.task_name}`,
                }))}
              />
              <MiniList
                title={t("agents.section.checkpoints")}
                empty={t("agents.noCheckpoints")}
                items={checkpoints.slice(0, 5).map((checkpoint) => ({
                  id: checkpoint.id,
                  title: `${checkpoint.agent_path} / v${checkpoint.version}`,
                  detail: `${checkpoint.estimated_tokens_before} -> ${checkpoint.estimated_tokens_after} tokens`,
                }))}
              />
            </div>
          ) : null}

          {tab === "tools" ? (
            <div className="flex flex-col gap-4">
              <DetailGrid
                rows={[
                  [
                    t("agents.field.toolMode"),
                    toolPolicy.mode === "custom"
                      ? t("agents.option.toolPolicy.custom")
                      : t("agents.option.toolPolicy.inherit"),
                  ],
                  [
                    t("agents.field.allowedTools"),
                    toolPolicy.allowedToolIds.length
                      ? String(toolPolicy.allowedToolIds.length)
                      : t("agents.inherit"),
                  ],
                  [
                    t("agents.field.approvalTools"),
                    String(toolPolicy.requireApprovalToolIds.length),
                  ],
                ]}
              />
              <MiniList
                title={t("agents.section.activity")}
                empty={t("agents.noActivity")}
                items={events.slice(0, 8).map((event) => ({
                  id: event.id,
                  title: event.title,
                  detail: `${event.kind} / ${labelFor(t, RUNTIME_STATUS_KEYS, event.status)} / ${f.dateTime(
                    event.created_at,
                  )}`,
                }))}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AgentEditorModal({
  open,
  mode,
  form,
  setForm,
  validation,
  tab,
  setTab,
  managedModels,
  tools,
  busy,
  onSave,
  onClose,
}: {
  open: boolean;
  mode: "create" | "edit";
  form: AgentFormState;
  setForm: (form: AgentFormState) => void;
  validation: AgentValidation;
  tab: AgentEditorTab;
  setTab: (tab: AgentEditorTab) => void;
  managedModels: ManagedModelInfo[];
  tools: ChatToolDescriptor[];
  busy: boolean;
  onSave: () => void;
  onClose: () => void;
}): React.JSX.Element | null {
  const { t } = useT();
  if (!open) return null;
  const patch = (value: Partial<AgentFormState>): void => setForm({ ...form, ...value });
  const patchRuntime = (value: Partial<AgentRuntimeConfig>): void =>
    patch({ runtimeConfig: { ...form.runtimeConfig, ...value } });
  const patchContextPolicy = (
    value: Partial<NonNullable<AgentRuntimeConfig["contextPolicy"]>>,
  ): void =>
    patchRuntime({
      contextPolicy: {
        ...(form.runtimeConfig.contextPolicy ?? DEFAULT_AGENT_RUNTIME_CONFIG.contextPolicy!),
        ...value,
      },
    });
  const patchHandoff = (value: Partial<AgentHandoffConfig>): void =>
    patch({ handoffConfig: { ...form.handoffConfig, ...value } });
  const patchTools = (value: Partial<AgentToolPolicy>): void =>
    patch({ toolPolicy: { ...form.toolPolicy, ...value } });
  const approvalTools = tools.filter((tool) => !isChatToolId(tool.id));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-4xl p-0">
        <DialogHeader className="flex-row items-center justify-between gap-3 px-5 py-4">
          <div>
            <DialogTitle className="text-base font-semibold">
              {mode === "create" ? t("agents.editor.create") : t("agents.editor.edit")}
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-foreground/50">
              {t("agents.editor.subtitle")}
            </DialogDescription>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={onClose}
            aria-label={t("common.close")}
          >
            <IconClose className="size-4" />
          </Button>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex flex-col gap-5">
            <Tabs value={tab} onValueChange={(key) => setTab(agentEditorTabKey(key))}>
              <TabsList aria-label={t("agents.editor.tabs")}>
                <TabsTrigger value="basics">{t("agents.tab.basics")}</TabsTrigger>
                <TabsTrigger value="runtime">{t("agents.tab.runtime")}</TabsTrigger>
                <TabsTrigger value="routing">{t("agents.tab.routing")}</TabsTrigger>
                <TabsTrigger value="tools">{t("agents.tab.tools")}</TabsTrigger>
              </TabsList>
            </Tabs>

            {tab === "basics" ? (
              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-[1fr_120px]">
                  <Field label={t("agents.field.name")} error={validation.name}>
                    <Input
                      value={form.name}
                      onChange={(event) => patch({ name: event.target.value })}
                    />
                  </Field>
                  <Field label={t("agents.field.avatar")}>
                    <Input
                      value={form.avatar}
                      onChange={(event) => patch({ avatar: event.target.value })}
                      maxLength={4}
                    />
                  </Field>
                </div>
                <Field label={t("agents.field.role")} error={validation.role}>
                  <Input
                    value={form.role}
                    onChange={(event) => patch({ role: event.target.value })}
                  />
                </Field>
                <Field label={t("agents.field.description")}>
                  <TextArea
                    rows={3}
                    value={form.description}
                    onChange={(event) => patch({ description: event.target.value })}
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t("agents.field.model")}>
                    <SelectField
                      value={form.model_ref}
                      options={[
                        { value: "", label: t("agents.inherit") },
                        ...managedModels.map((model) => ({
                          value: model.ref,
                          label: `${model.providerLabel} / ${model.modelLabel ?? model.modelId}`,
                        })),
                      ]}
                      onChange={(value) => patch({ model_ref: value })}
                      ariaLabel={t("agents.field.model")}
                    />
                  </Field>
                  <Field label={t("agents.field.voice")}>
                    <Input
                      value={form.voice}
                      onChange={(event) => patch({ voice: event.target.value })}
                    />
                  </Field>
                </div>
                <Field label={t("agents.field.persona")}>
                  <TextArea
                    rows={4}
                    value={form.persona}
                    onChange={(event) => patch({ persona: event.target.value })}
                  />
                </Field>
                <Field label={t("agents.field.instructions")}>
                  <TextArea
                    rows={7}
                    value={form.instructions}
                    onChange={(event) => patch({ instructions: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}

            {tab === "runtime" ? (
              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label={t("agents.field.status")}>
                    <SelectField
                      value={form.status}
                      options={[
                        { value: "active", label: t("status.agent.active") },
                        { value: "draft", label: t("status.agent.draft") },
                      ]}
                      onChange={(value) => patch({ status: value as AgentProfile["status"] })}
                      ariaLabel={t("agents.field.status")}
                    />
                  </Field>
                  <Field label={t("agents.field.maxTurns")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.maxTurns)}
                      onChange={(event) =>
                        patchRuntime({ maxTurns: clampInteger(event.target.value, 1, 20, 8) })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.reasoning")}>
                    <SelectField
                      value={form.runtimeConfig.reasoning ?? "provider-default"}
                      options={CHAT_REASONING_LEVELS.map((level) => ({
                        value: level,
                        label: level,
                      }))}
                      onChange={(value) => patchRuntime({ reasoning: value as ChatReasoningLevel })}
                      ariaLabel={t("agents.field.reasoning")}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label={t("agents.field.maxConcurrentSubagents")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.maxConcurrentSubagents ?? 3)}
                      onChange={(event) =>
                        patchRuntime({
                          maxConcurrentSubagents: clampInteger(
                            event.target.value,
                            MIN_CONCURRENT_SUBAGENTS,
                            MAX_CONCURRENT_SUBAGENTS,
                            3,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.totalTimeoutMs")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.totalTimeoutMs ?? 120000)}
                      onChange={(event) =>
                        patchRuntime({
                          totalTimeoutMs: clampInteger(event.target.value, 10000, 900000, 120000),
                        })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.contextMode")}>
                    <SelectField
                      value={form.runtimeConfig.contextPolicy?.mode ?? "semantic"}
                      options={Object.entries(CONTEXT_MODE_KEYS).map(([value, key]) => ({
                        value,
                        label: t(key),
                      }))}
                      onChange={(value) =>
                        patchRuntime({
                          contextPolicy: {
                            ...(form.runtimeConfig.contextPolicy ??
                              DEFAULT_AGENT_RUNTIME_CONFIG.contextPolicy!),
                            mode: value as "off" | "prune" | "semantic",
                          },
                        })
                      }
                      ariaLabel={t("agents.field.contextMode")}
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label={t("agents.field.pruneThreshold")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.contextPolicy?.pruneThreshold ?? 0.6)}
                      onChange={(event) =>
                        patchContextPolicy({
                          pruneThreshold: optionalNumber(event.target.value, 0.3, 0.9) ?? 0.6,
                        })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.compactThreshold")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.contextPolicy?.compactThreshold ?? 0.75)}
                      onChange={(event) =>
                        patchContextPolicy({
                          compactThreshold: optionalNumber(event.target.value, 0.35, 0.98) ?? 0.75,
                        })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.targetRatio")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.contextPolicy?.targetRatio ?? 0.5)}
                      onChange={(event) =>
                        patchContextPolicy({
                          targetRatio: optionalNumber(event.target.value, 0.2, 0.9) ?? 0.5,
                        })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.keepRecentTokens")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.contextPolicy?.keepRecentTokens ?? 20000)}
                      onChange={(event) =>
                        patchContextPolicy({
                          keepRecentTokens: clampInteger(event.target.value, 1000, 200000, 20000),
                        })
                      }
                    />
                  </Field>
                </div>
                <Field label={t("agents.field.compactionModel")}>
                  <SelectField
                    value={form.runtimeConfig.compactionModelRef ?? ""}
                    options={[
                      { value: "", label: t("agents.option.compactionModel.active") },
                      ...managedModels.map((model) => ({
                        value: model.ref,
                        label: `${model.modelLabel} / ${model.providerLabel}`,
                      })),
                    ]}
                    onChange={(value) => patchRuntime({ compactionModelRef: value || undefined })}
                    ariaLabel={t("agents.field.compactionModel")}
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label={t("agents.field.temperature")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.temperature ?? "")}
                      onChange={(event) =>
                        patchRuntime({ temperature: optionalNumber(event.target.value, 0, 2) })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.topP")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.topP ?? "")}
                      onChange={(event) =>
                        patchRuntime({ topP: optionalNumber(event.target.value, 0, 1) })
                      }
                    />
                  </Field>
                  <Field label={t("agents.field.maxOutputTokens")}>
                    <Input
                      type="number"
                      value={String(form.runtimeConfig.maxOutputTokens ?? "")}
                      onChange={(event) =>
                        patchRuntime({
                          maxOutputTokens: optionalNumber(event.target.value, 1, 32768),
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t("agents.field.reviewPolicy")}>
                    <SelectField
                      value={form.runtimeConfig.reviewPolicy ?? "review_sensitive"}
                      options={Object.entries(REVIEW_POLICY_KEYS).map(([value, key]) => ({
                        value,
                        label: t(key),
                      }))}
                      onChange={(value) =>
                        patchRuntime({
                          reviewPolicy: value as NonNullable<AgentRuntimeConfig["reviewPolicy"]>,
                        })
                      }
                      ariaLabel={t("agents.field.reviewPolicy")}
                    />
                  </Field>
                  <Field label={t("agents.field.sandboxPolicy")}>
                    <SelectField
                      value={form.runtimeConfig.sandboxPolicy ?? "local"}
                      options={Object.entries(SANDBOX_POLICY_KEYS).map(([value, key]) => ({
                        value,
                        label: t(key),
                      }))}
                      onChange={(value) =>
                        patchRuntime({
                          sandboxPolicy: value as NonNullable<AgentRuntimeConfig["sandboxPolicy"]>,
                        })
                      }
                      ariaLabel={t("agents.field.sandboxPolicy")}
                    />
                  </Field>
                </div>
                <Switch isSelected={form.enabled} onChange={(enabled) => patch({ enabled })}>
                  <Switch.Content>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    {t("agents.enabled")}
                  </Switch.Content>
                </Switch>
              </div>
            ) : null}

            {tab === "routing" ? (
              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t("agents.field.handoff")}>
                    <SelectField
                      value={form.handoffConfig.mode}
                      options={Object.entries(HANDOFF_MODE_KEYS).map(([value, key]) => ({
                        value,
                        label: t(key),
                      }))}
                      onChange={(value) =>
                        patchHandoff({ mode: value as AgentHandoffConfig["mode"] })
                      }
                      ariaLabel={t("agents.field.handoff")}
                    />
                  </Field>
                  <Field label={t("agents.field.priority")}>
                    <SelectField
                      value={form.handoffConfig.priority}
                      options={Object.entries(PRIORITY_KEYS).map(([value, key]) => ({
                        value,
                        label: t(key),
                      }))}
                      onChange={(value) =>
                        patchHandoff({ priority: value as AgentHandoffConfig["priority"] })
                      }
                      ariaLabel={t("agents.field.priority")}
                    />
                  </Field>
                </div>
                <Field label={t("agents.field.accepts")}>
                  <TextArea
                    rows={3}
                    value={form.handoffConfig.accepts.join(", ")}
                    onChange={(event) =>
                      patchHandoff({ accepts: splitList(event.target.value).slice(0, 12) })
                    }
                  />
                </Field>
                <Field label={t("agents.field.expectedOutput")}>
                  <TextArea
                    rows={4}
                    value={form.handoffConfig.expectedOutput}
                    onChange={(event) => patchHandoff({ expectedOutput: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}

            {tab === "tools" ? (
              <div className="flex flex-col gap-4">
                <Field label={t("agents.field.toolMode")}>
                  <SelectField
                    value={form.toolPolicy.mode}
                    options={[
                      { value: "inherit", label: t("agents.option.toolPolicy.inherit") },
                      { value: "custom", label: t("agents.option.toolPolicy.custom") },
                    ]}
                    onChange={(value) =>
                      patchTools({ mode: value === "custom" ? "custom" : "inherit" })
                    }
                    ariaLabel={t("agents.field.toolMode")}
                  />
                </Field>
                <ToolChecklist
                  title={t("agents.field.allowedTools")}
                  tools={tools}
                  disabled={form.toolPolicy.mode !== "custom"}
                  selected={form.toolPolicy.allowedToolIds}
                  onChange={(allowedToolIds) => patchTools({ allowedToolIds })}
                />
                <ToolChecklist
                  title={t("agents.field.approvalTools")}
                  tools={approvalTools}
                  selected={form.toolPolicy.requireApprovalToolIds}
                  onChange={(requireApprovalToolIds) => patchTools({ requireApprovalToolIds })}
                />
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter className="flex-row justify-end px-5 py-4">
          <Button variant="tertiary" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" isPending={busy} onPress={onSave}>
            <IconCheck className="size-4" />
            {t("agents.action.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToolChecklist({
  title,
  tools,
  selected,
  disabled,
  onChange,
}: {
  title: string;
  tools: ChatToolDescriptor[];
  selected: ChatToolReference[];
  disabled?: boolean;
  onChange: (ids: ChatToolReference[]) => void;
}): React.JSX.Element {
  const { t } = useT();
  const selectedSet = new Set(selected);
  const toggle = (id: ChatToolReference, enabled: boolean): void => {
    onChange(enabled ? [...selectedSet, id] : selected.filter((item) => item !== id));
  };
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="max-h-64 overflow-y-auto rounded-md border border-border">
        {tools.length === 0 ? (
          <p className="px-3 py-4 text-sm text-foreground/45">{t("agents.noTools")}</p>
        ) : (
          tools.map((tool) => (
            <div
              key={tool.id}
              className="flex items-start gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0"
            >
              <Checkbox
                isSelected={selectedSet.has(tool.id)}
                isDisabled={disabled}
                onChange={(enabled) => toggle(tool.id, enabled)}
                aria-label={tool.label}
              />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                disabled={disabled}
                onClick={() => toggle(tool.id, !selectedSet.has(tool.id))}
              >
                <span className="block font-medium">{tool.label}</span>
                <span className="line-clamp-2 text-xs text-foreground/50">{tool.description}</span>
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function createAgentForm(agent?: AgentProfile): AgentFormState {
  const runtimeConfig = normalizeAgentRuntimeConfig(
    agent?.runtime_config_json,
    DEFAULT_AGENT_RUNTIME_CONFIG,
  );
  return {
    name: agent?.name ?? "",
    role: agent?.role ?? "",
    description: agent?.description ?? "",
    avatar: agent?.avatar ?? "",
    status: agent?.status ?? "draft",
    enabled: agent ? agent.enabled !== 0 : false,
    model_ref: agent?.model_ref ?? "",
    voice: agent?.voice ?? "",
    persona: agent?.personality ?? "",
    instructions: agent?.soul_prompt ?? "",
    runtimeConfig,
    handoffConfig: normalizeAgentHandoffConfig(
      agent?.handoff_config_json,
      DEFAULT_AGENT_HANDOFF_CONFIG,
    ),
    toolPolicy: normalizeAgentToolPolicy(agent?.tool_policy_json, DEFAULT_AGENT_TOOL_POLICY),
  };
}

function formToAgentInput(form: AgentFormState): AgentInput {
  return {
    avatar: form.avatar.trim() || form.name.trim().slice(0, 1).toUpperCase(),
    description: form.description.trim(),
    enabled: form.status === "draft" ? false : form.enabled,
    handoff_config_json: JSON.stringify(form.handoffConfig),
    model_ref: form.model_ref || null,
    name: form.name.trim(),
    personality: form.persona.trim(),
    role: form.role.trim(),
    runtime_config_json: JSON.stringify(form.runtimeConfig),
    soul_prompt: form.instructions.trim(),
    status: form.status,
    tool_policy_json: JSON.stringify(form.toolPolicy),
    voice: form.voice.trim() || null,
  };
}

function validateAgentForm(form: AgentFormState, t: (key: string) => string): AgentValidation {
  return {
    ...(form.name.trim() ? {} : { name: t("agents.validation.required") }),
    ...(form.role.trim() ? {} : { role: t("agents.validation.required") }),
  };
}

function MetricCard({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <Card>
      <Card.Content className="p-4">
        <p className="text-xs text-foreground/45">{label}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
      </Card.Content>
    </Card>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <label className="grid select-none gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      {children}
      {error ? <span className="text-xs text-danger">{error}</span> : null}
    </label>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <div>
      <p>{label}</p>
      <p className="mt-1 truncate text-foreground/70">{value}</p>
    </div>
  );
}

function StatusChip({ status }: { status: string }): React.JSX.Element {
  const { t } = useT();
  const color =
    status === "active" || status === "succeeded"
      ? "success"
      : status === "failed" || status === "archived"
        ? "danger"
        : status === "running" || status === "queued" || status === "tool_calling"
          ? "accent"
          : "default";
  return (
    <Chip size="sm" color={color} variant="soft">
      {labelFor(t, { ...STATUS_KEYS, ...RUNTIME_STATUS_KEYS }, status)}
    </Chip>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, ReactNode]> }): React.JSX.Element {
  return (
    <div className="grid gap-2 rounded-md border border-border px-3 py-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1 sm:grid-cols-[112px_minmax(0,1fr)]">
          <span className="text-foreground/40">{label}</span>
          <span className="min-w-0 break-words text-foreground/70">{value}</span>
        </div>
      ))}
    </div>
  );
}

function ReadBlock({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  const { t } = useT();
  return (
    <section>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-2 rounded-md border border-border bg-muted p-3 text-sm leading-6 text-foreground/65">
        {children || t("agents.emptyField")}
      </div>
    </section>
  );
}

function MiniList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; title: string; detail: string }>;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="min-w-0 rounded-md border border-border px-3 py-2">
              <p className="line-clamp-2 break-words text-sm font-medium">{item.title}</p>
              <p className="mt-1 line-clamp-2 break-words text-xs text-foreground/45">
                {item.detail}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EmptyState({ title }: { title: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {title}
    </div>
  );
}

function runningCount(runtime: RuntimeSnapshotState): number {
  return runtime.agentRuntimeStates.filter((state) =>
    ["queued", "running", "reviewing", "handoff", "tool_calling", "sandbox", "learning"].includes(
      state.status,
    ),
  ).length;
}

function runsForAgent(runs: RuntimeRun[], agentId: string): RuntimeRun[] {
  return runs.filter((run) => run.root_agent_id === agentId || run.final_agent_id === agentId);
}

function stepsForAgent(steps: RuntimeStep[], agentId: string): RuntimeStep[] {
  return steps.filter((step) => step.agent_id === agentId);
}

function eventsForAgent(events: RuntimeEvent[], agentId: string): RuntimeEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    const match = event.agent_id === agentId || event.detail_json.includes(agentId);
    if (match) seen.add(event.id);
    return match;
  });
}

function checkpointsForAgent(
  checkpoints: AgentContextCheckpoint[],
  instances: AgentInstanceRecord[],
  agentId: string,
): AgentContextCheckpoint[] {
  const instanceIds = new Set(
    instances.filter((instance) => instance.agent_id === agentId).map((instance) => instance.id),
  );
  return checkpoints.filter(
    (checkpoint) =>
      (checkpoint.agent_instance_id !== null && instanceIds.has(checkpoint.agent_instance_id)) ||
      (agentId === DEFAULT_AGENT_ID && checkpoint.agent_path === "/root"),
  );
}

function firstToolCallingModelRef(
  providers: Array<{
    id: string;
    models: Array<{ id: string; capabilities: { toolCalling: boolean } }>;
  }>,
): string | null {
  for (const provider of providers) {
    const model = provider.models.find((item) => item.capabilities.toolCalling);
    if (model) return `${provider.id}/${model.id}`;
  }
  return null;
}

function labelFor(
  t: (key: string) => string,
  keys: Record<string, TranslationKey>,
  value: string,
): string {
  const key = keys[value];
  return key ? t(key) : value;
}

function agentTabKey(key: unknown): AgentPanelTab {
  return key === "draft" ? "draft" : "active";
}

function agentDetailTabKey(key: unknown): AgentDetailTab {
  return key === "instructions" || key === "runtime" || key === "tools" ? key : "overview";
}

function agentEditorTabKey(key: unknown): AgentEditorTab {
  return key === "runtime" || key === "routing" || key === "tools" ? key : "basics";
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function clampInteger(value: string, min: number, max: number, fallback: number): number {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function optionalNumber(value: string, min: number, max: number): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}
