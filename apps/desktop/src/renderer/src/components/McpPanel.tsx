import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Modal, Switch, TextArea } from "./ui";
import { api, type ToolsSnapshot } from "../lib/api";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { buildMcpInput, type McpFormState } from "../lib/tools-form";
import { cn } from "../lib/utils";
import type { McpTransportKind, ToolRecord, ToolServer } from "@shared/types";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconCheck,
  IconClose,
  IconEye,
  IconGlobe,
  IconPlus,
  IconRotateCcw,
  IconTrash,
} from "./icons";
import {
  EmptyTools,
  Field,
  MetricCard,
  ReadStat,
  ToolDetailModal,
  type DetailTarget,
  formatEndpoint,
  groupByServer,
} from "./ToolsPanel";

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

export function McpPanel(): React.JSX.Element {
  const { t, locale } = useT();
  const [snapshot, setSnapshot] = useState<ToolsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ToolServer | null>(null);
  const [detailTarget, setDetailTarget] = useState<Extract<DetailTarget, { type: "mcp" }> | null>(
    null,
  );

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

  const mcpServers = useMemo(
    () => (snapshot?.toolServers ?? []).filter((server) => server.kind === "mcp"),
    [snapshot],
  );
  const mcpToolsByServer = useMemo(
    () => groupByServer((snapshot?.toolRecords ?? []).filter((tool) => tool.kind === "mcp")),
    [snapshot],
  );

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

  const confirmDelete = (): void => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    void runAction(() => api.mcp.delete(target.id), t("tools.toast.deleted"));
  };

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">{t("main.title.mcp")}</h1>
        <div className="flex items-center gap-3">
          <MetricCard
            label={t("tools.metric.mcp")}
            value={mcpServers.length}
            orientation="horizontal"
          />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onPress={() => setMcpOpen(true)}>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !snapshot ? (
          <div className="rounded-md border border-dashed border-foreground/15 px-4 py-16 text-center text-sm text-foreground/45">
            {t("main.loading")}
          </div>
        ) : null}

        {snapshot ? (
          <McpSection
            servers={mcpServers}
            toolsByServer={mcpToolsByServer}
            busy={busy}
            onDelete={setDeleteTarget}
            onToggle={(server, enabled) =>
              runAction(() => api.mcp.setEnabled(server.id, enabled), t("tools.toast.saved"))
            }
            onDetail={(server, tools) => setDetailTarget({ type: "mcp", item: server, tools })}
          />
        ) : null}
      </div>

      <AddMcpModal
        open={mcpOpen}
        busy={busy}
        onClose={() => setMcpOpen(false)}
        onCreate={(input) =>
          runAction(async () => {
            const server = await api.mcp.create(input);
            const discovery = await api.mcp.discover(server.id);
            setMcpOpen(false);
            if (discovery.server.status === "error") throw new Error(discovery.message);
          }, t("tools.toast.discovered"))
        }
      />

      <ToolDetailModal detail={detailTarget} onClose={() => setDetailTarget(null)} />

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

function McpSection({
  servers,
  toolsByServer,
  busy,
  onDelete,
  onToggle,
  onDetail,
}: {
  servers: ToolServer[];
  toolsByServer: Map<string, ToolRecord[]>;
  busy: boolean;
  onDelete: (server: ToolServer) => void;
  onToggle: (server: ToolServer, enabled: boolean) => void;
  onDetail: (server: ToolServer, tools: ToolRecord[]) => void;
}): React.JSX.Element {
  const { t } = useT();
  if (servers.length === 0) {
    return <EmptyTools message={t("tools.mcp.empty")} />;
  }
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      {servers.map((server) => (
        <McpCard
          key={server.id}
          server={server}
          tools={toolsByServer.get(server.id) ?? []}
          busy={busy}
          onDelete={() => onDelete(server)}
          onToggle={(enabled) => onToggle(server, enabled)}
          onDetail={() => onDetail(server, toolsByServer.get(server.id) ?? [])}
        />
      ))}
    </section>
  );
}

