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
export const CONVERSATION_DISCLOSURE_SCROLL_LOCK_MS = 300;

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

export function shouldFollowConversationContent(
  autoStick: boolean,
  disclosureScrollLocked = false,
): boolean {
  return autoStick && !disclosureScrollLocked;
}

export function isConversationDisclosureScrollLocked(now: number, lockedUntil: number): boolean {
  return now < lockedUntil;
}

export function shouldHandleConversationScroll(isProgrammaticScroll: boolean): boolean {
  return !isProgrammaticScroll;
}

export function getDisclosureScrollAdjustment(
  wasAboveViewport: boolean,
  previousHeight: number,
  currentHeight: number,
): number {
  return wasAboveViewport ? currentHeight - previousHeight : 0;
}

interface DisclosureScrollSnapshot {
  element: HTMLElement;
  wasAboveViewport: boolean;
  previousHeight: number;
}

export interface ConversationScrollController {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: (node: HTMLDivElement | null) => void;
  isAwayFromLatest: boolean;
  scrollToLatest: () => void;
  preserveScrollOnDisclosure: (element?: HTMLElement | null) => void;
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
  const disclosureScrollLockUntilRef = useRef(0);
  const disclosureScrollLockTimerRef = useRef<number | null>(null);
  const disclosureScrollSnapshotRef = useRef<DisclosureScrollSnapshot | null>(null);
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
    if (
      !shouldFollowConversationContent(
        autoStickRef.current,
        isConversationDisclosureScrollLocked(Date.now(), disclosureScrollLockUntilRef.current),
      )
    ) {
      return;
    }
    if (followFrameRef.current !== null) return;

    followFrameRef.current = window.requestAnimationFrame(() => {
      followFrameRef.current = null;
      const node = containerRef.current;
      if (
        !node ||
        !shouldFollowConversationContent(
          autoStickRef.current,
          isConversationDisclosureScrollLocked(Date.now(), disclosureScrollLockUntilRef.current),
        ) ||
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

  const preserveScrollOnDisclosure = useCallback(
    (element?: HTMLElement | null): void => {
      cancelProgrammaticScroll();
      updateScrollState();

      const container = containerRef.current;
      if (container && element) {
        const containerRect = container.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        disclosureScrollSnapshotRef.current = {
          element,
          wasAboveViewport: elementRect.bottom <= containerRect.top,
          previousHeight: elementRect.height,
        };
      } else {
        disclosureScrollSnapshotRef.current = null;
      }

      disclosureScrollLockUntilRef.current = Date.now() + CONVERSATION_DISCLOSURE_SCROLL_LOCK_MS;
      if (disclosureScrollLockTimerRef.current !== null) {
        window.clearTimeout(disclosureScrollLockTimerRef.current);
      }
      disclosureScrollLockTimerRef.current = window.setTimeout(() => {
        disclosureScrollLockTimerRef.current = null;
        disclosureScrollLockUntilRef.current = 0;
        disclosureScrollSnapshotRef.current = null;
      }, CONVERSATION_DISCLOSURE_SCROLL_LOCK_MS);
    },
    [cancelProgrammaticScroll, updateScrollState],
  );

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
    const handleUserInteraction = (): void => {
      cancelProgrammaticScroll();
      updateScrollState();
    };
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

    const observer = new ResizeObserver(() => {
      const node = containerRef.current;
      const snapshot = disclosureScrollSnapshotRef.current;
      if (node && snapshot && snapshot.element.isConnected) {
        const currentHeight = snapshot.element.getBoundingClientRect().height;
        const adjustment = getDisclosureScrollAdjustment(
          snapshot.wasAboveViewport,
          snapshot.previousHeight,
          currentHeight,
        );
        if (adjustment !== 0) node.scrollTop += adjustment;
        snapshot.previousHeight = currentHeight;
      }
      scheduleFollow();
    });
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
      if (disclosureScrollLockTimerRef.current !== null) {
        window.clearTimeout(disclosureScrollLockTimerRef.current);
      }
      disclosureScrollSnapshotRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      containerRef,
      contentRef,
      isAwayFromLatest,
      preserveScrollOnDisclosure,
      scrollToLatest,
    }),
    [contentRef, isAwayFromLatest, preserveScrollOnDisclosure, scrollToLatest],
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

export function useConversationScrollOptional(): ConversationScrollController | null {
  return useContext(ConversationScrollContext);
}
