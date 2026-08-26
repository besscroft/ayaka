import { type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { RichContent, type RichContentSkillMention } from "./rich-content";

type MessageRole = "user" | "assistant" | "system";

interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  from: MessageRole;
}

export function Message({ from, className, children, ...rest }: MessageProps): React.JSX.Element {
  const isUser = from === "user";
  return (
    <div
      data-slot="message"
      data-from={from}
      className={cn("group/msg flex w-full", isUser ? "justify-end" : "justify-start", className)}
      {...rest}
    >
      <div
        className={cn(
          "flex w-full min-w-0 max-w-[min(1050px,100%)] flex-col gap-1.5",
          isUser ? "items-end" : "items-start pr-6 sm:pr-10 lg:pr-16",
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface MessageContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function MessageContent({
  className,
  children,
  ...rest
}: MessageContentProps): React.JSX.Element {
  const fromAttr = (rest as { "data-from"?: string })["data-from"];
  const isUser = fromAttr === "user";
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex flex-col gap-1 text-sm leading-relaxed",
        isUser
          ? "rounded-xl bg-primary px-4 py-2.5 text-primary-foreground shadow-xs"
          : "w-full bg-transparent px-0 py-0 text-foreground",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface MessageResponseProps extends HTMLAttributes<HTMLDivElement> {
  children?: string;
  streaming?: boolean;
  skillMentions?: readonly RichContentSkillMention[];
}

export function MessageResponse({
  children,
  streaming = false,
  skillMentions,
  className,
  ...rest
}: MessageResponseProps): React.JSX.Element {
  return (
    <RichContent
      data-slot="message-response"
      data-streaming={streaming ? "true" : undefined}
      value={children ?? ""}
      skillMentions={skillMentions}
      className={className}
      {...rest}
    />
  );
}
