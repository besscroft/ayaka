import type { ChatErrorCode, RuntimeRun } from "@shared/types";

export type ChatRunMode = "start" | "resume";

export interface ChatRetryRunSelection {
  runId: string;
  mode: ChatRunMode;
}

const STALE_RUN_ERROR_CODES: ReadonlySet<ChatErrorCode> = new Set([
  "run_not_active",
  "run_not_found",
]);

/** Only a resumable blocked run may keep its identity during a chat retry. */
export function isResumableBlockedRun(
  run: Pick<RuntimeRun, "status" | "metadata_json"> | null | undefined,
): boolean {
  if (!run || run.status !== "blocked") return false;
  try {
    const metadata = JSON.parse(run.metadata_json ?? "{}") as { resumable?: unknown };
    return metadata.resumable !== false;
  } catch {
    return false;
  }
}

export function selectChatRetryRun({
  currentRunId,
  currentRun,
  newRunId,
}: {
  currentRunId: string | null;
  currentRun: RuntimeRun | null | undefined;
  newRunId: string;
}): ChatRetryRunSelection {
  if (currentRunId && currentRun?.id === currentRunId && isResumableBlockedRun(currentRun)) {
    return { runId: currentRunId, mode: "resume" };
  }
  return { runId: newRunId, mode: "start" };
}

export function shouldFallbackToFreshRun(code: ChatErrorCode, alreadyAttempted: boolean): boolean {
  return !alreadyAttempted && STALE_RUN_ERROR_CODES.has(code);
}
