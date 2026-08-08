import { app, BrowserWindow, ipcMain } from "electron";
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
  createToolServer,
  updateToolServer,
  deleteToolServer,
  listDeletedToolServers,
  restoreToolServer,
  permanentlyDeleteToolServer,
  permanentlyDeleteToolServers,
  purgeExpiredDeletedToolServers,
  setToolServerEnabled,
  updateToolRecord,
  createSkillTool,
  updateSkillTool,
  deleteSkillTool,
  listDeletedSkillTools,
  restoreSkillTool,
  permanentlyDeleteSkillTool,
  permanentlyDeleteSkillTools,
  purgeExpiredDeletedSkillTools,
  setSkillToolEnabled,
  setToolSecret,
  deleteToolSecret,
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
  MemoryRecord,
  MessagePatch,
  MessageRow,
  ToolServerInput,
  AgentRunInputKind,
  AgentRunInputSource,
} from "../../shared/types";
import type { UIMessage } from "ai";
import { queueAgentLearning } from "../lib/agent-learning";
import { memoryOrchestrator } from "../lib/memory-orchestrator";
import {
  getMemoryFileSnapshot,
  reloadMemoryFile,
  writeMemoryFile,
  type MemoryFileKind,
} from "../lib/agent-memory-files";
import { closeMcpClient, discoverMcpServer, testMcpServer } from "../lib/mcp-manager";
import { runToolSkill } from "../lib/skill-runtime";
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
  installCatalogItem,
  searchCatalogMcp,
  searchCatalogSkills,
  setArtifactInstallationEnabled,
  uninstallArtifact,
} from "../lib/catalog-service";
import { agentLoopSessions } from "../lib/agent-loop-session";
import { updateManager } from "../lib/update-manager";

/**
 * IPC handlers 娉ㄥ唽
 *
 * 鍛藉悕绾﹀畾锛歝hannel 褰㈠ "domain:action"
 *  - conversations:list / conversations:create / conversations:delete / conversations:get
 *  - messages:list / messages:save
 *  - settings:get / settings:set
 *  - apikeys:list / apikeys:set / apikeys:delete
 *  - server:port         鑾峰彇鏈湴 AI 鏈嶅姟绔彛
 *  - providers:list      鑾峰彇 provider 鍒楄〃锛堝惈妯″瀷銆乭elpUrl锛?
 */

