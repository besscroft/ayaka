/**
 * AI Elements - Reasoning 组件
 *
 * 源码：https://elements.ai-sdk.dev/components/reasoning
 *
 * 简化实现：
 *  - 原版基于 Radix Collapsible
 *  - 此处用 HTML5 <details>/<summary> 实现：浏览器原生，无依赖
 *  - isStreaming 时自动展开（defaultOpen），结束后保持当前状态
 *
 * 数据流（与 AI Elements 兼容）：
 *  <Reasoning isStreaming={isReasoningStreaming}>
 *    <ReasoningTrigger />  ← 显示 "Thinking..." 或 "Thought for Xs"
 *    <ReasoningContent>{text}</ReasoningContent>
 *  </Reasoning>
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { IconBrain, IconChevronDown, IconDots } from "../icons";
import {
  AnimatedDisclosure,
  AnimatedDisclosureContent,
  AnimatedDisclosureChevron,
  AnimatedDisclosureTrigger,
} from "./animated-disclosure";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

function useReasoningContext(): ReasoningContextValue {
  const ctx = useContext(ReasoningContext);
  if (!ctx) {
    throw new Error("Reasoning components must be used inside <Reasoning>");
  }
  return ctx;
}

interface ReasoningProps extends HTMLAttributes<HTMLDivElement> {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
  children?: ReactNode;
}

export function Reasoning({
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  duration: durationProp,
  className,
  children,
  ...rest
}: ReasoningProps): React.JSX.Element {
  const startRef = useRef<number>(Date.now());
  const wasStreamingRef = useRef(isStreaming);
  const [duration, setDuration] = useState<number>(durationProp ?? 0);
  const [internalOpen, setInternalOpen] = useState<boolean>(defaultOpen ?? isStreaming);
  const isOpen = open ?? internalOpen;

  useEffect(() => {
    if (isStreaming) {
      startRef.current = Date.now();
      const timer = window.setInterval(() => {
        setDuration(Math.round((Date.now() - startRef.current) / 1000));
      }, 1000);
      return () => window.clearInterval(timer);
    }
    setDuration(Math.round((Date.now() - startRef.current) / 1000));
    return undefined;
  }, [isStreaming]);

  useEffect(() => {
    if (open !== undefined) return;
    if (isStreaming) {
      wasStreamingRef.current = true;
      setInternalOpen(true);
      return;
    }
    if (wasStreamingRef.current) {
      wasStreamingRef.current = false;
      setInternalOpen(false);
    }
  }, [isStreaming, open]);

  const setIsOpen = (next: boolean): void => {
    onOpenChange?.(next);
    if (open === undefined) setInternalOpen(next);
  };

  return (
    <ReasoningContext.Provider value={{ isStreaming, isOpen, setIsOpen, duration }}>
      <AnimatedDisclosure
        data-slot="reasoning"
        data-streaming={isStreaming ? "true" : "false"}
        active={isStreaming}
        open={isOpen}
        onOpenChange={setIsOpen}
        className={cn("rounded-xl border border-border bg-muted/30", className)}
        {...rest}
      >
        {children}
      </AnimatedDisclosure>
    </ReasoningContext.Provider>
  );
}

interface ReasoningTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
}

export function ReasoningTrigger({
  getThinkingMessage,
  className,
  children,
  ...rest
}: ReasoningTriggerProps): React.JSX.Element {
  const { isStreaming, duration } = useReasoningContext();
  const { t } = useT();
  const message =
    getThinkingMessage?.(isStreaming, duration) ??
    (isStreaming ? t("msg.cot.reasoningActive") : t("msg.cot.reasoned"));

  return (
    <AnimatedDisclosureTrigger
      data-slot="reasoning-trigger"
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground",
        "hover:text-foreground",
        className,
      )}
      {...rest}
    >
      {isStreaming ? (
        <IconDots className="size-3.5 animate-pulse text-primary" />
      ) : (
        <IconBrain className="size-3.5" />
      )}
      <span className="flex-1 truncate">{message}</span>
      <AnimatedDisclosureChevron className="flex size-3.5 items-center justify-center">
        <IconChevronDown className="size-3.5" />
      </AnimatedDisclosureChevron>
      {children}
    </AnimatedDisclosureTrigger>
  );
}

interface ReasoningContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function ReasoningContent({
  className,
  children,
  ...rest
}: ReasoningContentProps): React.JSX.Element {
  return (
    <AnimatedDisclosureContent
      data-slot="reasoning-content"
      innerClassName={cn(
        "max-h-[min(32rem,50vh)] overflow-y-auto border-t border-border px-3 py-2.5 text-xs leading-relaxed text-muted-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </AnimatedDisclosureContent>
  );
}

/**
 * 拿到 reasoning 上下文（用于业务层在流式时调整 UI）
 */
export function useReasoning(): ReasoningContextValue {
  return useReasoningContext();
}
