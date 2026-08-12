import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("SQLite writer requires a parent port.");

const data = workerData as { dbPath: string; migrationsFolder: string };
process.env.VOID_AI_DB_WRITER_WORKER = "1";
const domain = await import("./db");
domain.initDb({
  dbPath: data.dbPath,
  migrationsFolder: data.migrationsFolder,
  migrate: true,
  seed: true,
});
parentPort.postMessage({ type: "ready" });

let requestQueue = Promise.resolve();

parentPort.on("message", (message: { type: string; id: number; payload?: unknown }) => {
  requestQueue = requestQueue.then(async () => {
    try {
      if (message.type === "invoke") {
        const payload = message.payload as { command: string; args: unknown[] };
        const handler = (domain as Record<string, unknown>)[payload.command];
        if (typeof handler !== "function")
          throw new Error(`Unknown SQLite write command: ${payload.command}`);
        const result = await handler(...payload.args);
        parentPort?.postMessage({ type: "result", id: message.id, result });
      } else if (message.type === "flush") {
        parentPort?.postMessage({ type: "result", id: message.id });
      } else if (message.type === "shutdown") {
        await domain.closeDb();
        parentPort?.postMessage({ type: "result", id: message.id });
      } else {
        throw new Error(`Unknown SQLite writer request: ${message.type}`);
      }
    } catch (error) {
      const value = error instanceof Error ? error : new Error(String(error));
      parentPort?.postMessage({
        type: "error",
        id: message.id,
        error: { name: value.name, message: value.message, stack: value.stack },
      });
    }
  });
});
