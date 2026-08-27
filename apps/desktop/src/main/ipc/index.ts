import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { getServerInfo, getServerPort } from "../server";
import {
  listConversations,
  listDeletedConversations,
  getConversation,
  createConversation,
  deleteConversation,
  restoreConversation,
  permanentlyDeleteConversation,
  permanentlyDeleteConversations,
  purgeExpiredDeletedConversations,
  touchConversation,
  getMessagesSnapshot,
  saveMessage,
  saveMessagesBatch,
  applyMessagesPatch,
  getSetting,
  setSetting,
  listApiKeyProviders,
  setApiKey,
  deleteApiKey,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  archiveAgent,
  restoreAgent as restoreAgentProfile,
  duplicateAgent,
  deleteAgent,
  saveAgent,
  runtimeSnapshot,
  listMemories,
  deleteMemory,
  getMemoryById,
  searchMemories,
  deleteMemoriesBatch,
  updateMemoriesBatch,
  listRuntimeEvents,
  listInteractionProfiles,
  getSyncState,
  getRuntimeSnapshot,
  getToolsSnapshot,
  getSkillInspection,
  getSkillPackage,
  getSkillTool,
  insertRuntimeEvent,
  deleteSkillPackageAsync,
  listSkillRuns,
  setSkillPackageStatusAsync,
  createToolServerAsync as createToolServer,
  updateToolServerAsync as updateToolServer,
  deleteToolServerAsync as deleteToolServer,
  listDeletedToolServers,
  getSandboxSession,
  restoreToolServerAsync as restoreToolServer,
  permanentlyDeleteToolServerAsync as permanentlyDeleteToolServer,
  permanentlyDeleteToolServersAsync as permanentlyDeleteToolServers,
  purgeExpiredDeletedToolServersAsync as purgeExpiredDeletedToolServers,
  setToolServerEnabledAsync as setToolServerEnabled,
  updateToolRecordAsync as updateToolRecord,
  createSkillToolAsync as createSkillTool,
  updateSkillToolAsync as updateSkillTool,
  deleteSkillToolAsync as deleteSkillTool,
  listDeletedSkillTools,
  restoreSkillToolAsync as restoreSkillTool,
  permanentlyDeleteSkillToolAsync as permanentlyDeleteSkillTool,
  permanentlyDeleteSkillToolsAsync as permanentlyDeleteSkillTools,
  purgeExpiredDeletedSkillToolsAsync as purgeExpiredDeletedSkillTools,
  setSkillToolEnabledAsync as setSkillToolEnabled,
  setToolSecretAsync as setToolSecret,
  deleteToolSecretAsync as deleteToolSecret,
} from "../lib/db";
import {
  clearProviderApiKey,
  clearModelApiKey,
  deleteCustomModel,
  deleteCustomProvider,
  listManagedModels,
  listProviders,
  saveProviderApiKey,
  saveModelApiKey,
  syncAvailableModels,
  subscribeProviderCatalogUpdated,
  testProvider,
  updateModelEnabled,
  upsertCustomModel,
  upsertCustomProvider,
} from "../lib/providers";
import type {
  AgentInput,
  AgentProfile,
  Conversation,
  CatalogInstallInput,
  CatalogSearchInput,
  CronJobInput,
  CustomModelInput,
  CustomProviderInput,
  SkillDraftRequest,
  ToolSecretInput,
  ToolSkillInput,
  SkillRunInput,
  MemoryRecord,
  MessagePatch,
  MessageRow,
  ToolServerInput,
  AgentRunInputKind,
  AgentRunInputSource,
  WorkspaceMediaSaveInput,
  McpInputRequest,
  TrayMenuLabels,
  ErrorLogInput,
} from "../../shared/types";
import type { UIMessage } from "ai";
import { DEFAULT_AGENT_ID } from "../../shared/types";
import { queueAgentLearning } from "../lib/agent-learning";
import { memoryOrchestrator } from "../lib/memory-orchestrator";
import { createMemoryAccessContext } from "../lib/memory-access";
import {
  getMemoryFileSnapshot,
  reloadMemoryFile,
  writeMemoryFile,
  type MemoryFileKind,
} from "../lib/agent-memory-files";
import {
  discoverMcpServer,
  testMcpServer,
  getMcpCapabilities,
  readMcpResource,
  getMcpPrompt,
  completeMcp,
  listenMcpCapabilities,
  onMcpCapabilitiesChanged,
  onMcpToolsChanged,
  notifyMcpToolsChanged,
} from "../lib/mcp-manager";
import {
  authorizeMcpServer,
  getMcpAuthStatus,
  logoutMcpServer,
  onMcpAuthChanged,
} from "../lib/mcp-auth";
import {
  cancelMcpInput,
  onMcpInputRequested,
  respondMcpInput,
} from "../lib/mcp-interaction-broker";
import {
  applyMcpConfigImport,
  exportMcpConfig,
  previewMcpConfigImport,
} from "../lib/mcp-config-manager";
import {
  installMcpDependencies,
  onMcpDependencyStateChanged,
  removeMcpDependencyDirectory,
  uninstallMcpDependencies,
} from "../lib/mcp-dependencies";
import {
  getMcpManagerSnapshot as getLifecycleMcpSnapshot,
  probeMcpServer,
  restartMcpServer,
  startMcpServer,
  stopMcpServer,
  onMcpLifecycleStateChanged,
} from "../lib/mcp-lifecycle-manager";
import {
  getRuntimeSnapshot as getManagedRuntimeSnapshot,
  installManagedRuntime,
  uninstallManagedRuntime,
  upgradeManagedRuntime,
  setRuntimeManifestSource,
  onManagedRuntimeStateChanged,
} from "../lib/runtime-manager";
import { runToolSkill } from "../lib/skill-runtime";
import { onSkillChanged, notifySkillChanged } from "../lib/skill-events";
import {
  cancelSkillRunsForSkill,
  cancelSkillRun,
  onSkillRunUpdated,
  runSkill,
} from "../lib/skill-executor";
import {
  confirmSkillDependencies,
  inspectSkillDependencies,
  refreshSkillPackageStatus,
} from "../lib/skill-dependencies";
import { redactWorkspaceCommandInput } from "../lib/workspace-command";
import { generateSkillDraft } from "../lib/skill-drafts";
import {
  createCronJob,
  deleteCronJob,
  getCronJob,
  listCronJobs,
  listCronRuns,
  setCronJobPaused,
  updateCronJob,
} from "../lib/cron-store";
import { getCronScheduler } from "../lib/cron-scheduler";
import {
  getCatalogSnapshot,
  getCatalogItemDetail,
  importSkillArchive,
  installCatalogItem,
  searchCatalogMcp,
  searchCatalogSkills,
  setArtifactInstallationEnabled,
  uninstallArtifact,
  removeSkillPackageDirectory,
} from "../lib/catalog-service";
import { agentLoopSessions } from "../lib/agent-loop-session";
import {
  getConversationWorkspaceInfo,
  getWorkspaceParentState,
  listWorkspaceOrphans,
  openConversationWorkspace,
  openWorkspaceOrphan,
  openWorkspaceParent,
  prepareConversationWorkspace,
  readWorkspaceFileContent,
  revealWorkspaceFile,
  removeWorkspaceOrphan,
  rollbackConversationWorkspacePreparation,
  saveWorkspaceAttachments,
  saveWorkspaceMediaAs,
  selectWorkspaceParent,
} from "../lib/conversation-workspace";
import { updateManager } from "../lib/update-manager";
import { readChangelog } from "../lib/changelog";
import {
  authorizeSandboxArtifact,
  getSandboxArtifactResourceUrl,
  listSandboxArtifactsForConversation,
  readSandboxArtifactHtml,
  revokeSandboxArtifactAuthorization,
} from "../lib/sandbox-artifact-manager";
import {
  closeSandboxPreview,
  listSandboxPreviewsForConversation,
  restartSandboxPreview,
  setSandboxPreviewBounds,
  setSandboxPreviewVisible,
  stopSandboxPreview,
  onSandboxPreviewUpdated,
} from "../lib/sandbox-preview-manager";
import { onSandboxArtifactUpdated } from "../lib/sandbox-artifact-manager";
import {
  exportCurrentErrorLog,
  recordErrorLog,
  type ErrorLogSaveDialog,
  type ErrorLogSaveDialogOptions,
} from "../lib/error-logger";

