import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

/**
 * 鏆撮湶缁欐覆鏌撹繘绋嬬殑 API
 *
 * 璁捐瑕佺偣锛?
 * - 浠呴€氳繃 contextBridge.exposeInMainWorld 鏆撮湶鐧藉悕鍗曟柟娉?
 * - 娓叉煋灞傞€氳繃 window.api.* 璋冪敤锛屾棤鐩存帴 ipcRenderer 璁块棶
 * - 鎵€鏈夋柟娉曡繑鍥?Promise锛坕pcRenderer.invoke 璇箟锛?
 * - API key 鏄庢枃涓嶅嚭涓昏繘绋嬶紙鏃?get 鏂规硶锛?
 */
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
  conversations: {
    list: () => ipcRenderer.invoke("conversations:list"),
    listDeleted: () => ipcRenderer.invoke("conversations:listDeleted"),
    get: (id: string) => ipcRenderer.invoke("conversations:get", id),
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
  },
  apikeys: {
    list: () => ipcRenderer.invoke("apikeys:list"),
    set: (provider: string, apiKey: string) => ipcRenderer.invoke("apikeys:set", provider, apiKey),
    delete: (provider: string) => ipcRenderer.invoke("apikeys:delete", provider),
  },
  runtime: {
    snapshot: () => ipcRenderer.invoke("runtime:snapshot"),
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
  desktopPet: {
    getSnapshot: () => ipcRenderer.invoke("desktopPet:getSnapshot"),
    listPets: () => ipcRenderer.invoke("desktopPet:listPets"),
    listStore: (query: unknown) => ipcRenderer.invoke("desktopPet:listStore", query),
    select: (selector: string) => ipcRenderer.invoke("desktopPet:select", selector),
    installStore: (id: string, replace = false) =>
      ipcRenderer.invoke("desktopPet:installStore", id, replace),
    beginLocalImport: (mode: "zip" | "folder") =>
      ipcRenderer.invoke("desktopPet:beginLocalImport", mode),
    commitLocalImport: (token: string, replace = false) =>
      ipcRenderer.invoke("desktopPet:commitLocalImport", token, replace),
    delete: (selector: string) => ipcRenderer.invoke("desktopPet:delete", selector),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke("desktopPet:setEnabled", enabled),
    updateWindow: (patch: unknown) => ipcRenderer.invoke("desktopPet:updateWindow", patch),
    show: () => ipcRenderer.invoke("desktopPet:show"),
    hide: () => ipcRenderer.invoke("desktopPet:hide"),
    resetPosition: () => ipcRenderer.invoke("desktopPet:resetPosition"),
    moveWindowBy: (delta: { dx: number; dy: number }) =>
      ipcRenderer.invoke("desktopPet:moveWindowBy", delta),
    showContextMenu: () => ipcRenderer.invoke("desktopPet:showContextMenu"),
    getLookDirection: () => ipcRenderer.invoke("desktopPet:getLookDirection"),
    setIgnoreMouseEvents: (ignore: boolean) =>
      ipcRenderer.invoke("desktopPet:setIgnoreMouseEvents", ignore),
    onSnapshotApplied: (handler: (snapshot: unknown) => void) => {
      const listener = (_event: IpcRendererEvent, snapshot: unknown): void => {
        handler(snapshot);
      };
      ipcRenderer.on("desktopPet:snapshotApplied", listener);
      return () => ipcRenderer.removeListener("desktopPet:snapshotApplied", listener);
    },
  },
  sync: {
    get: () => ipcRenderer.invoke("sync:get"),
  },
  tools: {
    snapshot: () => ipcRenderer.invoke("tools:snapshot"),
    updateTool: (id: string, patch: unknown) => ipcRenderer.invoke("tools:updateTool", id, patch),
    skills: {
      create: (input: unknown) => ipcRenderer.invoke("tools:skills:create", input),
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
      run: (skillId: string, input?: unknown) =>
        ipcRenderer.invoke("tools:skills:run", skillId, input),
      setSecret: (input: unknown) => ipcRenderer.invoke("tools:skills:setSecret", input),
      deleteSecret: (id: string) => ipcRenderer.invoke("tools:skills:deleteSecret", id),
    },
  },
  mcp: {
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
  },
  server: {
    port: () => ipcRenderer.invoke("server:port"),
    info: () => ipcRenderer.invoke("server:info"),
  },
  system: {
    locale: () => ipcRenderer.invoke("system:locale"),
    version: () => ipcRenderer.invoke("system:version"),
    onPetOpenSettings: (handler: () => void) => {
      const listener = (): void => handler();
      ipcRenderer.on("desktopPet:openSettings", listener);
      return () => ipcRenderer.removeListener("desktopPet:openSettings", listener);
    },
    onPetOpenAbout: (handler: () => void) => {
      const listener = (): void => handler();
      ipcRenderer.on("desktopPet:openAbout", listener);
      return () => ipcRenderer.removeListener("desktopPet:openAbout", listener);
    },
  },
  cache: {
    stats: () => ipcRenderer.invoke("cache:stats"),
    clear: () => ipcRenderer.invoke("cache:clear"),
  },
} as const;

// contextIsolation 鍚敤鏃堕€氳繃 contextBridge 鏆撮湶锛涘惁鍒欑洿鎺ユ寕鍒?window
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("api", api);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-expect-error 鐢?d.ts 澹版槑
  window.electron = electronAPI;
  // @ts-expect-error 鐢?d.ts 澹版槑
  window.api = api;
}
