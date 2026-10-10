import { z } from "zod";
import type { UIMessage } from "ai";

const identifier = z.string().trim().min(1).max(512);
const messageJson = z.string().max(16 * 1024 * 1024);

export const messageRowSchema = z
  .object({
    id: identifier,
    conversation_id: identifier,
    role: z.enum(["user", "assistant", "system"]),
    content: messageJson,
    content_json: messageJson.optional(),
    metadata_json: z
      .string()
      .max(256 * 1024)
      .optional(),
    created_at: z.number().int().nonnegative().safe(),
  })
  .strict();

const uiMessageSchema = z.custom<UIMessage>(
  (value): value is UIMessage => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const candidate = value as { id?: unknown; role?: unknown; parts?: unknown };
    return (
      typeof candidate.id === "string" &&
      candidate.id.length > 0 &&
      (candidate.role === "user" ||
        candidate.role === "assistant" ||
        candidate.role === "system") &&
      Array.isArray(candidate.parts) &&
      candidate.parts.length <= 500
    );
  },
  { message: "message must be a valid UI message" },
);

const runtimeStatusOptionsSchema = z
  .object({
    runId: identifier.optional(),
    runLimit: z.number().int().min(1).max(50).optional(),
    inputLimit: z.number().int().min(1).max(500).optional(),
    stepLimit: z.number().int().min(1).max(300).optional(),
    eventLimit: z.number().int().min(1).max(300).optional(),
    instanceLimit: z.number().int().min(1).max(300).optional(),
  })
  .strict();

export const ipcSchemas = {
  "messages:list": z.object({ conversationId: identifier }).strict(),
  "messages:save": messageRowSchema,
  "messages:saveBatch": z.array(messageRowSchema).max(500),
  "messages:applyPatch": z
    .object({
      conversationId: identifier,
      baseRevision: z.number().int().nonnegative().safe(),
      upserts: z.array(messageRowSchema).max(500),
      deleteIds: z.array(identifier).max(500),
    })
    .strict(),
  "agents:runtimeStatus": z
    .object({
      conversationId: identifier,
      options: runtimeStatusOptionsSchema.optional(),
    })
    .strict(),
  "runtime:enqueueInput": z
    .object({
      runId: identifier,
      kind: z.enum(["steering", "follow_up"]),
      source: z.enum(["user", "system", "automation", "tool"]).optional(),
      message: uiMessageSchema,
    })
    .strict(),
  "runtime:discardQueuedInput": z.object({ runId: identifier, inputId: identifier }).strict(),
  "runtime:cancelRun": z.object({ runId: identifier }).strict(),
} as const;

export type IpcChannel = keyof typeof ipcSchemas;
export type IpcInput<Channel extends IpcChannel> = z.infer<(typeof ipcSchemas)[Channel]>;

export class IpcValidationError extends Error {
  readonly code = "invalid_ipc_input";

  constructor(
    readonly channel: IpcChannel,
    readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(`Invalid input for IPC channel ${channel}.`);
    this.name = "IpcValidationError";
  }
}

export function parseIpcInput<Channel extends IpcChannel>(
  channel: Channel,
  input: unknown,
): IpcInput<Channel> {
  const result = ipcSchemas[channel].safeParse(input);
  if (!result.success) throw new IpcValidationError(channel, result.error.issues);
  return result.data as IpcInput<Channel>;
}
