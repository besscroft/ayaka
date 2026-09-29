/**
 * ChatView
 *
 * 渲染层：把"会话"和"消息"两件事串起来
 *
 * 职责：
 *  - 加载历史消息 -> 交给 useChat
 *  - 发送：把用户消息写入 DB（pre-save）后再 sendMessage
 *  - 流式结束 -> 把最新快照写回 DB
 *  - 头部展示：对话状态徽章（流式 / 就绪 / 错误 / 停止）+ 上下文用量
 *  - 标题自动生成：首次 user + assistant 完整出现后调用 /api/title
 *  - 消息动作（Edit / Resend / Delete）由本组件实现，传递给 MessageList
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { MessageList } from "./MessageList";
import { persistGeneratedUIStateChange } from "@shared/generated-ui/message";
import { MessageInput, type QueuedMessagePreview } from "./MessageInput";
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
  readFollowupSuggestions,
  toFileUIParts,
  updateFollowupSuggestions,
} from "../lib/chat-messages";
import type { GeneratedUIStateChange } from "@shared/generated-ui/types";
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
import {
  chatSessionRegistry,
  type ChatSessionFinishEvent,
  type ChatSessionInputConsumedPayload,
} from "../lib/chat-session-registry";
import { createIncrementalTokenCache } from "../lib/chat-token-cache";
import { notify } from "../lib/toast";
import { useT } from "../lib/i18n";
import { getConversationWorkspaceForHeader } from "../lib/conversation-workspace";
import { getEnabledSkillMentions, getSkillMentions } from "../lib/chat-tools";
import { scheduleAfterPaint } from "../lib/schedule-after-paint";
import { sanitizeBrowserScreenshotMessage } from "@shared/browser-message";
import { ConversationStatus, type ConversationStatusKind, type FilePartLike } from "./ai-elements";
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
  type ConversationHydration,
  type AgentProfile,
  type AgentRunInput,
  type LocalServerInfo,
  type McpInputRequest,
  type ProviderInfo,
  type ToolsSnapshot,
} from "@shared/types";
import type { RevisionRef } from "../lib/chat-persistence";

interface ChatViewProps {
  conversationId: string;
  serverInfo: LocalServerInfo;
  isNewConversation?: boolean;
}

type AutoTitleStatus = "running" | "completed";

type ChatRuntimeSnapshot = Pick<
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
>;

function retainTerminalRunInputStatuses(
  current: ChatRuntimeSnapshot | null,
  next: ChatRuntimeSnapshot,
): ChatRuntimeSnapshot {
  if (!current) return next;
  const currentInputs = new Map(current.agentRunInputs.map((input) => [input.id, input]));
  let changed = false;
  const agentRunInputs = next.agentRunInputs.map((input) => {
    const currentInput = currentInputs.get(input.id);
    if (currentInput && currentInput.status !== "queued" && input.status === "queued") {
      changed = true;
      return currentInput;
    }
    return input;
  });
  return changed ? { ...next, agentRunInputs } : next;
}

/**
 * 模型上下文窗口查找（粗略）。
 *  - 部分主流模型从已知的"厂商惯例"给默认值
 *  - 找不到则回落到 32K
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

function getQueuedMessagePreview(input: AgentRunInput): QueuedMessagePreview {
  try {
    const message = JSON.parse(input.message_json) as Partial<UIMessage>;
    const parts = Array.isArray(message.parts) ? message.parts : [];
    const text = parts
      .filter(
        (part): part is Extract<UIMessage["parts"][number], { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join("\n")
      .trim();
    const attachmentCount = parts.filter((part) => part.type === "file").length;
    return { id: input.id, text, attachmentCount };
  } catch {
    return { id: input.id, text: "", attachmentCount: 0 };
  }
}

/** Append a consumed follow-up after the assistant response that preceded it. */
function appendConsumedMessage(messages: UIMessage[], message: UIMessage): UIMessage[] {
  if (messages.some((candidate) => candidate.id === message.id)) return messages;
  return [...messages, message];
}

/** Keep a steering message before the currently streaming assistant response. */
function insertSteeringMessage(messages: UIMessage[], message: UIMessage): UIMessage[] {
  if (messages.some((candidate) => candidate.id === message.id)) return messages;
  const assistantIndex = messages.findLastIndex((candidate) => candidate.role === "assistant");
  const insertAt = assistantIndex >= 0 ? assistantIndex : messages.length;
  return [...messages.slice(0, insertAt), message, ...messages.slice(insertAt)];
}

