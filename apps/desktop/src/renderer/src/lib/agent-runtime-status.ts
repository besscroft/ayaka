import type { AgentRuntimeStatus, RuntimeRun } from "@shared/types";
import type { TranslationKey } from "./i18n.messages";

export const AGENT_RUNTIME_STATUS_KEYS: Record<AgentRuntimeStatus, TranslationKey> = {
  blocked: "status.run.blocked",
  failed: "status.run.failed",
  handoff: "status.AgentRuntime.handoff",
  idle: "status.sync.idle",
  learning: "status.AgentRuntime.learning",
  queued: "status.run.queued",
  reviewing: "status.AgentRuntime.reviewing",
  running: "status.run.running",
  sandbox: "status.AgentRuntime.sandbox",
  tool_calling: "status.AgentRuntime.toolCalling",
};

export const ACTIVE_CONVERSATION_RUN_STATUSES: ReadonlySet<RuntimeRun["status"]> = new Set([
  "queued",
  "running",
  "waiting_approval",
  "waiting_handoff",
]);

export function getRunningConversationIds(runs: RuntimeRun[]): Set<string> {
  return new Set(
    runs
      .filter(
        (run) => run.conversation_id !== null && ACTIVE_CONVERSATION_RUN_STATUSES.has(run.status),
      )
      .map((run) => run.conversation_id as string),
  );
}
