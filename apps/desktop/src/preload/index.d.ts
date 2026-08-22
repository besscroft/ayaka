import { ElectronAPI } from "@electron-toolkit/preload";
import type {
  AgentInput,
  AgentMemoryFileSnapshot,
  AgentProfile,
  ErrorLogExportResult,
  Conversation,
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
  RuntimeSnapshot,
  ManagedRuntimeSnapshot,
  McpManagerSnapshot,
  McpServerRuntimeState,
  McpDependencyInstallation,
  McpConfigFormat,
  McpConfigImportPreview,
  McpConfigImportResult,
  AgentRunInput,
  AgentRunInputKind,
  AgentRunInputSource,
  TrayAction,
  TrayMenuLabels,
  UpdateState,
  WorkspaceFileRef,
  WorkspaceFileContent,
  WorkspaceInfo,
  WorkspaceMediaSaveInput,
  WorkspaceMediaSaveResult,
  WorkspaceOrphan,
} from "../shared/types";
import type { UIMessage } from "ai";

/**
 * Ayaka 鏆撮湶缁欐覆鏌撹繘绋嬬殑 API
 *
 * 璁捐鍘熷垯锛?
 * - 浠呴€氳繃 contextBridge 鏆撮湶鐧藉悕鍗曟柟娉曪紝娓叉煋灞傛棤娉曠洿鎺ヨ闂?Node API
 * - API key 鏄庢枃涓嶅嚭涓昏繘绋嬶紱杩欓噷鍙彁渚?set/list锛屼笉鎻愪緵 get
 * - 鎵€鏈夋柟娉曡繑鍥?Promise锛坕pcRenderer.invoke 鐨勮涔夛級
 */
