/**
 * AI Elements - Queue 组件
 *
 * 源码参考：https://elements.ai-sdk.dev/components/queue
 *
 * 设计目标：
 *  - 通用队列容器：消息列表 / 待办事项 / 任务区域都共用同一壳
 *  - 提供 QueueSection（带标题的折叠分区）和 QueueList（条目列表）
 *  - 条目支持状态点（pending / active / done）
 *
 * 用法：
 *   <Queue>
 *     <QueueSection title="Message Queue">
 *       <QueueList>
 *         <QueueItem status="active">正在流式输出</QueueItem>
 *         <QueueItem status="pending">待发送</QueueItem>
 *       </QueueList>
 *     </QueueSection>
 *   </Queue>
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT, type TranslationKey } from "../../lib/i18n";
import { IconChevronDown, IconList, IconStatusDot } from "../icons";

/* ---------- 类型 ---------- */

export type QueueItemStatus = "pending" | "active" | "done";

/* ---------- Queue 容器 ---------- */

interface QueueProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  children?: ReactNode;
}

/** 队列外壳：浅色背景的纵向容器 */
export function Queue({ title, className, children, ...rest }: QueueProps): React.JSX.Element {
  return (
    <div
      data-slot="queue"
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border border-border bg-background/40 p-2.5",
        className,
      )}
      {...rest}
    >
      {title ? (
        <p className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <IconList className="size-3" />
          {title}
        </p>
      ) : null}
      {children}
    </div>
  );
}

/* ---------- QueueSection 分区 ---------- */

interface QueueSectionProps extends Omit<HTMLAttributes<HTMLDetailsElement>, "title"> {
  title: ReactNode;
  count?: number;
  defaultOpen?: boolean;
  open?: boolean;
  children?: ReactNode;
}

/** 队列分区：可折叠的子区域 */
export function QueueSection({
  title,
  count,
  defaultOpen = true,
  open,
  className,
  children,
  ...rest
}: QueueSectionProps): React.JSX.Element {
  return (
    <details
      data-slot="queue-section"
      open={open ?? defaultOpen}
      className={cn(
        "group/sec overflow-hidden rounded-lg border border-border bg-muted/20",
        className,
      )}
      {...rest}
    >
      <summary
        data-slot="queue-section-trigger"
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-[11.5px] font-medium",
          "[&::-webkit-details-marker]:hidden",
          "hover:bg-muted/60",
        )}
      >
        <span className="flex-1 truncate text-foreground">{title}</span>
        {typeof count === "number" ? (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
        <IconChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground transition-transform",
            "group-open/sec:rotate-180",
          )}
        />
      </summary>
      <div className="border-t border-border p-1.5">{children}</div>
    </details>
  );
}

/* ---------- QueueList 条目列表 ---------- */

interface QueueListProps extends HTMLAttributes<HTMLUListElement> {
  children?: ReactNode;
}

/** 条目列表（ul） */
export function QueueList({ className, children, ...rest }: QueueListProps): React.JSX.Element {
  return (
    <ul data-slot="queue-list" className={cn("flex flex-col gap-0.5", className)} {...rest}>
      {children}
    </ul>
  );
}

/* ---------- QueueItem 条目 ---------- */

interface QueueItemProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
  status?: QueueItemStatus;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

const STATUS_TONE: Record<QueueItemStatus, string> = {
  pending: "text-foreground/35",
  active: "text-accent",
  done: "text-success",
};

const STATUS_LABEL_KEY: Record<QueueItemStatus, TranslationKey> = {
  pending: "queue.status.queued",
  active: "queue.status.active",
  done: "queue.status.done",
};

/** 单条队列条目 */
export function QueueItem({
  status = "pending",
  title,
  description,
  className,
  children,
  ...rest
}: QueueItemProps): React.JSX.Element {
  const { t } = useT();
  return (
    <li
      data-slot="queue-item"
      data-status={status}
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs transition",
        "hover:bg-muted",
        className,
      )}
      {...rest}
    >
      <span className={cn("mt-1 shrink-0", STATUS_TONE[status])}>
        <IconStatusDot className={cn("size-1.5", status === "active" && "animate-pulse")} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <p
            className={cn(
              "truncate text-[12px] font-medium",
              status === "done" ? "text-muted-foreground line-through" : "text-foreground/85",
            )}
          >
            {title}
          </p>
          <span
            className={cn(
              "ml-auto rounded-full bg-muted px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wider",
              STATUS_TONE[status],
            )}
          >
            {t(STATUS_LABEL_KEY[status])}
          </span>
        </div>
        {description ? (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-foreground/50">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </li>
  );
}
