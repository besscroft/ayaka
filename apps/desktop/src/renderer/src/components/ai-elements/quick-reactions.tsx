import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";

export const DEFAULT_REACTIONS: readonly string[] = ["👍", "❤️", "🎉", "😂", "🤔", "🔥"];

const REACTION_LABELS: Record<string, string> = {
  "👍": "helpful",
  "❤️": "loved",
  "🎉": "celebration",
  "😂": "funny",
  "🤔": "thoughtful",
  "🔥": "strong",
};

interface QuickReactionsProps extends Omit<HTMLMotionProps<"div">, "onSelect"> {
  onReact: (emoji: string, label: string) => void;
  selectedEmoji?: string;
  reactions?: readonly string[];
  placement?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
}

export function QuickReactions({
  onReact,
  selectedEmoji,
  reactions = DEFAULT_REACTIONS,
  placement = "bottom-left",
  className,
  ...rest
}: QuickReactionsProps): React.JSX.Element {
  const { t } = useT();

  return (
    <AnimatePresence initial={false}>
      <motion.div
        data-slot="quick-reactions"
        data-placement={placement}
        role="toolbar"
        aria-label={t("ai.quickReactions.toolbar")}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16 }}
        className={cn(
          "mt-1.5 flex items-center gap-0.5 rounded-full",
          "text-foreground/50 transition group-hover/msg:text-foreground/75 group-focus-within/msg:text-foreground/75",
          className,
        )}
        onMouseDown={(event) => event.stopPropagation()}
        {...rest}
      >
        {reactions.map((emoji) => {
          const selected = selectedEmoji === emoji;
          const label = REACTION_LABELS[emoji] ?? emoji;
          return (
            <motion.button
              data-slot="quick-reaction-item"
              key={emoji}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onReact(emoji, label);
              }}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.94 }}
              aria-pressed={selected}
              aria-label={t("ai.quickReactions.reactWith", { emoji })}
              title={t("ai.quickReactions.reactWith", { emoji })}
              className={cn(
                "flex size-7 items-center justify-center rounded-full text-base transition-colors",
                selected ? "bg-accent/15 text-foreground ring-1 ring-accent/30" : "hover:bg-muted",
              )}
            >
              {emoji}
            </motion.button>
          );
        })}
      </motion.div>
    </AnimatePresence>
  );
}
