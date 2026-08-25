import { Chat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type ChatOnFinishCallback,
  type ChatTransport,
  type UIMessage,
} from "ai";
import type {
  ChatPermissionMode,
  ChatReasoningLevel,
  ChatToolSelectionRequest,
  LocalServerInfo,
} from "@shared/types";
import {
  CHAT_SESSION_HEADER,
  DEFAULT_AGENT_ID,
  DEFAULT_CHAT_PERMISSION_MODE,
  DEFAULT_CHAT_TOOL_SELECTION,
} from "@shared/types";
import { readChatRunIdHeader } from "./chat-retry";

export type ChatSessionFinishEvent = Parameters<ChatOnFinishCallback<UIMessage>>[0];

export type ChatSessionEvent =
  | { type: "finish"; payload: ChatSessionFinishEvent }
  | { type: "error"; error: Error };

export interface ChatSessionRequestConfig {
  model: string | null;
  reasoning: ChatReasoningLevel;
  toolSelection: ChatToolSelectionRequest;
  permissionMode: ChatPermissionMode;
}

export interface ChatSessionEntry {
  readonly conversationId: string;
  readonly chat: Chat<UIMessage>;
  readonly transport: ChatTransport<UIMessage>;
  readonly runIdRef: { current: string | null };
  readonly runModeRef: { current: "start" | "resume" };
  readonly reconciliationRef: {
    current: { runId: string | null; attempts: number; timer: number | null };
  };
  readonly requestConfig: ChatSessionRequestConfig;
  readonly pendingEvents: ChatSessionEvent[];
  hydrated: boolean;
  isStopped: boolean;
  errorMessage: string | null;
  errorRetryable: boolean;
  lastUsedAt: number;
}

export interface ChatSessionCreateOptions {
  conversationId: string;
  serverInfo?: LocalServerInfo;
  transport?: ChatTransport<UIMessage>;
}

export interface ChatSessionRegistryOptions {
  maxCachedSessions?: number;
}

export type ChatSessionListener = (event: ChatSessionEvent) => void;

const DEFAULT_MAX_CACHED_SESSIONS = 8;

/**
 * Keeps AI SDK Chat instances alive while the renderer changes conversations.
 *
 * A Chat owns the active response and its message state, so unmounting the
 * component must not be allowed to destroy the only subscriber to a stream.
 * Events are buffered only while a conversation has no active UI subscriber;
 * the next subscriber drains them synchronously in order.
 */
export class ChatSessionRegistry {
  private readonly sessions = new Map<string, ChatSessionEntry>();
  private readonly listeners = new Map<string, Set<ChatSessionListener>>();
  private readonly maxCachedSessions: number;

  constructor(options: ChatSessionRegistryOptions = {}) {
    this.maxCachedSessions = Math.max(1, options.maxCachedSessions ?? DEFAULT_MAX_CACHED_SESSIONS);
  }

  getOrCreate(options: ChatSessionCreateOptions): ChatSessionEntry {
    const existing = this.sessions.get(options.conversationId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing;
    }

    if (!options.transport && !options.serverInfo) {
      throw new Error("ChatSessionRegistry requires serverInfo or a custom transport.");
    }

    const runIdRef = { current: null as string | null };
    const runModeRef = { current: "start" as "start" | "resume" };
    const reconciliationRef = {
      current: { runId: null as string | null, attempts: 0, timer: null as number | null },
    };
    const requestConfig: ChatSessionRequestConfig = {
      model: null,
      reasoning: "provider-default",
      toolSelection: { ...DEFAULT_CHAT_TOOL_SELECTION, selectedToolIds: [] },
      permissionMode: DEFAULT_CHAT_PERMISSION_MODE,
    };

    const entry = {
      conversationId: options.conversationId,
      chat: undefined as unknown as Chat<UIMessage>,
      transport: undefined as unknown as ChatTransport<UIMessage>,
      runIdRef,
      runModeRef,
      reconciliationRef,
      requestConfig,
      pendingEvents: [],
      hydrated: false,
      isStopped: false,
      errorMessage: null,
      errorRetryable: false,
      lastUsedAt: Date.now(),
    } satisfies Omit<ChatSessionEntry, "chat" | "transport"> & {
      chat: Chat<UIMessage>;
      transport: ChatTransport<UIMessage>;
    };

    const transport =
      options.transport ??
      this.createDefaultTransport(entry, options.serverInfo as LocalServerInfo);
    entry.transport = transport;
    entry.chat = new Chat<UIMessage>({
      id: options.conversationId,
      messages: [],
      transport,
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
      onFinish: (payload) => this.emit(entry, { type: "finish", payload }),
      onError: (error) => this.emit(entry, { type: "error", error }),
    });

    this.sessions.set(options.conversationId, entry);
    this.evictCompletedInactiveSessions();
    return entry;
  }

