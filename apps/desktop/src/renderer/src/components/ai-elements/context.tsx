/**
 * AI Elements - Context 组件
 *
 * 源码参考：https://elements.ai-sdk.dev/components/context
 *
 * 设计目标：
 *  - 展示上下文窗口的使用情况：used / max
 *  - 显示 token 消耗（input / output）与成本估算
 *  - 视觉：紧凑的进度条 + 数字 + 紧凑徽章
 *  - 同时提供"展开/收起"两种形态：紧凑（默认）显示一行；展开显示更多指标
 *  - ContextPopover：把小图标 + 完整 Context 内容塞进一个 popover；
 *    通常放在输入框附近，hover/click 展开
 *
 * 用法：
 *   <Context
 *     usedTokens={1234}
 *     maxTokens={8192}
 *     inputTokens={800}
 *     outputTokens={434}
 *     costUsd={0.0023}
 *   />
 *
 *   <ContextPopover metrics={...} />   // 输入框旁的图标
 */
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { IconChartBar, IconChevronDown, IconCurrency, IconStatusDot } from "../icons";

/* ---------- 类型 ---------- */

export interface ContextMetrics {
  /** 当前上下文总 token（已用） */
  usedTokens: number;
  /** 上下文窗口上限（按模型设定） */
  maxTokens: number;
  /** 输入侧 token */
  inputTokens?: number;
  /** 输出侧 token */
  outputTokens?: number;
  /** 估算成本（美元） */
  costUsd?: number;
}

interface ContextProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  metrics: ContextMetrics;
  /** 标题文案 */
  title?: ReactNode;
  /** 默认展开 */
  defaultExpanded?: boolean;
  /** 受控展开 */
  expanded?: boolean;
  /** 自定义"上限"标签 */
  maxLabel?: string;
}

/* ---------- 主组件 ---------- */

/**
 * 上下文用量条
 *  - 紧凑（默认）：单行 progress + 百分比
 *  - 展开：增加 input / output / cost 等细分指标
 */
