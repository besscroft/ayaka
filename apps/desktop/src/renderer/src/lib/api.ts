import type {
  AgentInput,
  AgentMemoryFileSnapshot,
  AgentProfile,
  ErrorLogExportResult,
  Conversation,
  ConversationHydration,
  ArtifactInstallation,
  CatalogInstallInput,
  CatalogItemDetail,
  CatalogSearchInput,
  CatalogSearchResult,
  CatalogSnapshot,
  CronJob,
  CronJobInput,
  CronRun,
  CustomModelInput,
  CustomProviderInput,
  MemoryFileKind,
  SkillDraftRequest,
  SkillDraftResult,
  ToolSecretInput,
  ToolSecretPublic,
  ToolSkill,
  ToolSkillInput,
  SkillInspection,
  SkillEntry,
  SkillDependencyStatus,
  SkillRunInput,
  SkillRunRecord,
  SkillPackage,
  ToolsSnapshot,
  RuntimeEvent,
  InteractionProfile,
  LocalServerInfo,
  ManagedModelInfo,
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MessagePatch,
  MessagePatchResult,
  MessageRow,
  MessageSnapshot,
  SettingEntry,
  ToolDiscoveryResult,
  ToolServer,
  ToolServerInput,
  ToolRecord,
  McpCapabilitySnapshot,
  McpReadResourceResult,
  McpPromptResult,
  McpCompletionResult,
  McpAuthorizationResult,
  McpAuthStatus,
  McpInputRequest,
  ProviderModelSyncResult,
  ProviderInfo,
  ProviderTestResult,
  SyncState,
  AgentRunInput,
  AgentRunInputKind,
  AgentRunInputSource,
  RuntimeSnapshot,
  ManagedRuntimeSnapshot,
  McpManagerSnapshot,
  McpServerRuntimeState,
  McpDependencyInstallation,
  McpConfigFormat,
  McpConfigImportPreview,
  McpConfigImportResult,
  UpdateState,
  WorkspaceFileRef,
  WorkspaceFileContent,
  WorkspaceMediaSaveInput,
  WorkspaceMediaSaveResult,
  WorkspaceInfo,
  WorkspaceOrphan,
  TrayAction,
  TrayMenuLabels,
  SandboxArtifact,
  SandboxArtifactReadResult,
  SandboxArtifactUpdate,
  SandboxPreview,
  BrowserCaptureResult,
  BrowserPageSnapshot,
  BrowserSessionSnapshot,
  BrowserSessionUpdate,
} from "@shared/types";
import type { UIMessage } from "ai";

/**
 * 渲染层对 window.api 的类型化封装
 *
 * 通过此模块统一访问 IPC，便于：
 * - 类型推导
 * - 单点修改 IPC 调用方式
 * - 单元测试 mock
 */

function assertApi(): NonNullable<Window["api"]> {
  if (!window.api) {
    throw new Error("window.api is not available. Ensure preload has loaded correctly.");
  }
  return window.api;
}

/**
 * 软访问 window.api：未注入时返回 null 而不是抛错。
 * 供那些可能在 preload 加载前就执行的位置使用（例如 useEffect 清理 / 单测）。
 */
export function safeApi(): NonNullable<Window["api"]> | null {
  return window.api ?? null;
}

