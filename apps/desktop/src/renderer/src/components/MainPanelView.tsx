import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  Chip,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
} from "./ui";
import {
  api,
  type AgentMemoryFileSnapshot,
  type AgentProfile,
  type MemoryFileKind,
  type MemoryKind,
  type MemoryRecord,
  type MemoryScope,
  type RuntimeEvent,
} from "../lib/api";
import { useT } from "../lib/i18n";
import { AgentsPanel } from "./AgentsPanel";
import { ToolsPanel } from "./ToolsPanel";
import { McpPanel } from "./McpPanel";
import { SkillsPanel } from "./SkillsPanel";
import { AutomationPanel } from "./AutomationPanel";
import { ConfirmDialog } from "./ConfirmDialog";
import { RichContent } from "./ai-elements/rich-content";
import {
  IconDatabase,
  IconEdit,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconTrash,
  IconX,
  IconPin,
} from "./icons";
import { cn } from "../lib/utils";

export type MainSection = "agents" | "tools" | "mcp" | "skills" | "memory" | "automations";

interface MainPanelViewProps {
  section: MainSection;
  activeConversationId?: string | null;
}

interface PanelData {
  agents: AgentProfile[];
  runtimeEvents: RuntimeEvent[];
}

const MEMORY_SCOPES: MemoryScope[] = ["global", "agent"];
const MEMORY_KINDS: MemoryKind[] = ["fact", "preference", "episode", "profile", "skill"];