export function Context({
  metrics,
  title,
  defaultExpanded = false,
  expanded,
  maxLabel,
  className,
  ...rest
}: ContextProps): React.JSX.Element {
  const { t, f } = useT();
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isOpen = expanded ?? internalExpanded;
  const displayTitle = title ?? t("chat.context.title");
  const ratio = metrics.maxTokens > 0 ? metrics.usedTokens / metrics.maxTokens : 0;
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  // 颜色阈值：<60% 安全；<85% 提示；>=85% 警告
  const tone = ratio < 0.6 ? "text-success" : ratio < 0.85 ? "text-warning" : "text-danger";
  const barTone =
    ratio < 0.6
      ? "from-success/40 to-success/70"
      : ratio < 0.85
        ? "from-warning/40 to-warning/70"
        : "from-danger/40 to-danger/70";

  return (
    <div
      data-slot="context"
      className={cn("rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs", className)}
      {...rest}
    >
      <button
        data-slot="context-trigger"
        type="button"
        onClick={() => setInternalExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={isOpen}
      >
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-md",
            "bg-muted text-muted-foreground",
          )}
        >
          <IconChartBar className="size-3.5" />
        </span>
        <span className="flex-1 truncate text-[12px] font-medium text-foreground">
          {displayTitle}
        </span>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-medium",
            tone,
          )}
        >
          <IconStatusDot className="size-1.5" />
          {f.compactNumber(metrics.usedTokens)} / {f.compactNumber(metrics.maxTokens)} /{" "}
          {f.number(percent)}%
        </span>
        <IconChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>

      {/* 进度条 */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r transition-all", barTone)}
          style={{ width: `${percent}%` }}
          aria-hidden
        />
      </div>

      {/* 展开区：细分指标 */}
      {isOpen ? (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <Metric
            label={maxLabel ?? t("chat.context.max")}
            value={f.compactNumber(metrics.maxTokens)}
            tone="text-foreground/70"
          />
          <Metric
            label={t("chat.context.input")}
            value={f.compactNumber(metrics.inputTokens ?? 0)}
            tone="text-foreground/70"
          />
          <Metric
            label={t("chat.context.output")}
            value={f.compactNumber(metrics.outputTokens ?? 0)}
            tone="text-foreground/70"
          />
          {typeof metrics.costUsd === "number" ? (
            <Metric
              label={t("chat.context.cost")}
              value={f.usd(metrics.costUsd)}
              tone="text-primary"
              icon={<IconCurrency className="size-3" />}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 内部子组件 ---------- */

interface MetricProps {
  label: ReactNode;
  value: ReactNode;
  tone?: string;
  icon?: ReactNode;
}

function Metric({
  label,
  value,
  tone = "text-foreground/70",
  icon,
}: MetricProps): React.JSX.Element {
  return (
    <div className="rounded-md bg-muted px-2 py-1">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("mt-0.5 text-[12px] font-medium tabular-nums", tone)}>{value}</div>
    </div>
  );
}

/* ---------- 文本估算工具 ---------- */

/**
 * 估算一段文本的 token 数
 *
 * 启发式：
 *  - 英文：1 token ≈ 0.75 word ≈ 4 chars
 *  - 中文：1 token ≈ 1.5 chars（一个汉字约 1-2 token）
 *
 * 仅用于 UI 进度条提示，不需要精确。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 拆中英文：连续 ASCII 段按 4 字符/token；非 ASCII 按 1.5 字符/token
  const matches = text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9\s\p{P}]+/gu) ?? [];
  let total = 0;
  for (const segment of matches) {
    if (/^[\u4e00-\u9fa5]/.test(segment)) {
      total += segment.length / 1.5;
    } else {
      total += segment.length / 4;
    }
  }
  return Math.max(1, Math.round(total));
}

/* ---------- ContextPopover：输入框旁的紧凑图标 + 弹层 ---------- */

interface ContextPopoverProps {
  metrics: ContextMetrics;
  /** 触发模式：hover 展开 / click 展开（默认 click，移动端更顺手） */
  trigger?: "hover" | "click";
  /** 受控开关 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 自定义触发按钮 className（用于输入框场景统一高度） */
  className?: string;
}

/**
 * ContextPopover
 *  - 一个紧凑图标按钮：左侧 chart-bar 图标 + 右侧小进度条 + 百分比
 *  - 鼠标悬停或点击时弹出完整 Context 详情（与 <Context> 一致）
 *  - 默认放在 MessageInput 的工具行，与 emoji/attach 并列
 */
export function ContextPopover({
  metrics,
  trigger = "hover",
  open,
  onOpenChange,
  className,
}: ContextPopoverProps): React.JSX.Element {
  const { t, f } = useT();
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    top: number;
    placement: "top" | "bottom";
  } | null>(null);

  // 同步 controlled/uncontrolled
  const setOpen = useCallback(
    (next: boolean | ((prev: boolean) => boolean)): void => {
      const resolved = typeof next === "function" ? next(open ?? internalOpen) : next;
      if (onOpenChange) onOpenChange(resolved);
      if (open === undefined) setInternalOpen(resolved);
    },
    [internalOpen, onOpenChange, open],
  );

  const clearCloseTimer = useCallback((): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback((): void => {
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, 120);
  }, [clearCloseTimer, setOpen]);

  // 外部点击关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent): void => {
      if (!containerRef.current) return;
      const target = e.target as Node;
      if (!containerRef.current.contains(target) && !detailsRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, setOpen]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, setOpen]);

  // Portal 弹层脱离聊天主区域的 overflow 裁剪，并始终保持在视口内。
  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = (): void => {
      const trigger = triggerRef.current;
      const details = detailsRef.current;
      if (!trigger || !details) return;

      const triggerRect = trigger.getBoundingClientRect();
      const detailsRect = details.getBoundingClientRect();
      const viewportMargin = 8;
      const gap = 8;
      const maxLeft = Math.max(
        viewportMargin,
        window.innerWidth - detailsRect.width - viewportMargin,
      );
      const centeredLeft = triggerRect.left + (triggerRect.width - detailsRect.width) / 2;
      const left = Math.min(Math.max(centeredLeft, viewportMargin), maxLeft);
      const spaceAbove = triggerRect.top - viewportMargin - gap;
      const spaceBelow = window.innerHeight - triggerRect.bottom - viewportMargin - gap;
      const placement: "top" | "bottom" =
        spaceAbove >= detailsRect.height || spaceAbove >= spaceBelow ? "top" : "bottom";
      const unclampedTop =
        placement === "top" ? triggerRect.top - detailsRect.height - gap : triggerRect.bottom + gap;
      const maxTop = Math.max(
        viewportMargin,
        window.innerHeight - detailsRect.height - viewportMargin,
      );
      const top = Math.min(Math.max(unclampedTop, viewportMargin), maxTop);

      setPopoverPosition((current) =>
        current?.left === left && current.top === top && current.placement === placement
          ? current
          : { left, top, placement },
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  const ratio = metrics.maxTokens > 0 ? metrics.usedTokens / metrics.maxTokens : 0;
  const percent = Math.min(100, Math.max(0, Math.round(ratio * 100)));
  const tone = ratio < 0.6 ? "text-success" : ratio < 0.85 ? "text-warning" : "text-danger";
  const barTone =
    ratio < 0.6
      ? "from-success/40 to-success/70"
      : ratio < 0.85
        ? "from-warning/40 to-warning/70"
        : "from-danger/40 to-danger/70";

  // 触发器 hover 行为：进入容器 → 打开；离开容器 → 关闭
  const handleMouseEnter = (): void => {
    clearCloseTimer();
    setOpen(true);
  };

  const handleMouseLeave = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const relatedTarget = event.relatedTarget as Node | null;
    if (relatedTarget && detailsRef.current?.contains(relatedTarget)) return;
    scheduleClose();
  };

  const triggerProps =
    trigger === "hover"
      ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave }
      : { onClick: () => setOpen((v) => !v) };

  const details = isOpen ? (
    <div
      ref={detailsRef}
      data-slot="context-details"
      role="dialog"
      aria-label={t("ai.context.details")}
      onMouseEnter={trigger === "hover" ? clearCloseTimer : undefined}
      onMouseLeave={trigger === "hover" ? scheduleClose : undefined}
      className={cn(
        "fixed z-50 w-[300px] max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-y-auto",
        "rounded-lg border border-border bg-background/95 p-2 shadow-lg",
        "animate-in fade-in-0 zoom-in-95",
        popoverPosition?.placement === "bottom" ? "slide-in-from-top-2" : "slide-in-from-bottom-2",
      )}
      style={{
        left: popoverPosition?.left ?? 0,
        top: popoverPosition?.top ?? 0,
        visibility: popoverPosition ? "visible" : "hidden",
      }}
    >
      <Context
        metrics={metrics}
        title={t("chat.context.title")}
        defaultExpanded
        className="border-none bg-transparent px-1 py-0"
      />
    </div>
  ) : null;

  return (
    <div
      ref={containerRef}
      data-slot="context-popover"
      className={cn("relative flex items-center", className)}
      {...triggerProps}
    >
      {/* 触发按钮：图标 + 微型进度条 + 百分比 */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("chat.context.title")}
        title={t("chat.context.title")}
        className={cn(
          "group/trigger flex items-center gap-1.5 rounded-xl px-2 py-1.5",
          "text-muted-foreground transition",
          "hover:bg-muted hover:text-foreground",
          isOpen && "bg-muted text-foreground",
        )}
      >
        <IconChartBar className="size-3.5 shrink-0" />
        <span className="relative flex h-1.5 w-10 overflow-hidden rounded-full bg-muted">
          <span
            className={cn("h-full rounded-full bg-gradient-to-r transition-all", barTone)}
            style={{ width: `${percent}%` }}
            aria-hidden
          />
        </span>
        <span className={cn("text-[10.5px] font-medium tabular-nums", tone)}>
          {f.number(percent)}%
        </span>
      </button>
      {/* 弹层：完整 Context 详情，使用 portal 避免被聊天区域裁剪 */}
      {details && typeof document !== "undefined" ? createPortal(details, document.body) : null}
    </div>
  );
}
