/**
 * 消息列表
 *
 * 负责：
 *  - 渲染消息气泡、reasoning（思维链）、tool、source、附件
 *  - 提供每条消息的 hover 动作条：复制 / 编辑 / 重新发送 / 删除
 *  - 编辑态：把消息气泡替换为 EditableMessage
 *  - 错误展示与重试
 *
 * 与 ChatView 的契约：
 *  - onEditMessage(messageId, newText)  把指定 user 消息改为 newText，
 *    并触发后续 assistant 的重新生成
 *  - onResendMessage(messageId)  从该 user 消息开始重新生成
 *  - onDeleteMessage(messageId)  删除该消息；如果删的是 user 消息，
 *    紧跟其后的 assistant 消息也会被一并删除（保持角色交替）
 */
import { Fragment, memo, useCallback, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ChatAddToolApproveResponseFunction, UIMessage } from "ai";
import { MEDIA_GENERATION_TOOL_NAME, type MediaGenerationResponse } from "@shared/types";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  EditableMessage,
  Message,
  MessageActions,
  MessageAttachments,
  MessageContent,
  MessageResponse,
  PromptSuggestions,
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ConversationStatusKind,
  type FilePartLike,
} from "./ai-elements";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { readChatMessageMetadata } from "../lib/chat-messages";
import { GeneratedToolResult } from "./GeneratedToolResult";
import {
  getToolPartName,
  getToolSummary,
  isSilentToolPart,
  normalizeToolState,
  type RenderableToolPart,
} from "../lib/generated-tool-ui";
import { IconBrain, IconCopy } from "./icons";

interface MessageListProps {
  conversationId?: string;
  messages: UIMessage[];
  isLoading: boolean;
  status: ConversationStatusKind;
  error?: Error;
  errorDetail?: string | null;
  /** 后备建议（empty 状态） */
  emptySuggestions?: string[];
  followupSuggestions?: string[];
  onRetry?: () => void;
  onRetryMessage?: (messageId: string) => Promise<void> | void;
  onDismissError?: () => void;
  /** 用户消息编辑回调：编辑后重新发送 */
  onEditMessage?: (messageId: string, newText: string) => Promise<void> | void;
  /** 用户消息重新发送回调 */
  onResendMessage?: (messageId: string) => Promise<void> | void;
  /** 消息删除回调 */
  onDeleteMessage?: (messageId: string) => void;
  /** 建议被点击时 */
  onSuggestion?: (prompt: string) => void;
  onToolApprovalResponse?: ChatAddToolApproveResponseFunction;
}

type MessagePart = UIMessage["parts"][number];
type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
type SourcePart = Extract<MessagePart, { type: "source-url" | "source-document" }>;

export function isMessageStreaming(isLoading: boolean, index: number, lastIndex: number): boolean {
  return isLoading && index === lastIndex;
}