  subscribe(conversationId: string, listener: ChatSessionListener): () => void {
    const entry = this.sessions.get(conversationId);
    if (!entry) throw new Error(`Unknown chat session: ${conversationId}`);

    let listeners = this.listeners.get(conversationId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(conversationId, listeners);
    }
    listeners.add(listener);
    entry.lastUsedAt = Date.now();

    const pendingEvents = entry.pendingEvents.splice(0);
    for (const event of pendingEvents) listener(event);

    return () => {
      const currentListeners = this.listeners.get(conversationId);
      currentListeners?.delete(listener);
      if (currentListeners && currentListeners.size === 0) this.listeners.delete(conversationId);
      entry.lastUsedAt = Date.now();
      this.evictCompletedInactiveSessions();
    };
  }

  release(conversationId: string): void {
    const entry = this.sessions.get(conversationId);
    if (!entry) return;
    entry.lastUsedAt = Date.now();
    this.listeners.delete(conversationId);
    this.evictCompletedInactiveSessions();
  }

  delete(conversationId: string): void {
    const entry = this.sessions.get(conversationId);
    if (!entry) return;
    this.sessions.delete(conversationId);
    this.listeners.delete(conversationId);
    entry.pendingEvents.length = 0;
    if (entry.reconciliationRef.current.timer !== null) {
      window.clearTimeout(entry.reconciliationRef.current.timer);
      entry.reconciliationRef.current.timer = null;
    }
    void entry.chat.stop().catch(() => undefined);
  }

  get(conversationId: string): ChatSessionEntry | undefined {
    return this.sessions.get(conversationId);
  }

  size(): number {
    return this.sessions.size;
  }

  updateRequestConfig(
    conversationId: string,
    update: Partial<ChatSessionRequestConfig>,
  ): ChatSessionEntry | undefined {
    const entry = this.sessions.get(conversationId);
    if (!entry) return undefined;
    if (update.model !== undefined) entry.requestConfig.model = update.model;
    if (update.reasoning !== undefined) entry.requestConfig.reasoning = update.reasoning;
    if (update.toolSelection !== undefined) {
      entry.requestConfig.toolSelection = {
        ...update.toolSelection,
        selectedToolIds: [...update.toolSelection.selectedToolIds],
      };
    }
    if (update.permissionMode !== undefined)
      entry.requestConfig.permissionMode = update.permissionMode;
    entry.lastUsedAt = Date.now();
    return entry;
  }

  private emit(entry: ChatSessionEntry, event: ChatSessionEvent): void {
    entry.lastUsedAt = Date.now();
    const listeners = this.listeners.get(entry.conversationId);
    if (!listeners || listeners.size === 0) {
      entry.pendingEvents.push(event);
      if (entry.pendingEvents.length > 32) entry.pendingEvents.shift();
      return;
    }
    listeners.forEach((listener) => listener(event));
  }

  private createDefaultTransport(
    entry: Pick<
      ChatSessionEntry,
      "conversationId" | "runIdRef" | "runModeRef" | "requestConfig"
    > & {
      reconciliationRef: ChatSessionEntry["reconciliationRef"];
    },
    serverInfo: LocalServerInfo,
  ): ChatTransport<UIMessage> {
    return new DefaultChatTransport<UIMessage>({
      api: `http://127.0.0.1:${serverInfo.port}/api/chat`,
      headers: () => ({ [CHAT_SESSION_HEADER]: serverInfo.token }),
      fetch: async (input, init) => {
        const response = await globalThis.fetch(input, init);
        const effectiveRunId = readChatRunIdHeader(response);
        if (effectiveRunId) {
          const reconciliation = entry.reconciliationRef.current;
          if (reconciliation.runId !== effectiveRunId && reconciliation.timer !== null) {
            window.clearTimeout(reconciliation.timer);
          }
          entry.runIdRef.current = effectiveRunId;
          entry.runModeRef.current = "resume";
          entry.reconciliationRef.current = { runId: effectiveRunId, attempts: 0, timer: null };
        }
        return response;
      },
      body: () => ({
        model: entry.requestConfig.model ?? undefined,
        agentId: DEFAULT_AGENT_ID,
        conversationId: entry.conversationId,
        reasoning: entry.requestConfig.reasoning,
        toolSelection: entry.requestConfig.toolSelection,
        permissionMode: entry.requestConfig.permissionMode,
        runId: entry.runIdRef.current ?? undefined,
        mode: entry.runModeRef.current,
      }),
    });
  }

  private evictCompletedInactiveSessions(): void {
    if (this.sessions.size <= this.maxCachedSessions) return;
    const candidates = [...this.sessions.values()]
      .filter(
        (entry) =>
          !this.listeners.has(entry.conversationId) &&
          entry.chat.status === "ready" &&
          entry.pendingEvents.length === 0,
      )
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    while (this.sessions.size > this.maxCachedSessions && candidates.length > 0) {
      const entry = candidates.shift();
      if (!entry) break;
      this.sessions.delete(entry.conversationId);
    }
  }
}

export const chatSessionRegistry = new ChatSessionRegistry();
