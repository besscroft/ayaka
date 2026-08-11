/**
 * AI Elements - ConversationStatus 组件
 *
 * 设计目标：
 *  - 在 ChatView 头部展示对话当前状态
 *  - 状态：ready（就绪）、streaming（生成中）、submitted（已提交待连接）、
 *         stopped（用户手动停止）、error（错误）
 *  - 视觉：紧凑徽章 + 状态点（带脉冲）
 *
 * 用法：
 *   <ConversationStatus status="streaming" label="Void is thinking..." />
 */
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT, type TranslationKey } from "../../lib/i18n";
import { IconStatusDot } from "../icons";

/* ---------- 类型 ---------- */

export type ConversationStatusKind = "ready" | "submitted" | "streaming" | "stopped" | "error";

interface ConversationStatusProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  status: ConversationStatusKind;
  /** 自定义状态文案（可选；默认按 status 推断） */
  label?: ReactNode;
}

const STATUS_META: Record<
  ConversationStatusKind,
  { labelKey: TranslationKey; tone: string; dotClass: string; pulse: boolean }
> = {
  ready: {
    labelKey: "chat.status.ready",
    tone: "bg-muted text-muted-foreground",
    dotClass: "text-muted-foreground",
    pulse: false,
  },
  submitted: {
    labelKey: "chat.status.submitted",
    tone: "bg-primary/10 text-primary",
    dotClass: "text-primary",
    pulse: true,
  },
  streaming: {
    labelKey: "chat.status.streaming",
    tone: "bg-primary/10 text-primary",
    dotClass: "text-primary",
    pulse: true,
  },
  stopped: {
    labelKey: "chat.status.stopped",
    tone: "bg-warning/15 text-warning",
    dotClass: "text-warning",
    pulse: false,
  },
  error: {
    labelKey: "chat.status.error",
    tone: "bg-danger/15 text-danger",
    dotClass: "text-danger",
    pulse: false,
  },
};

/**
 * 对话状态徽章
 *  - 紧凑胶囊：状态点 + 文字
 *  - 动效：streaming/submitted 时状态点带脉冲
 */
export function ConversationStatus({
  status,
  label,
  className,
  ...rest
}: ConversationStatusProps): React.JSX.Element {
  const { t } = useT();
  const meta = STATUS_META[status];
  return (
    <div
      data-slot="conversation-status"
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-medium",
        meta.tone,
        className,
      )}
      {...rest}
    >
      <IconStatusDot className={cn("size-1.5", meta.dotClass, meta.pulse && "animate-pulse")} />
      <span>{label ?? t(meta.labelKey)}</span>
    </div>
  );
}
