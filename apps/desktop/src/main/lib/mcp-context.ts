import { AsyncLocalStorage } from "node:async_hooks";

export interface McpExecutionContext {
  serverId: string;
  conversationId: string | null;
  agentId: string | null;
  sampling?: (request: unknown) => Promise<unknown>;
}

const storage = new AsyncLocalStorage<McpExecutionContext>();

export function getMcpExecutionContext(): McpExecutionContext | undefined {
  return storage.getStore();
}

export function runWithMcpExecutionContext<T>(context: McpExecutionContext, callback: () => T): T {
  return storage.run(context, callback);
}