/**
 * IPC handlers 注册
 *
 * 命名约定：channel 形如 "domain:action"
 *  - conversations:list / conversations:create / conversations:delete / conversations:get
 *  - messages:list / messages:save
 *  - settings:get / settings:set
 *  - apikeys:list / apikeys:set / apikeys:delete
 *  - server:port         获取本地 AI 服务端口
 *  - providers:list      获取 provider 列表（含模型、helpUrl）
 */

export interface IpcHandlerOptions {
  onTrayLabelsChanged?: (labels: TrayMenuLabels) => void;
}

export function registerIpcHandlers(options: IpcHandlerOptions = {}): void {
  const broadcast = (channel: string, payload: unknown): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    }
  };
  onMcpCapabilitiesChanged((serverId, capabilities) =>
    broadcast("mcp:capabilities-changed", { serverId, capabilities }),
  );
  onMcpAuthChanged((serverId, status) => broadcast("mcp:auth-changed", { serverId, status }));
  onMcpInputRequested((request: McpInputRequest) => broadcast("mcp:input-requested", request));
  onMcpLifecycleStateChanged((state) => broadcast("mcp:state-changed", state));
  onMcpDependencyStateChanged((installation) => {
    broadcast("mcp:dependency-state-changed", installation);
    notifySkillChanged({ reason: "dependencies" });
  });
  onMcpToolsChanged((event) => broadcast("mcp:tools-changed", event));
  onManagedRuntimeStateChanged((snapshot) => {
    broadcast("runtime:state-changed", snapshot);
    notifySkillChanged({ reason: "dependencies" });
  });
  onSkillRunUpdated((run) => broadcast("skills:run-updated", run));
  onSkillChanged((event) => broadcast("skills:changed", event));
  onSandboxArtifactUpdated((artifact) => {
    const session = getSandboxSession(artifact.session_id);
    if (session?.conversation_id) {
      broadcast("sandbox:artifact-updated", {
        ...artifact,
        conversationId: session.conversation_id,
      });
    }
  });
  onSandboxPreviewUpdated((preview) => broadcast("sandbox:preview-updated", preview));
  subscribeProviderCatalogUpdated((providerId) =>
    broadcast("providers:catalog-updated", { providerId }),
  );

  const updateToolAndNotify = async (
    id: string,
    patch: {
      enabled?: boolean | number;
      auto_use?: boolean | number;
      requires_approval?: boolean | number;
    },
  ) => {
    const tool = await updateToolRecord(id, patch);
    if (tool.kind === "mcp" && tool.server_id) notifyMcpToolsChanged(tool.server_id);
    return tool;
  };

  // ---------- Main window controls ----------
  ipcMain.handle("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("window:toggleMaximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle("window:isMaximized", (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
  });
  ipcMain.handle("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on("logs:record", (_event, input: ErrorLogInput) => {
    if (!input || typeof input !== "object") return;
    recordErrorLog({ ...input, source: "renderer" });
  });
  ipcMain.handle("logs:export", (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const showSaveDialog: ErrorLogSaveDialog = (options: ErrorLogSaveDialogOptions) =>
      parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
    return exportCurrentErrorLog(showSaveDialog);
  });

  ipcMain.handle("tray:setLabels", (_event, labels: TrayMenuLabels) => {
    if (!isTrayMenuLabels(labels)) throw new Error("Invalid tray menu labels.");
    options.onTrayLabelsChanged?.(labels);
    return true;
  });

  // ---------- Application updates ----------
  ipcMain.handle("updates:getState", () => updateManager.getState());
  ipcMain.handle("updates:check", () => updateManager.check());
  ipcMain.handle("updates:download", () => updateManager.download());
  ipcMain.handle("updates:install", () => updateManager.install());

  // ---------- 会话历史 ----------
  ipcMain.handle("conversations:list", () => listConversations());

  ipcMain.handle("conversations:get", (_e, id: string) => getConversation(id));

  ipcMain.handle("conversations:create", (_e, id: string, title?: string) =>
    createConversation(id, title),
  );

  ipcMain.handle("conversations:delete", async (_e, id: string) => {
    await deleteConversation(id);
    return true;
  });

  ipcMain.handle("conversations:touch", async (_e, id: string, title?: string) => {
    await touchConversation(id, title);
    return true;
  });

  ipcMain.handle("conversations:listDeleted", () => listDeletedConversations());

  ipcMain.handle("conversations:restore", async (_e, id: string) => {
    await restoreConversation(id);
    return true;
  });

  ipcMain.handle("conversations:permanentDelete", async (_e, id: string) => {
    await permanentlyDeleteConversation(id);
    return true;
  });

  ipcMain.handle("conversations:permanentDeleteBatch", (_e, ids: string[]) => {
    return permanentlyDeleteConversations(ids);
  });

  ipcMain.handle("conversations:purgeExpired", () => purgeExpiredDeletedConversations());

  ipcMain.handle("workspace:get", (_e, conversationId: string) =>
    getConversationWorkspaceInfo(conversationId),
  );
  ipcMain.handle("workspace:prepare", (_e, conversationId: string, title?: string) =>
    prepareConversationWorkspace(conversationId, title),
  );
  ipcMain.handle("workspace:open", (_e, conversationId: string) =>
    openConversationWorkspace(conversationId),
  );
  ipcMain.handle("workspace:selectParent", async () => {
    return selectWorkspaceParent();
  });
  ipcMain.handle("workspace:openDefaultParent", () => openWorkspaceParent());
  ipcMain.handle("workspace:getParentState", () => getWorkspaceParentState());
  ipcMain.handle("workspace:listOrphans", () => listWorkspaceOrphans());
  ipcMain.handle("workspace:openOrphan", (_e, id: string) => openWorkspaceOrphan(id));
  ipcMain.handle("workspace:removeOrphan", (_e, id: string) => removeWorkspaceOrphan(id));
  ipcMain.handle(
    "workspace:saveAttachments",
    (
      _e,
      input: {
        conversationId: string;
        attachments: Array<{ filename?: string; mediaType?: string; dataUrl: string }>;
      },
    ) => saveWorkspaceAttachments(input.conversationId, input.attachments),
  );
  ipcMain.handle("workspace:saveMediaAs", (_e, input: WorkspaceMediaSaveInput) =>
    saveWorkspaceMediaAs(input),
  );
  ipcMain.handle("workspace:revealFile", (_e, input: { conversationId: string; path: string }) =>
    revealWorkspaceFile(input.conversationId, input.path),
  );
  ipcMain.handle("workspace:read", (_e, input: { conversationId: string; path: string }) =>
    readWorkspaceFileContent(input.conversationId, input.path),
  );
  ipcMain.handle("workspace:rollback", (_e, conversationId: string) =>
    rollbackConversationWorkspacePreparation(conversationId),
  );

  // ---------- 生成式 artifact / preview ----------
  ipcMain.handle("sandbox:artifacts:list", (_event, conversationId: string) => {
    if (typeof conversationId !== "string" || !conversationId)
      throw new Error("conversationId is required.");
    return listSandboxArtifactsForConversation(conversationId);
  });
  ipcMain.handle(
    "sandbox:artifacts:read",
    (_event, input: { conversationId: string; artifactId: string }) => {
      if (
        !input ||
        typeof input.conversationId !== "string" ||
        typeof input.artifactId !== "string"
      ) {
        throw new Error("conversationId and artifactId are required.");
      }
      return readSandboxArtifactHtml(input.conversationId, input.artifactId);
    },
  );
  ipcMain.handle(
    "sandbox:artifacts:resourceUrl",
    (_event, input: { conversationId: string; artifactId: string }) => {
      if (
        !input ||
        typeof input.conversationId !== "string" ||
        typeof input.artifactId !== "string"
      ) {
        throw new Error("conversationId and artifactId are required.");
      }
      return getSandboxArtifactResourceUrl(input.conversationId, input.artifactId);
    },
  );
  ipcMain.handle(
    "sandbox:artifacts:authorize",
    (_event, input: { conversationId: string; artifactId: string }) =>
      authorizeSandboxArtifact(input.conversationId, input.artifactId),
  );
  ipcMain.handle(
    "sandbox:artifacts:revoke",
    (_event, input: { conversationId: string; artifactId: string }) =>
      revokeSandboxArtifactAuthorization(input.conversationId, input.artifactId),
  );
  ipcMain.handle("sandbox:previews:list", (_event, conversationId: string) =>
    listSandboxPreviewsForConversation(conversationId),
  );
  ipcMain.handle(
    "sandbox:previews:stop",
    (_event, input: { conversationId: string; previewId: string }) =>
      stopSandboxPreview(input.previewId, input.conversationId),
  );
  ipcMain.handle(
    "sandbox:previews:restart",
    (_event, input: { conversationId: string; previewId: string }) =>
      restartSandboxPreview(input.previewId, input.conversationId),
  );
  ipcMain.handle(
    "sandbox:previews:close",
    (_event, input: { conversationId: string; previewId: string }) =>
      closeSandboxPreview(input.previewId, input.conversationId),
  );
  ipcMain.handle(
    "sandbox:previews:setBounds",
    (
      event,
      input: {
        conversationId: string;
        previewId: string;
        bounds: { x: number; y: number; width: number; height: number };
      },
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error("Preview window is unavailable.");
      setSandboxPreviewBounds(input.previewId, input.conversationId, window, input.bounds);
    },
  );
  ipcMain.handle(
    "sandbox:previews:setVisible",
    (event, input: { conversationId: string; previewId: string; visible: boolean }) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error("Preview window is unavailable.");
      setSandboxPreviewVisible(input.previewId, input.conversationId, window, input.visible);
    },
  );

  // ---------- 消息 ----------
  ipcMain.handle("messages:list", (_e, conversationId: string) =>
    getMessagesSnapshot(conversationId),
  );

  ipcMain.handle("messages:save", async (_e, msg: MessageRow) => {
    await saveMessage(msg);
    return true;
  });

  ipcMain.handle("messages:saveBatch", async (_e, msgs: MessageRow[]) => {
    await saveMessagesBatch(msgs);
    return true;
  });

  ipcMain.handle("messages:applyPatch", (_e, patch: MessagePatch) => applyMessagesPatch(patch));

  ipcMain.handle("cron:list", () => listCronJobs());
  ipcMain.handle("cron:get", (_e, id: string) => getCronJob(id));
  ipcMain.handle("cron:create", (_e, input: CronJobInput) => createCronJob(input));
  ipcMain.handle("cron:update", (_e, id: string, patch: Partial<CronJobInput>) =>
    updateCronJob(id, patch),
  );
  ipcMain.handle("cron:pause", (_e, id: string) => setCronJobPaused(id, true));
  ipcMain.handle("cron:resume", (_e, id: string) => setCronJobPaused(id, false));
  ipcMain.handle("cron:run", (_e, id: string) => getCronScheduler().runNow(id));
  ipcMain.handle("cron:delete", (_e, id: string) => deleteCronJob(id));
  ipcMain.handle("cron:runs", (_e, id: string, limit?: number) => listCronRuns(id, limit));

  ipcMain.handle("catalog:snapshot", () => getCatalogSnapshot());
  ipcMain.handle("catalog:search", (_e, input?: CatalogSearchInput) =>
    input?.artifactType === "mcp" ? searchCatalogMcp(input) : searchCatalogSkills(input),
  );
  ipcMain.handle("catalog:detail", (_e, itemId: string) => getCatalogItemDetail(itemId));
  ipcMain.handle("catalog:install", async (_e, input: CatalogInstallInput) => {
    const result = await installCatalogItem(input);
    if (result.artifactType === "skill" || result.skillId) {
      notifySkillChanged({ skillId: result.skillId ?? undefined, reason: "imported" });
    }
    return result;
  });
  ipcMain.handle("catalog:enable", async (_e, id: string, enabled: boolean) => {
    const result = await setArtifactInstallationEnabled(id, enabled);
    if (result.artifactType === "skill" || result.skillId) {
      notifySkillChanged({
        skillId: result.skillId ?? undefined,
        reason: enabled ? "enabled" : "disabled",
      });
    }
    return result;
  });
  ipcMain.handle("catalog:uninstall", async (_e, id: string) => {
    const result = await uninstallArtifact(id);
    notifySkillChanged({ reason: "deleted" });
    return result;
  });

  // ---------- 设置 ----------
  ipcMain.handle("settings:get", (_e, key: string) => getSetting(key));

  ipcMain.handle("settings:set", async (_e, key: string, value: string) => {
    await setSetting(key, value);
    return true;
  });

  ipcMain.handle("settings:getAll", (_e, keys: string[]) => {
    const result: Record<string, string | null> = {};
    for (const k of keys) result[k] = getSetting(k);
    return result;
  });

  // ---------- API Key ----------
  ipcMain.handle("apikeys:list", () => listApiKeyProviders());

  ipcMain.handle("apikeys:set", async (_e, provider: string, apiKey: string) => {
    await setApiKey(provider, apiKey);
    return true;
  });

  ipcMain.handle("apikeys:delete", async (_e, provider: string) => {
    await deleteApiKey(provider);
    return true;
  });
  // 注意：不暴露 apikeys:get 明文接口，渲染层无需读取明文 key

  // ---------- AI 工作台 ----------
  ipcMain.handle("runtime:snapshot", () => getRuntimeSnapshot());
  ipcMain.handle(
    "runtime:enqueueInput",
    (
      _event,
      input: {
        runId: string;
        kind: AgentRunInputKind;
        source?: AgentRunInputSource;
        message: UIMessage;
      },
    ) => {
      if (!input || typeof input.runId !== "string") throw new Error("runId is required.");
      if (input.kind !== "steering" && input.kind !== "follow_up") {
        throw new Error("kind must be steering or follow_up.");
      }
      if (
        !input.message ||
        typeof input.message.id !== "string" ||
        !Array.isArray(input.message.parts)
      ) {
        throw new Error("message must be a valid UI message.");
      }
      try {
        return {
          ok: true as const,
          value: agentLoopSessions.enqueue(
            input.runId,
            input.kind,
            input.source ?? "user",
            input.message,
          ),
        };
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "enqueue_failed";
        return {
          ok: false as const,
          code,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );
  ipcMain.handle("runtime:cancelRun", async (_event, runId: string) => {
    if (typeof runId !== "string" || !runId) throw new Error("runId is required.");
    return agentLoopSessions.cancel(runId);
  });
  ipcMain.handle("agents:list", () => listAgents());
  ipcMain.handle("agents:get", (_e, id: string) => getAgent(id));
  ipcMain.handle("agents:create", (_e, input: AgentInput) => createAgent(input));
  ipcMain.handle("agents:update", (_e, id: string, input: Partial<AgentInput>) =>
    updateAgent(id, input),
  );
  ipcMain.handle("agents:archive", (_e, id: string) => archiveAgent(id));
  ipcMain.handle("agents:restore", (_e, id: string) => restoreAgentProfile(id));
  ipcMain.handle("agents:duplicate", (_e, id: string) => duplicateAgent(id));
  ipcMain.handle("agents:delete", async (_e, id: string) => {
    await deleteAgent(id);
    return true;
  });
  ipcMain.handle("agents:runtimeSnapshot", () => runtimeSnapshot());
  ipcMain.handle("agents:queueLearning", (_e, conversationId: string) => {
    queueAgentLearning(conversationId);
    return true;
  });
  ipcMain.handle("agents:save", async (_e, agent: AgentProfile) => {
    await saveAgent(agent);
    return true;
  });
  ipcMain.handle("memories:list", () => listMemories());
  ipcMain.handle("memories:search", (_e, filters: Parameters<typeof searchMemories>[0]) =>
    filters.query?.trim()
      ? memoryOrchestrator.retrieve({
          query: filters.query,
          access: createMemoryAccessContext(DEFAULT_AGENT_ID),
          agentId: filters.agentId,
          scope: filters.scope,
          kind: filters.kind,
          limit: filters.limit,
        })
      : searchMemories(filters),
  );
  ipcMain.handle("memories:get", (_e, id: string) => getMemoryById(id));
  ipcMain.handle("memories:save", async (_e, memory: MemoryRecord) => {
    const existing = getMemoryById(memory.id);
    if (existing) {
      await memoryOrchestrator.update(memory.id, memory);
    } else {
      await memoryOrchestrator.saveExplicit({
        id: memory.id,
        title: memory.title,
        content: memory.content,
        scope: memory.scope,
        kind: memory.kind,
        agentId: memory.agent_id,
        sourceConversationId: memory.conversation_id,
        sourceRunId: memory.source_run_id,
        salience: memory.salience,
        pinned: memory.pinned === 1,
      });
    }
    return true;
  });
  ipcMain.handle("memories:delete", async (_e, id: string) => {
    await deleteMemory(id);
    return true;
  });
  ipcMain.handle("memories:deleteBatch", (_e, ids: string[]) => deleteMemoriesBatch(ids));
  ipcMain.handle(
    "memories:updateBatch",
    (_e, ids: string[], patch: Parameters<typeof updateMemoriesBatch>[1]) =>
      updateMemoriesBatch(ids, patch),
  );

  // 有界记忆文件（SOUL / USER / MEMORY）查看与编辑
  ipcMain.handle("agents:memoryFiles:list", (_e, agentId?: string) => ({
    soul: getMemoryFileSnapshot("soul", agentId),
    user: getMemoryFileSnapshot("user", agentId),
    memory: getMemoryFileSnapshot("memory", agentId),
  }));
  ipcMain.handle(
    "agents:memoryFiles:save",
    (_e, kind: MemoryFileKind, content: string, agentId?: string) => {
      writeMemoryFile(kind, content, { source: "user", agentId });
      return getMemoryFileSnapshot(kind, agentId);
    },
  );
  ipcMain.handle("agents:memoryFiles:reload", (_e, kind: MemoryFileKind, agentId?: string) =>
    reloadMemoryFile(kind, agentId),
  );

  ipcMain.handle("runtime:events:list", () => listRuntimeEvents());
  ipcMain.handle("runtime:managedSnapshot", () => getManagedRuntimeSnapshot());
  ipcMain.handle("runtime:managedInstall", (_e, kind: "node" | "uv") =>
    installManagedRuntime(kind),
  );
  ipcMain.handle("runtime:managedUpgrade", (_e, kind: "node" | "uv") =>
    upgradeManagedRuntime(kind),
  );
  ipcMain.handle("runtime:managedUninstall", (_e, runtimeId: string) =>
    uninstallManagedRuntime(runtimeId),
  );
  ipcMain.handle("runtime:managedSetSource", (_e, kind: "node" | "uv", manifestUrl: string) =>
    setRuntimeManifestSource(kind, manifestUrl),
  );
  ipcMain.handle("interactions:list", () => listInteractionProfiles());
  ipcMain.handle("sync:get", () => getSyncState());

  // ---------- tools: MCP + Agent Skills ----------
  ipcMain.handle("tools:snapshot", () => getToolsSnapshot());
  ipcMain.handle(
    "tools:updateTool",
    (
      _e,
      id: string,
      patch: {
        enabled?: boolean | number;
        auto_use?: boolean | number;
        requires_approval?: boolean | number;
      },
    ) => updateToolAndNotify(id, patch),
  );
  ipcMain.handle("mcp:create", (_e, input: ToolServerInput) => createToolServer(input));
  ipcMain.handle("mcp:update", async (_e, id: string, input: Partial<ToolServerInput>) => {
    await stopMcpServer(id).catch(() => undefined);
    const server = await updateToolServer(id, input);
    notifyMcpToolsChanged(id);
    return server;
  });
  ipcMain.handle("mcp:delete", async (_e, id: string) => {
    await stopMcpServer(id).catch(() => undefined);
    await deleteToolServer(id);
    notifyMcpToolsChanged(id);
    return true;
  });
  ipcMain.handle("mcp:listDeleted", () => listDeletedToolServers("mcp"));
  ipcMain.handle("mcp:restore", (_e, id: string) => restoreToolServer(id));
  ipcMain.handle("mcp:permanentDelete", async (_e, id: string) => {
    await stopMcpServer(id).catch(() => undefined);
    removeMcpDependencyDirectory(id);
    await permanentlyDeleteToolServer(id);
    return true;
  });
  ipcMain.handle("mcp:permanentDeleteBatch", async (_e, ids: string[]) => {
    await Promise.all(ids.map((id) => stopMcpServer(id).catch(() => undefined)));
    for (const id of ids) removeMcpDependencyDirectory(id);
    return permanentlyDeleteToolServers(ids);
  });
  ipcMain.handle("mcp:purgeExpired", () => purgeExpiredDeletedToolServers());
  ipcMain.handle("mcp:setEnabled", async (_e, id: string, enabled: boolean) => {
    if (!enabled) await stopMcpServer(id).catch(() => undefined);
    const server = await setToolServerEnabled(id, enabled);
    if (!enabled) notifyMcpToolsChanged(id);
    if (enabled) {
      // Enabling a server is an explicit user action. Discover immediately so
      // the Agent ToolSet is populated without requiring an app restart or a
      // second manual Start action. Runtime/dependency failures are recorded
      // by discovery and remain visible in the MCP workspace.
      await discoverMcpServer(id);
    }
    return server;
  });
  ipcMain.handle("mcp:snapshot", () => getLifecycleMcpSnapshot());
  ipcMain.handle("mcp:start", (_e, id: string) => startMcpServer(id));
  ipcMain.handle("mcp:stop", (_e, id: string) => stopMcpServer(id));
  ipcMain.handle("mcp:restart", (_e, id: string) => restartMcpServer(id));
  ipcMain.handle("mcp:probe", (_e, id: string) => probeMcpServer(id));
  ipcMain.handle("mcp:install", (_e, id: string, options?: { allowScripts?: boolean }) =>
    installMcpDependencies(id, options),
  );
  ipcMain.handle("mcp:uninstall", async (_e, id: string) => {
    await stopMcpServer(id).catch(() => undefined);
    return uninstallMcpDependencies(id);
  });
  ipcMain.handle(
    "mcp:config:previewImport",
    (_e, input: { format: "claude-json" | "codex-toml"; text: string }) =>
      previewMcpConfigImport(input),
  );
  ipcMain.handle(
    "mcp:config:applyImport",
    (_e, token: string, options?: { confirmConflicts?: boolean }) =>
      applyMcpConfigImport(token, options),
  );
  ipcMain.handle("mcp:config:importFile", async (event, format: "claude-json" | "codex-toml") => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          properties: ["openFile"],
          filters:
            format === "claude-json"
              ? [{ name: "JSON", extensions: ["json"] }]
              : [{ name: "TOML", extensions: ["toml"] }],
        })
      : await dialog.showOpenDialog({
          properties: ["openFile"],
          filters:
            format === "claude-json"
              ? [{ name: "JSON", extensions: ["json"] }]
              : [{ name: "TOML", extensions: ["toml"] }],
        });
    if (result.canceled || !result.filePaths[0]) return null;
    return previewMcpConfigImport({
      format,
      text: await readFile(result.filePaths[0], "utf8"),
    });
  });
  ipcMain.handle("mcp:config:export", (_e, format: "claude-json" | "codex-toml") =>
    exportMcpConfig(format),
  );
  ipcMain.handle("mcp:config:exportFile", async (event, format: "claude-json" | "codex-toml") => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          defaultPath: format === "claude-json" ? "mcp.json" : "config.toml",
          filters:
            format === "claude-json"
              ? [{ name: "JSON", extensions: ["json"] }]
              : [{ name: "TOML", extensions: ["toml"] }],
        })
      : await dialog.showSaveDialog({
          defaultPath: format === "claude-json" ? "mcp.json" : "config.toml",
          filters:
            format === "claude-json"
              ? [{ name: "JSON", extensions: ["json"] }]
              : [{ name: "TOML", extensions: ["toml"] }],
        });
    if (result.canceled || !result.filePath) return "cancelled" as const;
    await writeFile(result.filePath, exportMcpConfig(format), "utf8");
    return "saved" as const;
  });
  ipcMain.handle("mcp:test", (_e, id: string) => testMcpServer(id));
  ipcMain.handle("mcp:discover", (_e, id: string) => discoverMcpServer(id));
  ipcMain.handle("mcp:capabilities", (_e, id: string) => getMcpCapabilities(id));
  ipcMain.handle("mcp:readResource", (_e, input: { serverId: string; uri: string }) =>
    readMcpResource(input.serverId, input.uri),
  );
  ipcMain.handle(
    "mcp:getPrompt",
    (_e, input: { serverId: string; name: string; arguments?: Record<string, string> }) =>
      getMcpPrompt(input.serverId, input.name, input.arguments),
  );
  ipcMain.handle(
    "mcp:complete",
    (
      _e,
      input: {
        serverId: string;
        ref: Record<string, unknown>;
        argument: { name: string; value: string };
      },
    ) => completeMcp(input.serverId, input.ref, input.argument),
  );
  ipcMain.handle("mcp:subscribe", (_e, id: string) => listenMcpCapabilities(id));
  ipcMain.handle("mcp:authorize", (_e, id: string) => authorizeMcpServer(id));
  ipcMain.handle("mcp:authStatus", (_e, id: string) => getMcpAuthStatus(id));
  ipcMain.handle("mcp:logout", (_e, id: string) => logoutMcpServer(id));
  ipcMain.handle("mcp:respondInput", (_e, id: string, value: unknown) =>
    respondMcpInput(id, value),
  );
  ipcMain.handle("mcp:cancelInput", (_e, id: string) => cancelMcpInput(id));
  ipcMain.handle(
    "mcp:updateTool",
    (
      _e,
      id: string,
      patch: {
        enabled?: boolean | number;
        auto_use?: boolean | number;
        requires_approval?: boolean | number;
      },
    ) => updateToolAndNotify(id, patch),
  );
  ipcMain.handle("mcp:setSecret", (_e, input: ToolSecretInput) =>
    setToolSecret({ ...input, ownerType: "server" }),
  );
  ipcMain.handle("mcp:deleteSecret", async (_e, id: string) => {
    await deleteToolSecret(id);
    return true;
  });

  ipcMain.handle("tools:skills:create", async (_e, input: ToolSkillInput) => {
    const skill = await createSkillTool(input);
    notifySkillChanged({ skillId: skill.id, reason: "created" });
    return skill;
  });
  ipcMain.handle("tools:skills:importArchive", async (_e, bytes: Uint8Array) => {
    const skill = await importSkillArchive(bytes, "upload");
    notifySkillChanged({ skillId: skill.id, reason: "imported" });
    return skill;
  });
  ipcMain.handle("tools:skills:generateDraft", (_e, input: SkillDraftRequest) =>
    generateSkillDraft(input),
  );
  ipcMain.handle("tools:skills:update", async (_e, id: string, input: Partial<ToolSkillInput>) => {
    const skill = await updateSkillTool(id, input);
    notifySkillChanged({ skillId: id, reason: "updated" });
    return skill;
  });
  ipcMain.handle("tools:skills:delete", async (_e, id: string) => {
    await cancelSkillRunsForSkill(id);
    removeSkillPackageDirectory(id);
    await deleteSkillPackageAsync(id);
    await deleteSkillTool(id);
    notifySkillChanged({ skillId: id, reason: "deleted" });
    return true;
  });
  ipcMain.handle("tools:skills:listDeleted", () => listDeletedSkillTools());
  ipcMain.handle("tools:skills:restore", async (_e, id: string) => {
    const skill = await restoreSkillTool(id);
    notifySkillChanged({ skillId: id, reason: "restored" });
    return skill;
  });
  ipcMain.handle("tools:skills:permanentDelete", async (_e, id: string) => {
    await cancelSkillRunsForSkill(id);
    removeSkillPackageDirectory(id);
    await deleteSkillPackageAsync(id);
    await permanentlyDeleteSkillTool(id);
    notifySkillChanged({ skillId: id, reason: "deleted" });
    return true;
  });
  ipcMain.handle("tools:skills:permanentDeleteBatch", async (_e, ids: string[]) => {
    for (const id of ids) {
      await cancelSkillRunsForSkill(id);
      removeSkillPackageDirectory(id);
      await deleteSkillPackageAsync(id);
    }
    const result = await permanentlyDeleteSkillTools(ids);
    for (const id of ids) notifySkillChanged({ skillId: id, reason: "deleted" });
    return result;
  });
  ipcMain.handle("tools:skills:purgeExpired", async () => {
    const now = Date.now();
    for (const skill of listDeletedSkillTools()) {
      if (skill.purge_after_at !== null && skill.purge_after_at <= now) {
        removeSkillPackageDirectory(skill.id);
      }
    }
    const result = await purgeExpiredDeletedSkillTools(now);
    if (result > 0) notifySkillChanged({ reason: "deleted" });
    return result;
  });
  ipcMain.handle("tools:skills:setEnabled", async (_e, id: string, enabled: boolean) => {
    if (!enabled) await cancelSkillRunsForSkill(id);
    const skill = await setSkillToolEnabled(id, enabled);
    if (enabled) await refreshSkillPackageStatus(id);
    else if (getSkillPackage(id)) await setSkillPackageStatusAsync(id, "disabled");
    notifySkillChanged({ skillId: id, reason: enabled ? "enabled" : "disabled" });
    return skill;
  });
  ipcMain.handle("tools:skills:inspect", async (_e, skillId: string) => {
    await refreshSkillPackageStatus(skillId);
    const inspection = getSkillInspection(skillId);
    return {
      ...inspection,
      dependencies: await inspectSkillDependencies(skillId),
    };
  });
  ipcMain.handle(
    "tools:skills:entries",
    (_e, skillId: string) => getSkillInspection(skillId).entries,
  );
  ipcMain.handle("tools:skills:runs", (_e, skillId: string, limit?: number) =>
    listSkillRuns(skillId, limit),
  );
  ipcMain.handle("tools:skills:dependencies", (_e, skillId: string) =>
    inspectSkillDependencies(skillId),
  );
  ipcMain.handle(
    "tools:skills:confirmDependencies",
    async (_e, skillId: string, options?: { confirmed?: boolean; allowScripts?: boolean }) => {
      if (options?.confirmed !== true)
        throw new Error("Skill dependency confirmation was not accepted.");
      const result = await confirmSkillDependencies(skillId, {
        allowScripts: options.allowScripts,
      });
      notifySkillChanged({ skillId, reason: "dependencies" });
      return result;
    },
  );
  ipcMain.handle("tools:skills:cancel", (_e, runId: string) => cancelSkillRun(runId));
  ipcMain.handle(
    "tools:skills:run",
    async (event, skillIdOrInput: string | SkillRunInput, input?: unknown) => {
      const runInput =
        typeof skillIdOrInput === "string" && isSkillScriptInput(input)
          ? ({
              ...input,
              skillId: skillIdOrInput,
            } as SkillRunInput)
          : typeof skillIdOrInput === "string"
            ? null
            : skillIdOrInput;
      if (runInput) {
        const approved = await requestSkillRunApproval(event, runInput);
        if (!approved) throw new Error("Skill execution was not approved.");
        return runSkill(runInput);
      }
      return runToolSkill({ skillId: skillIdOrInput as string, input });
    },
  );
  ipcMain.handle("tools:skills:setSecret", (_e, input: ToolSecretInput) =>
    setToolSecret({ ...input, ownerType: "tool" }),
  );
  ipcMain.handle("tools:skills:deleteSecret", async (_e, id: string) => {
    await deleteToolSecret(id);
    return true;
  });
  // ---------- Provider metadata ----------
  ipcMain.handle("providers:list", () => listProviders());

  ipcMain.handle("providers:listManagedModels", () => listManagedModels());

  ipcMain.handle("providers:upsertCustomProvider", (_e, input: CustomProviderInput) =>
    upsertCustomProvider(input),
  );

  ipcMain.handle("providers:deleteCustomProvider", async (_e, providerId: string) => {
    await deleteCustomProvider(providerId);
    return true;
  });

  ipcMain.handle("providers:setProviderApiKey", async (_e, providerId: string, apiKey: string) => {
    await saveProviderApiKey(providerId, apiKey);
    return true;
  });

  ipcMain.handle("providers:deleteProviderApiKey", async (_e, providerId: string) => {
    await clearProviderApiKey(providerId);
    return true;
  });

  ipcMain.handle("providers:testProvider", (_e, providerId: string) => testProvider(providerId));

  ipcMain.handle("providers:syncAvailableModels", (_e, providerId: string) =>
    syncAvailableModels(providerId),
  );

  ipcMain.handle("providers:upsertCustomModel", (_e, input: CustomModelInput) =>
    upsertCustomModel(input),
  );

  ipcMain.handle(
    "providers:updateModelEnabled",
    async (_e, providerId: string, modelId: string, enabled: boolean) => {
      await updateModelEnabled(providerId, modelId, enabled);
      return true;
    },
  );

  ipcMain.handle(
    "providers:setModelApiKey",
    async (_e, providerId: string, modelId: string, apiKey: string) => {
      await saveModelApiKey(providerId, modelId, apiKey);
      return true;
    },
  );

  ipcMain.handle("providers:deleteModelApiKey", async (_e, providerId: string, modelId: string) => {
    await clearModelApiKey(providerId, modelId);
    return true;
  });

  ipcMain.handle("providers:deleteCustomModel", async (_e, providerId: string, modelId: string) => {
    await deleteCustomModel(providerId, modelId);
    return true;
  });

  // ---------- Local server port ----------
  ipcMain.handle("server:port", () => getServerPort());
  ipcMain.handle("server:info", () => getServerInfo());

  // ---------- System information ----------
  ipcMain.handle("system:locale", () => app.getLocale());
  ipcMain.handle("system:version", () => app.getVersion());
  ipcMain.handle("system:changelog", () =>
    readChangelog({
      isDev: process.env.AYAKA_DEV === "1",
      appPath: process.env.AYAKA_APP_PATH ?? app.getAppPath(),
      resourcesPath: process.resourcesPath,
    }),
  );
}

