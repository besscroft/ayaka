"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import { cn } from "@renderer/lib/utils";
import { sanitizeRichContentUrl } from "./rich-content-utils";
import { BookIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = ({ className, ...props }: SourcesProps): React.JSX.Element => (
  <Collapsible className={cn("not-prose mb-4 text-xs text-primary", className)} {...props} />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & { count: number };

export const SourcesTrigger = ({
  className,
  count,
  children,
  ...props
}: SourcesTriggerProps): React.JSX.Element => (
  <CollapsibleTrigger className={cn("flex items-center gap-2", className)} {...props}>
    {children ?? (
      <>
        <p className="font-medium">Used {count} sources</p>
        <ChevronDownIcon className="size-4" />
      </>
    )}
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({ className, ...props }: SourcesContentProps): React.JSX.Element => (
  <CollapsibleContent
    className={cn(
      "mt-3 flex w-fit flex-col gap-2 outline-none",
      "motion-safe:data-[state=closed]:animate-out motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:fade-out-0 motion-safe:data-[state=closed]:slide-out-to-top-2 motion-safe:data-[state=open]:slide-in-from-top-2",
      className,
    )}
    {...props}
  />
);

export type SourceProps = Omit<ComponentProps<"a">, "href"> & { href?: string };

export const Source = ({
  href,
  title,
  children,
  className,
  ...props
}: SourceProps): React.JSX.Element => {
  const safeHref = href ? sanitizeRichContentUrl(href, "link") : null;
  return (
    <a
      className={cn("flex items-center gap-2", className)}
      href={safeHref ?? undefined}
      rel={safeHref ? "noreferrer noopener" : undefined}
      target={safeHref ? "_blank" : undefined}
      aria-disabled={safeHref ? undefined : true}
      {...props}
    >
      {children ?? (
        <>
          <BookIcon className="size-4" />
          <span className="block font-medium">{title}</span>
        </>
      )}
    </a>
  );
};
