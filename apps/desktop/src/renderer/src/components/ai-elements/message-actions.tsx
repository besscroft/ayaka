/**
 * AI Elements - MessageActions 组件
 *
 * 设计目标：
 *  - 提供一行消息操作按钮，支持常显或 hover 时显示
 *  - 操作：复制、编辑、重新发送、删除
 *  - 视觉：紧凑圆角按钮 + 颜色微差（危险操作用危险色）
 *  - 通过回调把控制权交还给上层（MessageList / ChatView）
 *
 * 用法：
 *   <MessageActions
 *     onCopy={() => copy()}
 *     onEdit={canEdit ? () => startEdit() : undefined}
 *     onResend={canResend ? () => resend() : undefined}
 *     onDelete={canDelete ? () => remove() : undefined}
 *   />
 */
import { type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { IconCopy, IconEdit, IconRefresh, IconTrash } from "../icons";

interface MessageActionsProps extends HTMLMotionProps<"div"> {
  /** 复制回调（必填） */
  onCopy: () => void;
  /** 编辑回调（可选：未传则不渲染按钮） */
  onEdit?: () => void;
  /** 重新发送回调（可选：未传则不渲染按钮） */
  onResend?: () => void;
  /** 删除回调（可选：未传则不渲染按钮） */
  onDelete?: () => void;
  /** 自定义附加按钮（渲染在默认按钮之后） */
  children?: ReactNode;
  /** placement 提示：决定对齐方式。right 表示按钮靠右（assistant 消息），left 表示按钮靠左（user 消息） */
  placement?: "left" | "right";
  /** 是否始终显示操作条；未开启时仅在消息 hover/focus 时显示 */
  alwaysVisible?: boolean;
}

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  tone?: "default" | "danger";
}

/**
 * 操作条
 *  - alwaysVisible=true 时始终显示，否则通过 group-hover/msg 触发
 *  - placement=right 时按钮左对齐（紧跟 assistant 气泡左缘下方）
 *  - placement=left 时按钮右对齐（紧跟 user 气泡右缘下方）
 */
export function MessageActions({
  onCopy,
  onEdit,
  onResend,
  onDelete,
  placement = "right",
  alwaysVisible = false,
  className,
  children,
  ...rest
}: MessageActionsProps): React.JSX.Element {
  const { t } = useT();
  return (
    <motion.div
      data-slot="message-actions"
      data-placement={placement}
      initial={{ y: -3 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.14 }}
      className={cn(
        "flex items-center gap-0.5",
        !alwaysVisible &&
          "opacity-0 transition-opacity group-hover/msg:opacity-100 group-focus-within/msg:opacity-100",
        placement === "right" ? "justify-start" : "justify-end",
        className,
      )}
      role="toolbar"
      aria-label={t("ai.messageActions.toolbar")}
      {...rest}
    >
      <ActionButton label={t("msg.copy")} onClick={onCopy} icon={<IconCopy className="size-3" />} />
      {onEdit ? (
        <ActionButton
          label={t("common.edit")}
          onClick={onEdit}
          icon={<IconEdit className="size-3" />}
        />
      ) : null}
      {onResend ? (
        <ActionButton
          label={t("msg.action.resend")}
          onClick={onResend}
          icon={<IconRefresh className="size-3" />}
        />
      ) : null}
      {onDelete ? (
        <ActionButton
          label={t("common.delete")}
          onClick={onDelete}
          icon={<IconTrash className="size-3" />}
          tone="danger"
        />
      ) : null}
      {children}
    </motion.div>
  );
}

/* ---------- 内部 ActionButton ---------- */

function ActionButton({
  label,
  onClick,
  icon,
  tone = "default",
}: ActionButtonProps): React.JSX.Element {
  return (
    <button
      data-slot="message-action-button"
      data-tone={tone}
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-6 items-center justify-center rounded-md transition",
        tone === "danger"
          ? "text-muted-foreground hover:bg-danger/10 hover:text-danger"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}