export function MessageList({
  conversationId,
  messages,
  isLoading,
  status,
  error,
  errorDetail,
  emptySuggestions,
  followupSuggestions,
  onRetry,
  onRetryMessage,
  onDismissError,
  onEditMessage,
  onResendMessage,
  onDeleteMessage,
  onSuggestion,
  onToolApprovalResponse,
}: MessageListProps): React.JSX.Element {
  const { t } = useT();
  const callbacksRef = useRef({
    onEditMessage,
    onResendMessage,
    onDeleteMessage,
    onRetryMessage,
    onToolApprovalResponse,
  });
  callbacksRef.current = {
    onEditMessage,
    onResendMessage,
    onDeleteMessage,
    onRetryMessage,
    onToolApprovalResponse,
  };
  const stableEditMessage = useCallback(
    (messageId: string, text: string) => callbacksRef.current.onEditMessage?.(messageId, text),
    [],
  );
  const stableResendMessage = useCallback(
    (messageId: string) => callbacksRef.current.onResendMessage?.(messageId),
    [],
  );
  const stableDeleteMessage = useCallback(
    (messageId: string) => callbacksRef.current.onDeleteMessage?.(messageId),
    [],
  );
  const stableRetryMessage = useCallback(
    (messageId: string) => callbacksRef.current.onRetryMessage?.(messageId),
    [],
  );
  const stableToolApprovalResponse = useCallback<ChatAddToolApproveResponseFunction>(
    (options) => callbacksRef.current.onToolApprovalResponse?.(options),
    [],
  );
  const activityStatus = getMessageActivityStatus(messages, isLoading, status);
  const lastMessage = messages.at(-1);
  const showLiveThinking = shouldShowLiveThinking(messages, isLoading, status);
  const shouldShowFollowups =
    !isLoading &&
    status === "ready" &&
    !error &&
    lastMessage?.role === "assistant" &&
    !!onSuggestion &&
    !!followupSuggestions?.length;

  if (messages.length === 0 && !isLoading) {
    return (
      <Conversation>
        <ConversationContent>
          {emptySuggestions && emptySuggestions.length > 0 && onSuggestion ? (
            <ConversationEmptyState title={t("msg.empty.title")} description={t("msg.empty.desc")}>
              <PromptSuggestions
                title={t("chat.suggestions.title")}
                suggestions={emptySuggestions}
                onSelect={onSuggestion}
                className="mt-4 w-full"
              />
            </ConversationEmptyState>
          ) : (
            <ConversationEmptyState
              title={t("msg.empty.title")}
              description={t("msg.empty.desc")}
            />
          )}
        </ConversationContent>
      </Conversation>
    );
  }

  return (
    <Conversation>
      <ConversationContent>
        {messages.map((message, index) => (
          <motion.div
            key={message.id}
            layout={isLoading ? false : "position"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <MemoMessageItem
              conversationId={conversationId}
              message={message}
              isLastMessage={index === messages.length - 1}
              isStreaming={isMessageStreaming(isLoading, index, messages.length - 1)}
              onEdit={onEditMessage ? stableEditMessage : undefined}
              onResend={onResendMessage ? stableResendMessage : undefined}
              onDelete={onDeleteMessage ? stableDeleteMessage : undefined}
              onRetry={onRetryMessage ? stableRetryMessage : undefined}
              onToolApprovalResponse={
                onToolApprovalResponse ? stableToolApprovalResponse : undefined
              }
            />
          </motion.div>
        ))}

        {shouldShowFollowups ? (
          <motion.div
            key="followup-suggestions"
            layout="position"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="flex justify-start"
          >
            <PromptSuggestions
              title={t("chat.followups.title")}
              suggestions={followupSuggestions ?? []}
              onSelect={(prompt) => onSuggestion?.(prompt)}
              className="max-w-[min(1050px,100%)] pr-6 sm:pr-10 lg:pr-16"
            />
          </motion.div>
        ) : null}

        {showLiveThinking && activityStatus ? (
          <motion.div
            key="live-thinking"
            layout={isLoading ? false : "position"}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            <LiveThinkingPanel status={activityStatus} />
          </motion.div>
        ) : null}

        {error && (
          <div className="rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <p className="font-medium">{t("msg.error.title")}</p>
            <p className="mt-1 leading-relaxed opacity-85">
              {errorDetail || t("error.chat.unknown")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="rounded-md border border-danger/30 bg-background/70 px-2.5 py-1 text-xs font-medium text-danger transition hover:bg-background"
                >
                  {t("common.retry")}
                </button>
              )}
              {onDismissError && (
                <button
                  type="button"
                  onClick={onDismissError}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-danger/75 transition hover:bg-danger/10"
                >
                  {t("common.close")}
                </button>
              )}
            </div>
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  );
}

/* ---------- 单条消息 ---------- */

export type MessageActivityStatus =
  | "submitted"
  | "thinking"
  | "tool-calling"
  | "waiting-approval"
  | "responding";

export interface ReasoningDisplay {
  partIndex: number;
  text: string;
  isStreaming: boolean;
}

function getLiveThinkingTitle(
  status: MessageActivityStatus,
  t: ReturnType<typeof useT>["t"],
): string {
  if (status === "submitted") return t("msg.thinking.connecting");
  if (status === "responding") return t("msg.thinking.responding");
  if (status === "tool-calling") return t("msg.activity.toolCalling");
  if (status === "waiting-approval") return t("msg.activity.waitingApproval");
  return t("msg.thinking.waiting");
}

export function LiveThinkingPanel({
  status,
}: {
  status: MessageActivityStatus;
}): React.JSX.Element {
  const { t } = useT();
  const liveTitle = getLiveThinkingTitle(status, t);
  return (
    <Message from="assistant">
      <MessageContent data-from="assistant">
        <div
          data-slot="live-thinking-status"
          className="flex items-center gap-2 py-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <IconBrain className="size-4 text-muted-foreground/70" />
          <span>{liveTitle}</span>
        </div>
      </MessageContent>
    </Message>
  );
}

export function hasRenderableActivity(parts: UIMessage["parts"]): boolean {
  return parts
    .filter((part) => !isSilentToolPart(part))
    .some((part) => isToolPart(part) || isSourcePart(part) || isAttachmentPart(part));
}

export function getMessageActivityStatus(
  messages: UIMessage[],
  isLoading: boolean,
  status: ConversationStatusKind,
): MessageActivityStatus | null {
  if (!isLoading) return null;
  if (status === "submitted") return "submitted";
  if (status !== "streaming") return null;

  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== "assistant") return "thinking";
  const parts = (lastMessage.parts ?? []).filter((part) => !isSilentToolPart(part));
  const lastVisiblePart = [...parts]
    .reverse()
    .find((part) => isTextPart(part) || isReasoningPart(part) || isToolPart(part));
  if (!lastVisiblePart) return "thinking";
  if (isReasoningPart(lastVisiblePart)) return "thinking";
  if (isTextPart(lastVisiblePart)) return "responding";
  if (isToolPart(lastVisiblePart)) {
    const toolState = normalizeToolState(lastVisiblePart.state);
    if (toolState === "approval-requested") return "waiting-approval";
    if (toolState === "input-streaming" || toolState === "input-available") {
      return "tool-calling";
    }
  }
  return "thinking";
}

export function shouldShowLiveThinking(
  messages: UIMessage[],
  isLoading: boolean,
  status: ConversationStatusKind,
): boolean {
  if (getMessageActivityStatus(messages, isLoading, status) === null) return false;
  const lastMessage = messages.at(-1);
  if (!lastMessage || lastMessage.role !== "assistant") return true;
  const parts = (lastMessage.parts ?? []).filter((part) => !isSilentToolPart(part));
  return getReasoningDisplays(parts, isLoading).length === 0 && !hasRenderableActivity(parts);
}

export function getReasoningDisplays(
  parts: UIMessage["parts"],
  messageStreaming: boolean,
): ReasoningDisplay[] {
  const lastVisiblePartIndex = parts.reduce(
    (lastIndex, part, partIndex) => (isSilentToolPart(part) ? lastIndex : partIndex),
    -1,
  );
  return parts.flatMap((part, partIndex) => {
    if (!isReasoningPart(part)) return [];

    const isStreaming =
      messageStreaming && partIndex === lastVisiblePartIndex && part.state !== "done";
    if (!part.text && !isStreaming) return [];

    return [{ partIndex, text: part.text, isStreaming }];
  });
}

export interface MessageItemProps {
  conversationId?: string;
  message: UIMessage;
  isLastMessage: boolean;
  isStreaming: boolean;
  onEdit?: (messageId: string, newText: string) => Promise<void> | void;
  onResend?: (messageId: string) => Promise<void> | void;
  onDelete?: (messageId: string) => void;
  onRetry?: (messageId: string) => Promise<void> | void;
  onToolApprovalResponse?: ChatAddToolApproveResponseFunction;
}

/**
 * 单条消息容器
 *  - 渲染 Message（外壳）+ MessageContent（气泡）+ MessageActions（操作条）
 *  - 操作条放在气泡下方，hover 时浮现
 *  - 编辑态：整个替换为 EditableMessage
 */
function MessageItem({
  conversationId,
  message,
  isLastMessage,
  isStreaming,
  onEdit,
  onResend,
  onDelete,
  onRetry,
  onToolApprovalResponse,
}: MessageItemProps): React.JSX.Element {
  const { t, f } = useT();
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const allParts = message.parts ?? [];
  const parts = allParts.filter((part) => !isSilentToolPart(part));
  const messageStreaming = isLastMessage && isStreaming;
  const reasoningDisplays = getReasoningDisplays(allParts, messageStreaming);
  const reasoningDisplaysByPartIndex = new Map(
    reasoningDisplays.map((display) => [display.partIndex, display]),
  );
  const fileParts = parts.filter(isAttachmentPart) as unknown as FilePartLike[];
  const sourceParts = parts.filter(isSourcePart);
  const textParts = parts.filter(isTextPart).map((part) => part.text);
  const fullText = textParts.join("\n\n");
  const metadata = readChatMessageMetadata(message);
  const executionTime = formatExecutionTime(metadata.execution?.durationMs, f);
  const isUser = message.role === "user";
  const isMediaError = message.role === "assistant" && isMediaGenerationError(message);
  // 是否允许 hover 动作（仅在非流式中）
  const actionsEnabled = !messageStreaming;

  /* ---------- 复制 ---------- */
  const handleCopy = async (): Promise<void> => {
    if (!fullText) return;
    try {
      await navigator.clipboard.writeText(fullText);
      setCopyState("copied");
      notify.success(t("msg.copied"));
      setTimeout(() => setCopyState("idle"), 1500);
    } catch (err) {
      console.error("[chat] copy failed:", err);
    }
  };

  /* ---------- 进入编辑态 ---------- */
  const startEdit = (): void => {
    if (isUser) {
      setEditValue(fullText);
      setEditing(true);
    }
  };

  const cancelEdit = (): void => {
    setEditing(false);
    setEditValue("");
  };

  /* ---------- 保存编辑：调用 onEdit 回调 ---------- */
  const handleEditSave = async (): Promise<void> => {
    if (!onEdit) return;
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === fullText) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      await onEdit(message.id, trimmed);
      setEditing(false);
      setEditValue("");
    } catch (err) {
      console.error("[chat] edit failed:", err);
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 重新发送：仅 user 消息 ---------- */
  const handleResend = async (): Promise<void> => {
    if (!onResend || !isUser) return;
    try {
      await onResend(message.id);
    } catch (err) {
      console.error("[chat] resend failed:", err);
    }
  };

  /* ---------- 重试媒体生成：仅媒体错误 assistant 消息 ---------- */
  const handleMediaRetry = async (): Promise<void> => {
    if (!onRetry || !isMediaError) return;
    try {
      await onRetry(message.id);
    } catch (err) {
      console.error("[chat] media retry failed:", err);
    }
  };

  /* ---------- 删除：user 同时删除紧跟其后的 assistant ---------- */
  const handleDelete = (): void => {
    if (!onDelete) return;
    onDelete(message.id);
  };

  /* ---------- 编辑态：替换为 EditableMessage（无操作条） ---------- */
  if (editing && isUser) {
    return (
      <Message from={message.role}>
        <EditableMessage
          value={editValue}
          onChange={setEditValue}
          onSave={handleEditSave}
          onCancel={cancelEdit}
          isSaving={saving}
        />
      </Message>
    );
  }

  return (
    <Message from={message.role}>
      {message.role === "assistant" && sourceParts.length > 0 ? (
        <Sources className="mb-1">
          <SourcesTrigger count={sourceParts.length}>
            <span className="font-medium">
              {t("msg.cot.sources", { count: f.number(sourceParts.length) })}
            </span>
            <span aria-hidden="true">⌄</span>
          </SourcesTrigger>
          <SourcesContent>
            {sourceParts.map((source) => {
              const title =
                source.type === "source-url"
                  ? source.title || source.url
                  : source.title || source.filename || t("msg.cot.document");
              return (
                <Source
                  key={`${source.type}-${source.sourceId}`}
                  href={source.type === "source-url" ? source.url : undefined}
                  title={title}
                />
              );
            })}
          </SourcesContent>
        </Sources>
      ) : null}
      {/* 气泡本体：思维链、附件、各类 part */}
      <MessageContent data-from={message.role}>
        {fileParts.length > 0 && (
          <MessageAttachments conversationId={conversationId} parts={fileParts} />
        )}

        {allParts.map((part, index) => {
          const key = message.id + "-" + index;
          if (isSilentToolPart(part)) {
            return <Fragment key={key} />;
          }

          if (part.type === "reasoning") {
            const display = reasoningDisplaysByPartIndex.get(index);
            if (!display) return <Fragment key={key} />;

            return (
              <Reasoning
                key={`${message.id}-reasoning-${index}`}
                isStreaming={display.isStreaming}
                className="w-full"
              >
                <ReasoningTrigger
                  getThinkingMessage={(streaming) =>
                    streaming ? t("msg.cot.reasoningActive") : t("msg.cot.reasoned")
                  }
                />
                <ReasoningContent>{display.text}</ReasoningContent>
              </Reasoning>
            );
          }

          if (
            part.type === "reasoning-file" ||
            part.type === "source-url" ||
            part.type === "source-document" ||
            part.type === "step-start" ||
            part.type === "custom" ||
            part.type.startsWith("data-")
          ) {
            return <Fragment key={key} />;
          }

          if (part.type === "file") {
            return <Fragment key={key} />;
          }

          if (part.type === "text") {
            return <MessageResponse key={key}>{part.text}</MessageResponse>;
          }

          if (isToolPart(part)) {
            const state = normalizeToolState(part.state);
            const hasExplicitState = part.state !== undefined;
            const approval = part.approval;
            const mediaResult = state === "output-available" ? readMediaToolResult(part) : null;
            const generatedResult =
              state === "output-available" && !mediaResult ? (
                <GeneratedToolResult part={part} />
              ) : null;
            const summary = getToolSummary(part);
            return (
              <Fragment key={key}>
                <Tool active={hasExplicitState && isActiveToolState(state)} defaultOpen={false}>
                  <ToolHeader
                    type={part.type}
                    toolName={part.type === "dynamic-tool" ? part.toolName : undefined}
                    title={part.title}
                    state={state}
                    summary={summary ? t(summary.key, summary.params) : undefined}
                  />
                  <ToolContent>
                    <ToolInput input={part.input} />
                    {approval && state === "approval-requested" && approval.isAutomatic !== true ? (
                      <ToolApprovalActions
                        approvalId={approval.id}
                        onRespond={onToolApprovalResponse}
                      />
                    ) : null}
                    <ToolOutput
                      output={
                        mediaResult
                          ? undefined
                          : (generatedResult ??
                            renderToolOutput(part.output, t("tool.unserializable")))
                      }
                      errorText={part.errorText}
                    />
                  </ToolContent>
                </Tool>
                {mediaResult ? (
                  <MediaToolResult conversationId={conversationId} response={mediaResult} />
                ) : null}
              </Fragment>
            );
          }

          return <Fragment key={key} />;
        })}
      </MessageContent>

      {/* 操作条：放在气泡下方，hover 时浮现（仅气泡外的小行） */}
      {actionsEnabled && fullText && (
        <MessageActions
          placement={isUser ? "left" : "right"}
          onCopy={handleCopy}
          onEdit={isUser && onEdit ? startEdit : undefined}
          onResend={
            isUser && onResend
              ? handleResend
              : isMediaError && onRetry
                ? handleMediaRetry
                : undefined
          }
          onDelete={onDelete ? handleDelete : undefined}
        />
      )}

      {message.role === "assistant" && !messageStreaming && executionTime && (
        <span className="mt-0.5 text-[10.5px] leading-none text-foreground/40">
          {t("msg.executionTime", { duration: executionTime })}
        </span>
      )}
      {message.role === "assistant" &&
      !messageStreaming &&
      metadata.execution?.agentPath &&
      metadata.execution.agentPath !== "/root" ? (
        <span className="mt-1 text-[10.5px] leading-none text-foreground/45">
          {t("msg.agentOwner", { path: metadata.execution.agentPath })}
        </span>
      ) : null}

      <AnimatePresence initial={false}>
        {message.role === "assistant" && !messageStreaming && copyState === "copied" ? (
          <motion.span
            key="copied"
            initial={{ opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.14 }}
            className="mt-1 inline-flex items-center gap-1 text-[10px] text-success"
          >
            <IconCopy className="size-2.5" />
            {t("msg.copied")}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </Message>
  );
}

/* ---------- 类型守卫 ---------- */

export function areMessageItemPropsEqual(
  previous: MessageItemProps,
  next: MessageItemProps,
): boolean {
  return (
    previous.message === next.message &&
    previous.conversationId === next.conversationId &&
    previous.isLastMessage === next.isLastMessage &&
    previous.isStreaming === next.isStreaming &&
    previous.onEdit === next.onEdit &&
    previous.onResend === next.onResend &&
    previous.onDelete === next.onDelete &&
    previous.onRetry === next.onRetry &&
    previous.onToolApprovalResponse === next.onToolApprovalResponse
  );
}

const MemoMessageItem = memo(MessageItem, areMessageItemPropsEqual);

function formatExecutionTime(
  durationMs: number | undefined,
  f: { fixed: (value: number, digits: number) => string },
): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs)) return null;
  const seconds = Math.max(0, durationMs) / 1000;
  return f.fixed(seconds, seconds < 10 ? 1 : 0);
}

