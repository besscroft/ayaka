import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import type {
  ErrorLogError,
  ErrorLogExportResult,
  ErrorLogInput,
  TrayAction,
  TrayMenuLabels,
  SandboxArtifactUpdate,
  SandboxPreview,
  BrowserCaptureResult,
  BrowserSessionUpdate,
  SettingEntry,
} from "../shared/types";

/**
 * 暴露给渲染进程的 API
 *
 * 设计要点：
 * - 仅通过 contextBridge.exposeInMainWorld 暴露白名单方法
 * - 渲染层通过 window.api.* 调用，无直接 ipcRenderer 访问
 * - 所有方法返回 Promise（ipcRenderer.invoke 语义）
 * - API key 明文不出主进程（无 get 方法）
 */
function sendRendererError(input: Omit<ErrorLogInput, "source">): void {
  try {
    ipcRenderer.send("logs:record", { ...input, source: "renderer" });
  } catch {
    // Error reporting must never interfere with the renderer.
  }
}

function serializeRendererError(value: unknown): ErrorLogError | undefined {
  if (value == null) return undefined;
  if (value instanceof Error) {
    return {
      name: value.name || "Error",
      message: value.message,
      ...(value.stack ? { stack: value.stack } : {}),
    };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message =
      typeof record.message === "string" ? record.message : formatRendererErrorValue(value);
    const name = typeof record.name === "string" ? record.name : "Error";
    const stack = typeof record.stack === "string" ? record.stack : undefined;
    return { name, message, ...(stack ? { stack } : {}) };
  }
  return { name: "Error", message: formatRendererErrorValue(value) };
}

function formatRendererErrorValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? "[object]";
    } catch {
      return "[object]";
    }
  }
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return value.name || "[function]";
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "bigint") return value.toString();
  return "[unserializable]";
}

function installRendererErrorCapture(): void {
  const windowRef = globalThis as typeof globalThis & {
    addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  };
  windowRef.addEventListener?.("error", (rawEvent) => {
    const event = rawEvent as unknown as Record<string, unknown>;
    const message = typeof event.message === "string" ? event.message : "Uncaught renderer error";
    sendRendererError({
      level: "error",
      origin: "window-error",
      message,
      error: serializeRendererError(event.error),
      details: {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      },
    });
  });
  windowRef.addEventListener?.("unhandledrejection", (rawEvent) => {
    const event = rawEvent as unknown as Record<string, unknown>;
    const reason = event.reason;
    sendRendererError({
      level: "error",
      origin: "unhandledrejection",
      message: serializeRendererError(reason)?.message || "Unhandled renderer promise rejection",
      error: serializeRendererError(reason),
    });
  });
}

installRendererErrorCapture();

