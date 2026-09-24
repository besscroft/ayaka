import { createOpenAI } from "@ai-sdk/openai";
import type {
  Experimental_RealtimeModel,
  Experimental_RealtimeClientEvent,
  Experimental_RealtimeServerEvent,
  Experimental_RealtimeSessionConfig,
} from "ai";
import type { RealtimeProtocol } from "@shared/types";
import {
  buildBailianSessionConfig,
  parseBailianRealtimeServerEvent,
  serializeBailianRealtimeClientEvent,
} from "@shared/realtime-protocols";

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

class BailianRealtimeModel implements Experimental_RealtimeModel {
  readonly specificationVersion = "v4" as const;
  readonly provider = "bailian.realtime";
  readonly modelId: string;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async doCreateClientSecret(): Promise<{ token: string; url: string }> {
    throw new Error("Bailian Realtime uses a main-process WebSocket session.");
  }

  getWebSocketConfig(options: { token: string; url: string }): {
    url: string;
    protocols?: string[];
  } {
    return {
      url: options.url,
      protocols: ["realtime"],
    };
  }

  parseServerEvent(raw: unknown): Experimental_RealtimeServerEvent {
    return parseBailianRealtimeServerEvent(raw);
  }

  serializeClientEvent(event: Experimental_RealtimeClientEvent): unknown {
    return serializeBailianRealtimeClientEvent(event, this.modelId);
  }

  buildSessionConfig(config: Experimental_RealtimeSessionConfig): Record<string, unknown> {
    return buildBailianSessionConfig(config, this.modelId);
  }
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
  bailian: {
    id: "bailian",
    transport: "websocket",
    createModel(modelId, _endpoint) {
      return new BailianRealtimeModel(modelId);
    },
  },
};

/**
 * Build the browser-safe model facade for a native Realtime WebSocket adapter.
 * Long-lived credentials are never passed here; the setup URL returns either
 * an OpenAI client secret or a local main-process proxy session.
 */
export function createRealtimeModel(options: {
  descriptor: RealtimeAdapterDescriptor;
  modelId: string;
}): Experimental_RealtimeModel {
  if (options.descriptor.transport !== "websocket") {
    throw new Error(`Unsupported Realtime transport: ${String(options.descriptor.transport)}`);
  }

  const protocol = options.descriptor.protocol;
  const adapter = REALTIME_ADAPTERS[protocol];
  if (!adapter) throw new Error(`Unsupported Realtime protocol: ${String(protocol)}`);
  return adapter.createModel(options.modelId, options.descriptor.endpoint);
}
