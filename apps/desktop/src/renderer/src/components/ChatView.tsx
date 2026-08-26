/**
 * ChatView
 *
 * 娓叉煋灞傦細鎶?浼氳瘽"鍜?娑堟伅"涓や欢浜嬩覆璧锋潵
 *
 * 鑱岃矗锛?
 *  - 鍔犺浇鍘嗗彶娑堟伅 -> 浜ょ粰 useChat
 *  - 鍙戦€侊細鎶婄敤鎴锋秷鎭啓鍏?DB锛坧re-save锛夊悗鍐?sendMessage
 *  - 娴佸紡缁撴潫 -> 鎶婃渶鏂板揩鐓у啓鍥?DB
 *  - 澶撮儴灞曠ず锛氬璇濈姸鎬佸窘绔狅紙娴佸紡 / 灏辩华 / 閿欒 / 鍋滄锛? 涓婁笅鏂囩敤閲?
 *  - 鏍囬鑷姩鐢熸垚锛氶娆?user + assistant 瀹屾暣鍑虹幇鍚庤皟鐢?/api/title
 *  - 娑堟伅鍔ㄤ綔锛圗dit / Resend / Delete锛夌敱鏈粍浠跺疄鐜帮紝浼犻€掔粰 MessageList
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { McpInputDialog } from "./McpWorkspace";
import { IconFolderOpen } from "./icons";
import { getModelReasoningDefault } from "./ReasoningSelector";
import { Button, LoadingIndicator } from "./ui";
import { api, type RuntimeSnapshot } from "../lib/api";
import {
  deriveFallbackConversationTitle,
  generateConversationTitleWithFallback,
  getConversationTitleExcerpt,
  getFirstUserMessageText,
  hasMeaningfulConversationTitle,
  persistConversationTitleWithRetry,
} from "../lib/conversation-title";
import { getChatErrorInfo, getChatErrorMessage } from "../lib/errors";
import { AgentStatusTrigger } from "./AgentStatusWidget";
import { openWorkspaceSidePanel, WorkspaceSidePanel } from "./WorkspaceSidePanel";
import {
  appendOrReplaceMessage,
  buildUserMessage,
  getLatestFollowupSuggestions,
  getAgentLearningQueueKey,
  hydrateStoredMessage,
  isNonEmptyUIMessage,
  normalizeFollowupSuggestions,
  prepareFailedChatSnapshot,
  toFileUIParts,
  updateFollowupSuggestions,
} from "../lib/chat-messages";
import {
  createSnapshotPersistenceQueue,
  mergeMessagePersistenceRequests,
  persistMessagesPatch,
  type MessagePersistenceRequest,
} from "../lib/chat-persistence";
import {
  mergeChatMessages,
  reconcileChatMessages,
  selectLiveChatMessages,
  shouldReconcileCompletedRun,
} from "../lib/chat-reconciliation";
import {
  isResumableBlockedRun,
  selectChatRetryRun,
  shouldFallbackToFreshRun,
} from "../lib/chat-retry";
import { chatSessionRegistry, type ChatSessionFinishEvent } from "../lib/chat-session-registry";
import { createIncrementalTokenCache } from "../lib/chat-token-cache";
import { notify } from "../lib/toast";
import { useT } from "../lib/i18n";
import { getConversationWorkspaceForHeader } from "../lib/conversation-workspace";
import { getEnabledSkillMentions, getSkillMentions } from "../lib/chat-tools";
import {
  ConversationStatus,
  PromptSuggestions,
  type ConversationStatusKind,
  type FilePartLike,
} from "./ai-elements";
import {
  CHAT_SESSION_HEADER,
  DEFAULT_CHAT_PERMISSION_MODE,
  DEFAULT_CHAT_TOOL_SELECTION,
  DEFAULT_SETTINGS,
  SettingKey,
  getChatPermissionForConversation,
  getChatToolSelectionForConversation,
  isChatReasoningLevel,
  clearChatPermissionForConversation,
  withChatPermissionForConversation,
  withChatToolSelectionForConversation,
  type ChatPermissionMode,
  type ChatReasoningLevel,
  type ChatToolSelectionRequest,
  type AgentProfile,
  type LocalServerInfo,
  type McpInputRequest,
  type ProviderInfo,
  type ToolsSnapshot,
} from "@shared/types";
import type { RevisionRef } from "../lib/chat-persistence";

interface ChatViewProps {
  conversationId: string;
  serverInfo: LocalServerInfo;
}

type AutoTitleStatus = "running" | "completed";

/**
 * 妯″瀷涓婁笅鏂囩獥鍙ｆ煡鎵撅紙绮楃暐锛夈€?
 *  - 閮ㄥ垎涓绘祦妯″瀷浠庡凡鐭ョ殑"鍘傚晢鎯緥"缁欓粯璁ゅ€?
 *  - 鎵句笉鍒板垯鍥炶惤鍒?32K
 */
const CONTEXT_WINDOW_BY_MODEL: Array<{ match: RegExp; tokens: number }> = [
  { match: /^gpt-4o-mini|^gpt-4o$|^chatgpt-4o/i, tokens: 128_000 },
  { match: /^gpt-4-turbo/i, tokens: 128_000 },
  { match: /^gpt-4\b|^gpt-4-32k/i, tokens: 8_192 },
  { match: /^gpt-3\.5-turbo/i, tokens: 16_385 },
  { match: /^o1-mini|^o1-preview|^o1/i, tokens: 128_000 },
  { match: /^claude-3/i, tokens: 200_000 },
  { match: /^gemini-1\.5-pro/i, tokens: 1_000_000 },
  { match: /^gemini-1\.5-flash/i, tokens: 1_000_000 },
  { match: /^gemini-1\.0|^gemini-pro/i, tokens: 32_000 },
  { match: /^deepseek-chat|^deepseek-reasoner/i, tokens: 64_000 },
  { match: /^qwen-max|^qwen-plus/i, tokens: 32_000 },
  { match: /^qwen-turbo|^qwen-long/i, tokens: 1_000_000 },
  { match: /^glm-4-plus|^glm-4-air/i, tokens: 128_000 },
];

const DEFAULT_CONTEXT_WINDOW = 32_000;

