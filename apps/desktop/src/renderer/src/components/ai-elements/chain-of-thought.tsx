/**
 * AI Elements - ChainOfThought 组件
 *
 * 源码参考：https://elements.ai-sdk.dev/components/chain-of-thought
 *
 * 设计目标：
 *  - 思维链容器：用于展示 AI 推理的多个步骤
 *  - 步骤（Step）：每个步骤可展示标题、状态、内容
 *  - 搜索结果（SearchResult）：引用外部信息时的搜索条目
 *  - 图片（Image）：推理过程中引用的图片
 *  - 自动默认展开但可折叠，整体风格与项目一致
 *
 * 用法：
 *   <ChainOfThought>
 *     <ChainOfThoughtStep
 *       icon="search" | "image" | "think" | "default"
 *       label="搜索资料"
 *       status="complete" | "active" | "pending"
 *     >
 *       <ChainOfThoughtSearchResults>
 *         <ChainOfThoughtSearchResult>...</ChainOfThoughtSearchResult>
 *       </ChainOfThoughtSearchResults>
 *     </ChainOfThoughtStep>
 *   </ChainOfThought>
 */
import {
  useEffect,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "../../lib/utils";
import { useMediaResourceStates } from "../../lib/media-resource";
import { useT } from "../../lib/i18n";
import {
  IconBrain,
  IconChevronDown,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconImage,
  IconLink,
  IconSearch,
  IconSparkles,
  IconWrench,
} from "../icons";
import { sanitizeRichContentUrl } from "./rich-content-utils";
import {
  AnimatedDisclosure,
  AnimatedDisclosureContent,
  AnimatedDisclosureChevron,
  AnimatedDisclosureTrigger,
} from "./animated-disclosure";

/* ---------- 类型定义 ---------- */

/** 步骤状态 */
export type ChainStepStatus = "complete" | "active" | "pending" | "error";

/** 步骤图标类别 */
export type ChainStepIcon = "default" | "search" | "image" | "think" | "tool" | "sparkles";

/* ---------- 容器 ChainOfThought ---------- */

interface ChainOfThoughtProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  active?: boolean;
  keepOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export function ChainOfThought({
  title,
  defaultOpen = true,
  open,
  active,
  keepOpen = false,
  onOpenChange,
  className,
  children,
  ...rest
}: ChainOfThoughtProps): React.JSX.Element {
  const { t } = useT();
  const resolvedTitle = title ?? t("msg.cot.title");
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const wasActive = useRef(Boolean(active));

  useEffect(() => {
    if (open !== undefined) return;
    if (active && !wasActive.current) setInternalOpen(true);
    if (!active && wasActive.current && !keepOpen) setInternalOpen(false);
    wasActive.current = Boolean(active);
  }, [active, keepOpen, open]);

  const resolvedOpen = open ?? internalOpen;
  const handleOpenChange = (nextOpen: boolean): void => {
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <AnimatedDisclosure
      data-slot="chain-of-thought"
      active={active}
      defaultOpen={defaultOpen}
      open={resolvedOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        "group/cot overflow-hidden rounded-lg border border-border bg-muted/30",
        className,
      )}
      {...rest}
    >
      <AnimatedDisclosureTrigger
        data-slot="chain-of-thought-trigger"
        className={cn(
          "flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left text-xs font-medium",
          "hover:bg-muted/60",
        )}
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
          <IconBrain className="size-3.5" />
        </span>
        <span className="flex-1 truncate text-foreground">{resolvedTitle}</span>
        <AnimatedDisclosureChevron className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          <IconChevronDown className="size-3.5" />
        </AnimatedDisclosureChevron>
      </AnimatedDisclosureTrigger>
      <AnimatedDisclosureContent innerClassName="border-t border-border px-2 py-2.5 text-xs">
        <ol data-slot="chain-of-thought-content" className="relative flex flex-col gap-1.5">
          {children}
        </ol>
      </AnimatedDisclosureContent>
    </AnimatedDisclosure>
  );
}

/* ---------- ChainOfThoughtStep ---------- */

interface ChainOfThoughtStepProps extends Omit<HTMLAttributes<HTMLLIElement>, "title"> {
  icon?: ChainStepIcon;
  label: ReactNode;
  description?: ReactNode;
  status?: ChainStepStatus;
  children?: ReactNode;
}

const ICON_MAP: Record<ChainStepIcon, typeof IconBrain> = {
  default: IconCircleDashed,
  search: IconSearch,
  image: IconImage,
  think: IconBrain,
  tool: IconWrench,
  sparkles: IconSparkles,
};

/**
 * 思维链单个步骤
 *  - 视觉：左侧图标 + 序号（圆点），中间标签/描述
 *  - 状态：complete 绿色勾，active 蓝色旋转，pending 灰色虚线
 */
