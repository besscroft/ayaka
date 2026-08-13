import type { AgentRuntimeStatus } from "@shared/types";
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
