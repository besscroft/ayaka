/**
 * AI Elements 组件索引
 *
 * 对外统一暴露 ai-elements 的组件，便于上层 import：
 *   import { Conversation, Message, ... } from "@/components/ai-elements";
 *
 * 风格说明：
 *  - 子模块文件按 AI Elements 官方组件一一对应（conversation / message / prompt-input / reasoning / tool）
 *  - 通过本入口聚合，调用方无需关心文件拆分
 */
export {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "./conversation";

export { Message, MessageContent, MessageResponse } from "./message";
export {
  getMediaKindFromUrl,
  parseRichContentBlocks,
  sanitizeRichContentUrl,
} from "./rich-content-utils";
export { RichContent } from "./rich-content";

export {
  PromptInput,
  PromptInputTextarea,
  PromptInputSubmit,
  type PromptInputMessage,
} from "./prompt-input";

export { Reasoning, ReasoningTrigger, ReasoningContent, useReasoning } from "./reasoning";

export { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput, type ToolState } from "./tool";

/* ----- v2 创意扩展组件 ----- */

export {
  EmojiPicker,
  DEFAULT_EMOJI_CATEGORIES,
  type EmojiEntry,
  type EmojiCategory,
} from "./emoji-picker";

export { AttachmentChip, type AttachmentItem } from "./attachment-chip";

export { MessageAttachments, type FilePartLike } from "./message-attachments";
export { ImageLightbox, type ImageLightboxItem } from "./image-lightbox";

export { PromptSuggestions } from "./prompt-suggestions";

/* ----- v3 新增：对话操作与高级组件 ----- */

export {
  ChainOfThought,
  ChainOfThoughtStep,
  ChainOfThoughtSearchResults,
  ChainOfThoughtSearchResult,
  ChainOfThoughtImage,
  type ChainStepStatus,
  type ChainStepIcon,
} from "./chain-of-thought";

export { Context, ContextPopover, estimateTokens, type ContextMetrics } from "./context";

export { Queue, QueueSection, QueueList, QueueItem, type QueueItemStatus } from "./queue";

export { Task, TaskTrigger, TaskContent, TaskItem, TaskSection, type TaskItemStatus } from "./task";

export { ConversationStatus, type ConversationStatusKind } from "./conversation-status";

export { MessageActions } from "./message-actions";
export { EditableMessage } from "./editable-message";