export function ChainOfThoughtStep({
  icon = "default",
  label,
  description,
  status = "complete",
  className,
  children,
  ...rest
}: ChainOfThoughtStepProps): React.JSX.Element {
  const Icon = ICON_MAP[icon];

  return (
    <li
      data-slot="chain-of-thought-step"
      data-status={status}
      className={cn(
        "group/step relative flex flex-col gap-1.5 rounded-lg px-2 py-1.5 transition",
        "hover:bg-muted/50",
        className,
      )}
      {...rest}
    >
      <div className="flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
            status === "complete" && "border-success/30 bg-success/10 text-success",
            status === "active" && "border-primary/40 bg-primary/10 text-primary",
            status === "pending" && "border-border bg-muted/50 text-muted-foreground",
            status === "error" && "border-danger/35 bg-danger/10 text-danger",
          )}
        >
          {status === "complete" ? (
            <IconCircleCheck className="size-3" />
          ) : status === "error" ? (
            <IconCircleX className="size-3" />
          ) : status === "active" ? (
            <Icon className="size-3 animate-pulse" />
          ) : (
            <Icon className="size-3" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="truncate text-[12px] font-medium text-foreground">{label}</p>
          {description ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children ? <div className="ml-7 mt-0.5 flex flex-col gap-1.5">{children}</div> : null}
    </li>
  );
}

/* ---------- 搜索结果容器 ---------- */

interface ChainOfThoughtSearchResultsProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

/** 搜索结果列表容器 */
export function ChainOfThoughtSearchResults({
  className,
  children,
  ...rest
}: ChainOfThoughtSearchResultsProps): React.JSX.Element {
  return (
    <div
      data-slot="chain-of-thought-search-results"
      className={cn("flex flex-col gap-1", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ---------- 单个搜索结果 ---------- */

interface ChainOfThoughtSearchResultProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** 搜索结果 URL（可选；不传则为纯文本） */
  href?: string;
  /** 结果标题 */
  title?: ReactNode;
  /** 结果描述/摘要 */
  description?: ReactNode;
  children?: ReactNode;
}

/** 搜索结果条目（带链接图标的卡片） */
export function ChainOfThoughtSearchResult({
  href,
  title,
  description,
  className,
  children,
  ...rest
}: ChainOfThoughtSearchResultProps): React.JSX.Element {
  const safeHref = href ? sanitizeRichContentUrl(href, "link") : null;
  const content = (
    <>
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <IconLink className="size-3" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <p className="truncate text-[12px] font-medium text-foreground">{title}</p> : null}
        {description ? (
          <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </>
  );

  if (safeHref) {
    return (
      <a
        data-slot="chain-of-thought-search-result"
        href={safeHref}
        target="_blank"
        rel="noreferrer noopener"
        className={cn(
          "flex items-start gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5",
          "transition hover:border-accent/35 hover:bg-accent/5",
          className,
        )}
        {...(rest as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </a>
    );
  }
  return (
    <div
      data-slot="chain-of-thought-search-result"
      className={cn(
        "flex items-start gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5",
        className,
      )}
      {...rest}
    >
      {content}
    </div>
  );
}

/* ---------- 图片 ChainOfThoughtImage ---------- */

interface ChainOfThoughtImageProps extends HTMLAttributes<HTMLDivElement> {
  src: string;
  alt?: string;
  caption?: ReactNode;
  conversationId?: string;
}

/** 推理过程中引用的图片（带说明文字） */
export function ChainOfThoughtImage({
  src,
  alt,
  caption,
  conversationId,
  className,
  ...rest
}: ChainOfThoughtImageProps): React.JSX.Element {
  const { t } = useT();
  const { states, markFailed } = useMediaResourceStates(conversationId, [
    { type: "chain-of-thought-image", filename: alt, mediaType: "image/*", url: src },
  ]);
  const state = states["chain-of-thought-image-0"];
  const safeSrc = state?.url ? sanitizeRichContentUrl(state.url, "image") : null;
  return (
    <figure
      data-slot="chain-of-thought-image"
      className={cn("overflow-hidden rounded-md border border-border bg-background/60", className)}
      {...rest}
    >
      {state?.error ? (
        <div className="px-2 py-3 text-[10.5px] text-danger">
          {t("attachment.loadFailed", { name: alt ?? t("attachment.file") })}
        </div>
      ) : state?.loading ? (
        <div className="px-2 py-3 text-[10.5px] text-muted-foreground">{alt ?? ""}</div>
      ) : safeSrc ? (
        <img
          src={safeSrc}
          alt={alt ?? ""}
          loading="lazy"
          className="block max-h-48 w-full object-cover"
          onError={() => markFailed("chain-of-thought-image-0")}
        />
      ) : (
        <div className="px-2 py-3 text-[10.5px] text-muted-foreground">{alt ?? ""}</div>
      )}
      {caption ? (
        <figcaption className="border-t border-border px-2 py-1 text-[10.5px] text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
