import { parentPort, workerData } from "node:worker_threads";

if (!parentPort) throw new Error("SQLite writer requires a parent port.");

const data = workerData as {
  dbPath: string;
  migrationsFolder: string;
  appPath?: string;
  userDataDir: string;
};
process.env.VOID_AI_DB_WRITER_WORKER = "1";
process.env.VOID_AI_USER_DATA_DIR = data.userDataDir;
if (data.appPath) process.env.VOID_AI_APP_PATH = data.appPath;
const [dbDomain, cronDomain] = await Promise.all([import("./db"), import("./cron-store")]);
dbDomain.initDb({
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
        const handler =
          (dbDomain as Record<string, unknown>)[payload.command] ??
          (cronDomain as Record<string, unknown>)[payload.command];
        if (typeof handler !== "function")
          throw new Error(`Unknown SQLite write command: ${payload.command}`);
        const result = await handler(...payload.args);
        parentPort?.postMessage({ type: "result", id: message.id, result });
      } else if (message.type === "flush") {
        parentPort?.postMessage({ type: "result", id: message.id });
      } else if (message.type === "shutdown") {
        await dbDomain.closeDb();
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
