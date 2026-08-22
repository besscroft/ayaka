import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  LoadingIndicator,
  SelectField,
  Tabs,
  TabsList,
  TabsTrigger,
  TextArea,
} from "./ui";
import { api, type ToolsSnapshot } from "../lib/api";
import { useT } from "../lib/i18n";
import { getMcpErrorMessage } from "../lib/mcp-errors";
import { notify } from "../lib/toast";
import { buildMcpInput, formatMcpEnvironment, type McpFormState } from "../lib/tools-form";
import { cn } from "../lib/utils";
import type {
  ArtifactInstallation,
  CatalogItem,
  CatalogSnapshot,
  McpConfigFormat,
  McpConfigImportPreview,
  McpTransportKind,
  ToolServer,
} from "@shared/types";
import { McpPresetsPanel } from "./McpPresetsPanel";
import { McpWorkspace } from "./McpWorkspace";
import { ConfirmDialog } from "./ConfirmDialog";
import { IconCheck, IconClose, IconPlus, IconRotateCcw, IconSearch } from "./icons";
import { Field, MetricCard, ReadStat, groupByServer } from "./ToolsPanel";

// MCP 新建表单的默认状态
const EMPTY_MCP_FORM: McpFormState = {
  name: "",
  description: "",
  transport: "stdio",
  enabled: true,
  auto_use: false,
  requires_approval: true,
  commandLine: "",
  command: "",
  args: "[]",
  url: "",
  headers: "",
  env: "",
  cwd: "",
  timeoutSeconds: "60",
};

