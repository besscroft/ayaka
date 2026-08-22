import { useEffect, useMemo, useRef, useState } from "react";
import type {
  McpAuthStatus,
  McpCapabilitySnapshot,
  McpInputRequest,
  McpPrompt,
  McpPromptResult,
  ToolRecord,
  ToolServer,
  McpServerRuntimeState,
  McpDependencyInstallation,
} from "@shared/types";
import { isMcpOAuthTransport } from "@shared/types";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { getMcpErrorMessage } from "../lib/mcp-errors";
import { notify } from "../lib/toast";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  LoadingIndicator,
  SelectField,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TextArea,
} from "./ui";
import { IconCheck, IconCopy, IconEdit, IconGlobe, IconRotateCcw } from "./icons";
import { cn } from "../lib/utils";
import { Field, ReadStat } from "./ToolsPanel";
import { ConfirmDialog } from "./ConfirmDialog";

type WorkspaceTab = "overview" | "tools" | "prompts";
export type McpDependencyAction = "install" | "confirm" | "review";

export function getMcpDependencyAction(
  runtimeState: McpServerRuntimeState["state"] | undefined,
  dependency: McpDependencyInstallation | null | undefined,
): McpDependencyAction | null {
  if (runtimeState === "needs_confirmation" || dependency?.status === "needs_confirmation") {
    return dependency?.packageSpecs.length ? "confirm" : "review";
  }
  if (
    runtimeState === "needs_install" ||
    dependency?.status === "not_installed" ||
    dependency?.status === "failed"
  ) {
    return "install";
  }
  return null;
}

export interface McpWorkspaceProps {
  servers: ToolServer[];
  toolsByServer: Map<string, ToolRecord[]>;
  busy: boolean;
  discoveringServerIds: ReadonlySet<string>;
  onRefresh: () => void;
  activeConversationId?: string | null;
  onEdit: (server: ToolServer) => void;
  onDelete: (server: ToolServer) => void;
  onToggle: (server: ToolServer, enabled: boolean) => void;
}

