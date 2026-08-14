import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CronJob,
  CronJobInput,
  CronRun,
  CronSchedule,
  ChatReasoningLevel,
} from "@shared/types";
import { CHAT_REASONING_LEVELS } from "@shared/types";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useT } from "../lib/i18n";
import {
  Button,
  Card,
  Chip,
  DateTimePicker,
  Input,
  LoadingIndicator,
  SelectField,
  TextArea,
  ToggleButton,
  ToggleButtonGroup,
} from "./ui";
import { ConfirmDialog } from "./ConfirmDialog";

type ScheduleKind = CronSchedule["kind"];

interface Draft {
  name: string;
  description: string;
  kind: ScheduleKind;
  onceAt: string;
  intervalMinutes: string;
  expression: string;
  timezone: string;
  prompt: string;
  modelRef: string;
  agentId: string;
  reasoning: ChatReasoningLevel;
  skillIds: string;
}

const emptyDraft = (): Draft => ({
  name: "",
  description: "",
  kind: "interval",
  onceAt: toLocalDateTime(new Date(Date.now() + 60 * 60_000)),
  intervalMinutes: "60",
  expression: "0 9 * * 1-5",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  prompt: "",
  modelRef: "",
  agentId: "",
  reasoning: "provider-default",
  skillIds: "",
});