export const api = {
  windowControls: {
    minimize: (): Promise<void> => assertApi().windowControls.minimize(),
    toggleMaximize: (): Promise<boolean> => assertApi().windowControls.toggleMaximize(),
    isMaximized: (): Promise<boolean> => assertApi().windowControls.isMaximized(),
    close: (): Promise<void> => assertApi().windowControls.close(),
    onMaximizedChange: (handler: (maximized: boolean) => void): (() => void) =>
      assertApi().windowControls.onMaximizedChange(handler),
  },
  tray: {
    onAction: (handler: (action: TrayAction) => void): (() => void) =>
      assertApi().tray.onAction(handler),
    setLabels: (labels: TrayMenuLabels): Promise<boolean> => assertApi().tray.setLabels(labels),
  },
  conversations: {
    list: (): Promise<Conversation[]> => assertApi().conversations.list(),
    listDeleted: (): Promise<Conversation[]> => assertApi().conversations.listDeleted(),
    get: (id: string): Promise<Conversation | null> => assertApi().conversations.get(id),
    hydrate: (id: string): Promise<ConversationHydration | null> =>
      assertApi().conversations.hydrate(id),
    create: (id: string, title?: string): Promise<Conversation> =>
      assertApi().conversations.create(id, title),
    delete: (id: string): Promise<boolean> => assertApi().conversations.delete(id),
    restore: (id: string): Promise<boolean> => assertApi().conversations.restore(id),
    permanentDelete: (id: string): Promise<boolean> =>
      assertApi().conversations.permanentDelete(id),
    permanentDeleteBatch: (ids: string[]): Promise<number> =>
      assertApi().conversations.permanentDeleteBatch(ids),
    purgeExpired: (): Promise<number> => assertApi().conversations.purgeExpired(),
    touch: (id: string, title?: string): Promise<boolean> =>
      assertApi().conversations.touch(id, title),
  },
  messages: {
    list: (conversationId: string): Promise<MessageSnapshot> =>
      assertApi().messages.list(conversationId),
    save: (msg: MessageRow): Promise<boolean> => assertApi().messages.save(msg),
    saveBatch: (msgs: MessageRow[]): Promise<boolean> => assertApi().messages.saveBatch(msgs),
    applyPatch: (patch: MessagePatch): Promise<MessagePatchResult> =>
      assertApi().messages.applyPatch(patch),
  },
  workspace: {
    get: (conversationId: string): Promise<WorkspaceInfo | null> =>
      assertApi().workspace.get(conversationId),
    prepare: (conversationId: string, title?: string): Promise<WorkspaceInfo> =>
      assertApi().workspace.prepare(conversationId, title),
    open: (conversationId: string): Promise<boolean> => assertApi().workspace.open(conversationId),
    selectParent: (): Promise<boolean> => assertApi().workspace.selectParent(),
    openDefaultParent: (): Promise<boolean> => assertApi().workspace.openDefaultParent(),
    getParentState: (): Promise<{ configured: boolean; path: string }> =>
      assertApi().workspace.getParentState(),
    listOrphans: (): Promise<WorkspaceOrphan[]> => assertApi().workspace.listOrphans(),
    openOrphan: (id: string): Promise<boolean> => assertApi().workspace.openOrphan(id),
    removeOrphan: (id: string): Promise<boolean> => assertApi().workspace.removeOrphan(id),
    saveAttachments: (input: {
      conversationId: string;
      attachments: Array<{ filename?: string; mediaType?: string; dataUrl: string }>;
    }): Promise<WorkspaceFileRef[]> => assertApi().workspace.saveAttachments(input),
    read: (input: { conversationId: string; path: string }): Promise<WorkspaceFileContent> =>
      assertApi().workspace.read(input),
    saveMediaAs: (input: WorkspaceMediaSaveInput): Promise<WorkspaceMediaSaveResult> =>
      assertApi().workspace.saveMediaAs(input),
    revealFile: (input: { conversationId: string; path: string }): Promise<boolean> =>
      assertApi().workspace.revealFile(input),
    rollback: (conversationId: string): Promise<void> =>
      assertApi().workspace.rollback(conversationId),
  },
  sandboxArtifacts: {
    list: (conversationId: string): Promise<SandboxArtifact[]> =>
      assertApi().sandboxArtifacts.list(conversationId),
    read: (input: {
      conversationId: string;
      artifactId: string;
    }): Promise<SandboxArtifactReadResult> => assertApi().sandboxArtifacts.read(input),
    resourceUrl: (input: { conversationId: string; artifactId: string }): Promise<string> =>
      assertApi().sandboxArtifacts.resourceUrl(input),
    authorize: (input: { conversationId: string; artifactId: string }): Promise<SandboxArtifact> =>
      assertApi().sandboxArtifacts.authorize(input),
    revoke: (input: { conversationId: string; artifactId: string }): Promise<SandboxArtifact> =>
      assertApi().sandboxArtifacts.revoke(input),
    onUpdated: (handler: (artifact: SandboxArtifactUpdate) => void): (() => void) =>
      assertApi().sandboxArtifacts.onUpdated(handler),
  },
  sandboxPreviews: {
    list: (conversationId: string): Promise<SandboxPreview[]> =>
      assertApi().sandboxPreviews.list(conversationId),
    stop: (input: { conversationId: string; previewId: string }): Promise<SandboxPreview> =>
      assertApi().sandboxPreviews.stop(input),
    restart: (input: { conversationId: string; previewId: string }): Promise<SandboxPreview> =>
      assertApi().sandboxPreviews.restart(input),
    close: (input: { conversationId: string; previewId: string }): Promise<boolean> =>
      assertApi().sandboxPreviews.close(input),
    setBounds: (input: {
      conversationId: string;
      previewId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }): Promise<void> => assertApi().sandboxPreviews.setBounds(input),
    setVisible: (input: {
      conversationId: string;
      previewId: string;
      visible: boolean;
    }): Promise<void> => assertApi().sandboxPreviews.setVisible(input),
    onUpdated: (handler: (preview: SandboxPreview) => void): (() => void) =>
      assertApi().sandboxPreviews.onUpdated(handler),
  },
  browser: {
    getSession: (conversationId: string): Promise<BrowserSessionSnapshot> =>
      assertApi().browser.getSession(conversationId),
    createTab: (input: { conversationId: string; url?: string }): Promise<BrowserSessionSnapshot> =>
      assertApi().browser.createTab(input),
    selectTab: (input: {
      conversationId: string;
      tabId: string;
    }): Promise<BrowserSessionSnapshot> => assertApi().browser.selectTab(input),
    closeTab: (input: { conversationId: string; tabId: string }): Promise<BrowserSessionSnapshot> =>
      assertApi().browser.closeTab(input),
    navigate: (input: {
      conversationId: string;
      tabId?: string;
      url?: string;
      action?: "open" | "back" | "forward" | "reload";
    }): Promise<BrowserSessionSnapshot> => assertApi().browser.navigate(input),
    snapshot: (input: { conversationId: string; tabId?: string }): Promise<BrowserPageSnapshot> =>
      assertApi().browser.snapshot(input),
    click: (input: {
      conversationId: string;
      tabId?: string;
      ref: string;
    }): Promise<BrowserSessionSnapshot> => assertApi().browser.click(input),
    type: (input: {
      conversationId: string;
      tabId?: string;
      ref: string;
      text: string;
      submit?: boolean;
    }): Promise<BrowserSessionSnapshot> => assertApi().browser.type(input),
    pressKey: (input: {
      conversationId: string;
      tabId?: string;
      key: string;
      modifiers?: string[];
    }): Promise<BrowserSessionSnapshot> => assertApi().browser.pressKey(input),
    scroll: (input: {
      conversationId: string;
      tabId?: string;
      left?: number;
      top?: number;
    }): Promise<BrowserSessionSnapshot> => assertApi().browser.scroll(input),
    wait: (input: {
      conversationId: string;
      tabId?: string;
      milliseconds?: number;
      urlIncludes?: string;
      textIncludes?: string;
      timeoutMs?: number;
    }): Promise<BrowserPageSnapshot> => assertApi().browser.wait(input),
    capture: (input: { conversationId: string; tabId?: string }): Promise<BrowserCaptureResult> =>
      assertApi().browser.capture(input),
    readScreenshot: (input: { conversationId: string; path: string }): Promise<ArrayBuffer> =>
      assertApi().browser.readScreenshot(input),
    setBounds: (input: {
      conversationId: string;
      tabId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }): Promise<void> => assertApi().browser.setBounds(input),
    setVisible: (input: {
      conversationId: string;
      tabId: string;
      visible: boolean;
    }): Promise<void> => assertApi().browser.setVisible(input),
    onUpdated: (handler: (event: BrowserSessionUpdate) => void): (() => void) =>
      assertApi().browser.onUpdated(handler),
    onFocusRequested: (
      handler: (event: { conversationId: string; tabId: string }) => void,
    ): (() => void) => assertApi().browser.onFocusRequested(handler),
  },
  cron: {
    list: (): Promise<CronJob[]> => assertApi().cron.list(),
    get: (id: string): Promise<CronJob | null> => assertApi().cron.get(id),
    create: (input: CronJobInput): Promise<CronJob> => assertApi().cron.create(input),
    update: (id: string, patch: Partial<CronJobInput>): Promise<CronJob> =>
      assertApi().cron.update(id, patch),
    pause: (id: string): Promise<CronJob> => assertApi().cron.pause(id),
    resume: (id: string): Promise<CronJob> => assertApi().cron.resume(id),
    run: (id: string): Promise<CronRun> => assertApi().cron.run(id),
    delete: (id: string): Promise<boolean> => assertApi().cron.delete(id),
    runs: (id: string, limit?: number): Promise<CronRun[]> => assertApi().cron.runs(id, limit),
  },
  catalog: {
    snapshot: (): Promise<CatalogSnapshot> => assertApi().catalog.snapshot(),
    search: (input?: CatalogSearchInput): Promise<CatalogSearchResult> =>
      assertApi().catalog.search(input),
    detail: (itemId: string): Promise<CatalogItemDetail> => assertApi().catalog.detail(itemId),
    install: (input: CatalogInstallInput): Promise<ArtifactInstallation> =>
      assertApi().catalog.install(input),
    enable: (id: string, enabled: boolean): Promise<ArtifactInstallation> =>
      assertApi().catalog.enable(id, enabled),
    uninstall: (id: string): Promise<boolean> => assertApi().catalog.uninstall(id),
  },
  settings: {
    get: (key: string): Promise<string | null> => assertApi().settings.get(key),
    set: (key: string, value: string): Promise<boolean> => assertApi().settings.set(key, value),
    getAll: (keys: string[]): Promise<Record<string, string | null>> =>
      assertApi().settings.getAll(keys),
    setAll: (entries: SettingEntry[]): Promise<boolean> => assertApi().settings.setAll(entries),
  },
  logs: {
    export: (): Promise<ErrorLogExportResult> => assertApi().logs.export(),
  },
  apikeys: {
    list: (): Promise<string[]> => assertApi().apikeys.list(),
    set: (provider: string, apiKey: string): Promise<boolean> =>
      assertApi().apikeys.set(provider, apiKey),
    delete: (provider: string): Promise<boolean> => assertApi().apikeys.delete(provider),
  },
  runtime: {
    snapshot: (): Promise<RuntimeSnapshot> => assertApi().runtime.snapshot(),
    managedSnapshot: (): Promise<ManagedRuntimeSnapshot> => assertApi().runtime.managedSnapshot(),
    managedInstall: (kind: "node" | "uv") => assertApi().runtime.managedInstall(kind),
    managedUpgrade: (kind: "node" | "uv") => assertApi().runtime.managedUpgrade(kind),
    managedUninstall: (runtimeId: string) => assertApi().runtime.managedUninstall(runtimeId),
    managedSetSource: (kind: "node" | "uv", manifestUrl: string) =>
      assertApi().runtime.managedSetSource(kind, manifestUrl),
    onStateChanged: (handler: (snapshot: ManagedRuntimeSnapshot) => void): (() => void) =>
      assertApi().runtime.onStateChanged(handler),
    enqueueInput: (input: {
      runId: string;
      kind: AgentRunInputKind;
      source?: AgentRunInputSource;
      message: UIMessage;
    }): Promise<AgentRunInput> => assertApi().runtime.enqueueInput(input),
    cancelRun: (runId: string): Promise<boolean> => assertApi().runtime.cancelRun(runId),
    events: {
      list: (): Promise<RuntimeEvent[]> => assertApi().runtime.events.list(),
    },
  },
  agents: {
    list: (): Promise<AgentProfile[]> => assertApi().agents.list(),
    get: (id: string): Promise<AgentProfile | null> => assertApi().agents.get(id),
    create: (input: AgentInput): Promise<AgentProfile> => assertApi().agents.create(input),
    update: (id: string, input: Partial<AgentInput>): Promise<AgentProfile> =>
      assertApi().agents.update(id, input),
    archive: (id: string): Promise<AgentProfile> => assertApi().agents.archive(id),
    restore: (id: string): Promise<AgentProfile> => assertApi().agents.restore(id),
    duplicate: (id: string): Promise<AgentProfile> => assertApi().agents.duplicate(id),
    delete: (id: string): Promise<boolean> => assertApi().agents.delete(id),
    queueLearning: (conversationId: string): Promise<boolean> =>
      assertApi().agents.queueLearning(conversationId),
    runtimeSnapshot: (): Promise<
      Pick<
        RuntimeSnapshot,
        | "runtimeRuns"
        | "runtimeSteps"
        | "agentRuntimeStates"
        | "conversationAgentStates"
        | "sandboxSessions"
        | "sandboxSnapshots"
        | "sandboxArtifacts"
        | "runtimeEvents"
        | "agentInstances"
        | "agentRunInputs"
        | "collaborationMessages"
        | "contextCheckpoints"
      >
    > => assertApi().agents.runtimeSnapshot(),
    runningConversationIds: (): Promise<string[]> => assertApi().agents.runningConversationIds(),
    save: (agent: AgentProfile): Promise<boolean> => assertApi().agents.save(agent),
    memoryFiles: {
      list: (agentId?: string): Promise<Record<MemoryFileKind, AgentMemoryFileSnapshot>> =>
        assertApi().agents.memoryFiles.list(agentId),
      save: (
        kind: MemoryFileKind,
        content: string,
        agentId?: string,
      ): Promise<AgentMemoryFileSnapshot> =>
        assertApi().agents.memoryFiles.save(kind, content, agentId),
      reload: (kind: MemoryFileKind, agentId?: string): Promise<AgentMemoryFileSnapshot> =>
        assertApi().agents.memoryFiles.reload(kind, agentId),
    },
  },
  memories: {
    list: (): Promise<MemoryRecord[]> => assertApi().memories.list(),
    search: (filters: {
      query?: string;
      scope?: MemoryScope | null;
      kind?: MemoryKind | null;
      agentId?: string | null;
      conversationId?: string | null;
      pinned?: boolean | null;
      sortBy?: "salience" | "updated" | "created";
      sortOrder?: "asc" | "desc";
      limit?: number;
    }): Promise<MemoryRecord[]> => assertApi().memories.search(filters),
    get: (id: string): Promise<MemoryRecord | null> => assertApi().memories.get(id),
    save: (memory: MemoryRecord): Promise<boolean> => assertApi().memories.save(memory),
    delete: (id: string): Promise<boolean> => assertApi().memories.delete(id),
    deleteBatch: (ids: string[]): Promise<number> => assertApi().memories.deleteBatch(ids),
    updateBatch: (
      ids: string[],
      patch: Partial<Pick<MemoryRecord, "pinned" | "salience" | "kind" | "scope">>,
    ): Promise<number> => assertApi().memories.updateBatch(ids, patch),
  },
  interactions: {
    list: (): Promise<InteractionProfile[]> => assertApi().interactions.list(),
  },
  sync: {
    get: (): Promise<SyncState> => assertApi().sync.get(),
  },
  tools: {
    snapshot: (): Promise<ToolsSnapshot> => assertApi().tools.snapshot(),
    updateTool: (
      id: string,
      patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
    ): Promise<ToolRecord> => assertApi().tools.updateTool(id, patch),
    skills: {
      create: (input: ToolSkillInput): Promise<ToolSkill> => assertApi().tools.skills.create(input),
      importArchive: (bytes: Uint8Array): Promise<ToolSkill> =>
        assertApi().tools.skills.importArchive(bytes),
      generateDraft: (input: SkillDraftRequest): Promise<SkillDraftResult> =>
        assertApi().tools.skills.generateDraft(input),
      update: (id: string, input: Partial<ToolSkillInput>): Promise<ToolSkill> =>
        assertApi().tools.skills.update(id, input),
      delete: (id: string): Promise<boolean> => assertApi().tools.skills.delete(id),
      listDeleted: (): Promise<ToolSkill[]> => assertApi().tools.skills.listDeleted(),
      restore: (id: string): Promise<ToolSkill> => assertApi().tools.skills.restore(id),
      permanentDelete: (id: string): Promise<boolean> =>
        assertApi().tools.skills.permanentDelete(id),
      permanentDeleteBatch: (ids: string[]): Promise<number> =>
        assertApi().tools.skills.permanentDeleteBatch(ids),
      purgeExpired: (): Promise<number> => assertApi().tools.skills.purgeExpired(),
      setEnabled: (id: string, enabled: boolean): Promise<ToolSkill> =>
        assertApi().tools.skills.setEnabled(id, enabled),
      run: (inputOrSkillId: SkillRunInput | string, input?: unknown): Promise<unknown> =>
        typeof inputOrSkillId === "string"
          ? assertApi().tools.skills.run(inputOrSkillId, input)
          : assertApi().tools.skills.run(inputOrSkillId),
      inspect: (skillId: string): Promise<SkillInspection> =>
        assertApi().tools.skills.inspect(skillId),
      entries: (skillId: string): Promise<SkillEntry[]> =>
        assertApi().tools.skills.entries(skillId),
      runs: (skillId: string, limit?: number): Promise<SkillRunRecord[]> =>
        assertApi().tools.skills.runs(skillId, limit),
      dependencies: (skillId: string): Promise<SkillDependencyStatus[]> =>
        assertApi().tools.skills.dependencies(skillId),
      confirmDependencies: (
        skillId: string,
        options?: { confirmed?: boolean; allowScripts?: boolean },
      ): Promise<SkillPackage | null> =>
        assertApi().tools.skills.confirmDependencies(skillId, options),
      cancel: (runId: string): Promise<boolean> => assertApi().tools.skills.cancel(runId),
      onRunUpdated: (handler: (run: SkillRunRecord) => void): (() => void) =>
        assertApi().tools.skills.onRunUpdated(handler),
      onChanged: (handler: (event: { skillId?: string; reason: string }) => void): (() => void) =>
        assertApi().tools.skills.onChanged(handler),
      setSecret: (input: ToolSecretInput): Promise<ToolSecretPublic> =>
        assertApi().tools.skills.setSecret(input),
      deleteSecret: (id: string): Promise<boolean> => assertApi().tools.skills.deleteSecret(id),
    },
  },
  mcp: {
    snapshot: (): Promise<McpManagerSnapshot> => assertApi().mcp.snapshot(),
    start: (id: string): Promise<McpServerRuntimeState> => assertApi().mcp.start(id),
    stop: (id: string): Promise<McpServerRuntimeState> => assertApi().mcp.stop(id),
    restart: (id: string): Promise<McpServerRuntimeState> => assertApi().mcp.restart(id),
    probe: (id: string): Promise<McpServerRuntimeState> => assertApi().mcp.probe(id),
    install: (
      id: string,
      options?: { allowScripts?: boolean },
    ): Promise<McpDependencyInstallation> => assertApi().mcp.install(id, options),
    uninstall: (id: string): Promise<boolean> => assertApi().mcp.uninstall(id),
    config: {
      previewImport: (input: {
        format: McpConfigFormat;
        text: string;
      }): Promise<McpConfigImportPreview> => assertApi().mcp.config.previewImport(input),
      importFile: (format: McpConfigFormat): Promise<McpConfigImportPreview | null> =>
        assertApi().mcp.config.importFile(format),
      applyImport: (
        token: string,
        options?: { confirmConflicts?: boolean },
      ): Promise<McpConfigImportResult> => assertApi().mcp.config.applyImport(token, options),
      export: (format: McpConfigFormat): Promise<string> => assertApi().mcp.config.export(format),
      exportFile: (format: McpConfigFormat): Promise<"saved" | "cancelled"> =>
        assertApi().mcp.config.exportFile(format),
    },
    create: (input: ToolServerInput): Promise<ToolServer> => assertApi().mcp.create(input),
    update: (id: string, input: Partial<ToolServerInput>): Promise<ToolServer> =>
      assertApi().mcp.update(id, input),
    delete: (id: string): Promise<boolean> => assertApi().mcp.delete(id),
    listDeleted: (): Promise<ToolServer[]> => assertApi().mcp.listDeleted(),
    restore: (id: string): Promise<ToolServer> => assertApi().mcp.restore(id),
    permanentDelete: (id: string): Promise<boolean> => assertApi().mcp.permanentDelete(id),
    permanentDeleteBatch: (ids: string[]): Promise<number> =>
      assertApi().mcp.permanentDeleteBatch(ids),
    purgeExpired: (): Promise<number> => assertApi().mcp.purgeExpired(),
    setEnabled: (id: string, enabled: boolean): Promise<ToolServer> =>
      assertApi().mcp.setEnabled(id, enabled),
    test: (id: string): Promise<ToolDiscoveryResult> => assertApi().mcp.test(id),
    discover: (id: string): Promise<ToolDiscoveryResult> => assertApi().mcp.discover(id),
    capabilities: (id: string): Promise<McpCapabilitySnapshot> => assertApi().mcp.capabilities(id),
    readResource: (input: { serverId: string; uri: string }): Promise<McpReadResourceResult> =>
      assertApi().mcp.readResource(input),
    getPrompt: (input: {
      serverId: string;
      name: string;
      arguments?: Record<string, string>;
    }): Promise<McpPromptResult> => assertApi().mcp.getPrompt(input),
    complete: (input: {
      serverId: string;
      ref: Record<string, unknown>;
      argument: { name: string; value: string };
    }): Promise<McpCompletionResult> => assertApi().mcp.complete(input),
    subscribe: (id: string): Promise<boolean> => assertApi().mcp.subscribe(id),
    authorize: (id: string): Promise<McpAuthorizationResult> => assertApi().mcp.authorize(id),
    authStatus: (id: string): Promise<McpAuthStatus> => assertApi().mcp.authStatus(id),
    logout: (id: string): Promise<boolean> => assertApi().mcp.logout(id),
    respondInput: (id: string, value: unknown): Promise<boolean> =>
      assertApi().mcp.respondInput(id, value),
    cancelInput: (id: string): Promise<boolean> => assertApi().mcp.cancelInput(id),
    onCapabilitiesChanged: (
      handler: (event: { serverId: string; capabilities: McpCapabilitySnapshot }) => void,
    ): (() => void) => assertApi().mcp.onCapabilitiesChanged(handler),
    onInputRequested: (handler: (request: McpInputRequest) => void): (() => void) =>
      assertApi().mcp.onInputRequested(handler),
    onAuthChanged: (
      handler: (event: { serverId: string; status: McpAuthStatus }) => void,
    ): (() => void) => assertApi().mcp.onAuthChanged(handler),
    onStateChanged: (handler: (state: McpServerRuntimeState) => void): (() => void) =>
      assertApi().mcp.onStateChanged(handler),
    onToolsChanged: (handler: (event: { serverId: string }) => void): (() => void) =>
      assertApi().mcp.onToolsChanged(handler),
    onDependencyStateChanged: (
      handler: (installation: McpDependencyInstallation) => void,
    ): (() => void) => assertApi().mcp.onDependencyStateChanged(handler),
    updateTool: (
      id: string,
      patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
    ): Promise<ToolRecord> => assertApi().mcp.updateTool(id, patch),
    setSecret: (input: ToolSecretInput): Promise<ToolSecretPublic> =>
      assertApi().mcp.setSecret(input),
    deleteSecret: (id: string): Promise<boolean> => assertApi().mcp.deleteSecret(id),
  },
  providers: {
    list: (): Promise<ProviderInfo[]> => assertApi().providers.list(),
    listManagedModels: (): Promise<ManagedModelInfo[]> => assertApi().providers.listManagedModels(),
    upsertCustomProvider: (input: CustomProviderInput): Promise<ProviderInfo> =>
      assertApi().providers.upsertCustomProvider(input),
    deleteCustomProvider: (providerId: string): Promise<boolean> =>
      assertApi().providers.deleteCustomProvider(providerId),
    setProviderApiKey: (providerId: string, apiKey: string): Promise<boolean> =>
      assertApi().providers.setProviderApiKey(providerId, apiKey),
    deleteProviderApiKey: (providerId: string): Promise<boolean> =>
      assertApi().providers.deleteProviderApiKey(providerId),
    testProvider: (providerId: string): Promise<ProviderTestResult> =>
      assertApi().providers.testProvider(providerId),
    syncAvailableModels: (providerId: string): Promise<ProviderModelSyncResult> =>
      assertApi().providers.syncAvailableModels(providerId),
    upsertCustomModel: (input: CustomModelInput): Promise<ProviderInfo> =>
      assertApi().providers.upsertCustomModel(input),
    updateModelEnabled: (
      providerId: string,
      modelId: string,
      enabled: boolean,
    ): Promise<ProviderInfo> =>
      assertApi().providers.updateModelEnabled(providerId, modelId, enabled),
    setModelApiKey: (providerId: string, modelId: string, apiKey: string): Promise<boolean> =>
      assertApi().providers.setModelApiKey(providerId, modelId, apiKey),
    deleteModelApiKey: (providerId: string, modelId: string): Promise<boolean> =>
      assertApi().providers.deleteModelApiKey(providerId, modelId),
    deleteCustomModel: (providerId: string, modelId: string): Promise<ProviderInfo> =>
      assertApi().providers.deleteCustomModel(providerId, modelId),
    onCatalogUpdated: (handler: (event: { providerId: string }) => void): (() => void) =>
      assertApi().providers.onCatalogUpdated(handler),
  },
  server: {
    port: (): Promise<number> => assertApi().server.port(),
    info: (): Promise<LocalServerInfo> => assertApi().server.info(),
  },
  system: {
    locale: (): Promise<string> => assertApi().system.locale(),
    version: (): Promise<string> => assertApi().system.version(),
    changelog: (): Promise<string> => assertApi().system.changelog(),
  },
  updates: {
    getState: (): Promise<UpdateState> => assertApi().updates.getState(),
    check: (): Promise<UpdateState> => assertApi().updates.check(),
    download: (): Promise<UpdateState> => assertApi().updates.download(),
    install: (): Promise<UpdateState> => assertApi().updates.install(),
    onStateChanged: (handler: (state: UpdateState) => void): (() => void) =>
      assertApi().updates.onStateChanged(handler),
  },
};

export type {
  AgentInput,
  AgentMemoryFileSnapshot,
  AgentProfile,
  ErrorLogExportResult,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  MemoryFileKind,
  ToolSecretInput,
  ToolSecretPublic,
  ToolSkill,
  ToolSkillInput,
  ToolsSnapshot,
  RuntimeEvent,
  InteractionProfile,
  LocalServerInfo,
  MemoryKind,
  MemoryRecord,
  MemoryScope,
  MessageRow,
  ToolDiscoveryResult,
  McpCapabilitySnapshot,
  McpReadResourceResult,
  McpPromptResult,
  McpCompletionResult,
  McpAuthorizationResult,
  McpAuthStatus,
  McpInputRequest,
  ToolServer,
  ToolServerInput,
  ToolRecord,
  ProviderModelSyncResult,
  ProviderInfo,
  ProviderTestResult,
  SyncState,
  RuntimeSnapshot,
  UpdateState,
};