function ToolApprovalActions({
  approvalId,
  onRespond,
}: {
  approvalId: string;
  onRespond?: ChatAddToolApproveResponseFunction;
}): React.JSX.Element {
  const { t } = useT();
  if (!onRespond) {
    return (
      <p className="mb-2 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-xs text-warning">
        {t("tool.approval.unavailable")}
      </p>
    );
  }

  return (
    <div className="mb-2 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2">
      <p className="text-xs font-medium text-warning">{t("tool.approval.requested")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-md bg-success px-2.5 py-1 text-xs font-semibold text-success-foreground transition hover:opacity-90"
          onClick={() => void onRespond({ id: approvalId, approved: true })}
        >
          {t("tool.approval.approve")}
        </button>
        <button
          type="button"
          className="rounded-md border border-danger/30 bg-background/80 px-2.5 py-1 text-xs font-semibold text-danger transition hover:bg-danger/10"
          onClick={() => void onRespond({ id: approvalId, approved: false })}
        >
          {t("tool.approval.deny")}
        </button>
      </div>
    </div>
  );
}

function isMediaGenerationError(message: UIMessage): boolean {
  const metadata = message.metadata as
    | { mediaGeneration?: { status?: unknown } }
    | null
    | undefined;
  return metadata?.mediaGeneration?.status === "error";
}

function isTextPart(part: MessagePart): part is Extract<MessagePart, { type: "text" }> {
  return part.type === "text";
}

function isReasoningPart(part: MessagePart): part is ReasoningPart {
  return part.type === "reasoning";
}

function isSourcePart(part: MessagePart): part is SourcePart {
  return part.type === "source-url" || part.type === "source-document";
}

function isAttachmentPart(
  part: MessagePart,
): part is Extract<MessagePart, { type: "file" | "reasoning-file" }> {
  return part.type === "file" || part.type === "reasoning-file";
}

function isToolPart(part: MessagePart): part is MessagePart & RenderableToolPart {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

function MediaToolResult({
  conversationId,
  response,
}: {
  conversationId?: string;
  response: MediaGenerationResponse;
}): React.JSX.Element {
  const files: FilePartLike[] = response.files.map((file) => ({
    type: "file",
    mediaType: file.mediaType,
    filename: file.filename,
    url: file.url,
  }));
  return (
    <div className="flex flex-col gap-2">
      {(response.kind === "transcription" || files.length === 0) && response.text.trim() ? (
        <MessageResponse>{response.text.trim()}</MessageResponse>
      ) : null}
      {files.length > 0 ? (
        <MessageAttachments conversationId={conversationId} parts={files} />
      ) : null}
    </div>
  );
}

export function readMediaToolResult(part: RenderableToolPart): MediaGenerationResponse | null {
  const toolName = getToolPartName(part);
  if (toolName !== MEDIA_GENERATION_TOOL_NAME) return null;
  const output = part.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const value = output as Partial<MediaGenerationResponse>;
  if (
    (value.kind !== "image" && value.kind !== "speech" && value.kind !== "transcription") ||
    typeof value.text !== "string" ||
    !Array.isArray(value.files)
  ) {
    return null;
  }
  const files = value.files.filter(
    (file): file is MediaGenerationResponse["files"][number] =>
      !!file &&
      typeof file === "object" &&
      file.type === "file" &&
      typeof file.mediaType === "string" &&
      typeof file.filename === "string" &&
      typeof file.url === "string",
  );
  return {
    kind: value.kind,
    text: value.text,
    files,
    ...(value.metadata && typeof value.metadata === "object" ? { metadata: value.metadata } : {}),
  };
}

function isActiveToolState(state: ReturnType<typeof normalizeToolState>): boolean {
  return (
    state === "input-streaming" || state === "input-available" || state === "approval-requested"
  );
}

export function getToolDefaultOpen(state: ReturnType<typeof normalizeToolState>): boolean {
  void state;
  return false;
}

function renderToolOutput(output: unknown, unserializableLabel: string): ReactNode {
  if (output === undefined || output === null) return undefined;
  if (typeof output === "string" || typeof output === "number" || typeof output === "boolean") {
    return String(output);
  }
  return (
    <pre className="m-0 whitespace-pre-wrap font-mono">
      {safeJsonStringify(output, unserializableLabel)}
    </pre>
  );
}

function safeJsonStringify(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}