export function AutomationPanel(): React.JSX.Element {
  const { t, locale } = useT();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<CronRun[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CronJob | null>(null);

  const selected = jobs.find((job) => job.id === selectedId) ?? null;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const nextJobs = await api.cron.list();
      setJobs(nextJobs);
      setError(null);
      setSelectedId((current) =>
        current && nextJobs.some((job) => job.id === current) ? current : (nextJobs[0]?.id ?? null),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setRuns([]);
      return;
    }
    void api.cron.runs(selectedId, 50).then(setRuns).catch(console.error);
  }, [selectedId, jobs]);

  const preview = useMemo(() => describeDraft(draft, locale), [draft, locale]);

  const beginCreate = (): void => {
    setSelectedId(null);
    setDraft(emptyDraft());
    setEditing(true);
  };

  const beginEdit = (job: CronJob): void => {
    setSelectedId(job.id);
    setDraft(draftFromJob(job));
    setEditing(true);
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const input = inputFromDraft(draft);
      const job = selected
        ? await api.cron.update(selected.id, input)
        : await api.cron.create(input);
      await refresh();
      setSelectedId(job.id);
      setEditing(false);
      notify.success(t("automation.saved"));
    } catch (reason) {
      notify.error(t("automation.saveFailed"), reason, locale);
    } finally {
      setSaving(false);
    }
  };

  const togglePaused = async (job: CronJob): Promise<void> => {
    try {
      await (job.status === "paused" ? api.cron.resume(job.id) : api.cron.pause(job.id));
      await refresh();
    } catch (reason) {
      notify.error(t("automation.actionFailed"), reason, locale);
    }
  };

  const runNow = async (job: CronJob): Promise<void> => {
    try {
      await api.cron.run(job.id);
      notify.success(t("automation.runStarted"));
      await refresh();
    } catch (reason) {
      notify.error(t("automation.actionFailed"), reason, locale);
    }
  };

  if (loading) {
    return <LoadingIndicator className="flex flex-1" label={t("automation.loading")} />;
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Card className="max-w-md">
          <Card.Header>
            <Card.Title>{t("automation.loadFailed")}</Card.Title>
            <Card.Description>{error}</Card.Description>
          </Card.Header>
          <Card.Footer>
            <Button size="sm" onPress={() => void refresh()}>
              {t("common.retry")}
            </Button>
          </Card.Footer>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden">
      <header className="flex items-start justify-between gap-4 select-none">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t("automation.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("automation.subtitle")}</p>
        </div>
        <Button onPress={beginCreate}>{t("automation.new")}</Button>
      </header>

      <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground select-none">
        {t("automation.runningNotice")}
      </p>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,0.8fr)_minmax(24rem,1.2fr)] gap-4 overflow-hidden">
        <section className="min-h-0 overflow-y-auto select-none" aria-label={t("automation.jobs")}>
          {jobs.length === 0 ? (
            <Card>
              <Card.Header>
                <Card.Title>{t("automation.empty")}</Card.Title>
                <Card.Description>{t("automation.emptyDescription")}</Card.Description>
              </Card.Header>
              <Card.Footer>
                <Button size="sm" onPress={beginCreate}>
                  {t("automation.new")}
                </Button>
              </Card.Footer>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setSelectedId(job.id)}
                  className={`rounded-lg border p-3 text-left transition motion-reduce:transition-none ${selectedId === job.id ? "border-accent bg-accent/5" : "border-border bg-card hover:bg-muted/40"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{job.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {describeSchedule(job.schedule, locale)}
                      </p>
                    </div>
                    <Chip
                      size="sm"
                      color={job.status === "active" ? "success" : "default"}
                      variant="soft"
                    >
                      <Chip.Label>{t(`automation.status.${job.status}`)}</Chip.Label>
                    </Chip>
                  </div>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {job.nextRunAt
                      ? t("automation.nextRun", { time: formatDate(job.nextRunAt, locale) })
                      : t("automation.noNextRun")}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="min-h-0 overflow-y-auto select-none">
          {editing ? (
            <AutomationEditor
              draft={draft}
              setDraft={setDraft}
              preview={preview}
              saving={saving}
              onSave={() => void save()}
              onCancel={() => setEditing(false)}
            />
          ) : selected ? (
            <div className="flex flex-col gap-4">
              <Card>
                <Card.Header>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Card.Title>{selected.name}</Card.Title>
                      <Card.Description>
                        {selected.description || describeSchedule(selected.schedule, locale)}
                      </Card.Description>
                    </div>
                    <Chip
                      size="sm"
                      color={selected.status === "active" ? "success" : "default"}
                      variant="soft"
                    >
                      <Chip.Label>{t(`automation.status.${selected.status}`)}</Chip.Label>
                    </Chip>
                  </div>
                </Card.Header>
                <Card.Content className="flex flex-col gap-3 text-sm">
                  <div>
                    <p className="text-xs font-medium">{t("automation.prompt")}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                      {selected.payload.prompt}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <span>{describeSchedule(selected.schedule, locale)}</span>
                    <span>
                      {selected.nextRunAt
                        ? formatDate(selected.nextRunAt, locale)
                        : t("automation.noNextRun")}
                    </span>
                  </div>
                </Card.Content>
                <Card.Footer className="flex flex-wrap gap-2">
                  <Button size="sm" onPress={() => void runNow(selected)}>
                    {t("automation.runNow")}
                  </Button>
                  <Button size="sm" variant="tertiary" onPress={() => void togglePaused(selected)}>
                    {selected.status === "paused" ? t("automation.resume") : t("automation.pause")}
                  </Button>
                  <Button size="sm" variant="tertiary" onPress={() => beginEdit(selected)}>
                    {t("common.edit")}
                  </Button>
                  <Button
                    size="sm"
                    variant="tertiary"
                    onPress={() =>
                      window.dispatchEvent(
                        new CustomEvent("ayaka:open-conversation", {
                          detail: { conversationId: selected.conversationId },
                        }),
                      )
                    }
                  >
                    {t("automation.openChat")}
                  </Button>
                  <Button size="sm" variant="danger" onPress={() => setPendingDelete(selected)}>
                    {t("common.delete")}
                  </Button>
                </Card.Footer>
              </Card>

              <Card>
                <Card.Header>
                  <Card.Title>{t("automation.history")}</Card.Title>
                  <Card.Description>{t("automation.historyDescription")}</Card.Description>
                </Card.Header>
                <Card.Content>
                  {runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("automation.noRuns")}</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {runs.map((run) => (
                        <div key={run.id} className="rounded-md border border-border p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium">
                              {t(`automation.runStatus.${run.status}`)}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              {formatDate(run.scheduledFor, locale)}
                            </span>
                          </div>
                          {run.error ? (
                            <p className="mt-2 whitespace-pre-wrap text-xs text-destructive">
                              {run.error}
                            </p>
                          ) : run.output ? (
                            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                              {run.output}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </Card.Content>
              </Card>
            </div>
          ) : null}
        </section>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("automation.deleteTitle")}
        message={t("automation.deleteMessage")}
        danger
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const job = pendingDelete;
          setPendingDelete(null);
          if (!job) return;
          void api.cron
            .delete(job.id)
            .then(refresh)
            .catch((reason) => notify.error(t("automation.actionFailed"), reason, locale));
        }}
      />
    </div>
  );
}

function AutomationEditor({
  draft,
  setDraft,
  preview,
  saving,
  onSave,
  onCancel,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  preview: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useT();
  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void =>
    setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Card className="select-none">
      <Card.Header>
        <Card.Title>{t("automation.editorTitle")}</Card.Title>
        <Card.Description>{preview}</Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <Field label={t("automation.name")}>
          <Input
            value={draft.name}
            onChange={(event) => update("name", event.currentTarget.value)}
          />
        </Field>
        <Field label={t("automation.description")}>
          <Input
            value={draft.description}
            onChange={(event) => update("description", event.currentTarget.value)}
          />
        </Field>
        <Field label={t("automation.scheduleType")}>
          <ToggleButtonGroup
            selectedKeys={[draft.kind]}
            disallowEmptySelection
            onSelectionChange={(value) => {
              const kind = [...value][0];
              if (kind) update("kind", kind as ScheduleKind);
            }}
          >
            <ToggleButton id="once">{t("automation.once")}</ToggleButton>
            <ToggleButton id="interval">{t("automation.interval")}</ToggleButton>
            <ToggleButton id="cron">Cron</ToggleButton>
          </ToggleButtonGroup>
        </Field>
        {draft.kind === "once" ? (
          <Field label={t("automation.runAt")}>
            <DateTimePicker
              value={draft.onceAt}
              onChange={(value) => update("onceAt", value)}
              ariaLabel={t("automation.runAt")}
            />
          </Field>
        ) : null}
        {draft.kind === "interval" ? (
          <Field label={t("automation.intervalMinutes")}>
            <Input
              type="number"
              min="1"
              value={draft.intervalMinutes}
              onChange={(event) => update("intervalMinutes", event.currentTarget.value)}
            />
          </Field>
        ) : null}
        {draft.kind === "cron" ? (
          <>
            <Field label={t("automation.cronExpression")}>
              <Input
                value={draft.expression}
                onChange={(event) => update("expression", event.currentTarget.value)}
              />
            </Field>
            <Field label={t("automation.timezone")}>
              <Input
                value={draft.timezone}
                onChange={(event) => update("timezone", event.currentTarget.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label={t("automation.prompt")}>
          <TextArea
            rows={6}
            value={draft.prompt}
            onChange={(event) => update("prompt", event.currentTarget.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("automation.model")}>
            <Input
              placeholder={t("automation.inherit")}
              value={draft.modelRef}
              onChange={(event) => update("modelRef", event.currentTarget.value)}
            />
          </Field>
          <Field label={t("automation.agent")}>
            <Input
              placeholder={t("automation.inherit")}
              value={draft.agentId}
              onChange={(event) => update("agentId", event.currentTarget.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("automation.reasoning")}>
            <SelectField
              value={draft.reasoning}
              options={CHAT_REASONING_LEVELS.map((level) => ({
                value: level,
                label: t(`reasoning.level.${level}`),
              }))}
              onChange={(value) => update("reasoning", value as ChatReasoningLevel)}
              ariaLabel={t("automation.reasoning")}
            />
          </Field>
          <Field label={t("automation.skills")}>
            <Input
              placeholder="skill-a, skill-b"
              value={draft.skillIds}
              onChange={(event) => update("skillIds", event.currentTarget.value)}
            />
          </Field>
        </div>
      </Card.Content>
      <Card.Footer className="flex justify-end gap-2">
        <Button variant="tertiary" onPress={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button isPending={saving} onPress={onSave}>
          {t("common.save")}
        </Button>
      </Card.Footer>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium">{label}</span>
      {children}
    </label>
  );
}

function inputFromDraft(draft: Draft): CronJobInput {
  let schedule: CronSchedule;
  if (draft.kind === "once") schedule = { kind: "once", at: new Date(draft.onceAt).toISOString() };
  else if (draft.kind === "interval")
    schedule = { kind: "interval", everyMs: Number(draft.intervalMinutes) * 60_000 };
  else schedule = { kind: "cron", expression: draft.expression, timezone: draft.timezone };
  return {
    name: draft.name,
    description: draft.description,
    schedule,
    payload: {
      prompt: draft.prompt,
      ...(draft.modelRef ? { modelRef: draft.modelRef } : {}),
      ...(draft.agentId ? { agentId: draft.agentId } : {}),
      reasoning: draft.reasoning,
      ...(parseCommaSeparated(draft.skillIds).length
        ? { skillIds: parseCommaSeparated(draft.skillIds) }
        : {}),
    },
  };
}

function draftFromJob(job: CronJob): Draft {
  const draft = emptyDraft();
  draft.name = job.name;
  draft.description = job.description;
  draft.kind = job.schedule.kind;
  draft.prompt = job.payload.prompt;
  draft.modelRef = job.payload.modelRef ?? "";
  draft.agentId = job.payload.agentId ?? "";
  draft.reasoning = job.payload.reasoning ?? "provider-default";
  draft.skillIds = (job.payload.skillIds ?? []).join(", ");
  if (job.schedule.kind === "once") draft.onceAt = toLocalDateTime(new Date(job.schedule.at));
  if (job.schedule.kind === "interval")
    draft.intervalMinutes = String(job.schedule.everyMs / 60_000);
  if (job.schedule.kind === "cron") {
    draft.expression = job.schedule.expression;
    draft.timezone = job.schedule.timezone;
  }
  return draft;
}

function describeDraft(draft: Draft, locale: string): string {
  try {
    return describeSchedule(
      inputFromDraft({ ...draft, name: draft.name || "Draft", prompt: draft.prompt || "Draft" })
        .schedule,
      locale,
    );
  } catch {
    return "";
  }
}
function describeSchedule(schedule: CronSchedule, locale: string): string {
  if (schedule.kind === "once")
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(schedule.at),
    );
  if (schedule.kind === "interval") return `${Math.round(schedule.everyMs / 60_000)} min`;
  return `${schedule.expression} / ${schedule.timezone}`;
}
function parseCommaSeparated(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
function formatDate(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
function toLocalDateTime(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