export function McpWorkspace({
  servers,
  toolsByServer,
  busy,
  discoveringServerIds,
  onRefresh,
  activeConversationId,
  onEdit,
  onDelete,
  onToggle,
}: McpWorkspaceProps): React.JSX.Element {
  const { t, locale } = useT();
  const [selectedId, setSelectedId] = useState<string | null>(servers[0]?.id ?? null);
  const [tab, setTab] = useState<WorkspaceTab>("overview");
  const [capabilities, setCapabilities] = useState<McpCapabilitySnapshot | null>(null);
  const [auth, setAuth] = useState<McpAuthStatus | null>(null);
  const [loadingCapabilities, setLoadingCapabilities] = useState(false);
  const [capabilityError, setCapabilityError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [runtimeStates, setRuntimeStates] = useState<Map<string, McpServerRuntimeState>>(
    () => new Map(),
  );
  const [dependencies, setDependencies] = useState<Map<string, McpDependencyInstallation>>(
    () => new Map(),
  );
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [confirmDependencyInstall, setConfirmDependencyInstall] = useState(false);
  const [pendingInput, setPendingInput] = useState<McpInputRequest | null>(null);
  const capabilityRequestId = useRef(0);

  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;
  const selectedTools = selected ? (toolsByServer.get(selected.id) ?? []) : [];
  const selectedIsDiscovering = selected ? discoveringServerIds.has(selected.id) : false;
  const displayedCapabilityError =
    capabilityError ?? (selected?.status === "error" ? selected.last_error : null);
  const displayedError = displayedCapabilityError
    ? getMcpErrorMessage(displayedCapabilityError, locale)
    : null;
  const selectedRuntime = selected ? runtimeStates.get(selected.id) : undefined;
  const selectedDependency = selected ? dependencies.get(selected.id) : undefined;
  const dependencyInstalling = selectedDependency?.status === "installing";
  const dependencyAction = getMcpDependencyAction(selectedRuntime?.state, selectedDependency);
  const runtimeLabel = (state: McpServerRuntimeState["state"] | undefined): string =>
    t(`tools.mcp.state.${state ?? "stopped"}`);

  const refreshRuntimeStates = (): void => {
    void api.mcp.snapshot().then((next) => {
      setRuntimeStates(new Map(next.servers.map((item) => [item.server.id, item.runtime])));
      setDependencies(
        new Map(
          next.servers.flatMap((item) =>
            item.dependency ? [[item.server.id, item.dependency] as const] : [],
          ),
        ),
      );
    });
  };

  useEffect(refreshRuntimeStates, []);

  useEffect(
    () =>
      api.mcp.onStateChanged((state) => {
        setRuntimeStates((current) => new Map(current).set(state.serverId, state));
      }),
    [],
  );

  useEffect(
    () =>
      api.mcp.onDependencyStateChanged((installation) => {
        setDependencies((current) => new Map(current).set(installation.serverId, installation));
      }),
    [],
  );

  const runLifecycle = async (action: () => Promise<unknown>): Promise<void> => {
    setLifecycleBusy(true);
    setWorkspaceError(null);
    try {
      await action();
      refreshRuntimeStates();
    } catch (error) {
      setWorkspaceError(getMcpErrorMessage(error, locale));
    } finally {
      setLifecycleBusy(false);
    }
  };

  useEffect(() => {
    if (selected?.id !== selectedId) {
      // The selected server can disappear after a refresh.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(selected?.id ?? null);
      capabilityRequestId.current += 1;
      setCapabilities(null);
      setAuth(null);
      setLoadingCapabilities(false);
      setCapabilityError(null);
      setWorkspaceError(null);
      setTab("overview");
    }
  }, [selected?.id, selectedId]);

  const loadCapabilities = async (): Promise<void> => {
    const server = selected;
    if (!server || server.enabled === 0) return;
    const requestId = ++capabilityRequestId.current;
    setLoadingCapabilities(true);
    try {
      const [next, nextAuth] = await Promise.all([
        api.mcp.capabilities(server.id),
        isMcpOAuthTransport(server.transport)
          ? api.mcp.authStatus(server.id)
          : Promise.resolve({ status: "not_required" as const, expiresAt: null }),
      ]);
      if (requestId !== capabilityRequestId.current || selectedId !== server.id) return;
      setCapabilities(next);
      setAuth(nextAuth);
      setCapabilityError(null);
      void api.mcp.subscribe(server.id).catch(() => undefined);
      onRefresh();
    } catch (error) {
      if (requestId === capabilityRequestId.current && selectedId === server.id) {
        setCapabilityError(getMcpErrorMessage(error, locale));
        onRefresh();
      }
    } finally {
      if (requestId === capabilityRequestId.current && selectedId === server.id) {
        setLoadingCapabilities(false);
      }
    }
  };

  useEffect(() => {
    const offCapabilities = api.mcp.onCapabilitiesChanged((event) => {
      if (event.serverId === selected?.id) setCapabilities(event.capabilities);
    });
    const offAuth = api.mcp.onAuthChanged((event) => {
      if (event.serverId === selected?.id) setAuth(event.status);
    });
    const offInput = api.mcp.onInputRequested((request) => {
      if (request.serverId === selected?.id && request.conversationId === null) {
        setPendingInput(request);
      }
    });
    return () => {
      offCapabilities();
      offAuth();
      offInput();
    };
  }, [selected?.id]);

  const selectServer = (server: ToolServer): void => {
    if (server.id === selected?.id) return;
    capabilityRequestId.current += 1;
    setSelectedId(server.id);
    setCapabilities(null);
    setAuth(null);
    setLoadingCapabilities(false);
    setCapabilityError(null);
    setWorkspaceError(null);
    setTab("overview");
  };

  if (servers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-4 py-16">
        {t("tools.mcp.empty")}
      </div>
    );
  }

  return (
    <>
      <div
        data-slot="mcp-workspace"
        className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[250px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
      >
        <Card data-slot="mcp-server-list" className="h-full min-h-0 overflow-hidden">
          <Card.Header className="border-b border-border p-3">
            <Card.Title className="text-sm">{t("tools.metric.mcp")}</Card.Title>
          </Card.Header>
          <Card.Content className="min-h-0 overflow-y-auto p-2">
            <div className="flex flex-col gap-1">
              {servers.map((server) => {
                const active = server.id === selected?.id;
                const tools = toolsByServer.get(server.id) ?? [];
                const discovering = discoveringServerIds.has(server.id);
                const installing = dependencies.get(server.id)?.status === "installing";
                return (
                  <button
                    key={server.id}
                    type="button"
                    data-slot="mcp-server-item"
                    data-active={active ? "true" : "false"}
                    className={cn(
                      "flex items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "border-transparent hover:bg-muted/60",
                    )}
                    onClick={() => selectServer(server)}
                  >
                    {installing ? (
                      <IconRotateCcw className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                    ) : (
                      <IconGlobe className="mt-0.5 size-4 shrink-0 text-foreground/45" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{server.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {installing
                          ? t("tools.mcp.dependency.installing")
                          : server.enabled
                            ? discovering
                              ? t("tools.mcp.workspace.connecting")
                              : `${runtimeLabel(runtimeStates.get(server.id)?.state)} · ${tools.length} ${t("tools.field.tools")}`
                            : t("catalog.disabled")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </Card.Content>
        </Card>

        <Card data-slot="mcp-server-detail" className="min-h-0 overflow-hidden">
          {selected ? (
            <>
              <Card.Header className="border-b border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Card.Title className="truncate">{selected.name}</Card.Title>
                    <Card.Description className="truncate">
                      {selected.description ||
                        selected.url ||
                        selected.command ||
                        t("tools.mcp.noDescription")}
                    </Card.Description>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-muted px-2 py-1 text-xs">
                      {runtimeLabel(selectedRuntime?.state)}
                    </span>
                    {dependencyInstalling ? (
                      <span className="flex items-center gap-1 text-xs text-primary" role="status">
                        <IconRotateCcw className="size-3 animate-spin" />
                        {t("tools.mcp.dependency.installing")}
                      </span>
                    ) : selectedDependency?.status === "installed" ? (
                      <span className="text-xs text-muted-foreground">
                        {t("tools.mcp.dependency.installed")}
                      </span>
                    ) : null}
                    {selectedIsDiscovering ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <IconRotateCcw className="size-3 animate-spin" />
                        {t("tools.mcp.workspace.connecting")}
                      </span>
                    ) : null}
                    <Switch
                      size="sm"
                      isSelected={selected.enabled !== 0}
                      isDisabled={busy || selectedIsDiscovering || dependencyInstalling}
                      onChange={(value) => onToggle(selected, value)}
                    >
                      {t("tools.enabled")}
                    </Switch>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => onEdit(selected)}
                      isDisabled={busy || selectedIsDiscovering || dependencyInstalling}
                    >
                      <IconEdit className="size-4" />
                      {t("tools.mcp.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void loadCapabilities()}
                      isDisabled={
                        loadingCapabilities || selectedIsDiscovering || selected.enabled === 0
                      }
                    >
                      <IconRotateCcw
                        className={cn("size-4", loadingCapabilities && "animate-spin")}
                      />
                      {t("main.refresh")}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onPress={() => onDelete(selected)}
                      isDisabled={busy || selectedIsDiscovering || dependencyInstalling}
                    >
                      {t("common.delete")}
                    </Button>
                    {selectedRuntime?.state === "running" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={lifecycleBusy || dependencyInstalling}
                        onPress={() => void runLifecycle(() => api.mcp.stop(selected.id))}
                      >
                        {t("tools.mcp.stop")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        isDisabled={lifecycleBusy || dependencyInstalling || selected.enabled === 0}
                        onPress={() => void runLifecycle(() => api.mcp.start(selected.id))}
                      >
                        {t("tools.mcp.start")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="tertiary"
                      isDisabled={lifecycleBusy || dependencyInstalling || selected.enabled === 0}
                      onPress={() => void runLifecycle(() => api.mcp.restart(selected.id))}
                    >
                      {t("tools.mcp.restart")}
                    </Button>
                    {dependencyAction === "install" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={lifecycleBusy || dependencyInstalling}
                        onPress={() => void runLifecycle(() => api.mcp.install(selected.id))}
                      >
                        <IconRotateCcw
                          className={cn("size-4", dependencyInstalling && "animate-spin")}
                        />
                        {selectedDependency?.status === "failed"
                          ? t("tools.mcp.dependency.retry")
                          : t("tools.mcp.installDependencies")}
                      </Button>
                    ) : null}
                    {dependencyAction === "confirm" && !dependencyInstalling ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={lifecycleBusy || dependencyInstalling}
                        onPress={() => setConfirmDependencyInstall(true)}
                      >
                        {t("tools.mcp.confirmDependencyInstall")}
                      </Button>
                    ) : null}
                    {dependencyAction === "review" && !dependencyInstalling ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={lifecycleBusy || dependencyInstalling}
                        onPress={() => onEdit(selected)}
                      >
                        {t("tools.mcp.reviewCommand")}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
                  <TabsList aria-label={t("catalog.mcp.tabsLabel")}>
                    <TabsTrigger value="overview">{t("tools.mcp.workspace.overview")}</TabsTrigger>
                    <TabsTrigger value="tools">{t("tools.mcp.tools")}</TabsTrigger>
                    <TabsTrigger value="prompts">{t("tools.mcp.workspace.prompts")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </Card.Header>
              <Card.Content className="min-h-0 flex-1 overflow-y-auto p-4">
                {loadingCapabilities && !capabilities ? (
                  <LoadingIndicator label={t("tools.mcp.workspace.connecting")} />
                ) : null}
                {displayedError ? (
                  <p
                    role="alert"
                    className="mb-3 rounded-md border border-destructive/40 p-3 text-sm"
                  >
                    {t("tools.mcp.workspace.loadFailed")}: {displayedError}
                  </p>
                ) : null}
                {workspaceError ? (
                  <p
                    role="alert"
                    className="mb-3 rounded-md border border-destructive/40 p-3 text-sm"
                  >
                    {t("tools.mcp.workspace.actionFailed")}: {workspaceError}
                  </p>
                ) : null}
                {tab === "overview" ? (
                  <OverviewWorkspace
                    capabilities={capabilities}
                    auth={auth}
                    oauthSupported={isMcpOAuthTransport(selected.transport)}
                    onAuthorize={async () => {
                      setWorkspaceError(null);
                      try {
                        const result = await api.mcp.authorize(selected.id);
                        notify.success(
                          result.status === "authorized"
                            ? t("tools.mcp.workspace.authorized")
                            : t("tools.mcp.workspace.authorizePending"),
                        );
                      } catch (error) {
                        setWorkspaceError(getMcpErrorMessage(error, locale));
                      }
                    }}
                    onLogout={async () => {
                      setWorkspaceError(null);
                      try {
                        await api.mcp.logout(selected.id);
                        setAuth({ status: "unknown", expiresAt: null });
                      } catch (error) {
                        setWorkspaceError(getMcpErrorMessage(error, locale));
                      }
                    }}
                  />
                ) : null}
                {tab === "tools" ? (
                  <ToolWorkspace tools={selectedTools} busy={busy} onRefresh={onRefresh} />
                ) : null}
                {tab === "prompts" ? (
                  <PromptWorkspace
                    capabilities={capabilities}
                    serverId={selected.id}
                    activeConversationId={activeConversationId}
                  />
                ) : null}
              </Card.Content>
            </>
          ) : null}
        </Card>
      </div>
      <McpInputDialog request={pendingInput} onClose={() => setPendingInput(null)} />
      <ConfirmDialog
        open={confirmDependencyInstall}
        title={t("tools.mcp.confirmDependencyTitle")}
        message={t("tools.mcp.confirmDependencyMessage")}
        confirmLabel={t("tools.mcp.confirmDependencyInstall")}
        onConfirm={() => {
          setConfirmDependencyInstall(false);
          if (selected) {
            void runLifecycle(() => api.mcp.install(selected.id, { allowScripts: true }));
          }
        }}
        onClose={() => setConfirmDependencyInstall(false)}
      />
    </>
  );
}

function OverviewWorkspace({
  capabilities,
  auth,
  oauthSupported,
  onAuthorize,
  onLogout,
}: {
  capabilities: McpCapabilitySnapshot | null;
  auth: McpAuthStatus | null;
  oauthSupported: boolean;
  onAuthorize: () => Promise<void>;
  onLogout: () => Promise<void>;
}): React.JSX.Element {
  const { t } = useT();
  if (!capabilities)
    return <p className="text-sm text-muted-foreground">{t("tools.mcp.workspace.notLoaded")}</p>;
  const authLabel =
    auth?.status === "authorized"
      ? t("tools.mcp.workspace.authorized")
      : auth?.status === "pending"
        ? t("tools.mcp.workspace.authorizePending")
        : t("tools.mcp.workspace.authorize");
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ReadStat
          label={t("tools.mcp.workspace.protocol")}
          value={`${capabilities.protocolEra} ${capabilities.protocolVersion ?? ""}`}
        />
        <ReadStat
          label={t("tools.mcp.workspace.identity")}
          value={
            capabilities.identity
              ? `${capabilities.identity.name} ${capabilities.identity.version}`
              : "-"
          }
        />
        <ReadStat
          label={t("tools.field.tools")}
          value={
            capabilities.capabilities.tools
              ? t("tools.mcp.workspace.yes")
              : t("tools.mcp.workspace.no")
          }
        />
        {oauthSupported ? (
          <ReadStat label={t("tools.mcp.workspace.authorize")} value={authLabel} />
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {Object.entries(capabilities.capabilities).flatMap(([key, value]) =>
          typeof value === "boolean" && value ? (
            <span key={key} className="rounded border border-border px-2 py-1">
              {key}
            </span>
          ) : (
            []
          ),
        )}
      </div>
      {capabilities.instructions ? (
        <div className="rounded-md border border-border p-3">
          <p className="mb-1 text-sm font-medium">{t("tools.mcp.workspace.instructions")}</p>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {capabilities.instructions}
          </p>
        </div>
      ) : null}
      {oauthSupported ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onPress={() => void onAuthorize()}
            isDisabled={auth?.status === "authorized" || auth?.status === "pending"}
          >
            {authLabel}
          </Button>
          {auth?.status === "authorized" ? (
            <Button size="sm" variant="tertiary" onPress={() => void onLogout()}>
              {t("tools.mcp.workspace.logout")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolWorkspace({
  tools,
  busy,
  onRefresh,
}: {
  tools: ToolRecord[];
  busy: boolean;
  onRefresh: () => void;
}): React.JSX.Element {
  const { t, locale } = useT();
  const [error, setError] = useState<string | null>(null);
  if (tools.length === 0)
    return <p className="text-sm text-muted-foreground">{t("tools.mcp.noTools")}</p>;
  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
          {t("tools.mcp.workspace.actionFailed")}: {error}
        </p>
      ) : null}
      {tools.map((item) => (
        <div key={item.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{item.title || item.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.description || t("tools.noDescription")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Switch
                size="sm"
                isSelected={item.enabled !== 0}
                isDisabled={busy}
                onChange={(enabled) => {
                  setError(null);
                  void updateTool(item.id, { enabled }, onRefresh, (reason) =>
                    setError(getMcpErrorMessage(reason, locale)),
                  );
                }}
              >
                {t("tools.enabled")}
              </Switch>
              <Switch
                size="sm"
                isSelected={item.auto_use !== 0}
                isDisabled={busy}
                onChange={(auto_use) => {
                  setError(null);
                  void updateTool(item.id, { auto_use }, onRefresh, (reason) =>
                    setError(getMcpErrorMessage(reason, locale)),
                  );
                }}
              >
                {t("tools.autoUse")}
              </Switch>
              <Switch
                size="sm"
                isSelected={item.requires_approval !== 0}
                isDisabled={busy}
                onChange={(requires_approval) => {
                  setError(null);
                  void updateTool(item.id, { requires_approval }, onRefresh, (reason) =>
                    setError(getMcpErrorMessage(reason, locale)),
                  );
                }}
              >
                {t("tools.approval")}
              </Switch>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

async function updateTool(
  id: string,
  patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean>>,
  onRefresh: () => void,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await api.mcp.updateTool(id, patch);
    onRefresh();
  } catch (error) {
    onError(error);
  }
}

function PromptWorkspace({
  capabilities,
  serverId,
  activeConversationId,
}: {
  capabilities: McpCapabilitySnapshot | null;
  serverId: string;
  activeConversationId?: string | null;
}): React.JSX.Element {
  const { t, locale } = useT();
  const prompts = capabilities?.prompts ?? [];
  const [promptName, setPromptName] = useState(prompts[0]?.name ?? "");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<McpPromptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = prompts.find((prompt) => prompt.name === promptName) ?? prompts[0] ?? null;
  useEffect(() => {
    if (selected && selected.name !== promptName) {
      // A refreshed prompt list may replace the selected prompt.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPromptName(selected.name);
    }
  }, [promptName, selected]);
  const getPrompt = async (): Promise<void> => {
    if (!selected) return;
    setError(null);
    try {
      setResult(await api.mcp.getPrompt({ serverId, name: selected.name, arguments: args }));
    } catch (error) {
      setError(getMcpErrorMessage(error, locale));
    }
  };
  const copy = async (): Promise<void> => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    notify.success(t("tools.mcp.workspace.copy"));
  };
  const insert = (): void => {
    if (!result || !activeConversationId) return;
    window.dispatchEvent(
      new CustomEvent("ayaka:mcp-insert-prompt", {
        detail: { conversationId: activeConversationId, text: promptResultText(result) },
      }),
    );
    notify.success(t("tools.mcp.workspace.inserted"));
  };
  return (
    <div className="flex flex-col gap-4">
      {!capabilities ? (
        <p className="text-sm text-muted-foreground">{t("tools.mcp.workspace.notLoaded")}</p>
      ) : prompts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("tools.mcp.workspace.noCapability")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
          {t("tools.mcp.workspace.actionFailed")}: {error}
        </p>
      ) : null}
      {selected ? (
        <>
          <SelectField
            value={selected.name}
            options={prompts.map((prompt) => ({
              value: prompt.name,
              label: prompt.title || prompt.name,
            }))}
            onChange={(value) => {
              setPromptName(value);
              setResult(null);
            }}
            ariaLabel={t("tools.mcp.workspace.prompts")}
          />
          <p className="text-sm text-muted-foreground">
            {selected.description || t("tools.noDescription")}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {(selected.arguments ?? []).map((argument) => (
              <Field key={argument.name} label={argument.title || argument.name}>
                <Input
                  value={args[argument.name] ?? ""}
                  placeholder={argument.description}
                  onChange={(event) =>
                    setArgs((current) => ({ ...current, [argument.name]: event.target.value }))
                  }
                />
                <Button
                  size="sm"
                  variant="tertiary"
                  onPress={() => {
                    setError(null);
                    void requestCompletion(
                      serverId,
                      selected,
                      argument.name,
                      args[argument.name] ?? "",
                      t,
                    ).catch((reason) => setError(getMcpErrorMessage(reason, locale)));
                  }}
                >
                  {t("tools.mcp.workspace.complete")}
                </Button>
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onPress={() => void getPrompt()}>
              {t("tools.mcp.workspace.getPrompt")}
            </Button>
            <Button variant="secondary" onPress={() => void copy()} isDisabled={!result}>
              <IconCopy className="size-4" />
              {t("tools.mcp.workspace.copy")}
            </Button>
            <Button
              variant="secondary"
              onPress={insert}
              isDisabled={!result || !activeConversationId}
            >
              {t("tools.mcp.workspace.insert")}
            </Button>
          </div>
          {result ? (
            <pre
              data-slot="code-surface"
              className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs"
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function promptResultText(result: McpPromptResult): string {
  return result.messages
    .map((message) => {
      const content = message.content;
      if (content.type === "text" && typeof content.text === "string") return content.text;
      return JSON.stringify(content);
    })
    .join("\n\n");
}

async function requestCompletion(
  serverId: string,
  prompt: McpPrompt,
  argumentName: string,
  value: string,
  t: ReturnType<typeof useT>["t"],
): Promise<void> {
  const result = await api.mcp.complete({
    serverId,
    ref: { type: "ref/prompt", name: prompt.name },
    argument: { name: argumentName, value },
  });
  if (result.values[0]) {
    await navigator.clipboard.writeText(result.values.join("\n"));
    notify.success(t("tools.mcp.workspace.completionCopied"));
  }
}

export function McpInputDialog({
  request,
  onClose,
}: {
  request: McpInputRequest | null;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useT();
  const [values, setValues] = useState<Record<string, string>>({});
  const properties = useMemo(() => {
    const value = request?.requestedSchema?.properties;
    return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
  }, [request]);
  useEffect(() => {
    // Each elicitation request starts with a clean form.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues({});
  }, [request?.id]);
  const submit = async (): Promise<void> => {
    if (!request) return;
    await api.mcp.respondInput(request.id, values);
    onClose();
  };
  const cancel = async (): Promise<void> => {
    if (request) await api.mcp.cancelInput(request.id);
    onClose();
  };
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) void cancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tools.mcp.workspace.inputTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 px-6 py-4">
          <p className="text-sm text-muted-foreground">{request?.message}</p>
          {request?.url ? <p className="break-all text-sm underline">{request.url}</p> : null}
          {properties.map((key) => (
            <Field key={key} label={key}>
              <TextArea
                rows={2}
                value={values[key] ?? ""}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            </Field>
          ))}
        </div>
        <DialogFooter>
          <Button variant="secondary" onPress={() => void cancel()}>
            {t("tools.mcp.workspace.cancel")}
          </Button>
          <Button variant="primary" onPress={() => void submit()}>
            <IconCheck className="size-4" />
            {t("tools.mcp.workspace.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
