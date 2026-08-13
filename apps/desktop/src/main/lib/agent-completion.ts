import { jsonSchema, tool } from "ai";
import type { StopCondition, TextStreamPart, ToolSet } from "ai";
import type { AgentCompletionCandidate } from "../../shared/types";

export const COMPLETE_TASK_TOOL_NAME = "complete_task";

/** Keep completion validation internal; completion tool parts never reach chat UI. */
export function hideCompletionToolStream(
  stream: ReadableStream<TextStreamPart<ToolSet>>,
): ReadableStream<TextStreamPart<ToolSet>> {
  const hiddenToolCallIds = new Set<string>();
  const hiddenApprovalIds = new Set<string>();

  return stream.pipeThrough(
    new TransformStream<TextStreamPart<ToolSet>, TextStreamPart<ToolSet>>({
      transform(part, controller) {
        const value = part as unknown as Record<string, unknown>;
        const toolName = readToolName(value);
        const toolCallId = readToolCallId(value);

        if (toolName === COMPLETE_TASK_TOOL_NAME) {
          if (toolCallId) hiddenToolCallIds.add(toolCallId);
          const approvalId = readString(value.approvalId);
          if (approvalId) hiddenApprovalIds.add(approvalId);
          return;
        }

        if (toolCallId && hiddenToolCallIds.has(toolCallId)) return;
        const approvalId = readString(value.approvalId);
        if (approvalId && hiddenApprovalIds.has(approvalId)) return;
        controller.enqueue(part);
      },
    }),
  );
}

export interface CompleteTaskInput {
  result: string;
  completedItems: string[];
  verificationEvidence: string[];
  remainingItems: string[];
  blockingReason?: string;
}

export interface CompletionValidationContext {
  hasPendingApproval?: boolean;
  hasRunningSubagents?: boolean;
  hasRecentToolError?: boolean;
}

export interface CompletionValidation {
  accepted: boolean;
  reasons: string[];
  candidate: AgentCompletionCandidate;
}

export interface CompletionController {
  tool: ToolSet[typeof COMPLETE_TASK_TOOL_NAME];
  stopWhen: StopCondition<ToolSet>;
  getCandidate(): AgentCompletionCandidate | undefined;
  getValidation(): CompletionValidation | undefined;
  submit(input: CompleteTaskInput): CompletionValidation;
  parseAndSubmit(text: string): CompletionValidation | undefined;
  reset(): void;
}

const completionSchema = jsonSchema<CompleteTaskInput>({
  type: "object",
  properties: {
    result: { type: "string", description: "The final result delivered to the user." },
    completedItems: {
      type: "array",
      items: { type: "string" },
      description: "Concrete work items completed.",
    },
    verificationEvidence: {
      type: "array",
      items: { type: "string" },
      description: "Commands, checks, tool results, or other evidence used to verify completion.",
    },
    remainingItems: {
      type: "array",
      items: { type: "string" },
      description: "Items that are still incomplete. Must be empty to finish.",
    },
    blockingReason: { type: "string", description: "Why the task cannot be completed, if any." },
  },
  required: ["result", "completedItems", "verificationEvidence", "remainingItems"],
  additionalProperties: false,
});

export function validateCompletion(
  input: CompleteTaskInput,
  context: CompletionValidationContext = {},
): CompletionValidation {
  const candidate: AgentCompletionCandidate = {
    result: input.result.trim(),
    completedItems: normalizeList(input.completedItems),
    verificationEvidence: normalizeList(input.verificationEvidence),
    remainingItems: normalizeList(input.remainingItems),
    blockingReason: input.blockingReason?.trim() || undefined,
    submittedAt: Date.now(),
  };
  const reasons: string[] = [];
  if (!candidate.result) reasons.push("A non-empty result is required.");
  if (candidate.completedItems.length === 0)
    reasons.push("At least one completed item is required.");
  if (candidate.verificationEvidence.length === 0) {
    reasons.push("Verification evidence is required.");
  }
  if (candidate.remainingItems.length > 0) {
    reasons.push("The task still has incomplete items.");
  }
  if (candidate.blockingReason) reasons.push("A blocking reason was supplied.");
  if (context.hasPendingApproval) reasons.push("A tool approval is still pending.");
  if (context.hasRunningSubagents) reasons.push("A child agent is still running.");
  if (context.hasRecentToolError) reasons.push("The most recent tool execution failed.");
  return { accepted: reasons.length === 0, reasons, candidate };
}

export function validateCompletionText(
  text: string,
  context: CompletionValidationContext = {},
): CompletionValidation | undefined {
  const json = extractJsonObject(text);
  if (!json) return undefined;
  try {
    return validateCompletion(JSON.parse(json) as CompleteTaskInput, context);
  } catch {
    return undefined;
  }
}

export function createCompletionController(
  getContext: () => CompletionValidationContext = () => ({}),
): CompletionController {
  let candidate: AgentCompletionCandidate | undefined;
  let validation: CompletionValidation | undefined;

  const completeTool = tool({
    description:
      "Declare the task complete only after all work is finished and verified. " +
      "Do not use this tool when any item remains incomplete.",
    inputSchema: completionSchema,
    execute: async (input) => {
      validation = validateCompletion(input, getContext());
      candidate = validation.candidate;
      return validation.accepted
        ? { accepted: true, message: "Completion accepted." }
        : { accepted: false, message: "Completion rejected.", reasons: validation.reasons };
    },
  });

  return {
    tool: completeTool,
    stopWhen: ({ steps }) => {
      const last = steps.at(-1);
      return Boolean(
        last?.toolCalls.some((call) => call.toolName === COMPLETE_TASK_TOOL_NAME) &&
        validation?.accepted,
      );
    },
    getCandidate: () => candidate,
    getValidation: () => validation,
    submit: (input) => {
      validation = validateCompletion(input, getContext());
      candidate = validation.candidate;
      return validation;
    },
    parseAndSubmit: (text) => {
      const json = extractJsonObject(text);
      if (!json) return undefined;
      try {
        return {
          ...(() => {
            const input = JSON.parse(json) as CompleteTaskInput;
            return validateCompletion(input, getContext());
          })(),
        };
      } catch {
        return undefined;
      }
    },
    reset: () => {
      candidate = undefined;
      validation = undefined;
    },
  };
}

function extractJsonObject(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const source = fenced ?? text;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  return start >= 0 && end > start ? source.slice(start, end + 1) : undefined;
}

function normalizeList(value: string[]): string[] {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

function readToolName(value: Record<string, unknown>): string | undefined {
  if (typeof value.toolName === "string") return value.toolName;
  const toolCall = value.toolCall;
  if (toolCall && typeof toolCall === "object") {
    const name = (toolCall as Record<string, unknown>).toolName;
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

function readToolCallId(value: Record<string, unknown>): string | undefined {
  if (typeof value.toolCallId === "string") return value.toolCallId;
  if (typeof value.id === "string") return value.id;
  const toolCall = value.toolCall;
  if (toolCall && typeof toolCall === "object") {
    const id = (toolCall as Record<string, unknown>).toolCallId;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
