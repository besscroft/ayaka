import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { IconArrowDown } from "../icons";
import {
  ConversationScrollProvider,
  useConversationScroll,
  useConversationScrollController,
} from "./use-conversation-scroll";

export function Conversation({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const scrollController = useConversationScrollController();

  return (
    <ConversationScrollProvider value={scrollController}>
      <div
        data-slot="conversation"
        className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", className)}
        {...rest}
      >
        <div
          ref={scrollController.containerRef}
          data-slot="conversation-viewport"
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {children}
        </div>
      </div>
    </ConversationScrollProvider>
  );
}

export function ConversationContent({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  const { contentRef } = useConversationScroll();

  return (
    <div
      ref={contentRef}
      data-slot="conversation-content"
      className={cn(
        "mx-auto flex w-full max-w-[min(1400px,100%)] flex-col gap-6 px-3 py-8 sm:px-4",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface ConversationEmptyStateProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}

export function ConversationEmptyState({
  icon,
  title,
  description,
  className,
  children,
  ...rest
}: ConversationEmptyStateProps): React.JSX.Element {
  return (
    <div
      data-slot="conversation-empty"
      className={cn(
        "mx-auto flex max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
      {...rest}
    >
      {icon ? <div className="text-muted-foreground [&_svg]:size-10">{icon}</div> : null}
      {title ? <p className="text-base font-medium text-foreground">{title}</p> : null}
      {description ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      {children}
    </div>
  );
}

export function ConversationScrollButton({
  className,
  ...rest
}: HTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  const { t } = useT();
  const { isAwayFromLatest, scrollToLatest } = useConversationScroll();

  if (!isAwayFromLatest) return <></>;

  return (
    <button
      data-slot="conversation-scroll-button"
      data-icon-only="true"
      data-icon-tone="info"
      type="button"
      aria-label={t("ai.scroll.toLatest")}
      onClick={scrollToLatest}
      className={cn(
        "absolute bottom-4 left-1/2 z-10 -translate-x-1/2",
        "flex size-8 items-center justify-center rounded-full",
        "border border-border bg-background/90 shadow-md",
        "text-muted-foreground transition hover:bg-background hover:text-foreground",
        className,
      )}
      {...rest}
    >
      <IconArrowDown className="size-4" />
    </button>
  );
}
