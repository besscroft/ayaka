import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useReducedMotion } from "motion/react";

export const CONVERSATION_AUTO_STICK_THRESHOLD = 32;
export const CONVERSATION_SCROLL_BUTTON_THRESHOLD = 200;

export interface ConversationScrollState {
  isAtLatest: boolean;
  isAwayFromLatest: boolean;
}

export function getConversationScrollState(distanceFromLatest: number): ConversationScrollState {
  return {
    isAtLatest: distanceFromLatest <= CONVERSATION_AUTO_STICK_THRESHOLD,
    isAwayFromLatest: distanceFromLatest > CONVERSATION_SCROLL_BUTTON_THRESHOLD,
  };
}

export function getConversationScrollDistance({
  scrollHeight,
  scrollTop,
  clientHeight,
}: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function shouldFollowConversationContent(autoStick: boolean): boolean {
  return autoStick;
}

export function shouldHandleConversationScroll(isProgrammaticScroll: boolean): boolean {
  return !isProgrammaticScroll;
}

export interface ConversationScrollController {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: (node: HTMLDivElement | null) => void;
  isAwayFromLatest: boolean;
  scrollToLatest: () => void;
}

const ConversationScrollContext = createContext<ConversationScrollController | null>(null);

export function useConversationScrollController(): ConversationScrollController {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [contentNode, setContentNode] = useState<HTMLDivElement | null>(null);
  const [isAwayFromLatest, setIsAwayFromLatest] = useState(false);
  const autoStickRef = useRef(true);
  const programmaticScrollRef = useRef(false);
  const scrollStateFrameRef = useRef<number | null>(null);
  const followFrameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const reducedMotion = Boolean(useReducedMotion());

  const updateScrollState = useCallback((): void => {
    if (scrollStateFrameRef.current !== null) return;
    scrollStateFrameRef.current = window.requestAnimationFrame(() => {
      scrollStateFrameRef.current = null;
      const node = containerRef.current;
      if (!node || !shouldHandleConversationScroll(programmaticScrollRef.current)) return;

      const state = getConversationScrollState(getConversationScrollDistance(node));
      autoStickRef.current = state.isAtLatest;
      setIsAwayFromLatest((previous) =>
        previous === state.isAwayFromLatest ? previous : state.isAwayFromLatest,
      );
    });
  }, []);

  const scheduleFollow = useCallback((): void => {
    if (!shouldFollowConversationContent(autoStickRef.current)) return;
    if (followFrameRef.current !== null) return;

    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      const node = containerRef.current;
      if (
        !node ||
        !shouldFollowConversationContent(autoStickRef.current) ||
        programmaticScrollRef.current
      ) {
        return;
      }

      node.scrollTop = node.scrollHeight;
      setIsAwayFromLatest(false);
    });
  }, []);

  const finishProgrammaticScroll = useCallback((): void => {
    if (!programmaticScrollRef.current) return;
    programmaticScrollRef.current = false;
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    scheduleFollow();
    updateScrollState();
  }, [scheduleFollow, updateScrollState]);

  const cancelProgrammaticScroll = useCallback((): void => {
    if (!programmaticScrollRef.current) return;
    programmaticScrollRef.current = false;
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    updateScrollState();
  }, [updateScrollState]);

  const scrollToLatest = useCallback((): void => {
    const node = containerRef.current;
    if (!node) return;

    autoStickRef.current = true;
    setIsAwayFromLatest(false);

    if (reducedMotion) {
      programmaticScrollRef.current = false;
      node.scrollTo({ top: node.scrollHeight, behavior: "auto" });
      return;
    }

    programmaticScrollRef.current = true;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(finishProgrammaticScroll, 700);
  }, [finishProgrammaticScroll, reducedMotion]);

  const contentRef = useCallback((node: HTMLDivElement | null): void => {
    setContentNode(node);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const handleScroll = (): void => updateScrollState();
    const handleUserInteraction = (): void => cancelProgrammaticScroll();
    const handleScrollEnd = (): void => finishProgrammaticScroll();

    node.addEventListener("scroll", handleScroll, { passive: true });
    node.addEventListener("wheel", handleUserInteraction, { passive: true });
    node.addEventListener("touchstart", handleUserInteraction, { passive: true });
    node.addEventListener("pointerdown", handleUserInteraction, { passive: true });
    node.addEventListener("scrollend", handleScrollEnd, { passive: true });
    updateScrollState();

    return () => {
      node.removeEventListener("scroll", handleScroll);
      node.removeEventListener("wheel", handleUserInteraction);
      node.removeEventListener("touchstart", handleUserInteraction);
      node.removeEventListener("pointerdown", handleUserInteraction);
      node.removeEventListener("scrollend", handleScrollEnd);
    };
  }, [cancelProgrammaticScroll, finishProgrammaticScroll, updateScrollState]);

  useEffect(() => {
    if (!contentNode) return;

    if (typeof ResizeObserver === "undefined") {
      scheduleFollow();
      return;
    }

    const observer = new ResizeObserver(() => scheduleFollow());
    observer.observe(contentNode);
    scheduleFollow();
    return () => observer.disconnect();
  }, [contentNode, scheduleFollow]);

  useEffect(() => {
    return () => {
      if (scrollStateFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollStateFrameRef.current);
      }
      if (followFrameRef.current !== null) {
        window.cancelAnimationFrame(followFrameRef.current);
      }
      if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    };
  }, []);

  return useMemo(
    () => ({ containerRef, contentRef, isAwayFromLatest, scrollToLatest }),
    [contentRef, isAwayFromLatest, scrollToLatest],
  );
}

export function ConversationScrollProvider({
  value,
  children,
}: {
  value: ConversationScrollController;
  children: ReactNode;
}): React.JSX.Element {
  return createElement(ConversationScrollContext.Provider, { value }, children);
}

export function useConversationScroll(): ConversationScrollController {
  const value = useContext(ConversationScrollContext);
  if (!value) throw new Error("useConversationScroll must be used inside Conversation");
  return value;
}