const api = {
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
    close: () => ipcRenderer.invoke("window:close"),
    onMaximizedChange: (handler: (maximized: boolean) => void) => {
      const listener = (_event: IpcRendererEvent, maximized: boolean): void => handler(maximized);
      ipcRenderer.on("window:maximized-changed", listener);
      return () => ipcRenderer.removeListener("window:maximized-changed", listener);
    },
  },
  tray: {
    onAction: (handler: (action: TrayAction) => void) => {
      const listener = (_event: IpcRendererEvent, action: TrayAction): void => handler(action);
      ipcRenderer.on("tray:action", listener);
      return () => ipcRenderer.removeListener("tray:action", listener);
    },
    setLabels: (labels: TrayMenuLabels) => ipcRenderer.invoke("tray:setLabels", labels),
  },
  conversations: {
    list: () => ipcRenderer.invoke("conversations:list"),
    listDeleted: () => ipcRenderer.invoke("conversations:listDeleted"),
    get: (id: string) => ipcRenderer.invoke("conversations:get", id),
    hydrate: (id: string) => ipcRenderer.invoke("conversations:hydrate", id),
    create: (id: string, title?: string) => ipcRenderer.invoke("conversations:create", id, title),
    delete: (id: string) => ipcRenderer.invoke("conversations:delete", id),
    restore: (id: string) => ipcRenderer.invoke("conversations:restore", id),
    permanentDelete: (id: string) => ipcRenderer.invoke("conversations:permanentDelete", id),
    permanentDeleteBatch: (ids: string[]) =>
      ipcRenderer.invoke("conversations:permanentDeleteBatch", ids),
    purgeExpired: () => ipcRenderer.invoke("conversations:purgeExpired"),
    touch: (id: string, title?: string) => ipcRenderer.invoke("conversations:touch", id, title),
  },
  messages: {
    list: (conversationId: string) => ipcRenderer.invoke("messages:list", conversationId),
    save: (msg: unknown) => ipcRenderer.invoke("messages:save", msg),
    saveBatch: (msgs: unknown[]) => ipcRenderer.invoke("messages:saveBatch", msgs),
    applyPatch: (patch: unknown) => ipcRenderer.invoke("messages:applyPatch", patch),
  },
  workspace: {
    get: (conversationId: string) => ipcRenderer.invoke("workspace:get", conversationId),
    prepare: (conversationId: string, title?: string) =>
      ipcRenderer.invoke("workspace:prepare", conversationId, title),
    open: (conversationId: string) => ipcRenderer.invoke("workspace:open", conversationId),
    selectParent: () => ipcRenderer.invoke("workspace:selectParent"),
    openDefaultParent: () => ipcRenderer.invoke("workspace:openDefaultParent"),
    getParentState: () => ipcRenderer.invoke("workspace:getParentState"),
    listOrphans: () => ipcRenderer.invoke("workspace:listOrphans"),
    openOrphan: (id: string) => ipcRenderer.invoke("workspace:openOrphan", id),
    removeOrphan: (id: string) => ipcRenderer.invoke("workspace:removeOrphan", id),
    saveAttachments: (input: unknown) => ipcRenderer.invoke("workspace:saveAttachments", input),
    read: (input: unknown) => ipcRenderer.invoke("workspace:read", input),
    saveMediaAs: (input: unknown) => ipcRenderer.invoke("workspace:saveMediaAs", input),
    revealFile: (input: unknown) => ipcRenderer.invoke("workspace:revealFile", input),
    rollback: (conversationId: string) => ipcRenderer.invoke("workspace:rollback", conversationId),
  },
  sandboxArtifacts: {
    list: (conversationId: string) => ipcRenderer.invoke("sandbox:artifacts:list", conversationId),
    read: (input: { conversationId: string; artifactId: string }) =>
      ipcRenderer.invoke("sandbox:artifacts:read", input),
    resourceUrl: (input: { conversationId: string; artifactId: string }) =>
      ipcRenderer.invoke("sandbox:artifacts:resourceUrl", input),
    authorize: (input: { conversationId: string; artifactId: string }) =>
      ipcRenderer.invoke("sandbox:artifacts:authorize", input),
    revoke: (input: { conversationId: string; artifactId: string }) =>
      ipcRenderer.invoke("sandbox:artifacts:revoke", input),
    onUpdated: (handler: (artifact: SandboxArtifactUpdate) => void) => {
      const listener = (_event: IpcRendererEvent, artifact: SandboxArtifactUpdate): void =>
        handler(artifact);
      ipcRenderer.on("sandbox:artifact-updated", listener);
      return () => ipcRenderer.removeListener("sandbox:artifact-updated", listener);
    },
  },
  sandboxPreviews: {
    list: (conversationId: string) => ipcRenderer.invoke("sandbox:previews:list", conversationId),
    stop: (input: { conversationId: string; previewId: string }) =>
      ipcRenderer.invoke("sandbox:previews:stop", input),
    restart: (input: { conversationId: string; previewId: string }) =>
      ipcRenderer.invoke("sandbox:previews:restart", input),
    close: (input: { conversationId: string; previewId: string }) =>
      ipcRenderer.invoke("sandbox:previews:close", input),
    setBounds: (input: {
      conversationId: string;
      previewId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }) => ipcRenderer.invoke("sandbox:previews:setBounds", input),
    setVisible: (input: { conversationId: string; previewId: string; visible: boolean }) =>
      ipcRenderer.invoke("sandbox:previews:setVisible", input),
    onUpdated: (handler: (preview: SandboxPreview) => void) => {
      const listener = (_event: IpcRendererEvent, preview: SandboxPreview): void =>
        handler(preview);
      ipcRenderer.on("sandbox:preview-updated", listener);
      return () => ipcRenderer.removeListener("sandbox:preview-updated", listener);
    },
  },
  browser: {
    getSession: (conversationId: string) => ipcRenderer.invoke("browser:session", conversationId),
    createTab: (input: { conversationId: string; url?: string }) =>
      ipcRenderer.invoke("browser:tabs:create", input),
    selectTab: (input: { conversationId: string; tabId: string }) =>
      ipcRenderer.invoke("browser:tabs:select", input),
    closeTab: (input: { conversationId: string; tabId: string }) =>
      ipcRenderer.invoke("browser:tabs:close", input),
    navigate: (input: {
      conversationId: string;
      tabId?: string;
      url?: string;
      action?: "open" | "back" | "forward" | "reload";
    }) => ipcRenderer.invoke("browser:navigate", input),
    snapshot: (input: { conversationId: string; tabId?: string }) =>
      ipcRenderer.invoke("browser:snapshot", input),
    click: (input: { conversationId: string; tabId?: string; ref: string }) =>
      ipcRenderer.invoke("browser:click", input),
    type: (input: {
      conversationId: string;
      tabId?: string;
      ref: string;
      text: string;
      submit?: boolean;
    }) => ipcRenderer.invoke("browser:type", input),
    pressKey: (input: {
      conversationId: string;
      tabId?: string;
      key: string;
      modifiers?: string[];
    }) => ipcRenderer.invoke("browser:pressKey", input),
    scroll: (input: { conversationId: string; tabId?: string; left?: number; top?: number }) =>
      ipcRenderer.invoke("browser:scroll", input),
    wait: (input: {
      conversationId: string;
      tabId?: string;
      milliseconds?: number;
      urlIncludes?: string;
      textIncludes?: string;
      timeoutMs?: number;
    }) => ipcRenderer.invoke("browser:wait", input),
    capture: (input: { conversationId: string; tabId?: string }): Promise<BrowserCaptureResult> =>
      ipcRenderer.invoke("browser:capture", input),
    readScreenshot: (input: { conversationId: string; path: string }): Promise<ArrayBuffer> =>
      ipcRenderer.invoke("browser:readScreenshot", input),
    setBounds: (input: {
      conversationId: string;
      tabId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }) => ipcRenderer.invoke("browser:setBounds", input),
    setVisible: (input: { conversationId: string; tabId: string; visible: boolean }) =>
      ipcRenderer.invoke("browser:setVisible", input),
    onUpdated: (handler: (event: BrowserSessionUpdate) => void) => {
      const listener = (_event: IpcRendererEvent, update: BrowserSessionUpdate): void =>
        handler(update);
      ipcRenderer.on("browser:updated", listener);
      return () => ipcRenderer.removeListener("browser:updated", listener);
    },
    onFocusRequested: (handler: (event: { conversationId: string; tabId: string }) => void) => {
      const listener = (
        _event: IpcRendererEvent,
        request: { conversationId: string; tabId: string },
      ): void => handler(request);
      ipcRenderer.on("browser:focus-requested", listener);
      return () => ipcRenderer.removeListener("browser:focus-requested", listener);
    },
  },
  cron: {
    list: () => ipcRenderer.invoke("cron:list"),
    get: (id: string) => ipcRenderer.invoke("cron:get", id),
    create: (input: unknown) => ipcRenderer.invoke("cron:create", input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke("cron:update", id, patch),
    pause: (id: string) => ipcRenderer.invoke("cron:pause", id),
    resume: (id: string) => ipcRenderer.invoke("cron:resume", id),
    run: (id: string) => ipcRenderer.invoke("cron:run", id),
    delete: (id: string) => ipcRenderer.invoke("cron:delete", id),
    runs: (id: string, limit?: number) => ipcRenderer.invoke("cron:runs", id, limit),
  },
  catalog: {
    snapshot: () => ipcRenderer.invoke("catalog:snapshot"),
    search: (input?: unknown) => ipcRenderer.invoke("catalog:search", input),
    detail: (itemId: string) => ipcRenderer.invoke("catalog:detail", itemId),
    install: (input: unknown) => ipcRenderer.invoke("catalog:install", input),
    enable: (id: string, enabled: boolean) => ipcRenderer.invoke("catalog:enable", id, enabled),
    uninstall: (id: string) => ipcRenderer.invoke("catalog:uninstall", id),
  },
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) => ipcRenderer.invoke("settings:set", key, value),
    getAll: (keys: string[]) => ipcRenderer.invoke("settings:getAll", keys),
    setAll: (entries: SettingEntry[]) => ipcRenderer.invoke("settings:setAll", entries),
  },
  logs: {
    export: (): Promise<ErrorLogExportResult> => ipcRenderer.invoke("logs:export"),
  },
  apikeys: {
    list: () => ipcRenderer.invoke("apikeys:list"),
    set: (provider: string, apiKey: string) => ipcRenderer.invoke("apikeys:set", provider, apiKey),
    delete: (provider: string) => ipcRenderer.invoke("apikeys:delete", provider),
  },
  runtime: {
    snapshot: () => ipcRenderer.invoke("runtime:snapshot"),
    managedSnapshot: () => ipcRenderer.invoke("runtime:managedSnapshot"),
    managedInstall: (kind: "node" | "uv") => ipcRenderer.invoke("runtime:managedInstall", kind),
    managedUpgrade: (kind: "node" | "uv") => ipcRenderer.invoke("runtime:managedUpgrade", kind),
    managedUninstall: (runtimeId: string) =>
      ipcRenderer.invoke("runtime:managedUninstall", runtimeId),
    managedSetSource: (kind: "node" | "uv", manifestUrl: string) =>
      ipcRenderer.invoke("runtime:managedSetSource", kind, manifestUrl),
    onStateChanged: (handler: (snapshot: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
      ipcRenderer.on("runtime:state-changed", listener);
      return () => ipcRenderer.removeListener("runtime:state-changed", listener);
    },
    enqueueInput: async (input: unknown) => {
      const result = (await ipcRenderer.invoke("runtime:enqueueInput", input)) as
        | { ok: true; value: unknown }
        | { ok: false; code: string; error: string };
      if (result.ok) return result.value;
      throw Object.assign(new Error(result.error), { code: result.code });
    },
    cancelRun: (runId: string) => ipcRenderer.invoke("runtime:cancelRun", runId),
    events: {
      list: () => ipcRenderer.invoke("runtime:events:list"),
    },
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    get: (id: string) => ipcRenderer.invoke("agents:get", id),
    create: (input: unknown) => ipcRenderer.invoke("agents:create", input),
    update: (id: string, input: unknown) => ipcRenderer.invoke("agents:update", id, input),
    archive: (id: string) => ipcRenderer.invoke("agents:archive", id),
    restore: (id: string) => ipcRenderer.invoke("agents:restore", id),
    duplicate: (id: string) => ipcRenderer.invoke("agents:duplicate", id),
    delete: (id: string) => ipcRenderer.invoke("agents:delete", id),
    queueLearning: (conversationId: string) =>
      ipcRenderer.invoke("agents:queueLearning", conversationId),
    runtimeSnapshot: () => ipcRenderer.invoke("agents:runtimeSnapshot"),
    runningConversationIds: () => ipcRenderer.invoke("agents:runningConversationIds"),
    save: (agent: unknown) => ipcRenderer.invoke("agents:save", agent),
    memoryFiles: {
      list: (agentId?: string) => ipcRenderer.invoke("agents:memoryFiles:list", agentId),
      save: (kind: string, content: string, agentId?: string) =>
        ipcRenderer.invoke("agents:memoryFiles:save", kind, content, agentId),
      reload: (kind: string, agentId?: string) =>
        ipcRenderer.invoke("agents:memoryFiles:reload", kind, agentId),
    },
  },
  memories: {
    list: () => ipcRenderer.invoke("memories:list"),
    search: (filters: unknown) => ipcRenderer.invoke("memories:search", filters),
    get: (id: string) => ipcRenderer.invoke("memories:get", id),
    save: (memory: unknown) => ipcRenderer.invoke("memories:save", memory),
    delete: (id: string) => ipcRenderer.invoke("memories:delete", id),
    deleteBatch: (ids: string[]) => ipcRenderer.invoke("memories:deleteBatch", ids),
    updateBatch: (ids: string[], patch: unknown) =>
      ipcRenderer.invoke("memories:updateBatch", ids, patch),
  },
  interactions: {
    list: () => ipcRenderer.invoke("interactions:list"),
  },
  sync: {
    get: () => ipcRenderer.invoke("sync:get"),
  },
  tools: {
    snapshot: () => ipcRenderer.invoke("tools:snapshot"),
    updateTool: (id: string, patch: unknown) => ipcRenderer.invoke("tools:updateTool", id, patch),
    skills: {
      create: (input: unknown) => ipcRenderer.invoke("tools:skills:create", input),
      importArchive: (bytes: Uint8Array) => ipcRenderer.invoke("tools:skills:importArchive", bytes),
      generateDraft: (input: unknown) => ipcRenderer.invoke("tools:skills:generateDraft", input),
      update: (id: string, input: unknown) => ipcRenderer.invoke("tools:skills:update", id, input),
      delete: (id: string) => ipcRenderer.invoke("tools:skills:delete", id),
      listDeleted: () => ipcRenderer.invoke("tools:skills:listDeleted"),
      restore: (id: string) => ipcRenderer.invoke("tools:skills:restore", id),
      permanentDelete: (id: string) => ipcRenderer.invoke("tools:skills:permanentDelete", id),
      permanentDeleteBatch: (ids: string[]) =>
        ipcRenderer.invoke("tools:skills:permanentDeleteBatch", ids),
      purgeExpired: () => ipcRenderer.invoke("tools:skills:purgeExpired"),
      setEnabled: (id: string, enabled: boolean) =>
        ipcRenderer.invoke("tools:skills:setEnabled", id, enabled),
      run: (skillIdOrInput: unknown, input?: unknown) =>
        ipcRenderer.invoke("tools:skills:run", skillIdOrInput, input),
      inspect: (skillId: string) => ipcRenderer.invoke("tools:skills:inspect", skillId),
      entries: (skillId: string) => ipcRenderer.invoke("tools:skills:entries", skillId),
      runs: (skillId: string, limit?: number) =>
        ipcRenderer.invoke("tools:skills:runs", skillId, limit),
      dependencies: (skillId: string) => ipcRenderer.invoke("tools:skills:dependencies", skillId),
      confirmDependencies: (
        skillId: string,
        options?: { confirmed?: boolean; allowScripts?: boolean },
      ) => ipcRenderer.invoke("tools:skills:confirmDependencies", skillId, options),
      cancel: (runId: string) => ipcRenderer.invoke("tools:skills:cancel", runId),
      onRunUpdated: (handler: (run: unknown) => void) => {
        const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
        ipcRenderer.on("skills:run-updated", listener);
        return () => ipcRenderer.removeListener("skills:run-updated", listener);
      },
      onChanged: (handler: (event: unknown) => void) => {
        const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
        ipcRenderer.on("skills:changed", listener);
        return () => ipcRenderer.removeListener("skills:changed", listener);
      },
      setSecret: (input: unknown) => ipcRenderer.invoke("tools:skills:setSecret", input),
      deleteSecret: (id: string) => ipcRenderer.invoke("tools:skills:deleteSecret", id),
    },
  },
  mcp: {
    snapshot: () => ipcRenderer.invoke("mcp:snapshot"),
    start: (id: string) => ipcRenderer.invoke("mcp:start", id),
    stop: (id: string) => ipcRenderer.invoke("mcp:stop", id),
    restart: (id: string) => ipcRenderer.invoke("mcp:restart", id),
    probe: (id: string) => ipcRenderer.invoke("mcp:probe", id),
    install: (id: string, options?: { allowScripts?: boolean }) =>
      ipcRenderer.invoke("mcp:install", id, options),
    uninstall: (id: string) => ipcRenderer.invoke("mcp:uninstall", id),
    config: {
      previewImport: (input: unknown) => ipcRenderer.invoke("mcp:config:previewImport", input),
      importFile: (format: "claude-json" | "codex-toml") =>
        ipcRenderer.invoke("mcp:config:importFile", format),
      applyImport: (token: string, options?: { confirmConflicts?: boolean }) =>
        ipcRenderer.invoke("mcp:config:applyImport", token, options),
      export: (format: "claude-json" | "codex-toml") =>
        ipcRenderer.invoke("mcp:config:export", format),
      exportFile: (format: "claude-json" | "codex-toml") =>
        ipcRenderer.invoke("mcp:config:exportFile", format),
    },
    create: (input: unknown) => ipcRenderer.invoke("mcp:create", input),
    update: (id: string, input: unknown) => ipcRenderer.invoke("mcp:update", id, input),
    delete: (id: string) => ipcRenderer.invoke("mcp:delete", id),
    listDeleted: () => ipcRenderer.invoke("mcp:listDeleted"),
    restore: (id: string) => ipcRenderer.invoke("mcp:restore", id),
    permanentDelete: (id: string) => ipcRenderer.invoke("mcp:permanentDelete", id),
    permanentDeleteBatch: (ids: string[]) => ipcRenderer.invoke("mcp:permanentDeleteBatch", ids),
    purgeExpired: () => ipcRenderer.invoke("mcp:purgeExpired"),
    setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke("mcp:setEnabled", id, enabled),
    test: (id: string) => ipcRenderer.invoke("mcp:test", id),
    discover: (id: string) => ipcRenderer.invoke("mcp:discover", id),
    capabilities: (id: string) => ipcRenderer.invoke("mcp:capabilities", id),
    readResource: (input: unknown) => ipcRenderer.invoke("mcp:readResource", input),
    getPrompt: (input: unknown) => ipcRenderer.invoke("mcp:getPrompt", input),
    complete: (input: unknown) => ipcRenderer.invoke("mcp:complete", input),
    subscribe: (id: string) => ipcRenderer.invoke("mcp:subscribe", id),
    authorize: (id: string) => ipcRenderer.invoke("mcp:authorize", id),
    authStatus: (id: string) => ipcRenderer.invoke("mcp:authStatus", id),
    logout: (id: string) => ipcRenderer.invoke("mcp:logout", id),
    respondInput: (id: string, value: unknown) => ipcRenderer.invoke("mcp:respondInput", id, value),
    cancelInput: (id: string) => ipcRenderer.invoke("mcp:cancelInput", id),
    onCapabilitiesChanged: (handler: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
      ipcRenderer.on("mcp:capabilities-changed", listener);
      return () => ipcRenderer.removeListener("mcp:capabilities-changed", listener);
    },
    onInputRequested: (handler: (request: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
      ipcRenderer.on("mcp:input-requested", listener);
      return () => ipcRenderer.removeListener("mcp:input-requested", listener);
    },
    onAuthChanged: (handler: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
      ipcRenderer.on("mcp:auth-changed", listener);
      return () => ipcRenderer.removeListener("mcp:auth-changed", listener);
    },
    onStateChanged: (handler: (state: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
      ipcRenderer.on("mcp:state-changed", listener);
      return () => ipcRenderer.removeListener("mcp:state-changed", listener);
    },
    onToolsChanged: (handler: (event: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
      ipcRenderer.on("mcp:tools-changed", listener);
      return () => ipcRenderer.removeListener("mcp:tools-changed", listener);
    },
    onDependencyStateChanged: (handler: (installation: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, value: unknown): void => handler(value);
      ipcRenderer.on("mcp:dependency-state-changed", listener);
      return () => ipcRenderer.removeListener("mcp:dependency-state-changed", listener);
    },
    updateTool: (id: string, patch: unknown) => ipcRenderer.invoke("mcp:updateTool", id, patch),
    setSecret: (input: unknown) => ipcRenderer.invoke("mcp:setSecret", input),
    deleteSecret: (id: string) => ipcRenderer.invoke("mcp:deleteSecret", id),
  },
  providers: {
    list: () => ipcRenderer.invoke("providers:list"),
    listManagedModels: () => ipcRenderer.invoke("providers:listManagedModels"),
    upsertCustomProvider: (input: unknown) =>
      ipcRenderer.invoke("providers:upsertCustomProvider", input),
    deleteCustomProvider: (providerId: string) =>
      ipcRenderer.invoke("providers:deleteCustomProvider", providerId),
    setProviderApiKey: (providerId: string, apiKey: string) =>
      ipcRenderer.invoke("providers:setProviderApiKey", providerId, apiKey),
    revealProviderApiKey: (providerId: string) =>
      ipcRenderer.invoke("providers:revealProviderApiKey", providerId),
    deleteProviderApiKey: (providerId: string) =>
      ipcRenderer.invoke("providers:deleteProviderApiKey", providerId),
    testProvider: (providerId: string) => ipcRenderer.invoke("providers:testProvider", providerId),
    syncAvailableModels: (providerId: string) =>
      ipcRenderer.invoke("providers:syncAvailableModels", providerId),
    upsertCustomModel: (input: unknown) => ipcRenderer.invoke("providers:upsertCustomModel", input),
    updateModelEnabled: (providerId: string, modelId: string, enabled: boolean) =>
      ipcRenderer.invoke("providers:updateModelEnabled", providerId, modelId, enabled),
    setModelApiKey: (providerId: string, modelId: string, apiKey: string) =>
      ipcRenderer.invoke("providers:setModelApiKey", providerId, modelId, apiKey),
    deleteModelApiKey: (providerId: string, modelId: string) =>
      ipcRenderer.invoke("providers:deleteModelApiKey", providerId, modelId),
    deleteCustomModel: (providerId: string, modelId: string) =>
      ipcRenderer.invoke("providers:deleteCustomModel", providerId, modelId),
    onCatalogUpdated: (handler: (event: { providerId: string }) => void) => {
      const listener = (_event: IpcRendererEvent, value: { providerId: string }): void =>
        handler(value);
      ipcRenderer.on("providers:catalog-updated", listener);
      return () => ipcRenderer.removeListener("providers:catalog-updated", listener);
    },
  },
  server: {
    port: () => ipcRenderer.invoke("server:port"),
    info: () => ipcRenderer.invoke("server:info"),
  },
  system: {
    locale: () => ipcRenderer.invoke("system:locale"),
    version: () => ipcRenderer.invoke("system:version"),
    changelog: () => ipcRenderer.invoke("system:changelog"),
  },
  updates: {
    getState: () => ipcRenderer.invoke("updates:getState"),
    check: () => ipcRenderer.invoke("updates:check"),
    download: () => ipcRenderer.invoke("updates:download"),
    install: () => ipcRenderer.invoke("updates:install"),
    onStateChanged: (handler: (state: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, state: unknown): void => handler(state);
      ipcRenderer.on("updates:state-changed", listener);
      return () => ipcRenderer.removeListener("updates:state-changed", listener);
    },
  },
  cache: {
    stats: () => ipcRenderer.invoke("cache:stats"),
    clear: () => ipcRenderer.invoke("cache:clear"),
  },
} as const;

// contextIsolation 启用时通过 contextBridge 暴露；否则直接挂载到 window
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error 使用 d.ts 声明
  window.electron = electronAPI;
  // @ts-expect-error 使用 d.ts 声明
  window.api = api;
}
