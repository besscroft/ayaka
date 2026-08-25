export const REASONING_AUTO_STICK_THRESHOLD = 32;

export function getReasoningScrollDistance({
  scrollHeight,
  scrollTop,
  clientHeight,
}: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">): number {
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function shouldFollowReasoningContent(
  element: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean {
  return getReasoningScrollDistance(element) <= REASONING_AUTO_STICK_THRESHOLD;
}