function getContextWindowForModel(
  modelRef: string | null | undefined,
  configuredContextWindow?: number,
): number {
  if (configuredContextWindow && Number.isFinite(configuredContextWindow)) {
    return configuredContextWindow;
  }
  if (!modelRef) return DEFAULT_CONTEXT_WINDOW;
  const id = modelRef.split("/").pop() ?? modelRef;
  for (const entry of CONTEXT_WINDOW_BY_MODEL) {
    if (entry.match.test(id)) return entry.tokens;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export function ChatView({ conversationId, serverInfo }: ChatViewProps): React.JSX.Element {
  const { t, locale } = useT();
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [reasoningLevel, setReasoningLevel] = useState<ChatReasoningLevel>(
    DEFAULT_SETTINGS.chatReasoningLevel,
  );
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [isPersistedConversation, setIsPersistedConversation] = useState(false);
  const [workspace, setWorkspace] = useState<import("@shared/types").WorkspaceInfo | null>(null);
  const [hydrationState, setHydrationState] = useState<"loading" | "ready" | "error">("loading");
  const [hydrationRetry, setHydrationRetry] = useState(0);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatErrorRetryable, setChatErrorRetryable] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [toolsSnapshot, setToolsSnapshot] = useState<ToolsSnapshot | null>(null);
  const skillMentionCatalog = useMemo(() => getSkillMentions(toolsSnapshot), [toolsSnapshot]);
  const enabledSkillMentions = useMemo(
    () => getEnabledSkillMentions(toolsSnapshot),
    [toolsSnapshot],
  );
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<Pick<
    RuntimeSnapshot,
    | "runtimeRuns"
    | "runtimeSteps"
    | "agentRuntimeStates"
    | "conversationAgentStates"
    | "agentInstances"
    | "agentRunInputs"
    | "runtimeEvents"
    | "sandboxSessions"
    | "sandboxSnapshots"
    | "sandboxArtifacts"
  > | null>(null);
  const [modelContextWindows, setModelContextWindows] = useState<Map<string, number>>(new Map());
  const [toolSelection, setToolSelection] = useState<ChatToolSelectionRequest>(
    DEFAULT_CHAT_TOOL_SELECTION,
  );
  const [permissionMode, setPermissionMode] = useState<ChatPermissionMode>(
    DEFAULT_CHAT_PERMISSION_MODE,
  );
  const [permissionSource, setPermissionSource] = useState<"default" | "conversation">("default");
  const [mcpInputRequest, setMcpInputRequest] = useState<McpInputRequest | null>(null);
  /** 鏄惁宸蹭负鏈璇濈敓鎴愯繃鏍囬锛堥槻姝㈤噸澶嶇敓鎴愶級 */
  const titleStateRef = useRef<Map<string, AutoTitleStatus>>(new Map());
  const createdAtRef = useRef<Map<string, number>>(new Map());
  const selectedModelRef = useRef<string | null>(null);
  const reasoningLevelRef = useRef<ChatReasoningLevel>(DEFAULT_SETTINGS.chatReasoningLevel);
  const reasoningModelKeyRef = useRef<string | null>(null);
  const toolSelectionRef = useRef<ChatToolSelectionRequest>(DEFAULT_CHAT_TOOL_SELECTION);
  const latestMessagesRef = useRef<UIMessage[]>([]);
  const lastNonEmptyMessagesRef = useRef<UIMessage[]>([]);
  const explicitEmptyMessagesRef = useRef(false);
  const manualMessageMutationRef = useRef(false);
  const hydrationAppliedRef = useRef<string | null>(null);
  const hydrationStateRef = useRef<"loading" | "ready" | "error">("loading");
  const revisionRef = useRef<RevisionRef>({ current: 0, persisted: new Map() });
  const persistenceDirtyRef = useRef(false);
  const learningQueueKeyRef = useRef<string | null>(null);
  const chatFailureRef = useRef(false);
  const errorReportedRef = useRef(false);
  const retryFallbackRef = useRef({ active: false, attempted: false });
  const followupRequestRef = useRef<string | null>(null);
  const tokenCacheRef = useRef(createIncrementalTokenCache());
  const session = chatSessionRegistry.getOrCreate({ conversationId, serverInfo });
  const runIdRef = session.runIdRef;
  const runModeRef = session.runModeRef;
  const reconciliationRef = session.reconciliationRef;
  const chatRef = useRef<{
    regenerate: () => Promise<void>;
    clearError: () => void;
    setMessages: (messages: UIMessage[]) => void;
  } | null>(null);
  const persistenceQueue = useMemo(
    () =>
      createSnapshotPersistenceQueue<MessagePersistenceRequest>(
        async (request) => {
          await persistMessagesPatch(
            conversationId,
            request,
            createdAtRef.current,
            revisionRef.current,
          );
          await api.conversations.touch(conversationId);
          persistenceDirtyRef.current = false;
        },
        (error) => console.error("[chat] failed to persist streaming snapshot:", error),
        mergeMessagePersistenceRequests,
      ),
    [conversationId],
  );
  const [starterSuggestions, setStarterSuggestions] = useState<string[]>([]);
  const [starterLoading, setStarterLoading] = useState<boolean>(true);

  /** 异步生成「新建对话」的开场建议（随机） */
  const fetchStarterSuggestions = useCallback(async (): Promise<void> => {
    setStarterLoading(true);
    try {
      const settings = await api.settings.getAll([SettingKey.SelectedModel]);
      const model = settings[SettingKey.SelectedModel];
      if (!model) {
        setStarterLoading(false);
        return;
      }
      const info = await api.server.info();
      const res = await fetch(`http://127.0.0.1:${info.port}/api/suggestions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CHAT_SESSION_HEADER]: info.token,
        },
        body: JSON.stringify({ model, locale }),
      });
      if (!res.ok) {
        setStarterLoading(false);
        return;
      }
      const data = (await res.json()) as { suggestions?: string[] };
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setStarterSuggestions(data.suggestions);
      }
      setStarterLoading(false);
    } catch (err) {
      console.error("[chat] fetch starter suggestions error:", err);
      setStarterLoading(false);
    }
  }, [locale]);

  /**
   * 上报一次聊天错误：写入 chatError、记录 console、统一弹 toast，并按需持久化。
   * - persistSnapshot: 同时把"出错时的快照"持久化（出错一般也意味着 transport 已部分刷新）
   * - toastKey: 默认 "toast.chat.failed"；媒体相关失败用 "toast.media.failed"
   */
  const reportChatError = useCallback(
    (
      source: string,
      err: unknown,
      opts: { persistSnapshot?: UIMessage[]; toastKey?: string } = {},
    ): void => {
      const info = getChatErrorInfo(err, locale);
      if (info.code === "cancelled" || errorReportedRef.current) return;
      errorReportedRef.current = true;
      chatFailureRef.current = true;
      session.errorMessage = info.message;
      session.errorRetryable = info.retryable;
      setChatError(info.message);
      setChatErrorRetryable(info.retryable);
      console.error(`[chat] ${source} failed:`, info.code, info.message);
      if (opts.persistSnapshot) {
        if (hydrationStateRef.current === "ready") {
          const snapshot = prepareFailedChatSnapshot(opts.persistSnapshot);
          persistenceDirtyRef.current = true;
          persistenceQueue.request(snapshot);
        }
      }
      notify.error(t(opts.toastKey ?? "toast.chat.failed"), info.message, locale);
    },
    [locale, persistenceQueue, session, t],
  );

  /**
   * 同步落盘消息快照并刷新会话 updated_at。
   * 行为等价于"先 persistMessagesSnapshot 后 conversations.touch"，用于消除两处 IPC 总是成对出现的样板代码。
   */
  const persistAndTouch = useCallback(
    async (messages: UIMessage[], deleteIds: string[] = []): Promise<boolean> => {
      if (hydrationStateRef.current !== "ready") return false;
      persistenceDirtyRef.current = true;
      await persistenceQueue.flush({ messages, deleteIds });
      return true;
    },
    [persistenceQueue],
  );
  const persistInBackground = useCallback(
    (messages: UIMessage[], source: string, deleteIds: string[] = []): void => {
      void persistAndTouch(messages, deleteIds).catch((error) =>
        console.error(`[chat] failed to persist ${source}:`, error),
      );
    },
    [persistAndTouch],
  );

  /** 异步生成追问建议 */
  const fetchFollowupSuggestions = useCallback(async (messages: UIMessage[]): Promise<string[]> => {
    try {
      const settings = await api.settings.getAll([SettingKey.SelectedModel]);
      const model = settings[SettingKey.SelectedModel];
      if (!model) return [];
      const info = await api.server.info();
      if (messages.length < 2) return [];
      const res = await fetch(`http://127.0.0.1:${info.port}/api/followups`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [CHAT_SESSION_HEADER]: info.token,
        },
        body: JSON.stringify({ model, messages }),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { suggestions?: unknown };
      return normalizeFollowupSuggestions(data.suggestions);
    } catch (err) {
      console.error("[chat] fetch followup suggestions error:", err);
      return [];
    }
  }, []);

  useEffect(() => {
    void api.settings.get(SettingKey.SelectedModel).then((model) => {
      if (model) setSelectedModel(model);
    });
    void api.settings.get(SettingKey.ChatReasoningLevel).then((level) => {
      if (isChatReasoningLevel(level) && reasoningModelKeyRef.current === null) {
        setReasoningLevel(level);
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.providers.list().then((providerList: ProviderInfo[]) => {
      if (cancelled) return;
      setProviders(providerList);
      setModelContextWindows(
        new Map(
          providerList.flatMap((provider) =>
            provider.models.map(
              (model) => [`${provider.id}/${model.id}`, model.contextWindow] as const,
            ),
          ),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selectedModel]);

  useEffect(() => {
    let cancelled = false;
    const refreshToolsSnapshot = (): void => {
      void api.tools.snapshot().then(
        (snapshot) => {
          if (!cancelled) setToolsSnapshot(snapshot);
        },
        () => undefined,
      );
    };
    void Promise.allSettled([api.agents.list(), api.tools.snapshot()]).then(
      ([agentsResult, toolsResult]) => {
        if (cancelled) return;
        if (agentsResult.status === "fulfilled") setAgentProfiles(agentsResult.value);
        if (toolsResult.status === "fulfilled") setToolsSnapshot(toolsResult.value);
      },
    );
    const offSkills = api.tools.skills.onChanged(refreshToolsSnapshot);
    return () => {
      cancelled = true;
      offSkills();
    };
  }, []);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
    chatSessionRegistry.updateRequestConfig(conversationId, { model: selectedModel });
  }, [conversationId, selectedModel]);

  useEffect(() => {
    reasoningLevelRef.current = reasoningLevel;
    chatSessionRegistry.updateRequestConfig(conversationId, { reasoning: reasoningLevel });
  }, [conversationId, reasoningLevel]);

  useEffect(() => {
    if (!selectedModel || providers.length === 0) {
      if (!selectedModel) reasoningModelKeyRef.current = null;
      return;
    }
    const separator = selectedModel.indexOf("/");
    if (separator <= 0) return;
    const providerId = selectedModel.slice(0, separator);
    const modelId = selectedModel.slice(separator + 1);
    const model = providers
      .find((provider) => provider.id === providerId)
      ?.models.find((item) => item.id === modelId);
    if (!model) {
      reasoningModelKeyRef.current = null;
      return;
    }
    const modelKey = conversationId + ":" + selectedModel;
    if (reasoningModelKeyRef.current === modelKey) return;
    const nextLevel = getModelReasoningDefault(model);
    reasoningModelKeyRef.current = modelKey;
    reasoningLevelRef.current = nextLevel;
    setReasoningLevel(nextLevel);
  }, [conversationId, providers, selectedModel]);

  useEffect(() => {
    toolSelectionRef.current = toolSelection;
    chatSessionRegistry.updateRequestConfig(conversationId, { toolSelection });
  }, [conversationId, toolSelection]);

  useEffect(() => {
    chatSessionRegistry.updateRequestConfig(conversationId, { permissionMode });
  }, [conversationId, permissionMode]);

  useEffect(() => {
    const offInput = api.mcp.onInputRequested((request) => {
      if (request.conversationId === conversationId) setMcpInputRequest(request);
    });
    return offInput;
  }, [conversationId]);

  useEffect(() => {
    const alreadyHydrated = session.hydrated;
    setHydrationState("loading");
    hydrationStateRef.current = "loading";
    setIsPersistedConversation(false);
    setWorkspace(null);
    setChatError(alreadyHydrated ? session.errorMessage : null);
    setChatErrorRetryable(alreadyHydrated ? session.errorRetryable : false);
    setIsStopped(alreadyHydrated ? session.isStopped : false);
    if (!alreadyHydrated) {
      chatFailureRef.current = false;
      errorReportedRef.current = false;
      retryFallbackRef.current = { active: false, attempted: false };
    } else {
      errorReportedRef.current = session.errorMessage !== null;
    }
    followupRequestRef.current = null;
    setToolSelection(DEFAULT_CHAT_TOOL_SELECTION);
    setPermissionMode(DEFAULT_CHAT_PERMISSION_MODE);
    setPermissionSource("default");
    if (!alreadyHydrated) {
      runIdRef.current = null;
      runModeRef.current = "start";
      reconciliationRef.current = { runId: null, attempts: 0, timer: null };
      createdAtRef.current = new Map();
      revisionRef.current = { current: 0, persisted: new Map() };
      persistenceDirtyRef.current = false;
      latestMessagesRef.current = [];
      lastNonEmptyMessagesRef.current = [];
      explicitEmptyMessagesRef.current = false;
      manualMessageMutationRef.current = false;
    }
    hydrationAppliedRef.current = null;
    if (alreadyHydrated) {
      const cachedMessages = session.chat.messages;
      setInitialMessages(cachedMessages);
      latestMessagesRef.current = cachedMessages;
      lastNonEmptyMessagesRef.current = cachedMessages.length > 0 ? cachedMessages : [];
      explicitEmptyMessagesRef.current = cachedMessages.length === 0;
    }
    // 涓嶉噸缃?titledRef锛氫繚鐣欒法浼氳瘽璁板綍锛岄伩鍏嶉噸澶嶇敓鎴愶紙鍒囨崲鍥炲埌鏃у璇濅篃涓嶉噸鐢熸垚锛?

    let cancelled = false;
    let loadedConversationTitle: string | null = null;
    void api.conversations
      .get(conversationId)
      .then((conversation) => {
        if (cancelled) return null;
        if (!conversation) {
          latestMessagesRef.current = [];
          lastNonEmptyMessagesRef.current = [];
          explicitEmptyMessagesRef.current = true;
          setInitialMessages([]);
          setIsPersistedConversation(false);
          session.hydrated = true;
          setHydrationState("ready");
          hydrationStateRef.current = "ready";
          return null;
        }
        loadedConversationTitle = conversation.title;
        setIsPersistedConversation(true);
        void api.workspace.get(conversationId).then((nextWorkspace) => {
          if (!cancelled) setWorkspace(nextWorkspace);
        });
        return api.messages.list(conversationId);
      })
      .then((snapshot) => {
        if (!snapshot) return;
        if (cancelled) return;
        const rows = snapshot.messages;
        const hydratedMessages = rows.map(hydrateStoredMessage);
        const messages = hydratedMessages.filter(isNonEmptyUIMessage);
        createdAtRef.current = new Map(rows.map((row) => [row.id, row.created_at]));
        revisionRef.current.current = snapshot.revision;
        revisionRef.current.persisted = new Map(
          messages.map((message) => [message.id, { message, content: JSON.stringify(message) }]),
        );
        latestMessagesRef.current = messages;
        lastNonEmptyMessagesRef.current = messages.length > 0 ? messages : [];
        explicitEmptyMessagesRef.current = messages.length === 0;
        session.hydrated = true;
        setInitialMessages(messages);
        setHydrationState("ready");
        hydrationStateRef.current = "ready";
        // 濡傛灉鍘嗗彶涓凡缁忔湁鏍囬锛圖B 宸叉湁锛夛紝鏍囪涓哄凡鐢熸垚锛岄伩鍏嶅啀娆¤Е鍙?
        if (hasMeaningfulConversationTitle(loadedConversationTitle)) {
          titleStateRef.current.set(conversationId, "completed");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[chat] failed to load message history:", error);
        setChatError(getChatErrorMessage(error, locale));
        setHydrationState("error");
        hydrationStateRef.current = "error";
      });

    void Promise.all([
      api.settings.get(SettingKey.ChatTools),
      api.settings.get(SettingKey.ChatPermissions),
    ]).then(([toolSetting, permissionSetting]) => {
      if (cancelled) return;
      setToolSelection(getChatToolSelectionForConversation(toolSetting, conversationId));
      const permission = getChatPermissionForConversation(permissionSetting, conversationId);
      setPermissionMode(permission.mode);
      setPermissionSource(permission.source);
    });
    return () => {
      cancelled = true;
      followupRequestRef.current = null;
    };
  }, [conversationId, hydrationRetry, locale, persistenceQueue, session]);

  useEffect(() => {
    let cancelled = false;
    void api.sandboxArtifacts.list(conversationId).then((items) => {
      if (!cancelled && items.some((item) => item.kind === "html" || item.kind === "static")) {
        openWorkspaceSidePanel("generated-app");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const chat = useChat({ chat: session.chat, experimental_throttle: 50 });
  chatRef.current = chat;

  const handleChatFinish = useCallback(
    ({ messages, isError, isAbort }: ChatSessionFinishEvent): void => {
      if (messages.length > 0) {
        latestMessagesRef.current = messages;
        lastNonEmptyMessagesRef.current = messages;
        explicitEmptyMessagesRef.current = false;
      }
      if (!isError) {
        chatFailureRef.current = false;
        errorReportedRef.current = false;
        session.errorMessage = null;
        session.errorRetryable = false;
        setChatError(null);
        setChatErrorRetryable(false);
      }
      session.isStopped = false;
      setIsStopped(false);
      const learningKey = isAbort
        ? null
        : getAgentLearningQueueKey(conversationId, messages, isError);
      const shouldQueueLearning =
        learningKey != null && learningQueueKeyRef.current !== learningKey;
      if (shouldQueueLearning) learningQueueKeyRef.current = learningKey;
      const snapshot = isError ? prepareFailedChatSnapshot(messages) : { messages, deleteIds: [] };
      void persistAndTouch(snapshot.messages, snapshot.deleteIds)
        .then((persisted) => {
          if (!persisted && shouldQueueLearning && learningQueueKeyRef.current === learningKey) {
            learningQueueKeyRef.current = null;
          }
          return persisted && shouldQueueLearning
            ? api.agents.queueLearning(conversationId)
            : undefined;
        })
        .catch((err) => {
          if (shouldQueueLearning && learningQueueKeyRef.current === learningKey) {
            learningQueueKeyRef.current = null;
          }
          console.error("[chat] failed to persist messages or queue learning:", err);
        });

      if (!isError && !isAbort) tryAutoTitle(conversationId, messages, titleStateRef);
      if (!isError && !isAbort) {
        const assistantMessage = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (assistantMessage) {
          const requestKey = `${conversationId}:${assistantMessage.id}`;
          followupRequestRef.current = requestKey;
          void fetchFollowupSuggestions(messages).then((suggestions) => {
            if (followupRequestRef.current !== requestKey || suggestions.length === 0) return;
            const updatedMessages = updateFollowupSuggestions({
              messages: latestMessagesRef.current,
              messageId: assistantMessage.id,
              suggestions,
            });
            if (updatedMessages === latestMessagesRef.current) return;
            latestMessagesRef.current = updatedMessages;
            if (updatedMessages.length > 0) lastNonEmptyMessagesRef.current = updatedMessages;
            explicitEmptyMessagesRef.current = updatedMessages.length === 0;
            chatRef.current?.setMessages(updatedMessages);
            persistInBackground(updatedMessages, "follow-up suggestions");
          });
        }
      }
    },
    [conversationId, fetchFollowupSuggestions, persistAndTouch, persistInBackground, session],
  );

  const handleChatError = useCallback(
    (err: Error): void => {
      const info = getChatErrorInfo(err, locale);
      const retryFallback = retryFallbackRef.current;
      if (
        shouldFallbackToFreshRun(info.code, retryFallback.attempted) &&
        (retryFallback.active || runModeRef.current === "resume")
      ) {
        retryFallback.active = true;
        retryFallback.attempted = true;
        const freshRun = selectChatRetryRun({
          currentRunId: null,
          currentRun: null,
          newRunId: crypto.randomUUID(),
        });
        runIdRef.current = freshRun.runId;
        runModeRef.current = freshRun.mode;
        reconciliationRef.current = { runId: freshRun.runId, attempts: 0, timer: null };
        session.errorMessage = null;
        session.errorRetryable = false;
        setChatError(null);
        setChatErrorRetryable(false);
        chatFailureRef.current = false;
        errorReportedRef.current = false;
        queueMicrotask(() => {
          const currentChat = chatRef.current;
          if (!currentChat) {
            retryFallback.active = false;
            reportChatError("streaming", err, { persistSnapshot: latestMessagesRef.current });
            return;
          }
          currentChat.clearError();
          void currentChat
            .regenerate()
            .catch((fallbackError) => {
              reportChatError("retry", fallbackError, {
                persistSnapshot: latestMessagesRef.current,
              });
            })
            .finally(() => {
              retryFallback.active = false;
              persistInBackground(latestMessagesRef.current, "retried response");
            });
        });
        return;
      }
      retryFallback.active = false;
      reportChatError("streaming", err, { persistSnapshot: latestMessagesRef.current });
    },
    [locale, persistInBackground, reportChatError, session],
  );

  useEffect(() => {
    return chatSessionRegistry.subscribe(conversationId, (event) => {
      if (event.type === "finish") handleChatFinish(event.payload);
      else handleChatError(event.error);
    });
  }, [conversationId, handleChatError, handleChatFinish]);

  const isChatLoading = chat.status === "submitted" || chat.status === "streaming";
  const mergedChatMessages = isChatLoading
    ? null
    : mergeChatMessages(latestMessagesRef.current, chat.messages);
  const renderedMessages = isChatLoading
    ? selectLiveChatMessages(chat.messages, latestMessagesRef.current)
    : (mergedChatMessages ??
      (latestMessagesRef.current.length > 0
        ? latestMessagesRef.current
        : chat.messages.length > 0 || explicitEmptyMessagesRef.current
          ? chat.messages
          : lastNonEmptyMessagesRef.current));
  if (isChatLoading && renderedMessages.length > 0) {
    latestMessagesRef.current = renderedMessages;
    lastNonEmptyMessagesRef.current = renderedMessages;
    explicitEmptyMessagesRef.current = false;
  } else if (chat.messages.length > 0 && mergedChatMessages) {
    latestMessagesRef.current = mergedChatMessages;
    lastNonEmptyMessagesRef.current = mergedChatMessages;
    explicitEmptyMessagesRef.current = false;
  }
  const followupSuggestions =
    hydrationState === "ready" ? getLatestFollowupSuggestions(renderedMessages) : [];

  useEffect(() => {
    if (
      hydrationState !== "ready" ||
      hydrationAppliedRef.current === conversationId ||
      initialMessages.length === 0
    ) {
      if (hydrationState === "ready" && initialMessages.length === 0) {
        hydrationAppliedRef.current = conversationId;
      }
      return;
    }
    if (chat.messages.length === 0) {
      latestMessagesRef.current = initialMessages;
      lastNonEmptyMessagesRef.current = initialMessages;
      explicitEmptyMessagesRef.current = false;
      chat.setMessages(initialMessages);
    }
    hydrationAppliedRef.current = conversationId;
  }, [chat, conversationId, hydrationState, initialMessages]);

  const isChatLoadingRef = useRef(isChatLoading);
  isChatLoadingRef.current = isChatLoading;
  const isLoading = isChatLoading;
  const hasActivePersistedRun = !!runtimeSnapshot?.runtimeRuns.some(
    (item) =>
      item.conversation_id === conversationId &&
      ["queued", "running", "waiting_approval", "waiting_handoff"].includes(item.status),
  );
  const isAgentRunActive = isChatLoading || hasActivePersistedRun;
  const shouldPollRuntime = isLoading || hasActivePersistedRun;

  const { setMessages: setChatMessages, stop: stopChat } = chat;
  const reconcileCompletedRun = useCallback(
    (runId: string): void => {
      if (manualMessageMutationRef.current) return;
      const state = reconciliationRef.current;
      if (state.runId !== runId) {
        if (state.timer !== null) window.clearTimeout(state.timer);
        state.runId = runId;
        state.attempts = 0;
        state.timer = null;
      }
      if (state.attempts >= 2 || state.timer !== null) return;

      const delay = state.attempts === 0 ? 350 : 1_000;
      state.attempts += 1;
      state.timer = window.setTimeout(() => {
        state.timer = null;
        void api.messages
          .list(conversationId)
          .then((snapshot) => {
            const persistedMessages = snapshot.messages
              .map(hydrateStoredMessage)
              .filter(isNonEmptyUIMessage);
            const reconciled = reconcileChatMessages(latestMessagesRef.current, persistedMessages);
            if (!reconciled || !isChatLoadingRef.current) return;

            latestMessagesRef.current = reconciled;
            if (reconciled.length > 0) lastNonEmptyMessagesRef.current = reconciled;
            explicitEmptyMessagesRef.current = reconciled.length === 0;
            setChatMessages(reconciled);
            void stopChat().catch((error) => {
              console.error("[chat] failed to finish reconciled stream:", error);
            });
          })
          .catch((error) => console.error("[chat] failed to reconcile completed run:", error));
      }, delay);
    },
    [conversationId, setChatMessages, stopChat],
  );

  useEffect(() => {
    if (hydrationState !== "ready" || !isChatLoading) return;
    const persistLatest = (): void => {
      persistenceDirtyRef.current = true;
      const snapshot = chatFailureRef.current
        ? prepareFailedChatSnapshot(latestMessagesRef.current)
        : { messages: latestMessagesRef.current, deleteIds: [] };
      persistenceQueue.request(snapshot);
    };
    persistLatest();
    const id = window.setInterval(persistLatest, 750);
    return () => {
      window.clearInterval(id);
      const snapshot = chatFailureRef.current
        ? prepareFailedChatSnapshot(latestMessagesRef.current)
        : { messages: latestMessagesRef.current, deleteIds: [] };
      void persistenceQueue
        .flush(snapshot)
        .catch((error) => console.error("[chat] failed to flush streaming snapshot:", error));
    };
  }, [hydrationState, isChatLoading, persistenceQueue]);

  useEffect(
    () => () => {
      if (hydrationStateRef.current !== "ready" || !persistenceDirtyRef.current) return;
      const snapshot = chatFailureRef.current
        ? prepareFailedChatSnapshot(latestMessagesRef.current)
        : { messages: latestMessagesRef.current, deleteIds: [] };
      void persistenceQueue
        .flush(snapshot)
        .catch((error) => console.error("[chat] failed to flush final snapshot:", error));
    },
    [persistenceQueue],
  );

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api.agents.runtimeSnapshot().then((snapshot) => {
        if (!cancelled) {
          setRuntimeSnapshot(snapshot);
          const activeRun = snapshot.runtimeRuns
            .filter(
              (item) =>
                item.conversation_id === conversationId &&
                ["queued", "running", "waiting_approval", "waiting_handoff"].includes(item.status),
            )
            .sort((a, b) => b.started_at - a.started_at)[0];
          if (activeRun) {
            runIdRef.current = activeRun.id;
            runModeRef.current = "resume";
          }

          const trackedRunId = runIdRef.current;
          const trackedRun = trackedRunId
            ? snapshot.runtimeRuns.find(
                (item) => item.id === trackedRunId && item.conversation_id === conversationId,
              )
            : undefined;
          if (
            trackedRun &&
            shouldReconcileCompletedRun({
              trackedRunId,
              runId: trackedRun.id,
              conversationId,
              runConversationId: trackedRun.conversation_id,
              isChatLoading: isChatLoadingRef.current,
              status: trackedRun.status,
            })
          ) {
            reconcileCompletedRun(trackedRun.id);
          }
        }
      });
    };
    load();
    if (!shouldPollRuntime) {
      return () => {
        cancelled = true;
        if (reconciliationRef.current.timer !== null) {
          window.clearTimeout(reconciliationRef.current.timer);
          reconciliationRef.current.timer = null;
        }
      };
    }
    const id = window.setInterval(load, 1_200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (reconciliationRef.current.timer !== null) {
        window.clearTimeout(reconciliationRef.current.timer);
        reconciliationRef.current.timer = null;
      }
    };
  }, [conversationId, reconcileCompletedRun, shouldPollRuntime]);

  /* ---------- 新建对话开场建议（随机生成） ---------- */
  const starterFetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (renderedMessages.length === 0 && !isLoading) {
      if (starterFetchedForRef.current === conversationId) return;
      starterFetchedForRef.current = conversationId;
      void fetchStarterSuggestions();
    }
  }, [conversationId, renderedMessages.length, isLoading, fetchStarterSuggestions]);

  /* ---------- 鐘舵€佹槧灏?---------- */
  const statusKind: ConversationStatusKind = chat.error
    ? "error"
    : isChatLoading
      ? chat.status === "submitted"
        ? "submitted"
        : "streaming"
      : isStopped
        ? "stopped"
        : "ready";

  /* ---------- Context usage ---------- */
  const contextMetrics = useMemo(() => {
    const usedTokens = tokenCacheRef.current.estimate(renderedMessages);
    const maxTokens = getContextWindowForModel(
      selectedModel,
      selectedModel ? modelContextWindows.get(selectedModel) : undefined,
    );
    return { usedTokens, maxTokens, costUsd: undefined as number | undefined };
  }, [renderedMessages, modelContextWindows, selectedModel]);

  /* ---------- 鍙戦€?---------- */
  const handleSend = async ({
    text,
    files,
  }: {
    text: string;
    files: FilePartLike[];
  }): Promise<void> => {
    let finalFiles = toFileUIParts(files);

    if (!selectedModel) return;

    const wasTemporary = !isPersistedConversation;
    try {
      if (wasTemporary) {
        const prepared = await api.workspace.prepare(conversationId, t("shell.newConversation"));
        setWorkspace(prepared);
      } else {
        const workspace = await api.workspace.get(conversationId);
        if (!workspace) setWorkspace(await api.workspace.prepare(conversationId));
      }
      const dataFiles = finalFiles.filter((file) => file.url.startsWith("data:"));
      if (dataFiles.length > 0) {
        const refs = await api.workspace.saveAttachments({
          conversationId,
          attachments: dataFiles.map((file) => ({
            filename: file.filename,
            mediaType: file.mediaType,
            dataUrl: file.url,
          })),
        });
        let refIndex = 0;
        finalFiles = finalFiles.map((file) =>
          file.url.startsWith("data:")
            ? { ...file, url: `workspace://${refs[refIndex++]?.path}` }
            : file,
        );
      }
    } catch (error) {
      if (wasTemporary) await api.workspace.rollback(conversationId).catch(() => undefined);
      reportChatError("prepare workspace", error);
      return;
    }

    const messageId = crypto.randomUUID();
    let userMessage: UIMessage;

    try {
      userMessage = buildUserMessage({ id: messageId, text, files: finalFiles });
    } catch {
      if (wasTemporary) await api.workspace.rollback(conversationId).catch(() => undefined);
      return;
    }
    setChatError(null);
    setChatErrorRetryable(false);
    session.errorMessage = null;
    session.errorRetryable = false;
    session.isStopped = false;
    setIsStopped(false);
    manualMessageMutationRef.current = false;
    chatFailureRef.current = false;
    errorReportedRef.current = false;
    chat.clearError();

    const pendingMessages = appendOrReplaceMessage(latestMessagesRef.current, userMessage);
    const activeRunId = runIdRef.current;
    const activeRuntimeRun = activeRunId
      ? runtimeSnapshot?.runtimeRuns.some(
          (item) =>
            item.id === activeRunId &&
            ["queued", "running", "waiting_approval", "waiting_handoff"].includes(item.status),
        )
      : false;
    const blockedRun = activeRunId
      ? runtimeSnapshot?.runtimeRuns.find(
          (item) => item.id === activeRunId && item.status === "blocked",
        )
      : undefined;
    if (blockedRun) {
      if (!isResumableBlockedRun(blockedRun)) {
        reportChatError(
          "resume blocked run",
          new Error(blockedRun.error ?? "Agent run is blocked."),
        );
        return;
      }
    }
    if (activeRunId && (isChatLoading || activeRuntimeRun || !!blockedRun)) {
      runModeRef.current = blockedRun ? "resume" : runModeRef.current;
      void api.runtime
        .enqueueInput({
          runId: activeRunId,
          kind: "steering",
          source: "user",
          message: userMessage,
        })
        .then(() => {
          chat.setMessages(pendingMessages);
          latestMessagesRef.current = pendingMessages;
          persistInBackground(pendingMessages, "steering input");
        })
        .catch(async (err) => {
          const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
          runIdRef.current = null;
          runModeRef.current = "start";
          if (code === "run_not_active" || code === "run_not_found") {
            latestMessagesRef.current = pendingMessages;
            void persistAndTouch(pendingMessages);
            await chat.sendMessage({ ...userMessage, messageId: userMessage.id });
            return;
          }
          reportChatError("send", err, { persistSnapshot: pendingMessages });
        });
      return;
    }
    runIdRef.current = crypto.randomUUID();
    runModeRef.current = "start";
    reconciliationRef.current = { runId: runIdRef.current, attempts: 0, timer: null };
    latestMessagesRef.current = pendingMessages;
    try {
      const persisted = await persistAndTouch(pendingMessages);
      if (!persisted) throw new Error("Conversation is not ready to save messages.");
    } catch (err) {
      runIdRef.current = null;
      runModeRef.current = "start";
      reconciliationRef.current = { runId: null, attempts: 0, timer: null };
      if (wasTemporary) {
        await api.workspace.rollback(conversationId).catch(() => undefined);
        setIsPersistedConversation(false);
        setWorkspace(null);
      }
      reportChatError("save user message", err);
      return;
    }
    if (wasTemporary) setIsPersistedConversation(true);
    void chat.sendMessage(userMessage).catch((err) => {
      reportChatError("send", err, { persistSnapshot: pendingMessages });
    });
  };

  const handleStop = (): void => {
    const runId = runIdRef.current;
    void Promise.allSettled([
      chat.stop(),
      runId ? api.runtime.cancelRun(runId) : Promise.resolve(false),
    ])
      .then(() => api.agents.runtimeSnapshot())
      .then((snapshot) => setRuntimeSnapshot(snapshot))
      .catch((error) => console.error("[chat] failed to refresh stopped runtime:", error))
      .finally(() => {
        runIdRef.current = null;
        runModeRef.current = "start";
        session.isStopped = true;
        setIsStopped(true);
        persistInBackground(latestMessagesRef.current, "stopped response");
      });
  };

  const handleRetry = (): void => {
    if (!chatErrorRetryable) return;
    const snapshot = prepareFailedChatSnapshot(renderedMessages);
    const currentRunId = runIdRef.current;
    const currentRun = currentRunId
      ? runtimeSnapshot?.runtimeRuns.find(
          (item) => item.id === currentRunId && item.conversation_id === conversationId,
        )
      : undefined;
    const retryRun = selectChatRetryRun({
      currentRunId,
      currentRun,
      newRunId: crypto.randomUUID(),
    });
    runIdRef.current = retryRun.runId;
    runModeRef.current = retryRun.mode;
    reconciliationRef.current = { runId: retryRun.runId, attempts: 0, timer: null };
    retryFallbackRef.current = { active: true, attempted: false };
    manualMessageMutationRef.current = true;
    chat.setMessages(snapshot.messages);
    latestMessagesRef.current = snapshot.messages;
    if (snapshot.messages.length > 0) lastNonEmptyMessagesRef.current = snapshot.messages;
    explicitEmptyMessagesRef.current = snapshot.messages.length === 0;
    persistInBackground(snapshot.messages, "cleared failed response", snapshot.deleteIds);
    setChatError(null);
    setChatErrorRetryable(false);
    session.errorMessage = null;
    session.errorRetryable = false;
    session.isStopped = false;
    setIsStopped(false);
    chatFailureRef.current = false;
    errorReportedRef.current = false;
    chat.clearError();
    void chat.regenerate().catch((err) => {
      retryFallbackRef.current.active = false;
      reportChatError("retry", err, { persistSnapshot: latestMessagesRef.current });
    });
  };

  const handleDismissError = (): void => {
    setChatError(null);
    setChatErrorRetryable(false);
    session.errorMessage = null;
    session.errorRetryable = false;
    session.isStopped = false;
    setIsStopped(false);
    chat.clearError();
  };

  const handleSuggestion = (suggestion: string): void => {
    if (!selectedModel) {
      notify.error(t("input.noModel"));
      return;
    }
    void handleSend({ text: suggestion, files: [] });
  };

  const handleToolSelectionChange = (next: ChatToolSelectionRequest): void => {
    setToolSelection(next);
    toolSelectionRef.current = next;
    chatSessionRegistry.updateRequestConfig(conversationId, { toolSelection: next });
    void api.settings
      .get(SettingKey.ChatTools)
      .then((raw) =>
        api.settings.set(
          SettingKey.ChatTools,
          JSON.stringify(withChatToolSelectionForConversation(raw, conversationId, next)),
        ),
      )
      .catch((err) => console.error("[chat] failed to persist tool selection:", err));
  };

  const handlePermissionChange = (next: ChatPermissionMode): void => {
    setPermissionMode(next);
    setPermissionSource("conversation");
    chatSessionRegistry.updateRequestConfig(conversationId, { permissionMode: next });
    void api.settings
      .get(SettingKey.ChatPermissions)
      .then((raw) =>
        api.settings.set(
          SettingKey.ChatPermissions,
          JSON.stringify(withChatPermissionForConversation(raw, conversationId, next)),
        ),
      )
      .catch((err) => console.error("[chat] failed to persist permission mode:", err));
  };

  const handlePermissionReset = (): void => {
    void api.settings
      .get(SettingKey.ChatPermissions)
      .then((raw) => {
        const nextSetting = clearChatPermissionForConversation(raw, conversationId);
        const next = getChatPermissionForConversation(JSON.stringify(nextSetting), conversationId);
        setPermissionMode(next.mode);
        setPermissionSource(next.source);
        chatSessionRegistry.updateRequestConfig(conversationId, { permissionMode: next.mode });
        return api.settings.set(SettingKey.ChatPermissions, JSON.stringify(nextSetting));
      })
      .catch((err) => console.error("[chat] failed to reset permission mode:", err));
  };

  /* ---------- 消息操作：编辑 ---------- */
  const handleEditMessage = async (messageId: string, newText: string): Promise<void> => {
    const idx = renderedMessages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = renderedMessages[idx];
    if (target.role !== "user") return;
    manualMessageMutationRef.current = true;

    // 1. 鎵惧埌璇?user 娑堟伅锛屾浛鎹?text part锛屽垹闄ゅ悗缁墍鏈夋秷鎭?
    const updated: UIMessage = {
      ...target,
      parts: [
        { type: "text", text: newText },
        ...(target.parts ?? []).filter((p) => p.type !== "text"),
      ],
    };
    const nextMessages = [...renderedMessages.slice(0, idx), updated];
    chat.setMessages(nextMessages);
    latestMessagesRef.current = nextMessages;
    if (nextMessages.length > 0) lastNonEmptyMessagesRef.current = nextMessages;
    explicitEmptyMessagesRef.current = nextMessages.length === 0;
    createdAtRef.current.delete(messageId);

    // 2. 鎸佷箙鍖栨柊蹇収锛堝垹闄ゅ悗缁秷鎭級
    persistInBackground(
      nextMessages,
      "edited message",
      renderedMessages.slice(idx + 1).map((message) => message.id),
    );
    session.errorMessage = null;
    session.errorRetryable = false;
    session.isStopped = false;
    setIsStopped(false);
    setChatError(null);
    chat.clearError();

    // 3. 瑙﹀彂閲嶆柊鐢熸垚
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      reportChatError("edit regenerate", err);
    }
  };

  /* ---------- 娑堟伅鍔ㄤ綔锛氶噸鏂板彂閫?---------- */
  const handleResendMessage = async (messageId: string): Promise<void> => {
    const idx = renderedMessages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = renderedMessages[idx];
    if (target.role !== "user") return;
    manualMessageMutationRef.current = true;

    // 1. 鎴柇鍒拌 user 娑堟伅
    const nextMessages = renderedMessages.slice(0, idx + 1);
    chat.setMessages(nextMessages);
    latestMessagesRef.current = nextMessages;
    if (nextMessages.length > 0) lastNonEmptyMessagesRef.current = nextMessages;
    explicitEmptyMessagesRef.current = nextMessages.length === 0;
    session.errorMessage = null;
    session.errorRetryable = false;
    session.isStopped = false;
    setIsStopped(false);
    setChatError(null);
    chat.clearError();

    // 2. 鎸佷箙鍖栵紙鍒犻櫎鍚庣画娑堟伅锛?
    persistInBackground(
      nextMessages,
      "resent message",
      renderedMessages.slice(idx + 1).map((message) => message.id),
    );

    // 3. 瑙﹀彂閲嶆柊鐢熸垚
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      reportChatError("resend", err);
    }
  };

  /* ---------- 娑堟伅鍔ㄤ綔锛氬垹闄?---------- */
  const handleDeleteMessage = (messageId: string): void => {
    const idx = renderedMessages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = renderedMessages[idx];
    const confirmed = window.confirm(t("msg.delete.confirm"));
    if (!confirmed) return;
    manualMessageMutationRef.current = true;

    // 1. 鍒犻櫎鐩爣 + 濡傛灉鐩爣鏄?user 娑堟伅锛岀揣璺熺殑 assistant 涔熶竴骞跺垹闄?
    const next = [...renderedMessages];
    const deletedIds = [target.id];
    next.splice(idx, 1);
    if (target.role === "user" && next[idx]?.role === "assistant") {
      const [assistant] = next.splice(idx, 1);
      if (assistant) deletedIds.push(assistant.id);
    }
    chat.setMessages(next);
    latestMessagesRef.current = next;
    if (next.length > 0) lastNonEmptyMessagesRef.current = next;
    explicitEmptyMessagesRef.current = next.length === 0;
    createdAtRef.current.delete(messageId);
    if (next[idx - 1]?.role === "user") {
      // 鍚屾鍒犻櫎鍙兘瀛樺湪鐨?createdAt
    }

    // 2. 鎸佷箙鍖栵紙鐩爣娑堟伅涓庡彲鑳界殑 assistant 鍚屾浠?DB 涓垹闄わ級
    persistInBackground(next, "message deletion", deletedIds);
    notify.success(t("chat.messageDeleted"));
  };

  const hydrationIsStale =
    hydrationState === "ready" &&
    !session.hydrated &&
    hydrationAppliedRef.current !== conversationId;
  if (hydrationState === "loading" || hydrationIsStale) {
    return <LoadingIndicator className="flex flex-1" label={t("chat.loadingHistory")} />;
  }

  if (hydrationState === "error") {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center" role="alert">
          <h2 className="text-base font-semibold">{t("chat.historyLoadFailed")}</h2>
          <p className="text-sm text-muted-foreground">{chatError}</p>
          <Button
            size="sm"
            onClick={() => {
              setChatError(null);
              setHydrationRetry((value) => value + 1);
            }}
          >
            {t("chat.retryHistory")}
          </Button>
        </div>
      </div>
    );
  }

  const isEmpty = renderedMessages.length === 0 && !isLoading;
  const renderAgentStatusWidget = () => (
    <AgentStatusTrigger
      conversationId={conversationId}
      snapshot={runtimeSnapshot}
      profiles={agentProfiles}
      providers={providers}
      selectedModel={selectedModel}
      reasoningLevel={reasoningLevel}
      toolSelection={toolSelection}
      tools={toolsSnapshot}
      chatStatus={statusKind}
      isChatActive={isChatLoading}
      onOpenChange={() => openWorkspaceSidePanel("runtime")}
      onStop={handleStop}
    />
  );

  return (
    <div data-page="chat-page" className="relative flex min-w-0 flex-1 overflow-hidden">
      <div data-slot="chat-surface" className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          status={statusKind}
          workspace={getConversationWorkspaceForHeader(workspace, conversationId)}
          agentStatus={renderAgentStatusWidget()}
        />

        <div className="relative flex min-h-0 flex-1">
          <main
            data-slot="chat-main"
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
          >
            {isEmpty ? (
              <EmptyState
                title={t("chat.empty.title")}
                subtitle={t("chat.empty.subtitle")}
                suggestions={starterSuggestions}
                loading={starterLoading}
                onSuggestion={handleSuggestion}
              />
            ) : (
              <MessageList
                key={conversationId}
                conversationId={conversationId}
                messages={renderedMessages}
                skillMentions={skillMentionCatalog}
                isLoading={isLoading}
                status={statusKind}
                error={chat.error}
                errorDetail={chatError}
                emptySuggestions={starterSuggestions}
                followupSuggestions={followupSuggestions}
                onRetry={chatErrorRetryable ? handleRetry : undefined}
                onDismissError={handleDismissError}
                onEditMessage={handleEditMessage}
                onResendMessage={handleResendMessage}
                onDeleteMessage={handleDeleteMessage}
                onToolApprovalResponse={chat.addToolApprovalResponse}
                onSuggestion={handleSuggestion}
              />
            )}

            <MessageInput
              conversationId={conversationId}
              isLoading={isLoading}
              isRunActive={isAgentRunActive}
              onSend={handleSend}
              onStop={isAgentRunActive ? handleStop : undefined}
              selectedModel={selectedModel}
              reasoningLevel={reasoningLevel}
              onModelChange={setSelectedModel}
              onReasoningLevelChange={setReasoningLevel}
              toolSelection={toolSelection}
              onToolSelectionChange={handleToolSelectionChange}
              permissionMode={permissionMode}
              permissionInherited={permissionSource === "default"}
              onPermissionChange={handlePermissionChange}
              onPermissionReset={handlePermissionReset}
              providers={providers}
              mentionSkills={enabledSkillMentions}
              contextMetrics={contextMetrics}
            />
          </main>
        </div>
      </div>

      <WorkspaceSidePanel
        conversationId={conversationId}
        snapshot={runtimeSnapshot}
        profiles={agentProfiles}
        providers={providers}
        selectedModel={selectedModel}
        reasoningLevel={reasoningLevel}
        toolSelection={toolSelection}
        tools={toolsSnapshot}
        chatStatus={statusKind}
        isChatActive={isChatLoading}
        onStop={handleStop}
      />
      <McpInputDialog request={mcpInputRequest} onClose={() => setMcpInputRequest(null)} />
    </div>
  );
}

/* ---------- 澶撮儴 ---------- */

interface ChatHeaderProps {
  status: ConversationStatusKind;
  workspace: import("@shared/types").WorkspaceInfo | null;
  agentStatus: React.ReactNode;
}

/**
 * 澶撮儴鍙睍绀?瀵硅瘽鍚?+ 鐘舵€佸窘绔?锛涗笂涓嬫枃鐢ㄩ噺宸茶縼鑷宠緭鍏ユ鐨?ContextPopover銆?
 */
function ChatHeader({ status, workspace, agentStatus }: ChatHeaderProps): React.JSX.Element {
  const { t } = useT();
  return (
    <header
      className="relative z-30 flex shrink-0 select-none items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-6"
      data-streaming={status === "streaming" || status === "submitted"}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:min-h-9">
        <span
          className="flex size-2 shrink-0 rounded-full bg-success/80 ring-2 ring-success/20"
          aria-hidden
        />
        <h1 className="shrink-0 text-sm font-medium text-foreground">{t("chat.header.title")}</h1>
        <ConversationStatus status={status} />
        {workspace ? (
          <Button
            variant="tertiary"
            size="sm"
            className="ml-1 max-w-64 truncate text-xs"
            onPress={() => void api.workspace.open(workspace.conversationId)}
            aria-label={t("workspace.open")}
          >
            <IconFolderOpen data-icon="inline-start" />
            {workspace.relativePath}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t("workspace.notCreated")}</span>
        )}
      </div>
      {agentStatus ? <div className="-mr-2 shrink-0 sm:-mr-3">{agentStatus}</div> : null}
    </header>
  );
}

/* ---------- 鎸佷箙鍖?---------- */

/* ---------- 鑷姩鏍囬鐢熸垚 ---------- */

/**
 * 褰撴湰杞?user + assistant 瀹屾暣鍑虹幉鍚庯紝璋冪敤 /api/title 鐢熸垚鏍囬
 *  - 浠呴娆★紙宸茬敓鎴愯繃鐨勫璇濅笉鍐嶇敓鎴愶級
 *  - 镓惧埌绗竴𨱒?user 娑堟伅鍙婂叾钖庨潬镄勭涓€𨱒?assistant 娑堟伅浣滀负鎹?锛?
 *    涓嶅己姘旗被鍨嬩綅缃纸鍏铡嗗彶/绯荤粺娑堟伅鍓|銆佹。搴忓彉鍖栵级锛岃€屼笉鏄镆?messages[0]/messages[1]銆?
 */
function tryAutoTitle(
  conversationId: string,
  messages: UIMessage[],
  titleStateRef: React.MutableRefObject<Map<string, AutoTitleStatus>>,
): void {
  const currentStatus = titleStateRef.current.get(conversationId);
  if (currentStatus === "running" || currentStatus === "completed") return;
  const excerpt = getConversationTitleExcerpt(messages);
  if (excerpt.length === 0 || !getFirstUserMessageText(excerpt)) return;

  titleStateRef.current.set(conversationId, "running");
  void (async () => {
    try {
      const existing = await api.conversations.get(conversationId);
      if (hasMeaningfulConversationTitle(existing?.title)) {
        titleStateRef.current.set(conversationId, "completed");
        return;
      }

      let serverInfo: LocalServerInfo | null = null;
      const title = await generateConversationTitleWithFallback({
        messages,
        generate: async (titleExcerpt) => {
          serverInfo ??= await api.server.info();
          return fetchTitle(serverInfo, titleExcerpt);
        },
      });
      if (!title) {
        titleStateRef.current.delete(conversationId);
        return;
      }

      let persistResult = await persistConversationTitle(conversationId, title);
      if (persistResult.status === "existing") {
        titleStateRef.current.set(conversationId, "completed");
        return;
      }
      if (persistResult.status === "failed") {
        const fallback = deriveFallbackConversationTitle(messages);
        if (!fallback || fallback === title) {
          titleStateRef.current.delete(conversationId);
          return;
        }
        persistResult = await persistConversationTitle(conversationId, fallback);
        if (persistResult.status === "existing") {
          titleStateRef.current.set(conversationId, "completed");
          return;
        }
        if (persistResult.status === "failed") {
          titleStateRef.current.delete(conversationId);
          return;
        }
      }

      titleStateRef.current.set(conversationId, "completed");
      window.dispatchEvent(
        new CustomEvent("ayaka:conversation-renamed", {
          detail: { id: conversationId, title: persistResult.title },
        }),
      );
    } catch (error) {
      console.error("[chat] auto title failed:", error);
      titleStateRef.current.delete(conversationId);
    }
  })();
}

async function persistConversationTitle(
  conversationId: string,
  title: string,
): ReturnType<typeof persistConversationTitleWithRetry> {
  return persistConversationTitleWithRetry({
    title,
    readCurrentTitle: async () => (await api.conversations.get(conversationId))?.title,
    writeTitle: async (nextTitle) => {
      await api.conversations.touch(conversationId, nextTitle);
    },
  });
}

async function fetchTitle(
  info: { port: number; token: string },
  messages: UIMessage[],
): Promise<string | null> {
  try {
    const settings = await api.settings.getAll([SettingKey.SelectedModel]);
    const model = settings[SettingKey.SelectedModel];
    if (!model) return null;
    const res = await fetch(`http://127.0.0.1:${info.port}/api/title`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [CHAT_SESSION_HEADER]: info.token,
      },
      body: JSON.stringify({ model, messages }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return typeof data.title === "string" && data.title.length > 0 ? data.title : null;
  } catch (err) {
    console.error("[chat] fetch title error:", err);
    return null;
  }
}

/* ---------- 空态 ---------- */

function EmptyState({
  title,
  subtitle,
  suggestions,
  loading,
  onSuggestion,
}: {
  title: string;
  subtitle: string;
  suggestions: string[];
  loading?: boolean;
  onSuggestion: (s: string) => void;
}): React.JSX.Element {
  const { t } = useT();
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-10 text-center">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <PromptSuggestions
          title={t("chat.suggestions.title")}
          suggestions={suggestions}
          loading={loading}
          onSelect={onSuggestion}
          className="mt-2"
        />
      </div>
    </div>
  );
}
