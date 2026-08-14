import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "../../lib/utils";
import { useConversationScrollOptional } from "./use-conversation-scroll";

interface AnimatedDisclosureContextValue {
  contentId: string;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
}

const AnimatedDisclosureContext = createContext<AnimatedDisclosureContextValue | null>(null);

function useAnimatedDisclosure(): AnimatedDisclosureContextValue {
  const ctx = useContext(AnimatedDisclosureContext);
  if (!ctx) throw new Error("AnimatedDisclosure components must be used inside the root");
  return ctx;
}

interface AnimatedDisclosureProps extends HTMLAttributes<HTMLDivElement> {
  open?: boolean;
  defaultOpen?: boolean;
  active?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

export function AnimatedDisclosure({
  open,
  defaultOpen,
  active = false,
  onOpenChange,
  className,
  children,
  ...rest
}: AnimatedDisclosureProps): React.JSX.Element {
  const contentId = useId();
  const wasActiveRef = useRef(active);
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? active);
  const isOpen = open ?? internalOpen;

  const setOpen = (next: boolean): void => {
    onOpenChange?.(next);
    if (open === undefined) setInternalOpen(next);
  };

  useEffect(() => {
    if (open !== undefined) return;
    if (active) {
      wasActiveRef.current = true;
      setInternalOpen(true);
      return;
    }
    if (wasActiveRef.current) {
      wasActiveRef.current = false;
      setInternalOpen(false);
    }
  }, [active, open]);

  return (
    <AnimatedDisclosureContext.Provider value={{ contentId, isOpen, setOpen }}>
      <div
        data-slot="animated-disclosure"
        data-open={isOpen ? "true" : "false"}
        data-active={active ? "true" : "false"}
        className={className}
        {...rest}
      >
        {children}
      </div>
    </AnimatedDisclosureContext.Provider>
  );
}

interface AnimatedDisclosureTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
}

export function AnimatedDisclosureTrigger({
  className,
  children,
  onPointerDown,
  onClick,
  ...rest
}: AnimatedDisclosureTriggerProps): React.JSX.Element {
  const { contentId, isOpen, setOpen } = useAnimatedDisclosure();
  const conversationScroll = useConversationScrollOptional();
  return (
    <button
      type="button"
      data-slot="animated-disclosure-trigger"
      aria-expanded={isOpen}
      aria-controls={contentId}
      className={className}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented) conversationScroll?.preserveScrollOnDisclosure();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          conversationScroll?.preserveScrollOnDisclosure();
          setOpen(!isOpen);
        }
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

interface AnimatedDisclosureContentProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  innerClassName?: string;
}

export function AnimatedDisclosureContent({
  className,
  innerClassName,
  children,
  ...rest
}: AnimatedDisclosureContentProps): React.JSX.Element {
  const { contentId, isOpen } = useAnimatedDisclosure();
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0.01 : 0.18;

  return (
    <AnimatePresence initial={false}>
      {isOpen ? (
        <motion.div
          key="content"
          id={contentId}
          data-slot="animated-disclosure-content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
          className={cn("overflow-hidden", className)}
        >
          <div className={innerClassName} {...rest}>
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function AnimatedDisclosureChevron({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  const { isOpen } = useAnimatedDisclosure();
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      aria-hidden
      animate={{ rotate: isOpen ? 180 : 0 }}
      transition={{ duration: reduceMotion ? 0.01 : 0.16 }}
      className={className}
    >
      {children}
    </motion.span>
  );
}
