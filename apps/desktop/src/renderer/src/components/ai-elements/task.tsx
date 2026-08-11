/**
 * AI Elements - Task 组件
 *
 * 源码参考：https://elements.ai-sdk.dev/components/task
 *
 * 设计目标：
 *  - 可折叠的任务列表（details/summary）
 *  - 每个任务展示：状态指示器 + 标题 + 描述
 *  - 状态：pending（待办）、in_progress（进行中）、complete（完成）
 *  - 整体可作为 Container 使用，也可作为单条 Task 使用
 *
 * 用法：
 *   <Task defaultOpen>
 *     <TaskTrigger title="搜索资料" count={3} completed={2} />
 *     <TaskContent>
 *       <TaskItem status="complete">关键词识别</TaskItem>
 *       <TaskItem status="in_progress">候选文档检索</TaskItem>
 *       <TaskItem status="pending">结果排序</TaskItem>
 *     </TaskContent>
 *   </Task>
 */
import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { IconCheckSquare, IconChevronDown, IconCircle, IconCircleDashed, IconList } from "../icons";

/* ---------- 类型 ---------- */

export type TaskItemStatus = "pending" | "in_progress" | "complete";

/* ---------- 容器 Task ---------- */

interface TaskProps extends Omit<HTMLAttributes<HTMLDetailsElement>, "title"> {
  defaultOpen?: boolean;
  open?: boolean;
  children?: ReactNode;
}

/** 任务列表容器（HTML5 <details>） */
export function Task({
  className,
  defaultOpen = true,
  open,
  children,
  ...rest
}: TaskProps): React.JSX.Element {
  return (
    <details
      data-slot="task"
      open={open ?? defaultOpen}
      className={cn(
        "group/task rounded-lg border border-border bg-card",
        "overflow-hidden",
        className,
      )}
      {...rest}
    >
      {children}
    </details>
  );
}

/* ---------- 触发器 TaskTrigger ---------- */

interface TaskTriggerProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** 任务列表标题 */
  title: ReactNode;
  /** 总任务数 */
  count?: number;
  /** 已完成数（用于显示 "1/3"） */
  completed?: number;
  /** 自定义状态覆盖：默认根据 completed 推断 */
  status?: TaskItemStatus;
}

/** 任务列表触发器（summary） */
export function TaskTrigger({
  title,
  count,
  completed,
  status: statusProp,
  className,
  children,
  ...rest
}: TaskTriggerProps): React.JSX.Element {
  const hasCount = typeof count === "number" && count > 0;
  const derivedStatus: TaskItemStatus =
    statusProp ??
    (hasCount
      ? (completed ?? 0) >= count
        ? "complete"
        : (completed ?? 0) > 0
          ? "in_progress"
          : "pending"
      : "pending");
  const StatusIcon =
    derivedStatus === "complete"
      ? IconCheckSquare
      : derivedStatus === "in_progress"
        ? IconCircleDashed
        : IconCircle;

  return (
    <summary
      data-slot="task-trigger"
      data-status={derivedStatus}
      className={cn(
        "flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium",
        "[&::-webkit-details-marker]:hidden",
        "hover:bg-muted",
        className,
      )}
      {...(rest as HTMLAttributes<HTMLElement>)}
    >
      <span
        className={cn(
          "flex size-6 items-center justify-center rounded-md",
          derivedStatus === "complete" && "bg-success/10 text-success",
          derivedStatus === "in_progress" && "bg-accent/12 text-primary",
          derivedStatus === "pending" && "bg-muted text-muted-foreground",
        )}
      >
        <StatusIcon
          className={cn("size-3.5", derivedStatus === "in_progress" && "animate-pulse")}
        />
      </span>
      <span className="flex-1 truncate text-foreground/85">{title}</span>
      {hasCount ? (
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10.5px] font-medium tabular-nums",
            derivedStatus === "complete"
              ? "bg-success/12 text-success"
              : "bg-muted text-muted-foreground",
          )}
        >
          {completed ?? 0}/{count}
        </span>
      ) : null}
      <IconChevronDown
        className={cn(
          "size-3.5 shrink-0 text-foreground/45 transition-transform",
          "group-open/task:rotate-180",
        )}
      />
      {children}
    </summary>
  );
}

/* ---------- 内容容器 TaskContent ---------- */

interface TaskContentProps extends Omit<HTMLAttributes<HTMLUListElement>, "title"> {
  children?: ReactNode;
}

/** 任务列表内容容器 */
export function TaskContent({ className, children, ...rest }: TaskContentProps): React.JSX.Element {
  return (
    <ul
      data-slot="task-content"
      className={cn("flex flex-col gap-0.5 border-t border-border px-2 py-2 text-xs", className)}
      {...rest}
    >
      {children}
    </ul>
  );
}

/* ---------- 单条任务 TaskItem ---------- */

interface TaskItemProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
  status?: TaskItemStatus;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

const ITEM_ICON: Record<TaskItemStatus, typeof IconCircle> = {
  pending: IconCircle,
  in_progress: IconCircleDashed,
  complete: IconCheckSquare,
};

/** 单条任务项 */
export function TaskItem({
  status = "pending",
  title,
  description,
  className,
  children,
  ...rest
}: TaskItemProps): React.JSX.Element {
  const Icon = ITEM_ICON[status];
  return (
    <li
      data-slot="task-item"
      data-status={status}
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5",
        "transition hover:bg-muted",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center",
          status === "complete" && "text-success",
          status === "in_progress" && "text-primary",
          status === "pending" && "text-foreground/35",
        )}
      >
        <Icon className={cn("size-3.5", status === "in_progress" && "animate-pulse")} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className={cn(
            "truncate text-[12px] font-medium",
            status === "complete" ? "text-foreground/55 line-through" : "text-foreground/85",
            status === "pending" && "text-foreground/55",
          )}
        >
          {title}
        </p>
        {description ? (
          <p className="text-[11px] leading-relaxed text-foreground/50">{description}</p>
        ) : null}
        {children}
      </div>
    </li>
  );
}

/* ---------- 队列简易封装 QueueSection ---------- */
/**
 * 队列区域（用于聚合 Task / List / 消息队列）
 * 这里仅给出一个最小可用的 Section 容器，便于 ChatView 把 Task 嵌入侧栏。
 */
interface TaskSectionProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  count?: number;
  children?: ReactNode;
}

export function TaskSection({
  title,
  count,
  className,
  children,
  ...rest
}: TaskSectionProps): React.JSX.Element {
  return (
    <section
      data-slot="task-section"
      className={cn("rounded-lg border border-border bg-card", className)}
      {...rest}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <span className="flex size-5 items-center justify-center rounded-md bg-muted text-foreground/65">
          <IconList className="size-3" />
        </span>
        <p className="flex-1 text-[12px] font-semibold text-foreground/75">{title}</p>
        {typeof count === "number" ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            {count}
          </span>
        ) : null}
      </header>
      <div className="border-t border-border">{children}</div>
    </section>
  );
}
