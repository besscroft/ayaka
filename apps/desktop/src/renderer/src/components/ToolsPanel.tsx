import { useMemo, useRef, useState, useEffect, type ChangeEvent } from "react";
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
  Label,
  LoadingIndicator,
  SelectField,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TextArea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui";
import { strFromU8, unzipSync } from "fflate";
import { api, type ToolsSnapshot } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import {
  buildSkillInputFromMarkdown,
  parseSkillMarkdown,
  type SkillPackageDraft,
} from "../lib/tools-form";
import {
  filterToolRecords,
  isToolRecordApprovalEligible,
  type ToolKindFilter,
  type ToolStatusFilter,
} from "../lib/tools-filter";
import { cn } from "../lib/utils";
import { isChatToolId } from "@shared/types";
import type {
  ArtifactInstallation,
  CatalogItem,
  CatalogItemDetail,
  CatalogSnapshot,
  CatalogSourceFilter,
  ToolRecord,
  ToolServer,
  ToolSkill,
} from "@shared/types";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconCheck,
  IconClose,
  IconEye,
  IconInfo,
  IconList,
  IconPlus,
  IconRotateCcw,
  IconSearch,
  IconSparkles,
  IconTrash,
} from "./icons";
import { RichContent } from "./ai-elements/rich-content";

export function applyCatalogInstallation(
  items: CatalogItem[],
  installation: ArtifactInstallation,
): CatalogItem[] {
  if (!installation.itemId) return items;

  let changed = false;
  const nextItems = items.map((item) => {
    if (item.id !== installation.itemId) return item;
    changed = true;
    return { ...item, installed: true, updateAvailable: false };
  });
  return changed ? nextItems : items;
}

