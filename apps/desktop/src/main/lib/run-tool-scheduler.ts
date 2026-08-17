import type { ToolSet } from "ai";

export interface ToolTurnControl {
  concludeTurn(): void;
  reset(): void;
  readonly concluded: boolean;
}

export function createToolTurnControl(): ToolTurnControl {
  let concluded = false;
  return {
    concludeTurn: () => {
      concluded = true;
    },
    reset: () => {
      concluded = false;
    },
    get concluded() {
      return concluded;
    },
  };
}

const READ_ONLY_TOOLS = new Set([
  "memory_search",
  "memory_list",
  "memory_get",
  "memory_file_read",
  "soul_list",
  "soul_read",
  "runtime_snapshot",
  "conversation_search",
  "current_time",
  "web_search",
  "web_open",
  "google_search",
  "sandbox_read_file",
  "sandbox_list_files",
  "sandbox_list_artifacts",
]);

export class RunToolScheduler {
  private writeTail: Promise<void> = Promise.resolve();

  async acquire(toolName: string, signal: AbortSignal): Promise<() => void> {
    if (READ_ONLY_TOOLS.has(toolName) || toolName.startsWith("consult_")) {
      throwIfAborted(signal);
      return () => undefined;
    }

    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.writeTail;
    this.writeTail = previous.catch(() => undefined).then(() => gate);
    await previous.catch(() => undefined);
    throwIfAborted(signal);
    return release;
  }
}

export function scheduleToolSet(
  tools: ToolSet,
  scheduler: RunToolScheduler,
  signal: AbortSignal,
  beginToolCall?: () => boolean,
  turnControl?: ToolTurnControl,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const executable = definition as typeof definition & {
        execute?: (...args: unknown[]) => unknown;
      };
      if (!executable.execute) return [name, definition];
      const execute = executable.execute.bind(definition);
      return [
        name,
        {
          ...definition,
          execute: async function* (...args: unknown[]) {
            const release = await scheduler.acquire(name, signal);
            try {
              if (beginToolCall && !beginToolCall()) {
                throw new Error("Agent run tool-call budget exhausted.");
              }
              const executionArgs =
                turnControl && args.length > 1 && isRecord(args[1])
                  ? [
                      args[0],
                      {
                        ...args[1],
                        concludeTurn: () => turnControl.concludeTurn(),
                      },
                    ]
                  : args;
              const result = execute(...executionArgs);
              if (isAsyncIterable(result)) {
                for await (const chunk of result) yield chunk;
              } else {
                yield await result;
              }
            } finally {
              release();
            }
          },
        },
      ];
    }),
  ) as ToolSet;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return !!value && typeof value === "object" && Symbol.asyncIterator in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException(String(signal.reason ?? "Agent run cancelled"), "AbortError");
}
