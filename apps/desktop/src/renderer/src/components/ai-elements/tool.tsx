/**
 * AI Elements - Tool 组件
 *
 * 源码：https://elements.ai-sdk.dev/components/tool
 *
 * 简化实现：
 *  - 原版基于 Radix Collapsible + Badge + 自定义 icon 状态
 *  - 此处用 HTML5 <details>/<summary> 替代 Radix Collapsible
 *  - 状态徽章简化为文字 + 图标（保留原版的 7 种状态识别）
 *
 * 数据流（与 AI Elements 兼容）：
 *  <Tool defaultOpen>
 *    <ToolHeader type="tool-fetch_weather" state={state} />
 *    <ToolContent>
 *      <ToolInput input={...} />
 *      <ToolOutput output={...} errorText={...} />
 *    </ToolContent>
 *  </Tool>
 */
import { type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT, type TranslationKey } from "../../lib/i18n";
import {
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconWrench,
} from "../icons";
import {
  AnimatedDisclosure,
  AnimatedDisclosureContent,
  AnimatedDisclosureChevron,
  AnimatedDisclosureTrigger,
} from "./animated-disclosure";

/** AI SDK ToolUIPart 的 state 字段，与 ai@5 保持兼容 */
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-requested"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

/** state → 状态标签与图标（与 AI Elements getStatusBadge 等价） */
const STATE_META: Record<
  ToolState,
  { labelKey: TranslationKey; tone: string; Icon: typeof IconWrench }
> = {
  "input-streaming": {
    labelKey: "tool.status.input-streaming",
    tone: "text-foreground/55",
    Icon: IconCircleDashed,
  },
  "input-available": {
    labelKey: "tool.status.input-available",
    tone: "text-accent",
    Icon: IconCircleDashed,
  },
  "approval-requested": {
    labelKey: "tool.status.approval-requested",
    tone: "text-warning",
    Icon: IconCircleDashed,
  },
  "approval-responded": {
    labelKey: "tool.status.approval-responded",
    tone: "text-foreground/65",
    Icon: IconCircleDashed,
  },
  "output-available": {
    labelKey: "tool.status.output-available",
    tone: "text-success",
    Icon: IconCircleCheck,
  },
  "output-error": { labelKey: "tool.status.output-error", tone: "text-danger", Icon: IconCircleX },
  "output-denied": {
    labelKey: "tool.status.output-denied",
    tone: "text-danger",
    Icon: IconCircleX,
  },
};

interface ToolProps extends HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
  open?: boolean;
  active?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export function Tool({
  className,
  children,
  defaultOpen,
  open,
  active,
  onOpenChange,
  ...rest
}: ToolProps): React.JSX.Element {
  return (
    <AnimatedDisclosure
      data-slot="tool"
      active={active}
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className={cn("rounded-xl border border-foreground/10 bg-foreground/[0.03]", className)}
      {...rest}
    >
      {children}
    </AnimatedDisclosure>
  );
}

interface ToolHeaderProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  type: string;
  state: ToolState;
  title?: string;
  toolName?: string;
  summary?: ReactNode;
}

export function ToolHeader({
  type,
  state,
  title,
  toolName,
  summary,
  className,
  children,
  ...rest
}: ToolHeaderProps): React.JSX.Element {
  const { t } = useT();
  const displayName = title ?? toolName ?? type.replace(/^tool-/, "");
  const meta = STATE_META[state];
  const StatusIcon = meta.Icon;
  // 状态图标做动效：input-available 旋转
  const stateIconClass = state === "input-available" ? "animate-spin" : "";

  return (
    <AnimatedDisclosureTrigger
      data-slot="tool-header"
      data-state={state}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium",
        "rounded-t-xl hover:bg-foreground/[0.04]",
        className,
      )}
      {...rest}
    >
      <IconWrench className="size-3.5 shrink-0 text-foreground/65" />
      <span className="min-w-0 flex-1 truncate text-foreground/85">{displayName}</span>
      {summary ? (
        <span className="min-w-0 max-w-[32%] truncate text-[10px] font-normal text-foreground/45">
          {summary}
        </span>
      ) : null}
      <span
        data-slot="tool-status"
        className={cn(
          "flex items-center gap-1 rounded-full bg-foreground/[0.06] px-1.5 py-0.5",
          meta.tone,
        )}
      >
        <StatusIcon className={cn("size-3", stateIconClass)} />
        <span className="text-[10px] font-medium uppercase tracking-wide">{t(meta.labelKey)}</span>
      </span>
      <AnimatedDisclosureChevron className="flex size-3.5 shrink-0 items-center justify-center text-foreground/45">
        <IconChevronDown className="size-3.5" />
      </AnimatedDisclosureChevron>
      {children}
    </AnimatedDisclosureTrigger>
  );
}

interface ToolContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function ToolContent({ className, children, ...rest }: ToolContentProps): React.JSX.Element {
  return (
    <AnimatedDisclosureContent
      data-slot="tool-content"
      innerClassName={cn("space-y-2 border-t border-foreground/10 px-3 py-2.5 text-xs", className)}
      {...rest}
    >
      {children}
    </AnimatedDisclosureContent>
  );
}

interface ToolInputProps extends HTMLAttributes<HTMLDivElement> {
  input?: unknown;
}

/** 工具调用入参：以 JSON 形式展示 */
export function ToolInput({ input, className, ...rest }: ToolInputProps): React.JSX.Element {
  const { t } = useT();
  return (
    <div data-slot="tool-input" className={cn("space-y-1", className)} {...rest}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground/45">
        {t("tool.parameters")}
      </p>
      <pre className="overflow-x-auto rounded-md bg-foreground/[0.05] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/80">
        {input === undefined ? "{}" : safeJsonStringify(input, t("tool.unserializable"))}
      </pre>
    </div>
  );
}

interface ToolOutputProps extends HTMLAttributes<HTMLDivElement> {
  output?: ReactNode;
  errorText?: string;
}

/** 工具调用结果 / 错误 */
export function ToolOutput({
  output,
  errorText,
  className,
  ...rest
}: ToolOutputProps): React.JSX.Element {
  const { t } = useT();
  const isError = Boolean(errorText);
  return (
    <div data-slot="tool-output" className={cn("space-y-1", className)} {...rest}>
      <p
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wide",
          isError ? "text-danger" : "text-foreground/45",
        )}
      >
        {isError ? t("tool.error") : t("tool.result")}
      </p>
      {errorText ? (
        <pre className="overflow-x-auto rounded-md bg-danger/10 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-danger">
          {errorText}
        </pre>
      ) : output ? (
        <div className="overflow-x-auto rounded-md bg-foreground/[0.05] px-2 py-1.5 text-[11px] leading-relaxed text-foreground/85 [&_p]:m-0">
          {output}
        </div>
      ) : (
        <pre className="overflow-x-auto rounded-md bg-foreground/[0.05] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/45">
          {t("tool.empty")}
        </pre>
      )}
    </div>
  );
}

/** JSON.stringify 兜底：循环引用会抛错，统一返回 "[unserializable]" */
function safeJsonStringify(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallback;
  }
}