export function ToolsPanel(): React.JSX.Element {
  const { t, locale } = useT();
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ToolKindFilter>("all");
  const [status, setStatus] = useState<ToolStatusFilter>("all");

  const refresh = (): void => {
    setRefreshing(true);
    void api.tools
      .snapshot()
      .then(setSnapshot)
      .catch((error) => notify.error(t("tools.toast.failed"), error, locale))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(refresh, []);

  const rows = useMemo(
    () =>
      filterToolRecords(
        (snapshot?.toolRecords ?? []).filter((tool) => tool.kind !== "skill"),
        { query, kind, status },
      ),
    [kind, query, snapshot, status],
  );

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight select-none">
          {t("main.title.tools")}
        </h1>
        <div className="flex items-center gap-3">
          <MetricCard
            label={t("tools.metric.tools")}
            value={(snapshot?.toolRecords ?? []).filter((tool) => tool.kind !== "skill").length}
            orientation="horizontal"
          />
          <Button variant="secondary" size="sm" onPress={refresh} isDisabled={refreshing}>
            <IconRotateCcw className={cn("size-4", refreshing && "animate-spin")} />
            {t("main.refresh")}
          </Button>
        </div>
      </div>

      {snapshot ? (
        <div className="grid shrink-0 gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px] select-none">
          <label className="relative min-w-0 select-none">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("tools.search.placeholder")}
              className="pl-9"
            />
          </label>
          <SelectField
            value={kind}
            options={[
              { value: "all", label: t("tools.filter.allKinds") },
              { value: "builtin", label: t("tools.kind.builtin") },
              { value: "mcp", label: t("tools.kind.mcp") },
              { value: "sandbox", label: t("tools.kind.sandbox") },
            ]}
            onChange={(value) => setKind(value as ToolKindFilter)}
            ariaLabel={t("tools.filter.allKinds")}
          />
          <SelectField
            value={status}
            options={[
              { value: "all", label: t("tools.filter.allStatus") },
              { value: "enabled", label: t("tools.filter.enabled") },
              { value: "approval", label: t("tools.filter.approval") },
            ]}
            onChange={(value) => setStatus(value as ToolStatusFilter)}
            ariaLabel={t("tools.filter.allStatus")}
          />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto select-none">
        {loading && !snapshot ? (
          <div className="rounded-md border border-dashed border-border px-4 py-16">
            <LoadingIndicator label={t("main.loading")} />
          </div>
        ) : null}

        {snapshot ? <RegistrySection rows={rows} /> : null}
      </div>
    </div>
  );
}

export function InstalledSkillsPanel(): React.JSX.Element {
  const { t, locale } = useT();
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null);
  const [catalogSnapshot, setCatalogSnapshot] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ToolSkill | null>(null);
  const [detailTarget, setDetailTarget] = useState<DetailTarget>(null);

  const refresh = (): void => {
    setRefreshing(true);
    void Promise.all([api.tools.snapshot(), api.catalog.snapshot()])
      .then(([toolsSnapshot, nextCatalogSnapshot]) => {
        setSnapshot(toolsSnapshot);
        setCatalogSnapshot(nextCatalogSnapshot);
      })
      .catch((error) => notify.error(t("tools.toast.failed"), error, locale))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(refresh, []);

  const runAction = async (action: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    try {
      await action();
      notify.success(success);
    } catch (error) {
      notify.error(t("tools.toast.failed"), error, locale);
    } finally {
      refresh();
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 select-none">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("skills.installedCount", { count: snapshot?.skills.length ?? 0 })}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onPress={() => setSkillOpen(true)}>
            <IconPlus className="size-4" />
            {t("tools.skill.add")}
          </Button>
          <Button variant="secondary" size="sm" onPress={refresh} isDisabled={refreshing}>
            <IconRotateCcw className={cn("size-4", refreshing && "animate-spin")} />
            {t("main.refresh")}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
        {loading && !snapshot ? (
          <InstalledSkillsListSkeleton />
        ) : (
          <SkillsSection
            skills={snapshot?.skills ?? []}
            busy={busy}
            onDelete={setDeleteTarget}
            onToggle={(skill, enabled) =>
              runAction(
                () => api.tools.skills.setEnabled(skill.id, enabled),
                t("tools.toast.saved"),
              )
            }
            onApprovalChange={(skill, requiresApproval) =>
              runAction(
                () => api.tools.skills.update(skill.id, { requires_approval: requiresApproval }),
                t("tools.toast.saved"),
              )
            }
            onDetail={(skill) => setDetailTarget({ type: "skill", item: skill })}
          />
        )}
      </div>
      <AddSkillModal
        open={skillOpen}
        busy={busy}
        onClose={() => setSkillOpen(false)}
        onCreate={(markdown, source) =>
          runAction(async () => {
            await api.tools.skills.create(buildSkillInputFromMarkdown(markdown, source));
            setSkillOpen(false);
          }, t("tools.toast.saved"))
        }
      />
      <ToolDetailModal detail={detailTarget} onClose={() => setDetailTarget(null)} />
      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title={t("tools.delete.title")}
        message={t("tools.delete.message", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("common.delete")}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) {
            const installation = catalogSnapshot?.installations.find(
              (value) => value.skillId === target.id,
            );
            void runAction(
              () =>
                installation
                  ? api.catalog.uninstall(installation.id)
                  : api.tools.skills.delete(target.id),
              t("tools.toast.deleted"),
            );
          }
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function InstalledSkillsListSkeleton(): React.JSX.Element {
  return (
    <section className="grid animate-pulse gap-3 xl:grid-cols-2" aria-hidden="true">
      {[0, 1, 2, 3].map((id) => (
        <Card key={id}>
          <Card.Header>
            <div className="flex flex-col gap-2">
              <div className="h-4 w-2/5 rounded bg-muted" />
              <div className="h-3 w-4/5 rounded bg-muted" />
              <div className="h-3 w-3/5 rounded bg-muted" />
            </div>
          </Card.Header>
          <Card.Content className="flex flex-col gap-3 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1, 2].map((statId) => (
                <div key={statId} className="flex flex-col gap-1.5">
                  <div className="h-3 w-1/3 rounded bg-muted" />
                  <div className="h-3 w-2/3 rounded bg-muted" />
                </div>
              ))}
            </div>
            <div className="h-16 rounded-md bg-muted" />
          </Card.Content>
          <Card.Footer>
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-4">
                <div className="h-5 w-16 rounded-md bg-muted" />
                <div className="h-5 w-20 rounded-md bg-muted" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-8 w-14 rounded-md bg-muted" />
                <div className="h-8 w-14 rounded-md bg-muted" />
                <div className="h-8 w-14 rounded-md bg-muted" />
              </div>
            </div>
          </Card.Footer>
        </Card>
      ))}
    </section>
  );
}

function RegistrySection({ rows }: { rows: ToolRecord[] }): React.JSX.Element {
  const { t } = useT();
  return (
    <>
      {rows.length === 0 ? (
        <EmptyTools message={t("tools.registry.empty")} />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {rows.map((tool, index) => (
            <div
              key={tool.id}
              className={[
                "grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                index > 0 ? "border-t border-border" : "",
              ].join(" ")}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 truncate text-sm font-medium">
                    {localizeToolName(t, tool)}
                  </p>
                  <Chip size="sm" variant="secondary">
                    {t(`tools.kind.${tool.kind}`)}
                  </Chip>
                  {tool.enabled ? (
                    <Chip size="sm" variant="soft">
                      {t("main.value.enabled")}
                    </Chip>
                  ) : (
                    <Chip size="sm" variant="secondary">
                      {t("main.value.disabled")}
                    </Chip>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-foreground/50">
                  {localizeToolDescription(t, tool)}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] text-foreground/35">
                  {tool.reference}
                </p>
              </div>
              <div className="flex flex-wrap items-start gap-2 md:justify-end">
                {tool.auto_use ? <Chip size="sm">{t("tools.autoUse")}</Chip> : null}
                {isToolRecordApprovalEligible(tool) && tool.requires_approval ? (
                  <Chip size="sm">{t("tools.approval")}</Chip>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SkillsSection({
  skills,
  busy,
  onDelete,
  onToggle,
  onApprovalChange,
  onDetail,
}: {
  skills: ToolSkill[];
  busy: boolean;
  onDelete: (skill: ToolSkill) => void;
  onToggle: (skill: ToolSkill, enabled: boolean) => void;
  onApprovalChange: (skill: ToolSkill, requiresApproval: boolean) => void;
  onDetail: (skill: ToolSkill) => void;
}): React.JSX.Element {
  const { t } = useT();
  if (skills.length === 0) {
    return <EmptyTools message={t("tools.skill.empty")} />;
  }
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      {skills.map((skill) => (
        <SkillCard
          key={skill.id}
          skill={skill}
          busy={busy}
          onDelete={() => onDelete(skill)}
          onToggle={(enabled) => onToggle(skill, enabled)}
          onApprovalChange={(requiresApproval) => onApprovalChange(skill, requiresApproval)}
          onDetail={() => onDetail(skill)}
        />
      ))}
    </section>
  );
}

function SkillCard({
  skill,
  busy,
  onDelete,
  onToggle,
  onApprovalChange,
  onDetail,
}: {
  skill: ToolSkill;
  busy: boolean;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onApprovalChange: (requiresApproval: boolean) => void;
  onDetail: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const config = safeJsonObject(skill.config_json);
  const source = typeof config.source === "string" ? config.source : "manual";
  const instructions = skill.instructions;
  return (
    <Card>
      <Card.Header>
        <div className="min-w-0">
          <Card.Title className="truncate">{skill.name}</Card.Title>
          <Card.Description className="line-clamp-2">
            {skill.description || t("tools.skill.noDescription")}
          </Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3 p-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <ReadStat label={t("tools.field.category")} value={skill.category} />
          <ReadStat label="Source" value={source} />
          <ReadStat
            label={t("tools.field.lastRun")}
            value={skill.last_run_at ? f.dateTime(skill.last_run_at) : t("tools.never")}
          />
        </div>
        {instructions ? (
          <p className="line-clamp-4 whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {instructions}
          </p>
        ) : null}
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-4">
            <Switch
              size="sm"
              isSelected={skill.enabled !== 0}
              isDisabled={busy}
              onChange={onToggle}
            >
              {t("tools.enabled")}
            </Switch>
            <Switch
              size="sm"
              isSelected={skill.requires_approval !== 0}
              isDisabled={busy}
              onChange={onApprovalChange}
            >
              {t("tools.filter.approval")}
            </Switch>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onPress={onDetail} isDisabled={busy}>
              <IconEye className="size-4" />
              {t("tools.detail")}
            </Button>
            <Button size="sm" variant="danger" onPress={onDelete} isDisabled={busy}>
              <IconTrash className="size-4" />
              {t("common.delete")}
            </Button>
          </div>
        </div>
      </Card.Footer>
    </Card>
  );
}

export type DetailTarget =
  | { type: "mcp"; item: ToolServer; tools: ToolRecord[] }
  | { type: "skill"; item: ToolSkill }
  | null;

export function ToolDetailModal({
  detail,
  onClose,
}: {
  detail: DetailTarget;
  onClose: () => void;
}): React.JSX.Element | null {
  const { t, f } = useT();
  if (!detail) return null;

  const isMcp = detail.type === "mcp";
  const item = detail.item;

  return (
    <Dialog open={!!detail} onOpenChange={(isOpen) => (!isOpen ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] w-[min(640px,calc(100vw-24px))] max-w-none">
        <DialogHeader>
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{item.name}</DialogTitle>
              <p className="mt-1 line-clamp-2 text-sm text-foreground/50">
                {item.description || t("tools.noDescription")}
              </p>
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
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {isMcp ? (
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-medium">{t("tools.detail.mcpInfo")}</h4>
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <ReadStat
                  label={t("tools.field.transport")}
                  value={(detail.item as ToolServer).transport}
                />
                <ReadStat
                  label={t("tools.field.status")}
                  value={
                    (detail.item as ToolServer).enabled
                      ? (detail.item as ToolServer).status
                      : "disabled"
                  }
                />
                <ReadStat
                  label="Timeout"
                  value={`${(detail.item as ToolServer).timeout_seconds}s`}
                />
                <ReadStat
                  label={t("tools.field.tools")}
                  value={`${detail.tools.filter((tool) => tool.enabled !== 0).length} / ${detail.tools.length}`}
                />
                <ReadStat
                  className="sm:col-span-2"
                  label={t("tools.field.endpoint")}
                  value={formatEndpoint(detail.item as ToolServer)}
                />
                <ReadStat
                  className="sm:col-span-2"
                  label={t("tools.field.connected")}
                  value={
                    (detail.item as ToolServer).last_connected_at
                      ? f.dateTime((detail.item as ToolServer).last_connected_at!)
                      : t("tools.never")
                  }
                />
              </div>
              {(detail.item as ToolServer).last_error ? (
                <p className="break-words rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
                  {(detail.item as ToolServer).last_error}
                </p>
              ) : null}
              {detail.tools.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium">{t("tools.detail.toolList")}</h4>
                  <div className="max-h-48 flex flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
                    {detail.tools.map((tool) => (
                      <div
                        key={tool.id}
                        className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs"
                      >
                        <span className="truncate font-medium">{tool.title ?? tool.name}</span>
                        <Chip size="sm" variant={tool.enabled ? "soft" : "secondary"}>
                          {tool.enabled ? t("main.value.enabled") : t("main.value.disabled")}
                        </Chip>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-medium">{t("tools.detail.skillInfo")}</h4>
              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <ReadStat
                  label={t("tools.field.category")}
                  value={(detail.item as ToolSkill).category}
                />
                <ReadStat
                  label="Source"
                  value={(() => {
                    const config = safeJsonObject((detail.item as ToolSkill).config_json);
                    return typeof config.source === "string" ? config.source : "manual";
                  })()}
                />
                <ReadStat
                  label={t("tools.field.lastRun")}
                  value={
                    (detail.item as ToolSkill).last_run_at
                      ? f.dateTime((detail.item as ToolSkill).last_run_at!)
                      : t("tools.never")
                  }
                />
              </div>
              {(() => {
                const instructions = (detail.item as ToolSkill).instructions;
                return instructions ? (
                  <div className="flex flex-col gap-2">
                    <h4 className="text-sm font-medium">{t("tools.detail.instructions")}</h4>
                    <pre
                      data-slot="code-surface"
                      className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
                    >
                      {instructions}
                    </pre>
                  </div>
                ) : null;
              })()}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onPress={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSkillModal({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (markdown: string, source: "upload" | "ai") => Promise<void>;
}): React.JSX.Element {
  const { t, locale } = useT();
  const skillFileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const zipRef = useRef<HTMLInputElement | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [draft, setDraft] = useState<SkillPackageDraft | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [source, setSource] = useState<"upload" | "ai">("upload");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const reset = (): void => {
    setAiPrompt("");
    setDraft(null);
    setMarkdown("");
    setSource("upload");
    setError(null);
  };
  const close = (): void => {
    reset();
    onClose();
  };
  const loadMarkdown = (text: string, nextSource: "upload" | "ai"): void => {
    try {
      const nextDraft = parseSkillMarkdown(text, nextSource);
      setDraft(nextDraft);
      setMarkdown(nextDraft.markdown);
      setSource(nextSource);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const install = (): void => {
    try {
      parseSkillMarkdown(markdown, source);
      void onCreate(markdown, source).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const generate = (): void => {
    setGenerating(true);
    setError(null);
    void api.tools.skills
      .generateDraft({ prompt: aiPrompt })
      .then((result) => loadMarkdown(result.markdown, "ai"))
      .catch((err) => notify.error(t("tools.toast.failed"), err, locale))
      .finally(() => setGenerating(false));
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (!isOpen ? close() : undefined)}>
      <DialogContent className="max-h-[92vh] w-[min(920px,calc(100vw-24px))] max-w-none overflow-hidden">
        <DialogHeader>
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold">
                {t("tools.skill.add")}
              </DialogTitle>
              <p className="line-clamp-2 text-sm text-foreground/50">
                Upload a SKILL.md package or create one with AI.
              </p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={close}
              aria-label={t("common.close")}
            >
              <IconClose className="size-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid gap-4">
            {error ? (
              <p className="break-words rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                {error}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-3">
              <Button variant="secondary" onPress={() => skillFileRef.current?.click()}>
                <IconList className="size-4" />
                SKILL.md
              </Button>
              <Button variant="secondary" onPress={() => folderRef.current?.click()}>
                <IconList className="size-4" />
                Folder
              </Button>
              <Button variant="secondary" onPress={() => zipRef.current?.click()}>
                <IconList className="size-4" />
                ZIP
              </Button>
            </div>
            <input
              ref={skillFileRef}
              className="hidden"
              type="file"
              accept=".md,text/markdown,text/plain"
              onChange={(event) => void handleSkillFile(event, loadMarkdown, setError)}
            />
            <input
              ref={folderRef}
              className="hidden"
              type="file"
              multiple
              {...({ webkitdirectory: "" } as Record<string, string>)}
              onChange={(event) => void handleSkillFolder(event, loadMarkdown, setError)}
            />
            <input
              ref={zipRef}
              className="hidden"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => void handleSkillZip(event, loadMarkdown, setError)}
            />

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <Field label="AI prompt">
                <TextArea
                  rows={3}
                  value={aiPrompt}
                  placeholder="Describe the skill you want to create"
                  onChange={(event) => setAiPrompt(event.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  className="w-full md:w-auto"
                  variant="primary"
                  isDisabled={!aiPrompt.trim()}
                  isPending={generating}
                  onPress={generate}
                >
                  <IconSparkles className="size-4" />
                  AI Create
                </Button>
              </div>
            </div>

            <Field label="SKILL.md preview">
              <TextArea
                rows={12}
                value={markdown}
                className="font-mono text-xs"
                onChange={(event) => {
                  setMarkdown(event.target.value);
                  try {
                    setDraft(parseSkillMarkdown(event.target.value, source));
                    setError(null);
                  } catch {
                    setDraft(null);
                  }
                }}
              />
            </Field>
            {draft ? (
              <div className="rounded-md border border-border bg-muted px-3 py-2">
                <p className="truncate text-sm font-medium">{draft.name}</p>
                <p className="line-clamp-2 text-xs text-foreground/55">{draft.description}</p>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="secondary" onPress={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" isDisabled={!draft} isPending={busy} onPress={install}>
              <IconCheck className="size-4" />
              {t("tools.skill.add")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MetricCard({
  label,
  value,
  orientation = "vertical",
}: {
  label: string;
  value: number;
  orientation?: "vertical" | "horizontal";
}): React.JSX.Element {
  const { f } = useT();
  if (orientation === "horizontal") {
    return (
      <div className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm select-none">
        <span className="font-semibold tabular-nums">{f.number(value)}</span>
        <span className="truncate text-xs text-foreground/45 select-none">{label}</span>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-border px-4 py-3">
      <p className="truncate text-xs text-foreground/45">{label}</p>
      <p className="mt-1 text-xl font-semibold">{f.number(value)}</p>
    </div>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="grid min-w-0 select-none gap-1.5">
      <Label className="text-xs font-medium text-foreground/50">{label}</Label>
      {children}
    </label>
  );
}

export function ReadStat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={["min-w-0 rounded-md bg-muted px-3 py-2", className].join(" ")}>
      <p className="truncate text-[11px] text-foreground/40">{label}</p>
      <p className="mt-1 break-all text-xs text-foreground/70">{value || "-"}</p>
    </div>
  );
}

export function EmptyTools({
  message,
  action,
  onAction,
}: {
  message: string;
  action?: string;
  onAction?: () => void;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-dashed border-border px-4 py-12 text-center">
      <p className="text-sm text-foreground/45">{message}</p>
      {action && onAction ? (
        <Button className="mt-4" variant="primary" size="sm" onPress={onAction}>
          <IconPlus className="size-4" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

async function handleSkillFile(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (markdown: string, source: "upload") => void,
  onError: (error: string | null) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    onLoad(await file.text(), "upload");
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

async function handleSkillFolder(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (markdown: string, source: "upload") => void,
  onError: (error: string | null) => void,
): Promise<void> {
  const files = Array.from(event.target.files ?? []);
  event.target.value = "";
  const skill = files.find(
    (file) => file.name === "SKILL.md" || file.webkitRelativePath.endsWith("/SKILL.md"),
  );
  if (!skill) {
    onError("Folder must contain SKILL.md.");
    return;
  }
  try {
    onLoad(await skill.text(), "upload");
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

async function handleSkillZip(
  event: ChangeEvent<HTMLInputElement>,
  onLoad: (markdown: string, source: "upload") => void,
  onError: (error: string | null) => void,
): Promise<void> {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const entryName = Object.keys(entries).find(
      (name) => name === "SKILL.md" || name.endsWith("/SKILL.md"),
    );
    if (!entryName) throw new Error("ZIP must contain SKILL.md.");
    onLoad(strFromU8(entries[entryName]!), "upload");
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

export function CatalogDiscover(): React.JSX.Element {
  const { t, f, locale } = useT();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<CatalogSourceFilter>("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [detailItem, setDetailItem] = useState<CatalogItem | null>(null);
  const [detail, setDetail] = useState<CatalogItemDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const pageSize = 36;

  const loadPage = async (nextPage: number, append: boolean): Promise<void> => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await api.catalog.search({
        ...(query.trim() ? { query: query.trim() } : {}),
        page: nextPage,
        pageSize,
        source,
      });
      setItems((current) => {
        if (!append) return result.items;
        const byId = new Map(current.map((item) => [item.id, item]));
        result.items.forEach((item) => byId.set(item.id, item));
        return [...byId.values()];
      });
      setPage(result.page);
      setHasMore(result.hasMore);
      setWarnings(result.sources.flatMap((state) => (state.error ? [state.error] : [])));
      setError(null);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setWarnings([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(1, false), 250);
    return () => window.clearTimeout(timer);
  }, [query, source]);

  const install = async (item: CatalogItem): Promise<void> => {
    setBusyId(item.id);
    try {
      const installation = await api.catalog.install({ itemId: item.id, enable: false });
      setItems((current) => applyCatalogInstallation(current, installation));
      setDetailItem(null);
      notify.success(
        item.installed ? t("catalog.updatedDisabled") : t("catalog.installedDisabled"),
      );
    } catch (reason) {
      notify.error(t("catalog.installFailed"), reason, locale);
    } finally {
      setBusyId(null);
    }
  };

  const openDetail = (item: CatalogItem): void => {
    setDetailItem(item);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    void api.catalog
      .detail(item.id)
      .then(setDetail)
      .catch((reason) => setDetailError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setDetailLoading(false));
  };

  return (
    <div
      data-slot="tools-catalog"
      className="flex h-full flex-col gap-4 overflow-hidden select-none"
    >
      <div className="flex shrink-0 flex-col gap-3">
        <div className="flex flex-col gap-2 md:flex-row">
          <label className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t("catalog.search")}
            />
          </label>
          <Tabs value={source} onValueChange={(value) => setSource(value as CatalogSourceFilter)}>
            <TabsList aria-label={t("catalog.sourceFilter")}>
              <TabsTrigger value="all">{t("catalog.source.all")}</TabsTrigger>
              <TabsTrigger value="skills-sh">skills.sh</TabsTrigger>
              <TabsTrigger value="modelscope-skills">ModelScope</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground select-none">
          <span>
            {source === "modelscope-skills"
              ? t("catalog.modelscopeDescription")
              : t("catalog.multiSourceDescription")}
          </span>
          <span className="shrink-0">{t("catalog.loaded", { count: f.number(items.length) })}</span>
        </div>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/30 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {t("catalog.sourceWarning")} {warnings.join(" ")}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={loading}>
        {loading && items.length === 0 ? (
          <CatalogListSkeleton />
        ) : items.length === 0 ? (
          <Card>
            <Card.Header>
              <Card.Title>{t("catalog.empty")}</Card.Title>
              <Card.Description>{t("catalog.emptyDescription")}</Card.Description>
            </Card.Header>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <CatalogCard
                key={item.id}
                item={item}
                busy={busyId !== null}
                onDetail={openDetail}
                onInstall={(next) => void install(next)}
              />
            ))}
          </div>
        )}
        {!loading && hasMore ? (
          <div className="flex justify-center py-5">
            <Button
              variant="secondary"
              isPending={loadingMore}
              isDisabled={loadingMore || busyId !== null}
              onPress={() => void loadPage(page + 1, true)}
            >
              {t("catalog.loadMore")}
            </Button>
          </div>
        ) : null}
      </div>
      <CatalogDetailModal
        item={detailItem}
        detail={detail}
        loading={detailLoading}
        error={detailError}
        busy={detailItem !== null && busyId === detailItem.id}
        onClose={() => setDetailItem(null)}
        onRetry={() => (detailItem ? openDetail(detailItem) : undefined)}
        onInstall={(item) => void install(item)}
      />
    </div>
  );
}

function CatalogListSkeleton(): React.JSX.Element {
  return (
    <div className="grid animate-pulse gap-3 md:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5].map((id) => (
        <Card key={id} className="overflow-hidden rounded-md">
          <Card.Header className="p-3">
            <div className="flex min-h-12 items-center gap-3">
              <div className="size-9 shrink-0 rounded-full bg-muted" />
              <div className="min-w-0 flex flex-1 flex-col gap-2">
                <div className="h-4 w-3/5 rounded bg-muted" />
                <div className="h-3 w-4/5 rounded bg-muted" />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <div className="size-8 rounded-md bg-muted" />
                <div className="size-8 rounded-md bg-muted" />
              </div>
            </div>
          </Card.Header>
          <Card.Content className="flex items-center gap-2 px-3 pb-3">
            <div className="h-5 w-16 rounded-full bg-muted" />
            <div className="h-5 w-12 rounded-full bg-muted" />
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

function CatalogCard({
  item,
  busy,
  onDetail,
  onInstall,
}: {
  item: CatalogItem;
  busy: boolean;
  onDetail: (item: CatalogItem) => void;
  onInstall: (item: CatalogItem) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const metric = item.metrics.installs ?? item.metrics.downloads ?? 0;
  return (
    <Card className="overflow-hidden rounded-md">
      <Card.Header className="p-3">
        <div className="flex min-h-12 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
            {item.sourceKind === "skills-sh" ? "AI" : "MS"}
          </div>
          <div className="min-w-0 flex-1">
            <Card.Title className="truncate text-sm">{item.name}</Card.Title>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{item.externalId}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  aria-label={t("catalog.details")}
                  onPress={() => onDetail(item)}
                >
                  <IconInfo className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("catalog.details")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger>
                <Button
                  isIconOnly
                  size="sm"
                  variant="primary"
                  aria-label={item.installed ? t("catalog.installed") : t("catalog.install")}
                  isDisabled={busy || (item.installed && !item.updateAvailable)}
                  onPress={() => onInstall(item)}
                >
                  {item.installed && !item.updateAvailable ? (
                    <IconCheck className="size-4" />
                  ) : (
                    <IconPlus className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {item.installed ? t("catalog.installed") : t("catalog.install")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </Card.Header>
      <Card.Content className="flex items-center gap-2 px-3 pb-3">
        <Chip size="sm" color="accent" variant="soft">
          <Chip.Label>{item.sourceLabel}</Chip.Label>
        </Chip>
        <Chip size="sm" variant="secondary">
          <Chip.Label>{metric ? f.compactNumber(metric) : "-"}</Chip.Label>
        </Chip>
      </Card.Content>
    </Card>
  );
}

function CatalogDetailModal({
  item,
  detail,
  loading,
  error,
  busy,
  onClose,
  onRetry,
  onInstall,
}: {
  item: CatalogItem | null;
  detail: CatalogItemDetail | null;
  loading: boolean;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onRetry: () => void;
  onInstall: (item: CatalogItem) => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const metric = item?.metrics.installs ?? item?.metrics.downloads ?? 0;
  return (
    <Dialog open={item !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[88vh] w-[min(760px,calc(100vw-24px))] max-w-none overflow-hidden">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{item?.name}</DialogTitle>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {item?.sourceLabel} · {item?.externalId}
              </p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              aria-label={t("common.close")}
              onPress={onClose}
            >
              <IconClose className="size-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {item ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <ReadStat label={t("catalog.source")} value={item.sourceLabel} />
              <ReadStat
                label={t("catalog.installs")}
                value={metric ? f.compactNumber(metric) : "-"}
              />
              <ReadStat
                label={t("catalog.files")}
                value={detail ? String(detail.files.length) : "-"}
              />
            </div>
          ) : null}
          {item?.description ? (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          ) : null}
          {loading ? (
            <LoadingIndicator className="w-full py-10" label={t("catalog.detailLoading")} />
          ) : null}
          {error ? (
            <div className="flex flex-col gap-2">
              <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
              <Button size="sm" variant="secondary" onPress={onRetry}>
                {t("catalog.retry")}
              </Button>
            </div>
          ) : null}
          {detail ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span>{t("catalog.packageSize", { size: f.number(detail.totalBytes) })}</span>
                <span>·</span>
                <span>{t("catalog.validated")}</span>
              </div>
              <div className="rounded-md border border-border p-4">
                <RichContent value={detail.markdown} />
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                {detail.files.map((file) => (
                  <span key={file.path} className="rounded bg-muted px-2 py-1 font-mono">
                    {file.path}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {item?.catalogUrl ? (
            <a
              className="text-xs text-primary underline underline-offset-2"
              href={item.catalogUrl}
              target="_blank"
              rel="noreferrer"
            >
              {t("catalog.openSource")}
            </a>
          ) : null}
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button variant="tertiary" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          {item ? (
            <Button
              isPending={busy}
              isDisabled={item.installed && !item.updateAvailable}
              onPress={() => onInstall(item)}
            >
              {item.updateAvailable
                ? t("catalog.updateDisabled")
                : item.installed
                  ? t("catalog.installed")
                  : t("catalog.installDisabled")}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function localizeToolName(t: (key: string) => string, tool: ToolRecord): string {
  if (isChatToolId(tool.name)) return t(`chatTools.${tool.name}.label`);
  return tool.title ?? tool.name;
}

function localizeToolDescription(t: (key: string) => string, tool: ToolRecord): string {
  if (isChatToolId(tool.name)) return t(`chatTools.${tool.name}.description`);
  return tool.description;
}

export function groupByServer(tools: ToolRecord[]): Map<string, ToolRecord[]> {
  const grouped = new Map<string, ToolRecord[]>();
  for (const tool of tools) {
    if (!tool.server_id) continue;
    grouped.set(tool.server_id, [...(grouped.get(tool.server_id) ?? []), tool]);
  }
  return grouped;
}

export function formatEndpoint(server: ToolServer): string {
  if (server.transport === "stdio") {
    const args = safeJsonArray(server.args_json).join(" ");
    return [server.command, args].filter(Boolean).join(" ") || server.transport;
  }
  return server.url ?? server.transport;
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
