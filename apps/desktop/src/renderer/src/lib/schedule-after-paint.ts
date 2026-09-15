type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/** Run non-critical work after the next paint, when the renderer is idle. */
export function scheduleAfterPaint(task: () => void, timeoutMs = 500): () => void {
  const idleWindow = window as IdleWindow;
  let cancelled = false;
  let idleId: number | null = null;
  let timeoutId: number | null = null;

  const frameId = window.requestAnimationFrame(() => {
    if (cancelled) return;
    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(
        () => {
          if (!cancelled) task();
        },
        { timeout: timeoutMs },
      );
      return;
    }
    timeoutId = window.setTimeout(() => {
      if (!cancelled) task();
    }, 0);
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameId);
    if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  };
}