export function registerIpcHandlers(): void {
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

  // ---------- Application updates ----------
  ipcMain.handle("updates:getState", () => updateManager.getState());
  ipcMain.handle("updates:check", () => updateManager.check());
  ipcMain.handle("updates:download", () => updateManager.download());
  ipcMain.handle("updates:install", () => updateManager.install());

  // ---------- 浼氳瘽鍘嗗彶 ----------
  ipcMain.handle("conversations:list", () => listConversations());

  ipcMain.handle("conversations:get", (_e, id: string) => getConversation(id));

  ipcMain.handle("conversations:create", (_e, id: string, title?: string) =>
    createConversation(id, title),
  );

  ipcMain.handle("conversations:delete", (_e, id: string) => {
    deleteConversation(id);
    return true;
  });

  ipcMain.handle("conversations:touch", (_e, id: string, title?: string) => {
    touchConversation(id, title);
    return true;
  });

  ipcMain.handle("conversations:listDeleted", () => listDeletedConversations());

  ipcMain.handle("conversations:restore", (_e, id: string) => {
    restoreConversation(id);
    return true;
  });

  ipcMain.handle("conversations:permanentDelete", (_e, id: string) => {
    permanentlyDeleteConversation(id);
    return true;
  });

  ipcMain.handle("conversations:permanentDeleteBatch", (_e, ids: string[]) => {
    return permanentlyDeleteConversations(ids);
  });

  ipcMain.handle("conversations:purgeExpired", () => purgeExpiredDeletedConversations());

  // ---------- 娑堟伅 ----------
  ipcMain.handle("messages:list", (_e, conversationId: string) =>
    getMessagesSnapshot(conversationId),
  );

  ipcMain.handle("messages:save", (_e, msg: MessageRow) => {
    saveMessage(msg);
    return true;
  });

  ipcMain.handle("messages:saveBatch", (_e, msgs: MessageRow[]) => {
    saveMessagesBatch(msgs);
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
  ipcMain.handle("catalog:install", (_e, input: CatalogInstallInput) => installCatalogItem(input));
  ipcMain.handle("catalog:enable", (_e, id: string, enabled: boolean) =>
    setArtifactInstallationEnabled(id, enabled),
  );
  ipcMain.handle("catalog:uninstall", (_e, id: string) => uninstallArtifact(id));

  // ---------- 璁剧疆 ----------
  ipcMain.handle("settings:get", (_e, key: string) => getSetting(key));

  ipcMain.handle("settings:set", (_e, key: string, value: string) => {
    setSetting(key, value);
    return true;
  });

  ipcMain.handle("settings:getAll", (_e, keys: string[]) => {
    const result: Record<string, string | null> = {};
    for (const k of keys) result[k] = getSetting(k);
    return result;
  });

  // ---------- API Key ----------
  ipcMain.handle("apikeys:list", () => listApiKeyProviders());

  ipcMain.handle("apikeys:set", (_e, provider: string, apiKey: string) => {
    setApiKey(provider, apiKey);
    return true;
  });

  ipcMain.handle("apikeys:delete", (_e, provider: string) => {
    deleteApiKey(provider);
    return true;
  });
  // 娉ㄦ剰锛氫笉鏆撮湶 apikeys:get 鏄庢枃鎺ュ彛锛屾覆鏌撳眰鏃犻渶璇诲彇鏄庢枃 key

  // ---------- AI 宸ヤ綔鍙?----------
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
  ipcMain.handle("runtime:cancelRun", (_event, runId: string) => {
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
  ipcMain.handle("agents:delete", (_e, id: string) => {
    deleteAgent(id);
    return true;
  });
  ipcMain.handle("agents:runtimeSnapshot", () => runtimeSnapshot());
  ipcMain.handle("agents:queueLearning", (_e, conversationId: string) => {
    queueAgentLearning(conversationId);
    return true;
  });
  ipcMain.handle("agents:save", (_e, agent: AgentProfile) => {
    saveAgent(agent);
    return true;
  });
  ipcMain.handle("memories:list", () => listMemories());
  ipcMain.handle("memories:search", (_e, filters: Parameters<typeof searchMemories>[0]) =>
    filters.query?.trim()
      ? memoryOrchestrator.retrieve({
          query: filters.query,
          agentId: filters.agentId,
          scope: filters.scope,
          kind: filters.kind,
          limit: filters.limit,
        })
      : searchMemories(filters),
  );
  ipcMain.handle("memories:get", (_e, id: string) => getMemoryById(id));
  ipcMain.handle("memories:save", (_e, memory: MemoryRecord) => {
    const existing = getMemoryById(memory.id);
    if (existing) {
      memoryOrchestrator.update(memory.id, memory);
    } else {
      memoryOrchestrator.saveExplicit({
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
  ipcMain.handle("memories:delete", (_e, id: string) => {
    deleteMemory(id);
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
    ) => updateToolRecord(id, patch),
  );
  ipcMain.handle("mcp:create", (_e, input: ToolServerInput) => createToolServer(input));
  ipcMain.handle("mcp:update", async (_e, id: string, input: Partial<ToolServerInput>) => {
    const server = updateToolServer(id, input);
    await closeMcpClient(id);
    return server;
  });
  ipcMain.handle("mcp:delete", async (_e, id: string) => {
    await closeMcpClient(id);
    deleteToolServer(id);
    return true;
  });
  ipcMain.handle("mcp:listDeleted", () => listDeletedToolServers("mcp"));
  ipcMain.handle("mcp:restore", (_e, id: string) => restoreToolServer(id));
  ipcMain.handle("mcp:permanentDelete", async (_e, id: string) => {
    await closeMcpClient(id);
    permanentlyDeleteToolServer(id);
    return true;
  });
  ipcMain.handle("mcp:permanentDeleteBatch", async (_e, ids: string[]) => {
    await Promise.all(ids.map((id) => closeMcpClient(id)));
    return permanentlyDeleteToolServers(ids);
  });
  ipcMain.handle("mcp:purgeExpired", () => purgeExpiredDeletedToolServers());
  ipcMain.handle("mcp:setEnabled", async (_e, id: string, enabled: boolean) => {
    const server = setToolServerEnabled(id, enabled);
    if (!enabled) await closeMcpClient(id);
    return server;
  });
  ipcMain.handle("mcp:test", (_e, id: string) => testMcpServer(id));
  ipcMain.handle("mcp:discover", (_e, id: string) => discoverMcpServer(id));
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
    ) => updateToolRecord(id, patch),
  );
  ipcMain.handle("mcp:setSecret", (_e, input: ToolSecretInput) =>
    setToolSecret({ ...input, ownerType: "server" }),
  );
  ipcMain.handle("mcp:deleteSecret", (_e, id: string) => {
    deleteToolSecret(id);
    return true;
  });

  ipcMain.handle("tools:skills:create", (_e, input: ToolSkillInput) => createSkillTool(input));
  ipcMain.handle("tools:skills:generateDraft", (_e, input: SkillDraftRequest) =>
    generateSkillDraft(input),
  );
  ipcMain.handle("tools:skills:update", (_e, id: string, input: Partial<ToolSkillInput>) =>
    updateSkillTool(id, input),
  );
  ipcMain.handle("tools:skills:delete", (_e, id: string) => {
    deleteSkillTool(id);
    return true;
  });
  ipcMain.handle("tools:skills:listDeleted", () => listDeletedSkillTools());
  ipcMain.handle("tools:skills:restore", (_e, id: string) => restoreSkillTool(id));
  ipcMain.handle("tools:skills:permanentDelete", (_e, id: string) => {
    permanentlyDeleteSkillTool(id);
    return true;
  });
  ipcMain.handle("tools:skills:permanentDeleteBatch", (_e, ids: string[]) =>
    permanentlyDeleteSkillTools(ids),
  );
  ipcMain.handle("tools:skills:purgeExpired", () => purgeExpiredDeletedSkillTools());
  ipcMain.handle("tools:skills:setEnabled", (_e, id: string, enabled: boolean) =>
    setSkillToolEnabled(id, enabled),
  );
  ipcMain.handle("tools:skills:run", (_e, skillId: string, input?: unknown) =>
    runToolSkill({ skillId, input }),
  );
  ipcMain.handle("tools:skills:setSecret", (_e, input: ToolSecretInput) =>
    setToolSecret({ ...input, ownerType: "tool" }),
  );
  ipcMain.handle("tools:skills:deleteSecret", (_e, id: string) => {
    deleteToolSecret(id);
    return true;
  });
  // ---------- Provider metadata ----------
  ipcMain.handle("providers:list", () => listProviders());

  ipcMain.handle("providers:listManagedModels", () => listManagedModels());

  ipcMain.handle("providers:upsertCustomProvider", (_e, input: CustomProviderInput) =>
    upsertCustomProvider(input),
  );

  ipcMain.handle("providers:deleteCustomProvider", (_e, providerId: string) => {
    deleteCustomProvider(providerId);
    return true;
  });

  ipcMain.handle("providers:setProviderApiKey", (_e, providerId: string, apiKey: string) => {
    saveProviderApiKey(providerId, apiKey);
    return true;
  });

  ipcMain.handle("providers:deleteProviderApiKey", (_e, providerId: string) => {
    clearProviderApiKey(providerId);
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
    (_e, providerId: string, modelId: string, enabled: boolean) => {
      updateModelEnabled(providerId, modelId, enabled);
      return true;
    },
  );

  ipcMain.handle(
    "providers:setModelApiKey",
    (_e, providerId: string, modelId: string, apiKey: string) => {
      saveModelApiKey(providerId, modelId, apiKey);
      return true;
    },
  );

  ipcMain.handle("providers:deleteModelApiKey", (_e, providerId: string, modelId: string) => {
    clearModelApiKey(providerId, modelId);
    return true;
  });

  ipcMain.handle("providers:deleteCustomModel", (_e, providerId: string, modelId: string) => {
    deleteCustomModel(providerId, modelId);
    return true;
  });

  // ---------- Local server port ----------
  ipcMain.handle("server:port", () => getServerPort());
  ipcMain.handle("server:info", () => getServerInfo());

  // ---------- System information ----------
  ipcMain.handle("system:locale", () => app.getLocale());
  ipcMain.handle("system:version", () => app.getVersion());
}

/** 瀵煎嚭绫诲瀷渚?preload 浣跨敤 */
export type { Conversation, MessageRow };
