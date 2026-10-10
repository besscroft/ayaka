import type { UIMessage } from "ai";
import type { IpcInput } from "../../shared/ipc-schema";
import type { AgentRunInput, AgentRunInputKind, AgentRunInputSource } from "../../shared/types";

export type RuntimeEnqueueInput = IpcInput<"runtime:enqueueInput">;

type EnqueueAgentRunInput = (
  runId: string,
  kind: AgentRunInputKind,
  source: AgentRunInputSource,
  message: UIMessage,
) => Promise<AgentRunInput>;

export function createRuntimeEnqueueInputHandler(enqueue: EnqueueAgentRunInput) {
  return async (
    input: RuntimeEnqueueInput,
  ): Promise<{ ok: true; value: AgentRunInput } | { ok: false; code: string; error: string }> => {
    try {
      return {
        ok: true,
        value: await enqueue(input.runId, input.kind, input.source ?? "user", input.message),
      };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "enqueue_failed";
      return {
        ok: false,
        code,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
}
