"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import { cn } from "@renderer/lib/utils";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import {
  createContext,
  lazy,
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { RichContent } from "./rich-content";
import { shouldFollowReasoningContent } from "./reasoning-scroll";
import { Shimmer } from "./shimmer";
import { useConversationScrollOptional } from "./use-conversation-scroll";

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

// This hook intentionally shares the compound component's context.
// eslint-disable-next-line react-refresh/only-export-components
export function useReasoning(): ReasoningContextValue {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const AUTO_CLOSE_DELAY = 1000;

export const Reasoning = memo(function Reasoning({
  className,
  isStreaming = false,
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...props
}: ReasoningProps): React.JSX.Element {
  const resolvedDefaultOpen = defaultOpen ?? isStreaming;
  const isExplicitlyClosed = defaultOpen === false;
  const [isOpen, setIsOpen] = useControllableState<boolean>({
    defaultProp: resolvedDefaultOpen,
    onChange: onOpenChange,
    prop: open,
  });
  const conversationScroll = useConversationScrollOptional();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const hasEverStreamedRef = useRef(isStreaming);
  const hasAutoClosedRef = useRef(false);

  useEffect(() => {
    if (isStreaming) {
      hasEverStreamedRef.current = true;
      hasAutoClosedRef.current = false;
    }
  }, [isStreaming]);

  useEffect(() => {
    if (isStreaming && !isOpen && !isExplicitlyClosed) setIsOpen(true);
  }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);

  const setReasoningOpen = useCallback(
    (nextOpen: boolean): void => {
      if (nextOpen !== isOpen) {
        conversationScroll?.preserveScrollOnDisclosure(rootRef.current);
      }
      setIsOpen(nextOpen);
    },
    [conversationScroll, isOpen, setIsOpen],
  );

  useEffect(() => {
    if (hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosedRef.current) {
      const timer = window.setTimeout(() => {
        setReasoningOpen(false);
        hasAutoClosedRef.current = true;
      }, AUTO_CLOSE_DELAY);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [isStreaming, isOpen, setReasoningOpen]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean): void => setReasoningOpen(nextOpen),
    [setReasoningOpen],
  );
  const contextValue = useMemo(
    () => ({ isOpen, isStreaming, setIsOpen }),
    [isOpen, isStreaming, setIsOpen],
  );

  return (
    <ReasoningContext.Provider value={contextValue}>
      <Collapsible
        {...props}
        data-slot="reasoning"
        data-streaming={isStreaming ? "true" : "false"}
        className={cn(
          "group/reasoning relative mb-3 pl-5",
          "before:absolute before:inset-y-1 before:left-1.5 before:w-px before:bg-border/75",
          "data-[streaming=true]:before:bg-primary/40",
          className,
        )}
        onOpenChange={handleOpenChange}
        open={isOpen}
        ref={rootRef}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
});

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean): ReactNode => {
  if (isStreaming) return <Shimmer duration={1}>Thinking...</Shimmer>;
  return <span>Thought completed</span>;
};

export const ReasoningTrigger = memo(function ReasoningTrigger({
  className,
  children,
  getThinkingMessage = defaultGetThinkingMessage,
  ...props
}: ReasoningTriggerProps): React.JSX.Element {
  const { isStreaming, isOpen } = useReasoning();

  return (
    <CollapsibleTrigger
      data-slot="reasoning-trigger"
      className={cn(
        "relative flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] text-muted-foreground transition-colors",
        "before:absolute before:-left-[18px] before:top-1/2 before:size-2 before:-translate-y-1/2 before:rounded-full before:border-2 before:border-background before:bg-muted-foreground/55",
        "data-[panel-open]:before:bg-primary/75",
        "hover:bg-muted/45 hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <BrainIcon className="size-4" />
          {getThinkingMessage(isStreaming)}
          <ChevronDownIcon
            className={cn(
              "ml-auto size-3.5 text-muted-foreground/65 transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
          />
        </>
      )}
    </CollapsibleTrigger>
  );
});

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string;
  isStreaming?: boolean;
};

interface StreamdownContentProps {
  children: string;
}

const StreamdownContent = lazy(async () => {
  const [{ Streamdown }, { cjk }, { code }, { math }, { mermaid }] = await Promise.all([
    import("streamdown"),
    import("@streamdown/cjk"),
    import("@streamdown/code"),
    import("@streamdown/math"),
    import("@streamdown/mermaid"),
  ]);
  const plugins = { cjk, code, math, mermaid };
  return {
    default: function StreamdownRenderer({ children }: StreamdownContentProps): React.JSX.Element {
      return <Streamdown plugins={plugins}>{children}</Streamdown>;
    },
  };
});

export const ReasoningContent = memo(function ReasoningContent({
  className,
  children,
  isStreaming = false,
  onScroll,
  ...props
}: ReasoningContentProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const streamingContentRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const scrollToLatest = useCallback((): void => {
    const node = scrollRef.current;
    if (!node || !isStreaming || !shouldAutoScrollRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [isStreaming]);

  const handleScroll = useCallback<
    NonNullable<ComponentProps<typeof CollapsibleContent>["onScroll"]>
  >(
    (event) => {
      shouldAutoScrollRef.current = shouldFollowReasoningContent(event.currentTarget);
      onScroll?.(event);
    },
    [onScroll],
  );

  useLayoutEffect(() => {
    scrollToLatest();
  }, [children, scrollToLatest]);

  useEffect(() => {
    const node = streamingContentRef.current;
    if (!node || !isStreaming || typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(node);
    return () => observer.disconnect();
  }, [isStreaming, scrollToLatest]);

  return (
    <CollapsibleContent
      data-slot="reasoning-content"
      className={cn(
        "h-[var(--collapsible-panel-height)] max-h-[min(42rem,60vh)] overflow-y-auto pr-2 text-[13px] leading-6 text-muted-foreground outline-none",
        "[&_.rich-content]:gap-2.5 [&_p]:leading-6 [&_pre]:my-2 [&_ul]:my-1 [&_ol]:my-1",
        "motion-safe:transition-[height,opacity,transform] motion-safe:duration-200 motion-safe:ease-out",
        "motion-safe:data-[starting-style]:translate-y-1 motion-safe:data-[starting-style]:opacity-0",
        "motion-safe:data-[ending-style]:-translate-y-1 motion-safe:data-[ending-style]:opacity-0",
        className,
      )}
      onScroll={handleScroll}
      ref={scrollRef}
      {...props}
    >
      {isStreaming ? (
        <div
          data-streaming="true"
          className="whitespace-pre-wrap break-words"
          ref={streamingContentRef}
        >
          {children}
        </div>
      ) : (
        <Suspense fallback={<RichContent value={children} />}>
          <StreamdownContent>{children}</StreamdownContent>
        </Suspense>
      )}
    </CollapsibleContent>
  );
});

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
