/**
 * AI Elements - PromptSuggestions 组件
 *
 * 设计目标：
 *  - 在空态（无消息）时提供建议 prompt
 *  - 点击建议自动填充到输入框或直接发送
 *  - 视觉上：水平排列的 chip 式按钮，带 hover 动效
 *
 * 用法：
 *   <PromptSuggestions
 *     suggestions={["解释量子计算", "写一首诗", ...]}
 *     onSelect={(s) => setInput(s)}
 *   />
 */
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { IconArrowUp } from "../icons";

interface PromptSuggestionsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  suggestions: string[];
  onSelect: (suggestion: string) => void;
  /** 标题（可选） */
  title?: string;
  /** 加载占位：渲染骨架而非真实建议；加载失败时（无建议）整体不渲染 */
  loading?: boolean;
}

const SUGGESTION_SKELETON_WIDTHS = ["w-32", "w-40", "w-28", "w-36"];

export function PromptSuggestions({
  suggestions,
  onSelect,
  title,
  loading = false,
  className,
  ...rest
}: PromptSuggestionsProps): React.JSX.Element {
  if (suggestions.length === 0 && !loading) return <></>;

  if (loading) {
    return (
      <div
        data-slot="prompt-suggestions"
        className={cn("flex w-full flex-col items-start gap-2", className)}
        {...rest}
      >
        {title && (
          <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {title}
          </p>
        )}
        <div className="flex w-full flex-wrap gap-2">
          {SUGGESTION_SKELETON_WIDTHS.map((w, i) => (
            <div key={i} className={cn("h-7 animate-pulse rounded-md bg-muted", w)} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="prompt-suggestions"
      className={cn("flex w-full flex-col items-start gap-2", className)}
      {...rest}
    >
      {title && (
        <p className="px-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
      )}
      <div className="flex w-full flex-wrap gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className={cn(
              "group/sug flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1.5 text-left text-xs text-foreground",
              "transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-primary/5 hover:text-foreground",
              "active:translate-y-0",
            )}
          >
            <span className="line-clamp-1 max-w-[280px]">{s}</span>
            <IconArrowUp
              className={cn(
                "size-3 -rotate-45 text-muted-foreground transition",
                "group-hover/sug:text-primary",
              )}
            />
          </button>
        ))}
      </div>
    </div>
  );
}
