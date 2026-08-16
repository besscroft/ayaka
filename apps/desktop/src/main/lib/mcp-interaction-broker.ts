import { randomUUID } from "node:crypto";
import { shell } from "electron";
import type { McpInputRequest } from "../../shared/types";
import { getMcpExecutionContext } from "./mcp-context";

type InputListener = (request: McpInputRequest) => void;
type PendingInput = {
  request: McpInputRequest;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, PendingInput>();
const listeners = new Set<InputListener>();

export function onMcpInputRequested(listener: InputListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestMcpInput(serverId: string, request: unknown): Promise<unknown> {
  const context = getMcpExecutionContext();
  const params = asRecord(asRecord(request).params);
  const mode = params.mode === "url" ? "url" : "form";
  const input: McpInputRequest = {
    id: randomUUID(),
    serverId,
    conversationId: context?.conversationId ?? null,
    agentId: context?.agentId ?? null,
    kind: mode,
    message: typeof params.message === "string" ? params.message : "MCP server requests input.",
    url: typeof params.url === "string" ? params.url : null,
    requestedSchema: isObject(params.requestedSchema) ? params.requestedSchema : null,
    createdAt: Date.now(),
  };
  if (input.kind === "url" && input.url) {
    try {
      const url = new URL(input.url);
      if (url.protocol === "https:" || url.protocol === "http:")
        void shell.openExternal(url.toString()).catch(() => undefined);
    } catch {
      // The renderer still receives the request and can show the malformed URL safely.
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(input.id);
      reject(new Error("MCP input request timed out."));
    }, 5 * 60_000);
    pending.set(input.id, { request: input, resolve, reject, timer });
    for (const listener of listeners) {
      try {
        listener(input);
      } catch {
        // UI event delivery is best effort.
      }
    }
  });
}

export function respondMcpInput(id: string, value: unknown): boolean {
  const item = pending.get(id);
  if (!item) return false;
  clearTimeout(item.timer);
  pending.delete(id);
  if (item.request.kind === "url") item.resolve({ action: "accept" });
  else item.resolve({ action: "accept", content: isObject(value) ? value : {} });
  return true;
}

export function cancelMcpInput(id: string): boolean {
  const item = pending.get(id);
  if (!item) return false;
  clearTimeout(item.timer);
  pending.delete(id);
  item.reject(new Error("MCP input request was cancelled."));
  return true;
}

export function cancelAllMcpInputs(): void {
  for (const id of pending.keys()) cancelMcpInput(id);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