export function MainPanelView({
  section,
  activeConversationId,
}: MainPanelViewProps): React.JSX.Element {
  useT();
  const [data, setData] = useState<PanelData>({
    agents: [],
    runtimeEvents: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = (): void => {
    setRefreshing(true);
    void Promise.allSettled([api.agents.list(), api.runtime.events.list()])
      .then(([agentsResult, runtimeEventsResult]) => {
        setData((current) => ({
          agents: agentsResult.status === "fulfilled" ? agentsResult.value : current.agents,
          runtimeEvents:
            runtimeEventsResult.status === "fulfilled"
              ? runtimeEventsResult.value
              : current.runtimeEvents,
        }));
        if (agentsResult.status === "rejected") {
          console.error("[agents] Failed to load agent profiles", agentsResult.reason);
        }
        if (runtimeEventsResult.status === "rejected") {
          console.error("[agents] Failed to load runtime events", runtimeEventsResult.reason);
        }
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(refresh, []);

  if (section === "tools") {
    return (
      <main data-page="tools-page" className="flex min-h-0 flex-1 overflow-hidden p-6">
        <ToolsPanel />
      </main>
    );
  }

  if (section === "mcp") {
    return (
      <main data-page="mcp-page" className="flex min-h-0 flex-1 overflow-hidden p-6">
        <McpPanel activeConversationId={activeConversationId} />
      </main>
    );
  }

  if (section === "skills") {
    return (
      <main data-page="skills-page" className="flex min-h-0 flex-1 overflow-hidden p-6">
        <SkillsPanel />
      </main>
    );
  }

  if (section === "automations") {
    return (
      <main data-page="automation-page" className="flex min-h-0 flex-1 overflow-hidden p-6">
        <AutomationPanel />
      </main>
    );
  }

  return (
    <main
      data-page={section === "agents" ? "agents-page" : "memory-page"}
      className="flex min-h-0 flex-1 overflow-hidden p-6"
    >
      <div className="flex h-full w-full min-h-0 flex-col gap-5">
        {section === "agents" && (
          <AgentsPanel
            agents={data.agents}
            events={data.runtimeEvents}
            onRefresh={refresh}
            loading={loading || refreshing}
          />
        )}
        {section === "memory" && <MemoryPanel agents={data.agents} />}
      </div>
    </main>
  );
}

type MemoryPanelTab = "entries" | MemoryFileKind;

function MemoryPanel({ agents }: { agents: AgentProfile[] }): React.JSX.Element {
  const { t, f } = useT();
  const [activeTab, setActiveTab] = useState<MemoryPanelTab>("entries");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const hasUserSelectedAgent = useRef(false);
  const [memoryFiles, setMemoryFiles] = useState<Record<
    MemoryFileKind,
    AgentMemoryFileSnapshot
  > | null>(null);

  // agents 列表加载完成后，默认选中主智能体（kind === "main"），仅在用户未手动选择时生效
  useEffect(() => {
    if (hasUserSelectedAgent.current || agents.length === 0) return;
    const primary = agents.find((agent) => agent.kind === "main") ?? agents[0];
    if (primary) setSelectedAgentId(primary.id);
  }, [agents]);

  const loadFiles = useCallback(async () => {
    if (!selectedAgentId) return;
    const files = await api.agents.memoryFiles.list(selectedAgentId);
    setMemoryFiles(files);
  }, [selectedAgentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFiles();
  }, [loadFiles]);

  const handleAgentChange = useCallback((agentId: string) => {
    hasUserSelectedAgent.current = true;
    setSelectedAgentId(agentId);
  }, []);

  const sidebarItems: {
    key: MemoryPanelTab;
    label: string;
    meta?: string;
  }[] = [
    { key: "entries", label: t("main.memory.tab.entries") },
    {
      key: "soul",
      label: t("main.memory.tab.soul"),
      meta: memoryFiles
        ? t("main.memory.file.charCount", {
            count: f.number(memoryFiles.soul.charCount),
            limit: f.number(memoryFiles.soul.charLimit),
          })
        : undefined,
    },
    {
      key: "user",
      label: t("main.memory.tab.user"),
      meta: memoryFiles
        ? t("main.memory.file.charCount", {
            count: f.number(memoryFiles.user.charCount),
            limit: f.number(memoryFiles.user.charLimit),
          })
        : undefined,
    },
    {
      key: "memory",
      label: t("main.memory.tab.memory"),
      meta: memoryFiles
        ? t("main.memory.file.charCount", {
            count: f.number(memoryFiles.memory.charCount),
            limit: f.number(memoryFiles.memory.charLimit),
          })
        : undefined,
    },
  ];

  return (
    <div data-slot="memory-layout" className="flex h-full gap-4 overflow-hidden">
      {/* 左侧记忆导航 */}
      <div
        data-slot="memory-list"
        className="flex w-56 shrink-0 flex-col gap-2 self-stretch overflow-y-auto rounded-lg border border-border bg-card p-3 select-none"
      >
        <h2 className="px-1 py-1 text-sm font-semibold">{t("main.title.memory")}</h2>

        <div className="flex flex-col gap-1">
          {sidebarItems.map((item) => {
            const isActive = activeTab === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveTab(item.key)}
                data-slot="memory-nav-item"
                data-active={isActive ? "true" : "false"}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground/80 hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="font-medium">{item.label}</span>
                {item.meta && (
                  <span
                    className={cn(
                      "text-xs",
                      isActive ? "text-primary-foreground/70" : "text-muted-foreground",
                    )}
                  >
                    {item.meta}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 右侧内容区域 */}
      <div
        data-slot="memory-detail"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        {activeTab === "entries" && <MemoryEntriesPanel />}
        {activeTab !== "entries" && memoryFiles && (
          <MemoryFilePanel
            kind={activeTab}
            snapshot={memoryFiles[activeTab]}
            onRefresh={loadFiles}
            agentId={selectedAgentId}
            agents={agents}
            onAgentChange={handleAgentChange}
          />
        )}
        {activeTab !== "entries" && !memoryFiles && (
          <EmptyState icon={<IconDatabase />} title={t("main.title.memory")} />
        )}
      </div>
    </div>
  );
}

export function MemoryFilePanel({
  kind,
  snapshot,
  onRefresh,
  agentId,
  agents,
  onAgentChange,
}: {
  kind: MemoryFileKind;
  snapshot: AgentMemoryFileSnapshot;
  onRefresh: () => void;
  agentId: string;
  agents: AgentProfile[];
  onAgentChange: (agentId: string) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(snapshot.content);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const agentOptions = agents.map((agent) => ({ label: agent.name, value: agent }));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(snapshot.content);
    setError(null);
  }, [snapshot.content, snapshot.updatedAt]);

  const isOverLimit = draft.length > snapshot.charLimit;

  const handleSave = async (): Promise<void> => {
    if (isOverLimit) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.agents.memoryFiles.save(kind, draft, agentId);
      setIsEditing(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleReload = async (): Promise<void> => {
    try {
      await api.agents.memoryFiles.reload(kind, agentId);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      data-slot="memory-file"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold uppercase">{kind}.md</h2>
        <div className="flex items-center gap-2">
          {kind === "soul" && (
            <Select
              items={agentOptions}
              value={selectedAgent}
              isItemEqualToValue={(agent, value) => agent.id === value.id}
              itemToStringLabel={(agent) => agent.name}
              itemToStringValue={(agent) => agent.id}
              onValueChange={(agent) => {
                if (agent) onAgentChange(agent.id);
              }}
              disabled={agents.length === 0}
            >
              <SelectTrigger className="w-56" aria-label={t("main.memory.scope.agent")}>
                <SelectValue>{(agent: AgentProfile | null) => agent?.name ?? ""}</SelectValue>
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="end">
                <SelectGroup>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <Button variant="secondary" size="sm" onPress={handleReload} isDisabled={isSaving}>
            <IconRotateCcw className="size-4" />
            {t("main.memory.file.refresh")}
          </Button>
          {isEditing ? (
            <>
              <Button
                variant="tertiary"
                size="sm"
                onPress={() => setIsEditing(false)}
                isDisabled={isSaving}
              >
                {t("main.memory.file.done")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onPress={handleSave}
                isPending={isSaving}
                isDisabled={isOverLimit}
              >
                {t("main.memory.file.save")}
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onPress={() => setIsEditing(true)}>
              <IconEdit className="size-4" />
              {t("main.memory.file.edit")}
            </Button>
          )}
        </div>
      </div>

      {isEditing ? (
        <TextArea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={18}
          className="font-mono text-sm"
        />
      ) : (
        <div className="max-h-[480px] overflow-auto rounded-md border border-border bg-background p-3">
          <RichContent value={snapshot.content} className="text-sm text-foreground" />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className={cn(isOverLimit && "font-medium text-danger")}>
          {t("main.memory.file.charCount", { count: draft.length, limit: snapshot.charLimit })}
        </span>
        <span>{t("main.memory.file.updatedAt", { time: f.dateTime(snapshot.updatedAt) })}</span>
      </div>

      {isOverLimit && (
        <p className="text-xs text-danger">
          {t("main.memory.file.overLimit", { limit: snapshot.charLimit })}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function MemoryEntriesPanel(): React.JSX.Element {
  const { t } = useT();
  const [memories, setMemories] = useState<MemoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filters, setFilters] = useState<{
    scope: MemoryScope | "all";
  }>({ scope: "all" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMemory, setEditingMemory] = useState<MemoryRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MemoryRecord | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const results = await api.memories.search({
        query: debouncedQuery,
        scope: filters.scope === "all" ? null : filters.scope,
        kind: null,
        pinned: null,
        sortBy: "salience",
        sortOrder: "desc",
        limit: 200,
      });
      setMemories(results);
    } finally {
      setIsLoading(false);
    }
  }, [debouncedQuery, filters]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const activeMemory = useMemo(
    () => memories.find((m) => m.id === selectedId) ?? null,
    [memories, selectedId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (
      memories.length > 0 &&
      (selectedId === null || !memories.some((m) => m.id === selectedId))
    ) {
      setSelectedId(memories[0].id);
    }
  }, [memories, selectedId]);

  const handleTogglePin = async (memory: MemoryRecord): Promise<void> => {
    await api.memories.updateBatch([memory.id], { pinned: memory.pinned === 1 ? 0 : 1 });
    await load();
  };

  const handleRefresh = (): void => {
    void load();
  };

  const openNewMemory = (): void => {
    setEditingMemory(null);
    setIsEditModalOpen(true);
  };

  const openEditMemory = (memory: MemoryRecord): void => {
    setEditingMemory(memory);
    setIsEditModalOpen(true);
  };

  const closeEditModal = (): void => {
    if (isSaving) return;
    setIsEditModalOpen(false);
    setEditingMemory(null);
  };

  const handleSaveMemory = async (memory: MemoryRecord): Promise<void> => {
    setIsSaving(true);
    try {
      await api.memories.save(memory);
      setIsEditModalOpen(false);
      setEditingMemory(null);
      await load();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    await api.memories.delete(deleteTarget.id);
    setDeleteTarget(null);
    await load();
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      {/* Two columns */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Left: search + list */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card select-none">
          <div className="border-b border-border p-4">
            <div className="relative">
              <IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("main.memory.search.placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <span className="text-sm font-medium">{t("main.memory.tab.entries")}</span>
            <span className="text-xs text-muted-foreground">{memories.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {memories.map((memory) => (
              <MemoryListRow
                key={memory.id}
                memory={memory}
                active={memory.id === selectedId}
                onSelect={() => setSelectedId(memory.id)}
              />
            ))}
            {isLoading && memories.length === 0 && (
              <div className="flex flex-col gap-2 px-1 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-md bg-muted/40" />
                ))}
              </div>
            )}
            {memories.length === 0 && !isLoading && (
              <EmptyState icon={<IconDatabase />} title={t("main.title.memory")} />
            )}
          </div>
        </div>

        {/* Right: actions + detail */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="flex shrink-0 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <FilterSelect
              ariaLabel={t("main.memory.filter.scope")}
              value={filters.scope}
              onChange={(scope) =>
                setFilters((prev) => ({ ...prev, scope: scope as typeof prev.scope }))
              }
              options={[
                { value: "all", label: t("main.memory.filter.all") },
                ...MEMORY_SCOPES.map((s) => ({ value: s, label: t(`main.memory.scope.${s}`) })),
              ]}
            />
            <Button variant="secondary" size="sm" onPress={handleRefresh} isDisabled={isLoading}>
              <IconRotateCcw className={cn("size-4", isLoading && "animate-spin")} />
              {t("main.refresh")}
            </Button>
            <Button variant="primary" size="sm" onPress={openNewMemory}>
              <IconPlus className="size-4" />
              {t("main.memory.new")}
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border bg-card p-5">
            {activeMemory ? (
              <MemoryDetail
                memory={activeMemory}
                onEdit={() => openEditMemory(activeMemory)}
                onDelete={() => setDeleteTarget(activeMemory)}
                onTogglePin={() => handleTogglePin(activeMemory)}
              />
            ) : (
              !isLoading && <EmptyState icon={<IconDatabase />} title={t("main.title.memory")} />
            )}
          </div>
        </div>
      </div>

      {/* Edit modal */}
      {isEditModalOpen && (
        <MemoryEditModal
          memory={editingMemory}
          onClose={closeEditModal}
          onSave={handleSaveMemory}
          isSaving={isSaving}
        />
      )}

      {/* Delete confirmations */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={t("main.memory.delete")}
        message={
          deleteTarget
            ? t("main.memory.deleteConfirm", { title: deleteTarget.title })
            : t("main.memory.deleteConfirm", { title: "" })
        }
        danger
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
      />
    </div>
  );
}

function MemoryListRow({
  memory,
  active,
  onSelect,
}: {
  memory: MemoryRecord;
  active: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  return (
    <div
      data-slot="memory-row"
      data-active={active ? "true" : "false"}
      className={cn(
        "rounded-md px-2 py-2.5 transition",
        active ? "bg-muted/50" : "hover:bg-muted/30",
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="flex items-center gap-1.5">
          {memory.pinned !== 0 && (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
          )}
          <span className="truncate text-sm font-medium">{memory.title}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <Chip size="sm" variant="soft">
            {t(`main.memory.scope.${memory.scope}`)}
          </Chip>
          <Chip size="sm" variant="secondary">
            {t(`main.memory.kind.${memory.kind}`)}
          </Chip>
          <span className="ml-auto text-[10px] text-muted-foreground">
            {f.dateTime(memory.created_at)}
          </span>
        </div>
      </button>
    </div>
  );
}

function MemoryDetail({
  memory,
  onEdit,
  onDelete,
  onTogglePin,
}: {
  memory: MemoryRecord;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-semibold">{memory.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip size="sm" variant="soft">
              {t(`main.memory.scope.${memory.scope}`)}
            </Chip>
            <Chip size="sm" variant="secondary">
              {t(`main.memory.kind.${memory.kind}`)}
            </Chip>
            {memory.pinned !== 0 && (
              <Chip size="sm" variant="soft">
                {t("main.metric.pinned", { count: 1 })}
              </Chip>
            )}
            {memory.origin && (
              <Chip size="sm" variant="default">
                {t(`main.memory.origin.${memory.origin}`)}
              </Chip>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="tertiary" size="sm" isIconOnly onPress={onTogglePin}>
            <IconPin className={cn("size-4", memory.pinned !== 0 && "text-primary")} />
          </Button>
          <Button variant="secondary" size="sm" onPress={onEdit}>
            <IconEdit className="size-4" />
            {t("main.memory.edit")}
          </Button>
          <Button variant="danger" size="sm" isIconOnly onPress={onDelete}>
            <IconTrash className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-border bg-background/50 p-4 text-xs sm:grid-cols-3 select-none">
        <MetaItem label={t("main.memory.field.salience")} value={String(memory.salience)} />
        <MetaItem label={t("main.memory.sort.created")} value={f.dateTime(memory.created_at)} />
        <MetaItem label={t("main.memory.sort.updated")} value={f.dateTime(memory.updated_at)} />
      </div>

      <div className="rounded-md border border-border bg-background p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {memory.content}
        </p>
      </div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium text-foreground">{value}</p>
    </div>
  );
}

function MemoryEditModal({
  memory,
  onClose,
  onSave,
  isSaving,
}: {
  memory: MemoryRecord | null;
  onClose: () => void;
  onSave: (memory: MemoryRecord) => Promise<void>;
  isSaving: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const [title, setTitle] = useState(memory?.title ?? "");
  const [content, setContent] = useState(memory?.content ?? "");
  const [scope, setScope] = useState<MemoryScope>(memory?.scope ?? "global");
  const [kind, setKind] = useState<MemoryKind>(memory?.kind ?? "fact");
  const [salience, setSalience] = useState(memory?.salience ?? 70);
  const [pinned, setPinned] = useState((memory?.pinned ?? 0) === 1);

  const isValid = title.trim().length > 0 && content.trim().length > 0;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!isValid) return;
    const now = Date.now();
    const record: MemoryRecord = {
      id: memory?.id ?? crypto.randomUUID(),
      scope,
      kind,
      title: title.trim().slice(0, 120),
      content: content.trim().slice(0, 4000),
      agent_id: memory?.agent_id ?? null,
      conversation_id: memory?.conversation_id ?? null,
      source_run_id: memory?.source_run_id ?? null,
      salience,
      pinned: pinned ? 1 : 0,
      created_at: memory?.created_at ?? now,
      updated_at: now,
    };
    await onSave(record);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] w-[min(560px,calc(100vw-24px))] max-w-none p-0">
        <DialogHeader className="flex-row items-center justify-between px-5 py-3">
          <DialogTitle className="text-sm font-semibold">
            {memory ? t("main.memory.edit") : t("main.memory.new")}
          </DialogTitle>
          <button
            type="button"
            data-icon-only="true"
            data-icon-tone="danger"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <IconX className="size-4" />
          </button>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="max-h-[calc(92vh-9rem)] overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>{t("main.memory.field.title")}</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("main.memory.field.title")}
                  maxLength={120}
                  className="select-text"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("main.memory.field.content")}</Label>
                <TextArea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder={t("main.memory.field.content")}
                  rows={5}
                  maxLength={4000}
                  className="select-text"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("main.memory.filter.scope")}</Label>
                <ToggleButtonGroup
                  selectedKeys={[scope]}
                  onSelectionChange={(keys) => {
                    const key = [...keys][0];
                    if (MEMORY_SCOPES.includes(key as MemoryScope)) setScope(key as MemoryScope);
                  }}
                  size="sm"
                  fullWidth
                >
                  {MEMORY_SCOPES.map((s) => (
                    <ToggleButton key={s} id={s}>
                      {t(`main.memory.scope.${s}`)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("main.memory.filter.kind")}</Label>
                <ToggleButtonGroup
                  selectedKeys={[kind]}
                  onSelectionChange={(keys) => {
                    const key = [...keys][0];
                    if (MEMORY_KINDS.includes(key as MemoryKind)) setKind(key as MemoryKind);
                  }}
                  size="sm"
                  fullWidth
                >
                  {MEMORY_KINDS.map((k) => (
                    <ToggleButton key={k} id={k}>
                      {t(`main.memory.kind.${k}`)}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </div>
              <div className="grid gap-1.5">
                <Label>
                  {t("main.memory.field.salience")}: {salience}
                </Label>
                <div className="relative h-3 w-full">
                  <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-md bg-muted" />
                  <div
                    className="pointer-events-none absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-md bg-primary"
                    style={{ width: `${salience}%` }}
                  />
                  <input
                    type="range"
                    value={salience}
                    onChange={(event) => setSalience(event.currentTarget.valueAsNumber)}
                    min={1}
                    max={100}
                    step={1}
                    aria-label={t("main.memory.field.salience")}
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  />
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground/30 bg-background shadow-xs"
                    style={{ left: `${salience}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch isSelected={pinned} onChange={setPinned}>
                  {t("main.memory.field.pinned")}
                </Switch>
              </div>
            </div>
          </div>
          <DialogFooter className="flex-row justify-end px-5 py-3">
            <Button variant="tertiary" size="sm" onPress={onClose} isDisabled={isSaving}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              isPending={isSaving}
              isDisabled={!isValid}
            >
              {t("main.memory.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FilterSelect({
  ariaLabel,
  value,
  onChange,
  options,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}): React.JSX.Element {
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const items = options.map((option) => ({ label: option.label, value: option }));

  return (
    <Select
      items={items}
      value={selectedOption}
      isItemEqualToValue={(option, selected) => option.value === selected.value}
      itemToStringLabel={(option) => option.label}
      itemToStringValue={(option) => option.value}
      onValueChange={(option) => {
        if (option) onChange(option.value);
      }}
    >
      <SelectTrigger className="min-w-24" aria-label={ariaLabel}>
        <SelectValue>
          {(option: { value: string; label: string } | null) => option?.label ?? ""}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function Label({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="text-sm font-medium">{children}</span>;
}

function EmptyState({ icon, title }: { icon: ReactNode; title: string }): React.JSX.Element {
  return (
    <Card>
      <Card.Content className="flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
        <span className="text-2xl">{icon}</span>
        <p className="text-sm">{title}</p>
      </Card.Content>
    </Card>
  );
}
