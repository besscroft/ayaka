import { createOpenAI } from "@ai-sdk/openai";
import type { Experimental_RealtimeModel } from "ai";
import type { RealtimeProtocol } from "@shared/types";

export interface RealtimeAdapterDescriptor {
  transport: "websocket";
  protocol: RealtimeProtocol;
  endpoint: string;
}

export interface RealtimeAdapter {
  id: RealtimeProtocol;
  transport: "websocket";
  createModel(modelId: string, endpoint: string): Experimental_RealtimeModel;
}

const REALTIME_ADAPTERS: Record<RealtimeProtocol, RealtimeAdapter> = {
  openai: {
    id: "openai",
    transport: "websocket",
    createModel(modelId, endpoint) {
      return createOpenAI({ apiKey: "", baseURL: endpoint, name: "openai" }).experimental_realtime(
        modelId,
      );
    },
  },
  "openai-compatible": {
    id: "openai-compatible",
    transport: "websocket",
    createModel(modelId, endpoint) {
      return createOpenAI({
        apiKey: "",
        baseURL: endpoint,
        name: "openai-compatible",
      }).experimental_realtime(modelId);
    },
  },
};

/**
 * Build the browser-safe model facade for a Realtime WebSocket adapter.
 * Long-lived credentials are never passed here; the setup URL mints the
 * short-lived client secret in the main process.
 */
export function createRealtimeModel(options: {
  descriptor: RealtimeAdapterDescriptor;
  modelId: string;
}): Experimental_RealtimeModel {
  if (options.descriptor.transport !== "websocket") {
    throw new Error(`Unsupported Realtime transport: ${options.descriptor.transport}`);
  }

  const adapter = REALTIME_ADAPTERS[options.descriptor.protocol];
  if (!adapter) throw new Error(`Unsupported Realtime protocol: ${options.descriptor.protocol}`);
  return adapter.createModel(options.modelId, options.descriptor.endpoint);
}
