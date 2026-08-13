import type { JSONValue, ModelMessage, ToolResultPart, UIMessage } from "ai";

interface AgentToolResult {
  toolCallId: string;
  toolName: string;
  output: unknown;
}

/**
 * AI SDK may return tool results separately from responseMessages for a
 * single-step agent stream. Reconcile both collections before the next model
 * request so every assistant tool call has a matching tool message.
 */
export function reconcileToolResults(
  responseMessages: ModelMessage[],
  toolResults: readonly AgentToolResult[],
): ModelMessage[] {
  const presentToolResultIds = new Set<string>();
  for (const message of responseMessages) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type === "tool-result") presentToolResultIds.add(part.toolCallId);
    }
  }

  const missingResults: ToolResultPart[] = toolResults
    .filter((result) => result.toolCallId && !presentToolResultIds.has(result.toolCallId))
    .map((result) => ({
      type: "tool-result" as const,
      toolCallId: result.toolCallId,
      toolName: result.toolName,
      output: normalizeToolOutput(result.output),
    }));

  if (missingResults.length === 0) return responseMessages;
  return [...responseMessages, { role: "tool", content: missingResults }];
}

/** Remove abandoned UI tool calls before a retry reaches AI SDK prompt validation. */
export function removeIncompleteToolParts(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const parts = message.parts.filter((part) => {
      if (!isToolPart(part)) return true;
      return isCompletedToolPart(part);
    });
    return parts.length === message.parts.length ? message : { ...message, parts };
  });
}

function isToolPart(part: UIMessage["parts"][number]): part is UIMessage["parts"][number] & {
  state?: string;
  toolCallId?: string;
} {
  return (
    typeof part === "object" &&
    part !== null &&
    (("toolCallId" in part && typeof part.toolCallId === "string") ||
      (typeof part.type === "string" &&
        (part.type === "dynamic-tool" || part.type.startsWith("tool-"))))
  );
}

function isCompletedToolPart(part: { state?: string }): boolean {
  return (
    part.state === "output-available" ||
    part.state === "output-error" ||
    part.state === "output-denied"
  );
}

function normalizeToolOutput(output: unknown): ToolResultPart["output"] {
  return typeof output === "string"
    ? { type: "text", value: output }
    : { type: "json", value: output as JSONValue };
}