function isSkillScriptInput(value: unknown): value is Omit<SkillRunInput, "skillId"> {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { entryId?: unknown }).entryId === "string",
  );
}

async function requestSkillRunApproval(
  event: Electron.IpcMainInvokeEvent,
  input: SkillRunInput,
): Promise<boolean> {
  const skill = getSkillTool(input.skillId);
  if (!skill) throw new Error("Skill not found.");
  if (skill.requires_approval === 0) return true;

  const auditInput = redactWorkspaceCommandInput({
    args: Array.isArray(input.args) ? input.args : [],
    cwd: input.cwd ?? "workspace",
  });
  insertRuntimeEvent({
    kind: "approval",
    title: "Approval requested: Skill script",
    status: "queued",
    tool_id: skill.id,
    conversation_id: input.conversationId,
    agent_id: input.agentId,
    detail: {
      skillId: skill.id,
      entryId: input.entryId,
      input: {
        ...(auditInput && typeof auditInput === "object" ? auditInput : {}),
        args: { count: Array.isArray(input.args) ? input.args.length : 0 },
      },
    },
  });

  const parent = BrowserWindow.fromWebContents(event.sender);
  const result = parent
    ? await dialog.showMessageBox(parent, {
        type: "warning",
        title: "Approve Skill execution",
        message: `Run the '${skill.name}' Skill script?`,
        detail:
          "This runs a package-provided script on the local machine. It can access the selected working directory, network, and other local processes according to the script's own behavior.",
        buttons: ["Cancel", "Run"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      })
    : await dialog.showMessageBox({
        type: "warning",
        title: "Approve Skill execution",
        message: `Run the '${skill.name}' Skill script?`,
        detail: "This runs a package-provided script on the local machine.",
        buttons: ["Cancel", "Run"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
  const approved = result.response === 1;
  insertRuntimeEvent({
    kind: "approval",
    title: `Approval ${approved ? "approved" : "denied"}: Skill script`,
    status: approved ? "succeeded" : "cancelled",
    tool_id: skill.id,
    conversation_id: input.conversationId,
    agent_id: input.agentId,
    detail: { skillId: skill.id, entryId: input.entryId },
  });
  return approved;
}

function isTrayMenuLabels(value: unknown): value is TrayMenuLabels {
  if (!value || typeof value !== "object") return false;
  const labels = value as Record<string, unknown>;
  return (
    typeof labels.settings === "string" &&
    typeof labels.openHome === "string" &&
    typeof labels.chat === "string" &&
    typeof labels.quit === "string"
  );
}

/** 导出类型供 preload 使用 */
export type { Conversation, MessageRow };
