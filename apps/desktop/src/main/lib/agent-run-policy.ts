import { isLoopFinished } from "ai";
import type { FinishReason, StopCondition, ToolSet } from "ai";

/**
 * Root chat runs are user-controlled: a model may finish naturally, while an
 * explicit abort from the chat UI stops the request. Tool-loop step counts do
 * not terminate the root agent.
 */
export const ROOT_AGENT_STOP_WHEN: StopCondition<ToolSet> = isLoopFinished();

export type AgentStepDisposition = "complete" | "continue";

export interface AgentStepOutcome {
  finishReason: FinishReason;
  toolCallCount: number;
  concludesTurn: boolean;
}

/**
 * Match the DeepSeek Harness step boundary: a model stop without tool calls
 * completes the turn, while tool results require another model step unless a
 * tool explicitly concluded the turn.
 */
export function resolveAgentStepDisposition({
  finishReason,
  toolCallCount,
  concludesTurn,
}: AgentStepOutcome): AgentStepDisposition {
  if (concludesTurn) return "complete";
  if (toolCallCount === 0 && finishReason !== "tool-calls") return "complete";
  return "continue";
}
