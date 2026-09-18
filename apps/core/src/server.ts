import { serve } from "@hono/node-server";
import type { Hono } from "hono";

export interface CoreServerOptions {
  hostname?: string;
  port?: number;
}

export interface CoreServerHandle {
  port: number;
  close(): void;
}

/** Start a Node HTTP host for a Core Hono app. Business logic stays in Core/runtime adapters. */
export function startCoreServer(
  app: Hono,
  options: CoreServerOptions = {},
): Promise<CoreServerHandle> {
  return new Promise((resolve, reject) => {
    let instance: ReturnType<typeof serve>;
    try {
      instance = serve({
        fetch: app.fetch,
        hostname: options.hostname ?? "127.0.0.1",
        port: options.port ?? 0,
        overrideGlobalObjects: false,
      });
    } catch (error) {
      reject(error);
      return;
    }

    instance.on?.("error", reject);
    instance.on?.("listening", () => {
      const address = instance.address();
      const port = address && typeof address === "object" && "port" in address ? address.port : 0;
      resolve({ port, close: () => instance.close?.() });
    });
  });
}