export function ChatView({
  conversationId,
  serverInfo,
  isNewConversation = false,
}: ChatViewProps): React.JSX.Element {
  const { t, locale } = useT();
  const session = chatSessionRegistry.getOrCreate({ conversationId, serverInfo });
  const hasCachedSession = session.hydrated && !isNewConversation;
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [reasoningLevel, setReasoningLevel] = useState<ChatReasoningLevel>(
    DEFAULT_SETTINGS.chatReasoningLevel,
  );
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const persistedConversationRef = useRef(hasCachedSession);
  const [workspace, setWorkspace] = useState<import("@shared/types").WorkspaceInfo | null>(null);
  const [hydrationState, setHydrationState] = useState<"loading" | "ready" | "error">(
    hasCachedSession ? "ready" : "loading",
  );
  const [hydrationRetry, setHydrationRetry] = useState(0);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatErrorRetryable, setChatErrorRetryable] = useState(false);
  const [isStopped, setIsStopped] = useState(false);
  const [externalReconciliationPending, setExternalReconciliationPending] = useState(false);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([]);
  const [toolsSnapshot, setToolsSnapshot] = useState<ToolsSnapshot | null>(null);
  const skillMentionCatalog = useMemo(() => getSkillMentions(toolsSnapshot), [toolsSnapshot]);
  const enabledSkillMentions = useMemo(
    () => getEnabledSkillMentions(toolsSnapshot),
    [toolsSnapshot],
  );
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ChatRuntimeSnapshot | null>(null);
  const [modelContextWindows, setModelContextWindows] = useState<Map<string, number>>(new Map());
  const [toolSelection, setToolSelection] = useState<ChatToolSelectionRequest>(
    DEFAULT_CHAT_TOOL_SELECTION,
  );
  const [permissionMode, setPermissionMode] = useState<ChatPermissionMode>(
    DEFAULT_CHAT_PERMISSION_MODE,
  );
  const [permissionSource, setPermissionSource] = useState<"default" | "conversation">("default");
  const [mcpInputRequest, setMcpInputRequest] = useState<McpInputRequest | null>(null);
  /** 是否已为本对话生成过标题（防止重复生成） */
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
  const hydrationRequestRef = useRef<{
    conversationId: string;
    retry: number;
    promise: Promise<ConversationHydration | null>;
  } | null>(null);
  const hydrationTimingRef = useRef<{
    conversationId: string;
    startedAt: number;
    responseLogged: boolean;
    frameLogged: boolean;
  } | null>(null);
  const hydrationStateRef = useRef<"loading" | "ready" | "error">("loading");
  const revisionRef = useRef<RevisionRef>({ current: 0, persisted: new Map() });
  const persistenceDirtyRef = useRef(false);
  const learningQueueKeyRef = useRef<string | null>(null);
  const chatFailureRef = useRef(false);
  const errorReportedRef = useRef(false);
  const retryFallbackRef = useRef({ active: false, attempted: false });
  const followupRequestRef = useRef<string | null>(null);
  const followupAbortControllerRef = useRef<AbortController | null>(null);
  const tokenCacheRef = useRef(createIncrementalTokenCache());
  const activeChatSendsRef = useRef(new Map<string, Promise<void>>());
  const freshChatSendQueuesRef = useRef(new Map<string, Promise<void>>());
  const pendingConsumedInputsRef = useRef<ChatSessionInputConsumedPayload[]>([]);
  const runIdRef = session.runIdRef;
  const runModeRef = session.runModeRef;
  const reconciliationRef = session.reconciliationRef;
  const chatRef = useRef<{
    regenerate: () => Promise<void>;
    sendMessage: () => Promise<void>;
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
          window.dispatchEvent(
            new CustomEvent("ayaka:conversation-touched", {
              detail: { id: conversationId, updatedAt: Date.now() },
            }),
          );
          persistenceDirtyRef.current = false;
        },
        (error) => console.error("[chat] failed to persist streaming snapshot:", error),
        mergeMessagePersistenceRequests,
      ),
    [conversationId],
  );
  const [followupLoading, setFollowupLoading] = useState(false);
  const generatedUIPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generatedUIPendingRef = useRef<UIMessage[] | null>(null);

  // Start history IPC before non-critical ChatView initialization. The
  // hydration effect below reuses this promise instead of invoking it twice.
  useEffect(() => {
    if (session.hydrated || isNewConversation) return;
    const existing = hydrationRequestRef.current;
    if (existing?.conversationId === conversationId && existing.retry === hydrationRetry) return;

    const startedAt = performance.now();
    const promise = api.conversations.hydrate(conversationId);
    hydrationRequestRef.current = { conversationId, retry: hydrationRetry, promise };
    hydrationTimingRef.current = {
      conversationId,
      startedAt,
      responseLogged: false,
      frameLogged: false,
    };
  }, [conversationId, hydrationRetry, isNewConversation, session]);

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

  const handleGeneratedUIStateChange = useCallback(
    (change: GeneratedUIStateChange): void => {
      const currentMessages = latestMessagesRef.current;
      const message = currentMessages.find((candidate) => candidate.id === change.messageId);
      if (!message) return;
      const updatedMessage = persistGeneratedUIStateChange(message, change);
      if (updatedMessage === message) return;
      const updatedMessages = currentMessages.map((candidate) =>
        candidate.id === updatedMessage.id ? updatedMessage : candidate,
      );
      latestMessagesRef.current = updatedMessages;
      lastNonEmptyMessagesRef.current = updatedMessages;
      generatedUIPendingRef.current = updatedMessages;
      chatRef.current?.setMessages(updatedMessages);
      if (generatedUIPersistTimerRef.current !== null) {
        clearTimeout(generatedUIPersistTimerRef.current);
      }
      generatedUIPersistTimerRef.current = setTimeout(() => {
        generatedUIPersistTimerRef.current = null;
        const pending = generatedUIPendingRef.current;
        generatedUIPendingRef.current = null;
        if (pending) persistInBackground(pending, "generated UI state");
      }, 250);
    },
    [persistInBackground],
  );

  useEffect(
    () => () => {
      if (generatedUIPersistTimerRef.current !== null) {
        clearTimeout(generatedUIPersistTimerRef.current);
        generatedUIPersistTimerRef.current = null;
      }
      const pending = generatedUIPendingRef.current;
      generatedUIPendingRef.current = null;
      if (pending) persistInBackground(pending, "generated UI state cleanup");
    },
    [persistInBackground],
  );

  /** 异步生成追问建议 */
  const fetchFollowupSuggestions = useCallback(
    async (messages: UIMessage[], signal: AbortSignal): Promise<string[]> => {
      try {
        const settings = await api.settings.getAll([SettingKey.SelectedModel]);
        const model = settings[SettingKey.SelectedModel];
        if (!model) return [];
        const info = await api.server.info();
        if (signal.aborted || messages.length < 2) return [];
        const previousAssistantMessage = messages
          .slice(0, -1)
          .reverse()
          .find((message) => message.role === "assistant");
        const res = await fetch(`http://127.0.0.1:${info.port}/api/followups`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [CHAT_SESSION_HEADER]: info.token,
          },
          body: JSON.stringify({
            model,
            messages: messages.map(sanitizeBrowserScreenshotMessage),
            generationId: crypto.randomUUID(),
            previousSuggestions: readFollowupSuggestions(previousAssistantMessage),
          }),
          signal,
        });
        if (!res.ok) return [];
        const data = (await res.json()) as { suggestions?: unknown };
        return normalizeFollowupSuggestions(data.suggestions);
      } catch (err) {
        if (signal.aborted) return [];
        console.error("[chat] fetch followup suggestions error:", err);
        return [];
      }
    },
    [],
  );

  const cancelFollowupSuggestions = useCallback((): void => {
    followupRequestRef.current = null;
    followupAbortControllerRef.current?.abort();
    followupAbortControllerRef.current = null;
    setFollowupLoading(false);
  }, []);

  useEffect(() => {
    if (hydrationState !== "ready") return;
    let cancelled = false;
    const cancelScheduled = scheduleAfterPaint(() => {
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
    });
    return () => {
      cancelled = true;
      cancelScheduled();
    };
  }, [hydrationState]);

  useEffect(() => {
    if (hydrationState !== "ready") return;
    let cancelled = false;
    const refreshToolsSnapshot = (): void => {
      void api.tools.snapshot().then(
        (snapshot) => {
          if (!cancelled) setToolsSnapshot(snapshot);
        },
        () => undefined,
      );
    };
    const cancelScheduled = scheduleAfterPaint(() => {
      void Promise.allSettled([api.agents.list(), api.tools.snapshot()]).then(
        ([agentsResult, toolsResult]) => {
          if (cancelled) return;
          if (agentsResult.status === "fulfilled") setAgentProfiles(agentsResult.value);
          if (toolsResult.status === "fulfilled") setToolsSnapshot(toolsResult.value);
        },
      );
    });
    const offSkills = api.tools.skills.onChanged(refreshToolsSnapshot);
    return () => {
      cancelled = true;
      cancelScheduled();
      offSkills();
    };
  }, [hydrationState]);

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
    const canUseCachedSession = alreadyHydrated && !isNewConversation;
    const cachedMessages = canUseCachedSession ? session.chat.messages : undefined;
    if (canUseCachedSession) {
      hydrationStateRef.current = "ready";
    } else {
      setHydrationState("loading");
      hydrationStateRef.current = "loading";
    }
    persistedConversationRef.current = canUseCachedSession;
    setWorkspace(null);
    setChatError(alreadyHydrated ? session.errorMessage : null);
    setChatErrorRetryable(alreadyHydrated ? session.errorRetryable : false);
    setIsStopped(alreadyHydrated ? session.isStopped : false);
    setExternalReconciliationPending(false);
    if (!alreadyHydrated) {
      chatFailureRef.current = false;
      errorReportedRef.current = false;
      retryFallbackRef.current = { active: false, attempted: false };
    } else {
      errorReportedRef.current = session.errorMessage !== null;
    }
    cancelFollowupSuggestions();
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
      setInitialMessages(cachedMessages ?? session.chat.messages);
      latestMessagesRef.current = session.chat.messages;
      lastNonEmptyMessagesRef.current =
        session.chat.messages.length > 0 ? session.chat.messages : [];
      explicitEmptyMessagesRef.current = session.chat.messages.length === 0;
    }
    // 不重置 titledRef：保留跨会话记录，避免重复生成（切换回到旧对话也不重生成）。

    let cancelled = false;
    const applyHydration = (hydration: ConversationHydration): void => {
      const rows = hydration.messages.messages;
      const hydratedMessages = rows.map(hydrateStoredMessage);
      const messages = hydratedMessages.filter(isNonEmptyUIMessage);
      createdAtRef.current = new Map(rows.map((row) => [row.id, row.created_at]));
      revisionRef.current.current = hydration.messages.revision;
      revisionRef.current.persisted = new Map(
        messages.map((message) => [message.id, { message, content: JSON.stringify(message) }]),
      );
      latestMessagesRef.current = messages;
      lastNonEmptyMessagesRef.current = messages.length > 0 ? messages : [];
      explicitEmptyMessagesRef.current = messages.length === 0;
      session.hydrated = true;
      persistedConversationRef.current = true;
      setWorkspace(hydration.workspace);
      setInitialMessages(messages);
      setHydrationState("ready");
      hydrationStateRef.current = "ready";
      // 如果历史中已经有标题（DB 已有），标记为已生成，避免再次触发。
      if (hasMeaningfulConversationTitle(hydration.conversation.title)) {
        titleStateRef.current.set(conversationId, "completed");
      }
    };

    if (canUseCachedSession) {
      setHydrationState("ready");
      hydrationStateRef.current = "ready";
    }
    if (isNewConversation) {
      const messages = alreadyHydrated ? session.chat.messages : [];
      latestMessagesRef.current = messages;
      lastNonEmptyMessagesRef.current = messages.length > 0 ? messages : [];
      explicitEmptyMessagesRef.current = messages.length === 0;
      session.hydrated = true;
      setInitialMessages(messages);
      setHydrationState("ready");
      hydrationStateRef.current = "ready";
    } else {
      const request = hydrationRequestRef.current;
      const hydrationPromise =
        request?.conversationId === conversationId && request.retry === hydrationRetry
          ? request.promise
          : (() => {
              const startedAt = performance.now();
              const promise = api.conversations.hydrate(conversationId);
              hydrationTimingRef.current = {
                conversationId,
                startedAt,
                responseLogged: false,
                frameLogged: false,
              };
              return promise;
            })();
      void hydrationPromise
        .then((hydration) => {
          if (cancelled) return;
          const timing = hydrationTimingRef.current;
          if (
            import.meta.env.DEV &&
            timing?.conversationId === conversationId &&
            !timing.responseLogged
          ) {
            timing.responseLogged = true;
            console.debug("[perf] conversation hydration", {
              conversationId,
              elapsedMs: Math.round(performance.now() - timing.startedAt),
            });
          }
          if (!hydration) {
            if (canUseCachedSession) return;
            latestMessagesRef.current = [];
            lastNonEmptyMessagesRef.current = [];
            explicitEmptyMessagesRef.current = true;
            setInitialMessages([]);
            persistedConversationRef.current = false;
            session.hydrated = true;
            setHydrationState("ready");
            hydrationStateRef.current = "ready";
            return;
          }
          if (
            canUseCachedSession &&
            (session.chat.status !== "ready" ||
              persistenceDirtyRef.current ||
              session.chat.messages !== cachedMessages)
          ) {
            persistedConversationRef.current = true;
            setWorkspace(hydration.workspace);
            if (hasMeaningfulConversationTitle(hydration.conversation.title)) {
              titleStateRef.current.set(conversationId, "completed");
            }
            return;
          }
          applyHydration(hydration);
        })
        .catch((error) => {
          if (cancelled) return;
          if (canUseCachedSession) {
            console.warn("[chat] failed to refresh cached message history:", error);
            return;
          }
          console.error("[chat] failed to load message history:", error);
          setChatError(getChatErrorMessage(error, locale));
          setHydrationState("error");
          hydrationStateRef.current = "error";
        });
    }

    void api.settings
      .getAll([
        SettingKey.SelectedModel,
        SettingKey.ChatReasoningLevel,
        SettingKey.ChatTools,
        SettingKey.ChatPermissions,
      ])
      .then((settings) => {
        if (cancelled) return;
        setSelectedModel(settings[SettingKey.SelectedModel] || null);
        const level = settings[SettingKey.ChatReasoningLevel];
        if (isChatReasoningLevel(level) && reasoningModelKeyRef.current === null) {
          setReasoningLevel(level);
        }
        setToolSelection(
          getChatToolSelectionForConversation(settings[SettingKey.ChatTools], conversationId),
        );
        const permission = getChatPermissionForConversation(
          settings[SettingKey.ChatPermissions],
          conversationId,
        );
        setPermissionMode(permission.mode);
        setPermissionSource(permission.source);
      })
      .catch((error) => {
        if (!cancelled) console.warn("[chat] failed to load chat settings:", error);
      });
    return () => {
      cancelled = true;
      cancelFollowupSuggestions();
    };
  }, [
    cancelFollowupSuggestions,
    conversationId,
    hydrationRetry,
    isNewConversation,
    locale,
    session,
  ]);

  useEffect(() => {
    const timing = hydrationTimingRef.current;
    if (
      !import.meta.env.DEV ||
      hydrationState !== "ready" ||
      timing?.conversationId !== conversationId ||
      timing.frameLogged
    ) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => {
      const current = hydrationTimingRef.current;
      if (current?.conversationId !== conversationId || current.frameLogged) return;
      current.frameLogged = true;
      console.debug("[perf] conversation first frame", {
        conversationId,
        elapsedMs: Math.round(performance.now() - current.startedAt),
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [conversationId, hydrationState, initialMessages.length]);

  useEffect(() => {
    if (hydrationState !== "ready") return;
    let cancelled = false;
    const cancelScheduled = scheduleAfterPaint(() => {
      void api.sandboxArtifacts.list(conversationId).then((items) => {
        if (
          !cancelled &&
          items.some(
            (item) => item.kind === "html" || item.kind === "svg" || item.kind === "static",
          )
        ) {
          openWorkspaceSidePanel("generated-app", undefined, { automatic: true });
        }
      });
    });
    return () => {
      cancelled = true;
      cancelScheduled();
    };
  }, [conversationId, hydrationState]);

  const chat = useChat({ chat: session.chat, experimental_throttle: 50 });
  chatRef.current = chat;

  const handleChatFinish = useCallback(
    ({ messages, isError, isAbort }: ChatSessionFinishEvent): void => {
      const pendingContinuationRunId = chatSessionRegistry.takePendingContinuation(conversationId);
      const continuationRunId = !isError && !isAbort ? pendingContinuationRunId : null;
      const consumedInputs = pendingConsumedInputsRef.current.splice(0);
      const streamedMessages =
        messages.length > 0
          ? (reconcileChatMessages(latestMessagesRef.current, messages) ?? messages)
          : latestMessagesRef.current;
      const completedMessages = consumedInputs.reduce(
        (current, payload) =>
          payload.continueRun
            ? appendConsumedMessage(current, payload.message)
            : insertSteeringMessage(current, payload.message),
        streamedMessages,
      );
      if (consumedInputs.length > 0) chat.setMessages(completedMessages);
      if (completedMessages.length > 0) {
        latestMessagesRef.current = completedMessages;
        lastNonEmptyMessagesRef.current = completedMessages;
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
      cancelFollowupSuggestions();
      const learningKey = isAbort
        ? null
        : getAgentLearningQueueKey(conversationId, completedMessages, isError);
      const shouldQueueLearning =
        learningKey != null && learningQueueKeyRef.current !== learningKey;
      if (shouldQueueLearning) learningQueueKeyRef.current = learningKey;
      const snapshot = isError
        ? prepareFailedChatSnapshot(completedMessages)
        : { messages: completedMessages, deleteIds: [] };
      const persistPromise = persistAndTouch(snapshot.messages, snapshot.deleteIds)
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

      void api.agents
        .runtimeSnapshot()
        .then((snapshot) =>
          setRuntimeSnapshot((current) => retainTerminalRunInputStatuses(current, snapshot)),
        )
        .catch((error) => console.error("[chat] failed to refresh queue state:", error));

      if (continuationRunId) {
        runIdRef.current = continuationRunId;
        runModeRef.current = "resume";
        void persistPromise.then(() => {
          const currentChat = chatRef.current;
          if (!currentChat || session.isStopped || runIdRef.current !== continuationRunId) return;
          void currentChat.sendMessage().catch((error) => {
            reportChatError("resume queued response", error, {
              persistSnapshot: latestMessagesRef.current,
            });
          });
        });
        return;
      }

      if (!isError && !isAbort) tryAutoTitle(conversationId, completedMessages, titleStateRef);
      if (!isError && !isAbort) {
        const assistantMessage = [...completedMessages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (assistantMessage) {
          const requestKey = `${conversationId}:${assistantMessage.id}`;
          followupAbortControllerRef.current?.abort();
          const controller = new AbortController();
          followupAbortControllerRef.current = controller;
          followupRequestRef.current = requestKey;
          setFollowupLoading(true);
          void fetchFollowupSuggestions(completedMessages, controller.signal)
            .then((suggestions) => {
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
            })
            .finally(() => {
              if (followupRequestRef.current !== requestKey) return;
              followupRequestRef.current = null;
              followupAbortControllerRef.current = null;
              setFollowupLoading(false);
            });
        } else {
          cancelFollowupSuggestions();
        }
      }
    },
    [
      cancelFollowupSuggestions,
      conversationId,
      fetchFollowupSuggestions,
      persistAndTouch,
      persistInBackground,
      reportChatError,
      session,
      chat,
    ],
  );

  const handleChatError = useCallback(
    (err: Error): void => {
      cancelFollowupSuggestions();
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
    [cancelFollowupSuggestions, locale, persistInBackground, reportChatError, session],
  );

  const handleInputConsumed = useCallback(
    (payload: ChatSessionInputConsumedPayload): void => {
      runIdRef.current = payload.runId;
      runModeRef.current = "resume";
      if (!pendingConsumedInputsRef.current.some((item) => item.inputId === payload.inputId)) {
        pendingConsumedInputsRef.current.push(payload);
      }

      const consumedAt = Date.now();
      setRuntimeSnapshot((snapshot) =>
        snapshot
          ? {
              ...snapshot,
              agentRunInputs: snapshot.agentRunInputs.map((input) =>
                input.id === payload.inputId
                  ? { ...input, status: "consumed", consumed_at: consumedAt }
                  : input,
              ),
            }
          : snapshot,
      );
      const snapshotContainsInput = runtimeSnapshot?.agentRunInputs.some(
        (input) => input.id === payload.inputId,
      );
      if (!snapshotContainsInput) {
        void api.agents
          .runtimeSnapshot()
          .then((snapshot) =>
            setRuntimeSnapshot((current) => retainTerminalRunInputStatuses(current, snapshot)),
          )
          .catch((error) => console.error("[chat] failed to refresh consumed input:", error));
      }
    },
    [runtimeSnapshot],
  );

  useEffect(() => {
    return chatSessionRegistry.subscribe(conversationId, (event) => {
      if (event.type === "finish") handleChatFinish(event.payload);
      else if (event.type === "error") handleChatError(event.error);
      else handleInputConsumed(event.payload);
    });
  }, [conversationId, handleChatError, handleChatFinish, handleInputConsumed]);

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
  const activeRunIdForConversation =
    runtimeSnapshot?.runtimeRuns
      .filter(
        (item) =>
          item.conversation_id === conversationId &&
          ["queued", "running", "waiting_approval", "waiting_handoff"].includes(item.status),
      )
      .sort((a, b) => b.started_at - a.started_at)[0]?.id ??
    (isChatLoading ? runIdRef.current : null);
  const queuedMessagePreviews = useMemo(
    () =>
      runtimeSnapshot?.agentRunInputs
        .filter(
          (item) =>
            item.run_id === activeRunIdForConversation &&
            item.kind === "follow_up" &&
            item.status === "queued",
        )
        .map(getQueuedMessagePreview) ?? [],
    [activeRunIdForConversation, runtimeSnapshot?.agentRunInputs],
  );

  const shouldPollRuntime = isLoading || hasActivePersistedRun || externalReconciliationPending;

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

  const refreshPersistedMessages = useCallback((): Promise<boolean> => {
    if (hydrationStateRef.current !== "ready") return Promise.resolve(false);
    return api.messages
      .list(conversationId)
      .then((snapshot) => {
        const persistedMessages = snapshot.messages
          .map(hydrateStoredMessage)
          .filter(isNonEmptyUIMessage);
        const hasAssistant = persistedMessages.some(
          (message) => message.role === "assistant" && message.parts.length > 0,
        );
        const reconciled = reconcileChatMessages(latestMessagesRef.current, persistedMessages);
        if (!reconciled || reconciled === latestMessagesRef.current) return hasAssistant;
        latestMessagesRef.current = reconciled;
        if (reconciled.length > 0) lastNonEmptyMessagesRef.current = reconciled;
        explicitEmptyMessagesRef.current = reconciled.length === 0;
        setChatMessages(reconciled);
        return hasAssistant;
      })
      .catch((error) => {
        console.error("[chat] failed to refresh persisted messages:", error);
        return false;
      });
  }, [conversationId, setChatMessages]);

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
    if (hydrationState !== "ready") return;
    let cancelled = false;
    let inFlight = false;
    const load = (): void => {
      if (inFlight) return;
      inFlight = true;
      void api.agents
        .runtimeSnapshot()
        .then((snapshot) => {
          if (!cancelled) {
            setRuntimeSnapshot((current) => retainTerminalRunInputStatuses(current, snapshot));
            const activeRun = snapshot.runtimeRuns
              .filter(
                (item) =>
                  item.conversation_id === conversationId &&
                  ["queued", "running", "waiting_approval", "waiting_handoff"].includes(
                    item.status,
                  ),
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
            const isExternalRun = runModeRef.current === "resume" && !isChatLoadingRef.current;
            if (activeRun) {
              setExternalReconciliationPending(false);
              void refreshPersistedMessages();
            }
            const shouldReconcile =
              trackedRun &&
              shouldReconcileCompletedRun({
                trackedRunId,
                runId: trackedRun.id,
                conversationId,
                runConversationId: trackedRun.conversation_id,
                isChatLoading: isChatLoadingRef.current,
                isExternalRun,
                status: trackedRun.status,
              });
            if (shouldReconcile && trackedRun) {
              if (isExternalRun) {
                setExternalReconciliationPending(true);
                void refreshPersistedMessages().then((hasAssistant) => {
                  if (hasAssistant) setExternalReconciliationPending(false);
                });
              } else {
                reconcileCompletedRun(trackedRun.id);
              }
            }
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };
    const cancelScheduled = scheduleAfterPaint(load);
    if (!shouldPollRuntime) {
      return () => {
        cancelled = true;
        cancelScheduled();
        if (reconciliationRef.current.timer !== null) {
          window.clearTimeout(reconciliationRef.current.timer);
          reconciliationRef.current.timer = null;
        }
      };
    }
    const id = window.setInterval(load, queuedMessagePreviews.length > 0 ? 250 : 1_200);
    return () => {
      cancelled = true;
      cancelScheduled();
      window.clearInterval(id);
      if (reconciliationRef.current.timer !== null) {
        window.clearTimeout(reconciliationRef.current.timer);
        reconciliationRef.current.timer = null;
      }
    };
  }, [
    conversationId,
    externalReconciliationPending,
    hydrationState,
    queuedMessagePreviews.length,
    reconcileCompletedRun,
    refreshPersistedMessages,
    shouldPollRuntime,
  ]);

  /* ---------- 状态徽章 ---------- */
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

  /* ---------- 发送 ---------- */
  const handleSend = async ({
    text,
    files,
  }: {
    text: string;
    files: FilePartLike[];
  }): Promise<void> => {
    let finalFiles = toFileUIParts(files);
    if (!selectedModel) return;
    cancelFollowupSuggestions();

    const resetChatForSend = (): void => {
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
    };

    const tryQueueMessage = async (userMessage: UIMessage): Promise<boolean> => {
      const activeRunId = runIdRef.current ?? activeRunIdForConversation;
      if (!activeRunId) return false;

      const activeRuntimeRun = runtimeSnapshot?.runtimeRuns.some(
        (item) =>
          item.id === activeRunId &&
          ["queued", "running", "waiting_approval", "waiting_handoff"].includes(item.status),
      );
      const blockedRun = runtimeSnapshot?.runtimeRuns.find(
        (item) => item.id === activeRunId && item.status === "blocked",
      );
      const hasLocalStream = activeChatSendsRef.current.has(conversationId);
      if (!(isChatLoadingRef.current || hasLocalStream || activeRuntimeRun || blockedRun)) {
        return false;
      }
      if (blockedRun && !isResumableBlockedRun(blockedRun)) {
        reportChatError(
          "resume blocked run",
          new Error(blockedRun.error ?? "Agent run is blocked."),
        );
        return true;
      }

      if (blockedRun) runModeRef.current = "resume";
      try {
        const queuedInput = await api.runtime.enqueueInput({
          runId: activeRunId,
          kind: "follow_up",
          source: "user",
          message: userMessage,
        });
        setRuntimeSnapshot((snapshot) =>
          snapshot
            ? {
                ...snapshot,
                agentRunInputs: [
                  ...snapshot.agentRunInputs.filter((item) => item.id !== queuedInput.id),
                  queuedInput,
                ],
              }
            : snapshot,
        );
        if (!runtimeSnapshot) {
          void api.agents
            .runtimeSnapshot()
            .then((snapshot) =>
              setRuntimeSnapshot((current) => retainTerminalRunInputStatuses(current, snapshot)),
            )
            .catch((error) => console.error("[chat] failed to refresh queued messages:", error));
        }
        return true;
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
        if (code !== "run_not_active" && code !== "run_not_found") {
          reportChatError("queue follow-up", err);
          return true;
        }
        if (runIdRef.current === activeRunId && !activeChatSendsRef.current.has(conversationId)) {
          runIdRef.current = null;
          runModeRef.current = "start";
        }
        return false;
      }
    };

    const tryTextQueueBeforeWorkspace = files.length === 0;
    let userMessage: UIMessage | null = null;
    if (tryTextQueueBeforeWorkspace) {
      try {
        userMessage = buildUserMessage({ id: crypto.randomUUID(), text, files: finalFiles });
      } catch {
        return;
      }
      resetChatForSend();
      if (await tryQueueMessage(userMessage)) return;
    }

    const wasTemporaryBeforeWorkspace = !persistedConversationRef.current;
    try {
      if (wasTemporaryBeforeWorkspace) {
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
      if (wasTemporaryBeforeWorkspace) {
        await api.workspace.rollback(conversationId).catch(() => undefined);
      }
      reportChatError("prepare workspace", error);
      return;
    }

    if (!userMessage) {
      try {
        userMessage = buildUserMessage({ id: crypto.randomUUID(), text, files: finalFiles });
      } catch {
        if (wasTemporaryBeforeWorkspace) {
          await api.workspace.rollback(conversationId).catch(() => undefined);
        }
        return;
      }
      resetChatForSend();
    }
    const finalUserMessage = userMessage;
    if (await tryQueueMessage(finalUserMessage)) return;

    const sendFreshRun = async (): Promise<void> => {
      const waitForCurrentResponse = async (): Promise<void> => {
        const pendingSend = activeChatSendsRef.current.get(conversationId);
        if (pendingSend) {
          await pendingSend;
          return;
        }
        const status = session.chat.status;
        if (status !== "submitted" && status !== "streaming") return;

        await new Promise<void>((resolve) => {
          let settled = false;
          let unsubscribe: (() => void) | undefined;
          const finish = (): void => {
            if (settled) return;
            settled = true;
            unsubscribe?.();
            resolve();
          };
          unsubscribe = chatSessionRegistry.subscribe(conversationId, (event) => {
            if (event.type === "finish" || event.type === "error") finish();
          });
          if (settled) unsubscribe();
        });
      };

      await waitForCurrentResponse();
      const wasTemporary = !persistedConversationRef.current;
      const pendingMessages = appendOrReplaceMessage(latestMessagesRef.current, finalUserMessage);
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
          persistedConversationRef.current = false;
          setWorkspace(null);
        }
        reportChatError("save user message", err);
        return;
      }
      if (wasTemporary) {
        persistedConversationRef.current = true;
        window.dispatchEvent(
          new CustomEvent("ayaka:conversation-created", {
            detail: { id: conversationId },
          }),
        );
      }

      const sendPromise = chat.sendMessage(finalUserMessage).catch((err) => {
        reportChatError("send", err, { persistSnapshot: pendingMessages });
      });
      activeChatSendsRef.current.set(conversationId, sendPromise);
      void sendPromise.then(() => {
        if (activeChatSendsRef.current.get(conversationId) === sendPromise) {
          activeChatSendsRef.current.delete(conversationId);
        }
      });
      await sendPromise;
    };

    // AI SDK's Chat owns one active response; serialize fresh sends after a late enqueue rejection.
    const previousFreshSends =
      freshChatSendQueuesRef.current.get(conversationId) ?? Promise.resolve();
    const queuedFreshSend = previousFreshSends.then(sendFreshRun);
    const handledFreshSend = queuedFreshSend.catch((err: unknown) => {
      reportChatError("send", err, { persistSnapshot: latestMessagesRef.current });
    });
    freshChatSendQueuesRef.current.set(conversationId, handledFreshSend);
    void handledFreshSend.then(() => {
      if (freshChatSendQueuesRef.current.get(conversationId) === handledFreshSend) {
        freshChatSendQueuesRef.current.delete(conversationId);
      }
    });
    await handledFreshSend;
  };

  const handleStop = (): void => {
    const runId = runIdRef.current;
    session.isStopped = true;
    setIsStopped(true);
    void Promise.allSettled([
      chat.stop(),
      runId ? api.runtime.cancelRun(runId) : Promise.resolve(false),
    ])
      .then(() => api.agents.runtimeSnapshot())
      .then((snapshot) =>
        setRuntimeSnapshot((current) => retainTerminalRunInputStatuses(current, snapshot)),
      )
      .catch((error) => console.error("[chat] failed to refresh stopped runtime:", error))
      .finally(() => {
        runIdRef.current = null;
        runModeRef.current = "start";
        session.isStopped = true;
        setIsStopped(true);
        persistInBackground(latestMessagesRef.current, "stopped response");
      });
  };

  const handleRemoveQueuedMessage = useCallback(
    async (inputId: string): Promise<boolean> => {
      if (!activeRunIdForConversation) return false;
      const removed = await api.runtime.discardQueuedInput(activeRunIdForConversation, inputId);
      if (removed) {
        const removedAt = Date.now();
        setRuntimeSnapshot((snapshot) =>
          snapshot
            ? {
                ...snapshot,
                agentRunInputs: snapshot.agentRunInputs.map((input) =>
                  input.id === inputId
                    ? {
                        ...input,
                        status: "discarded",
                        consumed_at: removedAt,
                        discarded_reason: "user_removed_from_queue",
                      }
                    : input,
                ),
              }
            : snapshot,
        );
      } else {
        void api.agents
          .runtimeSnapshot()
          .then((snapshot) =>
            setRuntimeSnapshot((current) => retainTerminalRunInputStatuses(current, snapshot)),
          )
          .catch((error) => console.error("[chat] failed to refresh queued messages:", error));
      }
      return removed;
    },
    [activeRunIdForConversation, runtimeSnapshot],
  );

  const handleRetry = (): void => {
    if (!chatErrorRetryable) return;
    cancelFollowupSuggestions();
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
    cancelFollowupSuggestions();
    manualMessageMutationRef.current = true;

    // 1. 找到该 user 消息，替换 text part，删除后续所有消息。
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

    // 2. 持久化新快照（删除后续消息）。
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

    // 3. 触发重新生成。
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      reportChatError("edit regenerate", err);
    }
  };

  /* ---------- 消息动作：重新发送 ---------- */
  const handleResendMessage = async (messageId: string): Promise<void> => {
    const idx = renderedMessages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = renderedMessages[idx];
    if (target.role !== "user") return;
    cancelFollowupSuggestions();
    manualMessageMutationRef.current = true;

    // 1. 截断到该 user 消息。
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

    // 2. 持久化（删除后续消息）。
    persistInBackground(
      nextMessages,
      "resent message",
      renderedMessages.slice(idx + 1).map((message) => message.id),
    );

    // 3. 触发重新生成。
    try {
      await chat.regenerate({ messageId: target.id });
    } catch (err) {
      reportChatError("resend", err);
    }
  };

  /* ---------- 消息动作：删除 ---------- */
  const handleDeleteMessage = (messageId: string): void => {
    const idx = renderedMessages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    const target = renderedMessages[idx];
    const confirmed = window.confirm(t("msg.delete.confirm"));
    if (!confirmed) return;
    cancelFollowupSuggestions();
    manualMessageMutationRef.current = true;

    // 1. 删除目标；如果目标是 user 消息，紧跟的 assistant 也一并删除。
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
      // 同步删除可能存在的 createdAt。
    }

    // 2. 持久化（目标消息与可能的 assistant 同步从 DB 中删除）。
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
              <EmptyState title={t("chat.empty.title")} subtitle={t("chat.empty.subtitle")} />
            ) : (
              <MessageList
                key={conversationId}
                conversationId={conversationId}
                messages={renderedMessages}
                createdAtById={createdAtRef.current}
                skillMentions={skillMentionCatalog}
                isLoading={isLoading}
                status={statusKind}
                error={chat.error}
                errorDetail={chatError}
                followupSuggestions={followupSuggestions}
                followupLoading={followupLoading}
                onRetry={chatErrorRetryable ? handleRetry : undefined}
                onDismissError={handleDismissError}
                onEditMessage={handleEditMessage}
                onResendMessage={handleResendMessage}
                onDeleteMessage={handleDeleteMessage}
                onToolApprovalResponse={chat.addToolApprovalResponse}
                onGeneratedUIStateChange={handleGeneratedUIStateChange}
                onSuggestion={handleSuggestion}
              />
            )}

            <MessageInput
              conversationId={conversationId}
              isLoading={isLoading}
              isRunActive={isAgentRunActive}
              queuedMessages={queuedMessagePreviews}
              onRemoveQueuedMessage={handleRemoveQueuedMessage}
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
        key={conversationId}
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

/* ---------- 头部 ---------- */

interface ChatHeaderProps {
  status: ConversationStatusKind;
  workspace: import("@shared/types").WorkspaceInfo | null;
  agentStatus: React.ReactNode;
}

/**
 * 头部只展示对话名 + 状态徽章；上下文用量已迁至输入框的 ContextPopover。
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
            className="ml-1"
            isIconOnly
            onPress={() => void api.workspace.open(workspace.conversationId)}
            aria-label={t("workspace.open")}
          >
            <IconFolderOpen aria-hidden="true" />
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">{t("workspace.notCreated")}</span>
        )}
      </div>
      {agentStatus ? <div className="-mr-2 shrink-0 sm:-mr-3">{agentStatus}</div> : null}
    </header>
  );
}

/* ---------- 持久化 ---------- */

/* ---------- 自动标题生成 ---------- */

/**
 * 当本轮 user + assistant 完整出现后，调用 /api/title 生成标题。
 *  - 仅首次（已生成过的对话不再生成）
 *  - 找到第一条 user 消息及其后面靠前的第一条 assistant 消息作为依据
 *    不强制类型位置（兼容历史/系统消息前缀、档序变化），而不是检查 messages[0]/messages[1]。
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
      body: JSON.stringify({ model, messages: messages.map(sanitizeBrowserScreenshotMessage) }),
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

function EmptyState({ title, subtitle }: { title: string; subtitle: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-6 py-10 text-center">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </div>
      </div>
    </div>
  );
}