function McpCard({
  server,
  tools,
  busy,
  onDelete,
  onToggle,
  onDetail,
}: {
  server: ToolServer;
  tools: ToolRecord[];
  busy: boolean;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
  onDetail: () => void;
}): React.JSX.Element {
  const { t, f } = useT();
  const enabledTools = tools.filter((tool) => tool.enabled !== 0).length;
  return (
    <Card>
      <Card.Header>
        <div className="flex w-full items-start justify-between gap-3">
          <div className="min-w-0">
            <Card.Title className="truncate">{server.name}</Card.Title>
            <Card.Description className="line-clamp-2">
              {server.description || formatEndpoint(server)}
            </Card.Description>
          </div>
          <IconGlobe className="size-5 shrink-0 text-foreground/40" />
        </div>
      </Card.Header>
      <Card.Content className="space-y-3 p-4">
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <ReadStat label={t("tools.field.transport")} value={server.transport} />
          <ReadStat label={t("tools.field.tools")} value={`${enabledTools} / ${tools.length}`} />
          <ReadStat
            label={t("tools.field.status")}
            value={server.enabled ? server.status : "disabled"}
          />
          <ReadStat label="Timeout" value={`${server.timeout_seconds}s`} />
          <ReadStat
            className="sm:col-span-2"
            label={t("tools.field.endpoint")}
            value={formatEndpoint(server)}
          />
          <ReadStat
            className="sm:col-span-2"
            label={t("tools.field.connected")}
            value={
              server.last_connected_at ? f.dateTime(server.last_connected_at) : t("tools.never")
            }
          />
        </div>
        {server.last_error ? (
          <p className="break-words rounded-md bg-danger/10 px-3 py-2 text-xs text-danger">
            {server.last_error}
          </p>
        ) : null}
      </Card.Content>
      <Card.Footer>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Switch size="sm" isSelected={server.enabled !== 0} isDisabled={busy} onChange={onToggle}>
            {t("tools.enabled")}
          </Switch>
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

function AddMcpModal({
  open,
  busy,
  onClose,
  onCreate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (input: ReturnType<typeof buildMcpInput>) => Promise<void>;
}): React.JSX.Element {
  const { t } = useT();
  const [form, setForm] = useState<McpFormState>(EMPTY_MCP_FORM);
  const [error, setError] = useState<string | null>(null);
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
      void onCreate(buildMcpInput(form)).catch((err) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal isOpen={open} onOpenChange={(isOpen) => (!isOpen ? close() : undefined)}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-h-[92vh] w-[min(880px,calc(100vw-24px))] overflow-hidden">
            <Modal.Header>
              <div className="flex w-full items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-semibold">{t("tools.mcp.add")}</h3>
                  <p className="line-clamp-2 text-sm text-foreground/50">
                    Manual MCP server connection.
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
            </Modal.Header>
            <Modal.Body className="min-h-0 overflow-y-auto">
              <div className="grid gap-4">
                {error ? (
                  <p className="break-words rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
                    {error}
                  </p>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="服务类型">
                    <select
                      className="h-10 min-w-0 select-none rounded-md border border-foreground/10 bg-background px-3 text-sm"
                      value={form.transport}
                      onChange={(event) =>
                        patch({ transport: event.target.value as McpTransportKind })
                      }
                    >
                      <option value="stdio">STDIO</option>
                      <option value="http">HTTP</option>
                      <option value="sse">SSE</option>
                    </select>
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
                  <Field label="命令">
                    <TextArea
                      rows={3}
                      value={form.commandLine}
                      placeholder="npx -y @modelcontextprotocol/server-filesystem"
                      className="font-mono text-sm"
                      onChange={(event) => patch({ commandLine: event.target.value })}
                    />
                  </Field>
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
                    label={form.transport === "stdio" ? "环境变量（可选）" : "Headers（可选）"}
                  >
                    <TextArea
                      rows={4}
                      value={form.transport === "stdio" ? form.env : form.headers}
                      placeholder={
                        form.transport === "stdio"
                          ? "API_KEY=your-api-key"
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
            </Modal.Body>
            <Modal.Footer>
              <div className="flex w-full flex-wrap justify-end gap-2">
                <Button variant="secondary" onPress={close}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" isPending={busy} onPress={save}>
                  <IconCheck className="size-4" />
                  {t("tools.mcp.add")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