export function McpPanel({
  activeConversationId,
}: {
  activeConversationId?: string | null;
}): React.JSX.Element {
  const { t, locale } = useT();
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null);
  const [catalogSnapshot, setCatalogSnapshot] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [discoveringServerIds, setDiscoveringServerIds] = useState<Set<string>>(() => new Set());
  const [mcpOpen, setMcpOpen] = useState(false);
  const [tab, setTab] = useState<"installed" | "presets">("installed");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "enabled" | "disabled" | "error">("all");
  const [transport, setTransport] = useState<"all" | McpTransportKind>("all");
  const [editTarget, setEditTarget] = useState<ToolServer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ToolServer | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{
    installation: ArtifactInstallation;
    item: CatalogItem;
    savedSecretKeys: string[];
  } | null>(null);
  const [configFormat, setConfigFormat] = useState<McpConfigFormat>("claude-json");
  const [importPreview, setImportPreview] = useState<McpConfigImportPreview | null>(null);
  const [confirmImportConflicts, setConfirmImportConflicts] = useState(false);

  const refresh = (options: { clearError?: boolean } = {}): void => {
    if (options.clearError !== false) setPageError(null);
    setRefreshing(true);
    void Promise.all([api.tools.snapshot(), api.catalog.snapshot()])
      .then(([nextSnapshot, nextCatalogSnapshot]) => {
        setSnapshot(nextSnapshot);
        setCatalogSnapshot(nextCatalogSnapshot);
      })
      .catch((error) => setPageError(getMcpErrorMessage(error, locale)))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(refresh, []);

  useEffect(() => {
    let alive = true;
    const offToolsChanged = api.mcp.onToolsChanged(() => {
      void api.tools
        .snapshot()
        .then((nextSnapshot) => {
          if (alive) setSnapshot(nextSnapshot);
        })
        .catch((error) => {
          if (alive) setPageError(getMcpErrorMessage(error, locale));
        });
    });
    return () => {
      alive = false;
      offToolsChanged();
    };
  }, [locale]);

  const mcpServers = useMemo(
    () => (snapshot?.toolServers ?? []).filter((server) => server.kind === "mcp"),
    [snapshot],
  );
  const filteredServers = useMemo(
    () =>
      mcpServers.filter((server) => {
        const normalized = query.trim().toLowerCase();
        const matchesQuery =
          !normalized ||
          `${server.name} ${server.description} ${server.url ?? ""}`
            .toLowerCase()
            .includes(normalized);
        const effectiveStatus =
          server.status === "error" ? "error" : server.enabled ? "enabled" : "disabled";
        return (
          matchesQuery &&
          (status === "all" || effectiveStatus === status) &&
          (transport === "all" || server.transport === transport)
        );
      }),
    [mcpServers, query, status, transport],
  );
  const mcpToolsByServer = useMemo(
    () => groupByServer((snapshot?.toolRecords ?? []).filter((tool) => tool.kind === "mcp")),
    [snapshot],
  );

  const runAction = async (action: () => Promise<unknown>, success: string): Promise<boolean> => {
    setPageError(null);
    setBusy(true);
    try {
      await action();
      notify.success(success);
      return true;
    } catch (error) {
      setPageError(getMcpErrorMessage(error, locale));
      return false;
    } finally {
      refresh({ clearError: false });
      setBusy(false);
    }
  };

  const importConfig = async (): Promise<void> => {
    setPageError(null);
    try {
      const preview = await api.mcp.config.importFile(configFormat);
      if (!preview) return;
      setConfirmImportConflicts(false);
      setImportPreview(preview);
    } catch (error) {
      setPageError(getMcpErrorMessage(error, locale));
    }
  };

  const exportConfig = async (): Promise<void> => {
    await runAction(() => api.mcp.config.exportFile(configFormat), t("tools.mcp.config.exported"));
  };

  const applyImport = async (): Promise<void> => {
    if (!importPreview) return;
    const applied = await runAction(
      () =>
        api.mcp.config.applyImport(importPreview.token, {
          confirmConflicts: confirmImportConflicts,
        }),
      t("tools.mcp.config.imported"),
    );
    if (!applied) return;
    setImportPreview(null);
    refresh({ clearError: false });
  };

  const setServerDiscovering = (serverId: string, discovering: boolean): void => {
    setDiscoveringServerIds((current) => {
      const next = new Set(current);
      if (discovering) next.add(serverId);
      else next.delete(serverId);
      return next;
    });
  };

  const discoverInBackground = (serverId: string): void => {
    setServerDiscovering(serverId, true);
    void api.mcp
      .discover(serverId)
      .then((discovery) => {
        if (discovery.server.status === "error") {
          setPageError(getMcpErrorMessage(discovery.message, locale));
        }
      })
      .catch((error) => setPageError(getMcpErrorMessage(error, locale)))
      .finally(() => {
        setServerDiscovering(serverId, false);
        refresh({ clearError: false });
      });
  };

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    const installation = catalogSnapshot?.installations.find(
      (value) => value.toolServerId === target.id,
    );
    void runAction(
      () => (installation ? api.catalog.uninstall(installation.id) : api.mcp.delete(target.id)),
      t("tools.toast.deleted"),
    );
  };

  return (
    <div data-slot="mcp-panel" className="flex h-full w-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0 select-none">
          <h1 className="text-xl font-semibold tracking-tight select-none">
            {t("main.title.mcp")}
          </h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(value === "presets" ? "presets" : "installed")}
          >
            <TabsList aria-label={t("catalog.mcp.tabsLabel")}>
              <TabsTrigger value="installed">{t("catalog.mcp.installedTab")}</TabsTrigger>
              <TabsTrigger value="presets">{t("catalog.mcp.presetsTab")}</TabsTrigger>
            </TabsList>
          </Tabs>
          <MetricCard
            label={t("tools.metric.mcp")}
            value={mcpServers.length}
            orientation="horizontal"
          />
          <div className="flex items-center gap-2">
            <SelectField
              value={configFormat}
              options={[
                { value: "claude-json", label: t("tools.mcp.config.claude") },
                { value: "codex-toml", label: t("tools.mcp.config.codex") },
              ]}
              onChange={(value) => setConfigFormat(value as McpConfigFormat)}
              ariaLabel={t("tools.mcp.config.format")}
            />
            <Button variant="secondary" size="sm" onPress={() => void importConfig()}>
              {t("tools.mcp.config.import")}
            </Button>
            <Button variant="secondary" size="sm" onPress={() => void exportConfig()}>
              {t("tools.mcp.config.export")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onPress={() => {
                setEditTarget(null);
                setMcpOpen(true);
              }}
            >
              <IconPlus className="size-4" />
              {t("tools.mcp.add")}
            </Button>
            <Button variant="secondary" size="sm" onPress={refresh} isDisabled={refreshing}>
              <IconRotateCcw className={cn("size-4", refreshing && "animate-spin")} />
              {t("main.refresh")}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto select-none">
        {pageError ? (
          <p
            role="alert"
            className="mb-4 break-words rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {t("tools.mcp.error.page")}: {pageError}
          </p>
        ) : null}
        {tab === "presets" ? (
          <McpPresetsPanel
            onInstalled={(installation, item, savedSecretKeys) => {
              setTab("installed");
              setReviewTarget({ installation, item, savedSecretKeys });
              refresh();
            }}
          />
        ) : null}
        {tab === "installed" && loading && !snapshot ? (
          <div className="rounded-md border border-dashed border-border px-4 py-16">
            <LoadingIndicator label={t("main.loading")} />
          </div>
        ) : null}

        {tab === "installed" && snapshot ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_180px_180px]">
              <label className="relative min-w-0">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground/35" />
                <Input
                  className="pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  placeholder={t("tools.search.placeholder")}
                />
              </label>
              <SelectField
                value={status}
                options={[
                  { value: "all", label: t("tools.filter.allStatus") },
                  { value: "enabled", label: t("catalog.enabled") },
                  { value: "disabled", label: t("catalog.disabled") },
                  { value: "error", label: t("tools.filter.error") },
                ]}
                onChange={(value) => setStatus(value as typeof status)}
                ariaLabel={t("tools.filter.allStatus")}
              />
              <SelectField
                value={transport}
                options={[
                  { value: "all", label: t("catalog.mcp.allTransports") },
                  { value: "stdio", label: "STDIO" },
                  { value: "http", label: "HTTP" },
                  { value: "sse", label: "SSE" },
                ]}
                onChange={(value) => setTransport(value as typeof transport)}
                ariaLabel={t("catalog.mcp.allTransports")}
              />
            </div>
            <McpWorkspace
              servers={filteredServers}
              toolsByServer={mcpToolsByServer}
              busy={busy}
              discoveringServerIds={discoveringServerIds}
              activeConversationId={activeConversationId}
              onEdit={(server) => {
                setEditTarget(server);
                setMcpOpen(true);
              }}
              onRefresh={refresh}
              onDelete={setDeleteTarget}
              onToggle={(server, enabled) =>
                runAction(() => api.mcp.setEnabled(server.id, enabled), t("tools.toast.saved"))
              }
            />
          </div>
        ) : null}
      </div>

      <AddMcpModal
        open={mcpOpen}
        busy={busy}
        server={editTarget}
        onClose={() => {
          setMcpOpen(false);
          setEditTarget(null);
        }}
        onSave={async (input) => {
          await runAction(async () => {
            const server = editTarget
              ? await api.mcp.update(editTarget.id, input)
              : await api.mcp.create(input);
            setMcpOpen(false);
            setEditTarget(null);
            discoverInBackground(server.id);
          }, t("tools.toast.saved"));
        }}
      />

      <McpReviewModal
        target={reviewTarget}
        server={
          reviewTarget?.installation.toolServerId
            ? (snapshot?.toolServers.find(
                (server) => server.id === reviewTarget.installation.toolServerId,
              ) ?? null)
            : null
        }
        busy={busy}
        onClose={() => setReviewTarget(null)}
        onEnabled={() => {
          setReviewTarget(null);
          refresh();
        }}
      />

      <McpImportPreviewModal
        preview={importPreview}
        confirmConflicts={confirmImportConflicts}
        onConfirmConflicts={setConfirmImportConflicts}
        onApply={() => void applyImport()}
        onClose={() => setImportPreview(null)}
        busy={busy}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        danger
        title={t("tools.delete.title")}
        message={t("tools.delete.message", { name: deleteTarget?.name ?? "" })}
        confirmLabel={t("common.delete")}
        onConfirm={confirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function McpImportPreviewModal({
  preview,
  confirmConflicts,
  onConfirmConflicts,
  onApply,
  onClose,
  busy,
}: {
  preview: McpConfigImportPreview | null;
  confirmConflicts: boolean;
  onConfirmConflicts: (value: boolean) => void;
  onApply: () => void;
  onClose: () => void;
  busy: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const conflictCount = preview?.servers.filter((server) => server.conflictServerId).length ?? 0;
  return (
    <Dialog open={preview !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] w-[min(760px,calc(100vw-24px))] max-w-none">
        <DialogHeader>
          <DialogTitle>{t("tools.mcp.config.previewTitle")}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <p className="text-sm text-muted-foreground">
            {t("tools.mcp.config.previewSummary", {
              count: String(preview?.servers.length ?? 0),
              format: preview?.format ?? "",
            })}
          </p>
          {preview?.warnings.length ? (
            <ul className="mt-3 list-disc rounded-md border border-warning/30 bg-warning/10 px-6 py-3 text-xs text-warning">
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
          <div className="mt-3 flex flex-col gap-2">
            {preview?.servers.map((server) => (
              <div
                key={`${server.id}-${server.name}`}
                className="rounded-md border border-border p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{server.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {server.conflictServerId
                      ? t("tools.mcp.config.conflict")
                      : t("tools.mcp.config.new")}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {server.transport} · {server.command ?? server.url ?? ""}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("tools.mcp.config.keys", {
                    env: String(server.envKeys.length),
                    headers: String(server.headerKeys.length),
                  })}
                </p>
                {server.diffs.length > 0 ? (
                  <p className="mt-1 text-xs text-warning">
                    {t("tools.mcp.config.diff")}: {server.diffs.join(", ")}
                  </p>
                ) : null}
                {server.warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-xs text-warning">
                    {warning}
                  </p>
                ))}
              </div>
            ))}
          </div>
          {conflictCount > 0 ? (
            <label className="mt-4 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmConflicts}
                onChange={(event) => onConfirmConflicts(event.currentTarget.checked)}
              />
              <span>
                {t("tools.mcp.config.confirmConflicts", { count: String(conflictCount) })}
              </span>
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="tertiary" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            isPending={busy}
            isDisabled={conflictCount > 0 && !confirmConflicts}
            onPress={onApply}
          >
            {t("tools.mcp.config.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function McpReviewModal({
  target,
  server,
  busy,
  onClose,
  onEnabled,
}: {
  target: {
    installation: ArtifactInstallation;
    item: CatalogItem;
    savedSecretKeys: string[];
  } | null;
  server: ToolServer | null;
  busy: boolean;
  onClose: () => void;
  onEnabled: () => void;
}): React.JSX.Element {
  const { t, locale } = useT();
  const secretRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [savedKeys, setSavedKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mcp = target?.item.detail.mcp as unknown as
    | {
        config?: {
          transport?: string;
          command?: string | null;
          args?: string[];
          url?: string | null;
          headers?: Record<string, string>;
          env?: Record<string, string>;
        };
        tools?: Array<{ name: string; description: string }>;
        warnings?: string[];
      }
    | undefined;
  const secretKeys = target ? installationSecretKeys(target.installation) : [];

  useEffect(() => {
    secretRefs.current = {};
    setSavedKeys(target?.savedSecretKeys ?? []);
    setError(null);
    setPending(false);
  }, [target?.installation.id]);

  const enable = async (): Promise<void> => {
    if (!target || !server) return;
    const missing = secretKeys.filter(
      (key) => !savedKeys.includes(key) && !secretRefs.current[key]?.value.trim(),
    );
    if (missing.length > 0) {
      setError(t("catalog.mcp.missingSecrets", { keys: missing.join(", ") }));
      return;
    }
    try {
      setPending(true);
      setError(null);
      await Promise.all(
        secretKeys
          .map((key) => [key, secretRefs.current[key]?.value.trim() ?? ""] as const)
          .filter(([, value]) => value)
          .map(([key, value]) =>
            api.mcp.setSecret({ ownerType: "server", ownerId: server.id, key, label: key, value }),
          ),
      );
      setSavedKeys((current) => [
        ...new Set([
          ...current,
          ...secretKeys.filter((key) => secretRefs.current[key]?.value.trim()),
        ]),
      ]);
      await api.catalog.enable(target.installation.id, true);
      notify.success(t("catalog.mcp.enabledToast"));
      onEnabled();
    } catch (reason) {
      setError(getMcpErrorMessage(reason, locale));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] w-[min(760px,calc(100vw-24px))] max-w-none">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle>{t("catalog.mcp.reviewTitle")}</DialogTitle>
              <p className="mt-1 truncate text-sm text-muted-foreground">{target?.item.name}</p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              data-icon-tone="danger"
              onPress={onClose}
              aria-label={t("common.close")}
            >
              <IconClose className="size-4" />
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            {t("catalog.mcp.reviewWarning")}
          </div>
          {target ? (
            <div className="grid gap-2 sm:grid-cols-3">
              <ReadStat label={t("catalog.source")} value={target.item.sourceLabel} />
              <ReadStat
                label={t("catalog.transport")}
                value={server?.transport ?? mcp?.config?.transport ?? "-"}
              />
              <ReadStat label={t("catalog.mcp.tools")} value={String(mcp?.tools?.length ?? 0)} />
            </div>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="break-words rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}
          {mcp?.warnings && mcp.warnings.length > 0 ? (
            <div className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">{t("catalog.mcp.warnings")}</p>
              <ul className="mt-1 list-disc pl-4 [&>li+li]:mt-1">
                {mcp.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{t("catalog.safetyDetails")}</p>
            <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(
                {
                  transport: server?.transport,
                  command: server?.command,
                  args: server?.args_json,
                  url: server?.url,
                  headers: server?.headers_json,
                  env: server?.env_json,
                },
                null,
                2,
              )}
            </pre>
          </div>
          {secretKeys.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">{t("catalog.secrets")}</p>
              {secretKeys.map((key) => (
                <label key={key} className="grid gap-1.5 text-xs font-medium">
                  <span>
                    {key}
                    {savedKeys.includes(key) ? ` · ${t("catalog.mcp.secretSaved")}` : ""}
                  </span>
                  <Input
                    type="password"
                    placeholder="$secret:{key}"
                    ref={(node) => {
                      secretRefs.current[key] = node;
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button variant="tertiary" onPress={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            isPending={pending || busy}
            isDisabled={!server}
            onPress={() => void enable()}
          >
            <IconCheck className="size-4" />
            {t("catalog.reviewEnable")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function installationSecretKeys(installation: ArtifactInstallation): string[] {
  const value = installation.safety.secretKeys;
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];
}

function mcpFormFromServer(server: ToolServer): McpFormState {
  return {
    ...EMPTY_MCP_FORM,
    name: server.name,
    description: server.description,
    transport: server.transport,
    enabled: server.enabled !== 0,
    auto_use: server.auto_use !== 0,
    requires_approval: server.requires_approval !== 0,
    command: server.command ?? "",
    args: formatJsonArray(server.args_json),
    url: server.url ?? "",
    headers: formatJsonObject(server.headers_json),
    env: formatMcpEnvironment(server.env_json),
    cwd: server.cwd ?? "",
    timeoutSeconds: String(server.timeout_seconds),
  };
}

function formatJsonArray(raw: string): string {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? JSON.stringify(value, null, 2) : "[]";
  } catch {
    return "[]";
  }
}

function formatJsonObject(raw: string): string {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? JSON.stringify(value, null, 2)
      : "{}";
  } catch {
    return "{}";
  }
}

function AddMcpModal({
  open,
  busy,
  onClose,
  onSave,
  server,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (input: ReturnType<typeof buildMcpInput>) => Promise<void>;
  server: ToolServer | null;
}): React.JSX.Element {
  const { t } = useT();
  const [form, setForm] = useState<McpFormState>(EMPTY_MCP_FORM);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    // Reset the draft whenever the modal switches between new and edit mode.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(server ? mcpFormFromServer(server) : EMPTY_MCP_FORM);
    setError(null);
  }, [open, server?.id]);
  const patch = (value: Partial<McpFormState>): void =>
    setForm((current) => ({ ...current, ...value }));
  const close = (): void => {
    setError(null);
    setForm(EMPTY_MCP_FORM);
    onClose();
  };
  const save = (): void => {
    try {
      setError(null);
      void onSave(buildMcpInput(form)).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => (!isOpen ? close() : undefined)}>
      <DialogContent className="max-h-[92vh] w-[min(880px,calc(100vw-24px))] max-w-none overflow-hidden">
        <DialogHeader>
          <div className="flex w-full items-start justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold">
                {server ? t("tools.mcp.edit") : t("tools.mcp.add")}
              </DialogTitle>
              <p className="line-clamp-2 text-sm text-foreground/50">
                Manual MCP server connection.
              </p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              data-icon-tone="danger"
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
              <p
                role="alert"
                className="break-words rounded-md bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {error}
              </p>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="服务类型">
                <SelectField
                  value={form.transport}
                  options={[
                    { value: "stdio", label: "STDIO" },
                    { value: "http", label: "HTTP" },
                    { value: "sse", label: "SSE" },
                  ]}
                  onChange={(value) => patch({ transport: value as McpTransportKind })}
                  ariaLabel={t("tools.field.transport")}
                />
              </Field>
              <Field label="服务器名称">
                <Input
                  value={form.name}
                  placeholder="my-mcp-server"
                  onChange={(event) => patch({ name: event.target.value })}
                />
              </Field>
            </div>
            <Field label={t("tools.field.description")}>
              <TextArea
                rows={2}
                value={form.description}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </Field>
            {form.transport === "stdio" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t("tools.field.command")}>
                  <Input
                    value={form.command}
                    placeholder="npx"
                    className="font-mono text-sm"
                    onChange={(event) => patch({ command: event.target.value })}
                  />
                </Field>
                <Field label={t("tools.field.args")}>
                  <TextArea
                    rows={3}
                    value={form.args}
                    placeholder='["-y", "@modelcontextprotocol/server-filesystem", "C:\\data"]'
                    className="font-mono text-sm"
                    onChange={(event) => patch({ args: event.target.value })}
                  />
                </Field>
              </div>
            ) : (
              <Field label={t("tools.field.url")}>
                <Input
                  value={form.url}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => patch({ url: event.target.value })}
                />
              </Field>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={form.transport === "stdio" ? t("tools.field.env") : t("tools.field.headers")}
              >
                <TextArea
                  rows={4}
                  value={form.transport === "stdio" ? form.env : form.headers}
                  placeholder={
                    form.transport === "stdio"
                      ? "KEY=value\nTOKEN=secret"
                      : "Authorization=Bearer token"
                  }
                  className="font-mono text-sm"
                  onChange={(event) =>
                    form.transport === "stdio"
                      ? patch({ env: event.target.value })
                      : patch({ headers: event.target.value })
                  }
                />
              </Field>
              <div className="grid gap-3">
                <Field label={t("tools.field.cwd")}>
                  <Input
                    value={form.cwd}
                    onChange={(event) => patch({ cwd: event.target.value })}
                  />
                </Field>
                <Field label="超时时间（秒）">
                  <Input
                    type="number"
                    min={1}
                    max={600}
                    value={form.timeoutSeconds}
                    onChange={(event) => patch({ timeoutSeconds: event.target.value })}
                  />
                </Field>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <div className="flex w-full flex-wrap justify-end gap-2">
            <Button variant="secondary" onPress={close}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" isPending={busy} onPress={save}>
              <IconCheck className="size-4" />
              {server ? t("common.save") : t("tools.mcp.add")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