export interface AyakaApi {
  windowControls: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    isMaximized: () => Promise<boolean>;
    close: () => Promise<void>;
    onMaximizedChange: (handler: (maximized: boolean) => void) => () => void;
  };
  // 浼氳瘽鍘嗗彶
  tray: {
    onAction: (handler: (action: TrayAction) => void) => () => void;
    setLabels: (labels: TrayMenuLabels) => Promise<boolean>;
  };
  conversations: {
    list: () => Promise<Conversation[]>;
    listDeleted: () => Promise<Conversation[]>;
    get: (id: string) => Promise<Conversation | null>;
    create: (id: string, title?: string) => Promise<Conversation>;
    delete: (id: string) => Promise<boolean>;
    restore: (id: string) => Promise<boolean>;
    permanentDelete: (id: string) => Promise<boolean>;
    permanentDeleteBatch: (ids: string[]) => Promise<number>;
    purgeExpired: () => Promise<number>;
    touch: (id: string, title?: string) => Promise<boolean>;
  };
  // 娑堟伅
  messages: {
    list: (conversationId: string) => Promise<MessageSnapshot>;
    save: (msg: MessageRow) => Promise<boolean>;
    saveBatch: (msgs: MessageRow[]) => Promise<boolean>;
    applyPatch: (patch: MessagePatch) => Promise<MessagePatchResult>;
  };
  workspace: {
    get: (conversationId: string) => Promise<WorkspaceInfo | null>;
    prepare: (conversationId: string, title?: string) => Promise<WorkspaceInfo>;
    open: (conversationId: string) => Promise<boolean>;
    selectParent: () => Promise<boolean>;
    openDefaultParent: () => Promise<boolean>;
    getParentState: () => Promise<{ configured: boolean; path: string }>;
    listOrphans: () => Promise<WorkspaceOrphan[]>;
    openOrphan: (id: string) => Promise<boolean>;
    removeOrphan: (id: string) => Promise<boolean>;
    saveAttachments: (input: {
      conversationId: string;
      attachments: Array<{ filename?: string; mediaType?: string; dataUrl: string }>;
    }) => Promise<WorkspaceFileRef[]>;
    read: (input: { conversationId: string; path: string }) => Promise<WorkspaceFileContent>;
    saveMediaAs: (input: WorkspaceMediaSaveInput) => Promise<WorkspaceMediaSaveResult>;
    revealFile: (input: { conversationId: string; path: string }) => Promise<boolean>;
    rollback: (conversationId: string) => Promise<void>;
  };
  cron: {
    list: () => Promise<CronJob[]>;
    get: (id: string) => Promise<CronJob | null>;
    create: (input: CronJobInput) => Promise<CronJob>;
    update: (id: string, patch: Partial<CronJobInput>) => Promise<CronJob>;
    pause: (id: string) => Promise<CronJob>;
    resume: (id: string) => Promise<CronJob>;
    run: (id: string) => Promise<CronRun>;
    delete: (id: string) => Promise<boolean>;
    runs: (id: string, limit?: number) => Promise<CronRun[]>;
  };
  catalog: {
    snapshot: () => Promise<CatalogSnapshot>;
    search: (input?: CatalogSearchInput) => Promise<CatalogSearchResult>;
    detail: (itemId: string) => Promise<CatalogItemDetail>;
    install: (input: CatalogInstallInput) => Promise<ArtifactInstallation>;
    enable: (id: string, enabled: boolean) => Promise<ArtifactInstallation>;
    uninstall: (id: string) => Promise<boolean>;
  };
  // 搴旂敤璁剧疆
  settings: {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<boolean>;
    getAll: (keys: string[]) => Promise<Record<string, string | null>>;
  };
  logs: {
    export: () => Promise<ErrorLogExportResult>;
  };
  // API Key 绠＄悊锛堟槑鏂囦笉澶栨硠锛?
  apikeys: {
    list: () => Promise<string[]>;
    set: (provider: string, apiKey: string) => Promise<boolean>;
    delete: (provider: string) => Promise<boolean>;
  };
  runtime: {
    snapshot: () => Promise<RuntimeSnapshot>;
    managedSnapshot: () => Promise<ManagedRuntimeSnapshot>;
    managedInstall: (kind: "node" | "uv") => Promise<ManagedRuntimeSnapshot["runtimes"][number]>;
    managedUpgrade: (kind: "node" | "uv") => Promise<ManagedRuntimeSnapshot["runtimes"][number]>;
    managedUninstall: (runtimeId: string) => Promise<boolean>;
    managedSetSource: (kind: "node" | "uv", manifestUrl: string) => Promise<ManagedRuntimeSnapshot>;
    onStateChanged: (handler: (snapshot: ManagedRuntimeSnapshot) => void) => () => void;
    enqueueInput: (input: {
      runId: string;
      kind: AgentRunInputKind;
      source?: AgentRunInputSource;
      message: UIMessage;
    }) => Promise<AgentRunInput>;
    cancelRun: (runId: string) => Promise<boolean>;
    events: {
      list: () => Promise<RuntimeEvent[]>;
    };
  };
  agents: {
    list: () => Promise<AgentProfile[]>;
    get: (id: string) => Promise<AgentProfile | null>;
    create: (input: AgentInput) => Promise<AgentProfile>;
    update: (id: string, input: Partial<AgentInput>) => Promise<AgentProfile>;
    archive: (id: string) => Promise<AgentProfile>;
    restore: (id: string) => Promise<AgentProfile>;
    duplicate: (id: string) => Promise<AgentProfile>;
    delete: (id: string) => Promise<boolean>;
    queueLearning: (conversationId: string) => Promise<boolean>;
    runtimeSnapshot: () => Promise<
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
    >;
    save: (agent: AgentProfile) => Promise<boolean>;
    memoryFiles: {
      list: (agentId?: string) => Promise<Record<MemoryFileKind, AgentMemoryFileSnapshot>>;
      save: (
        kind: MemoryFileKind,
        content: string,
        agentId?: string,
      ) => Promise<AgentMemoryFileSnapshot>;
      reload: (kind: MemoryFileKind, agentId?: string) => Promise<AgentMemoryFileSnapshot>;
    };
  };
  memories: {
    list: () => Promise<MemoryRecord[]>;
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
    }) => Promise<MemoryRecord[]>;
    get: (id: string) => Promise<MemoryRecord | null>;
    save: (memory: MemoryRecord) => Promise<boolean>;
    delete: (id: string) => Promise<boolean>;
    deleteBatch: (ids: string[]) => Promise<number>;
    updateBatch: (
      ids: string[],
      patch: Partial<Pick<MemoryRecord, "pinned" | "salience" | "kind" | "scope">>,
    ) => Promise<number>;
  };
  interactions: {
    list: () => Promise<InteractionProfile[]>;
  };
  sync: {
    get: () => Promise<SyncState>;
  };
  // Provider 鍏冧俊鎭?
  tools: {
    snapshot: () => Promise<ToolsSnapshot>;
    updateTool: (
      id: string,
      patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
    ) => Promise<ToolRecord>;
    skills: {
      create: (input: ToolSkillInput) => Promise<ToolSkill>;
      generateDraft: (input: SkillDraftRequest) => Promise<SkillDraftResult>;
      update: (id: string, input: Partial<ToolSkillInput>) => Promise<ToolSkill>;
      delete: (id: string) => Promise<boolean>;
      listDeleted: () => Promise<ToolSkill[]>;
      restore: (id: string) => Promise<ToolSkill>;
      permanentDelete: (id: string) => Promise<boolean>;
      permanentDeleteBatch: (ids: string[]) => Promise<number>;
      purgeExpired: () => Promise<number>;
      setEnabled: (id: string, enabled: boolean) => Promise<ToolSkill>;
      run: (skillId: string, input?: unknown) => Promise<unknown>;
      setSecret: (input: ToolSecretInput) => Promise<ToolSecretPublic>;
      deleteSecret: (id: string) => Promise<boolean>;
    };
  };
  mcp: {
    snapshot: () => Promise<McpManagerSnapshot>;
    start: (id: string) => Promise<McpServerRuntimeState>;
    stop: (id: string) => Promise<McpServerRuntimeState>;
    restart: (id: string) => Promise<McpServerRuntimeState>;
    probe: (id: string) => Promise<McpServerRuntimeState>;
    install: (
      id: string,
      options?: { allowScripts?: boolean },
    ) => Promise<McpDependencyInstallation>;
    uninstall: (id: string) => Promise<boolean>;
    config: {
      previewImport: (input: {
        format: McpConfigFormat;
        text: string;
      }) => Promise<McpConfigImportPreview>;
      importFile: (format: McpConfigFormat) => Promise<McpConfigImportPreview | null>;
      applyImport: (
        token: string,
        options?: { confirmConflicts?: boolean },
      ) => Promise<McpConfigImportResult>;
      export: (format: McpConfigFormat) => Promise<string>;
      exportFile: (format: McpConfigFormat) => Promise<"saved" | "cancelled">;
    };
    create: (input: ToolServerInput) => Promise<ToolServer>;
    update: (id: string, input: Partial<ToolServerInput>) => Promise<ToolServer>;
    delete: (id: string) => Promise<boolean>;
    listDeleted: () => Promise<ToolServer[]>;
    restore: (id: string) => Promise<ToolServer>;
    permanentDelete: (id: string) => Promise<boolean>;
    permanentDeleteBatch: (ids: string[]) => Promise<number>;
    purgeExpired: () => Promise<number>;
    setEnabled: (id: string, enabled: boolean) => Promise<ToolServer>;
    test: (id: string) => Promise<ToolDiscoveryResult>;
    discover: (id: string) => Promise<ToolDiscoveryResult>;
    capabilities: (id: string) => Promise<McpCapabilitySnapshot>;
    readResource: (input: { serverId: string; uri: string }) => Promise<McpReadResourceResult>;
    getPrompt: (input: {
      serverId: string;
      name: string;
      arguments?: Record<string, string>;
    }) => Promise<McpPromptResult>;
    complete: (input: {
      serverId: string;
      ref: Record<string, unknown>;
      argument: { name: string; value: string };
    }) => Promise<McpCompletionResult>;
    subscribe: (id: string) => Promise<boolean>;
    authorize: (id: string) => Promise<McpAuthorizationResult>;
    authStatus: (id: string) => Promise<McpAuthStatus>;
    logout: (id: string) => Promise<boolean>;
    respondInput: (id: string, value: unknown) => Promise<boolean>;
    cancelInput: (id: string) => Promise<boolean>;
    onCapabilitiesChanged: (
      handler: (event: { serverId: string; capabilities: McpCapabilitySnapshot }) => void,
    ) => () => void;
    onInputRequested: (handler: (request: McpInputRequest) => void) => () => void;
    onAuthChanged: (
      handler: (event: { serverId: string; status: McpAuthStatus }) => void,
    ) => () => void;
    onStateChanged: (handler: (state: McpServerRuntimeState) => void) => () => void;
    onDependencyStateChanged: (
      handler: (installation: McpDependencyInstallation) => void,
    ) => () => void;
    updateTool: (
      id: string,
      patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
    ) => Promise<ToolRecord>;
    setSecret: (input: ToolSecretInput) => Promise<ToolSecretPublic>;
    deleteSecret: (id: string) => Promise<boolean>;
  };
  providers: {
    list: () => Promise<ProviderInfo[]>;
    listManagedModels: () => Promise<ManagedModelInfo[]>;
    upsertCustomProvider: (input: CustomProviderInput) => Promise<ProviderInfo>;
    deleteCustomProvider: (providerId: string) => Promise<boolean>;
    setProviderApiKey: (providerId: string, apiKey: string) => Promise<boolean>;
    deleteProviderApiKey: (providerId: string) => Promise<boolean>;
    testProvider: (providerId: string) => Promise<ProviderTestResult>;
    syncAvailableModels: (providerId: string) => Promise<ProviderModelSyncResult>;
    upsertCustomModel: (input: CustomModelInput) => Promise<ProviderInfo>;
    updateModelEnabled: (providerId: string, modelId: string, enabled: boolean) => Promise<boolean>;
    setModelApiKey: (providerId: string, modelId: string, apiKey: string) => Promise<boolean>;
    deleteModelApiKey: (providerId: string, modelId: string) => Promise<boolean>;
    deleteCustomModel: (providerId: string, modelId: string) => Promise<boolean>;
  };
  // 鏈湴 AI 鏈嶅姟
  server: {
    port: () => Promise<number>;
    info: () => Promise<LocalServerInfo>;
  };
  system: {
    locale: () => Promise<string>;
    version: () => Promise<string>;
    changelog: () => Promise<string>;
  };
  updates: {
    getState: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    download: () => Promise<UpdateState>;
    install: () => Promise<UpdateState>;
    onStateChanged: (handler: (state: UpdateState) => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: AyakaApi;
  }
}
