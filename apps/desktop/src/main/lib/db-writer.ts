import { Worker } from "node:worker_threads";
import { join } from "node:path";
import type { NewRuntimeEvent } from "./schema";
import { resolveAppPath, resolveUserDataDir } from "./runtime-paths";

type WriterMessage = {
  type: "ready" | "result" | "error" | "shutdown";
  id?: number;
  result?: unknown;
  error?: { message: string; name?: string; stack?: string; code?: string };
};

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

const LOW_PRIORITY_FLUSH_MS = 200;
const MAX_LOW_PRIORITY_EVENTS = 1_000;

let worker: Worker | null = null;
let startup: Promise<void> | null = null;
let workerFailure: Error | null = null;
let stoppingWorker = false;
let nextId = 1;
let queue = Promise.resolve();
let lowPriorityEvents: NewRuntimeEvent[] = [];
let lowPriorityTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, Pending>();

export const isDbWriterWorker = process.env.VOID_AI_DB_WRITER_WORKER === "1";

export function isDbWriterStarted(): boolean {
  return worker !== null && startup !== null;
}

function resolveDbPath(): string {
  const userData = resolveUserDataDir();
  return join(userData, "data", "void-ai.db");
}

export function startDbWriter(options: {
  dbPath?: string;
  migrationsFolder: string;
}): Promise<void> {
  if (startup) return startup;
  workerFailure = null;
  stoppingWorker = false;
  startup = new Promise<void>((resolve, reject) => {
    const workerUrl = import.meta.url.includes("/chunks/")
      ? new URL("../db-writer-worker.mjs", import.meta.url)
      : new URL("./db-writer-worker.ts", import.meta.url);
    const instance = new Worker(workerUrl, {
      workerData: {
        role: "sqlite-writer",
        dbPath: options.dbPath ?? resolveDbPath(),
        migrationsFolder: options.migrationsFolder,
        appPath: resolveAppPath(),
        userDataDir: resolveUserDataDir(),
      },
    });
    worker = instance;
    instance.on("message", (message: WriterMessage) => {
      if (message.type === "ready") {
        resolve();
        return;
      }
      if (message.id === undefined) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.type === "error") {
        const error = new Error(message.error?.message ?? "SQLite writer failed.");
        error.name = message.error?.name ?? "SQLiteWriterError";
        if (message.error?.stack) error.stack = message.error.stack;
        request.reject(error);
      } else {
        request.resolve(message.result);
      }
    });
    const fail = (error: Error): void => {
      workerFailure = error;
      reject(error);
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };
    instance.once("error", fail);
    instance.once("exit", (code) => {
      if (!stoppingWorker) {
        if (code !== 0) fail(new Error(`SQLite writer exited with code ${code}.`));
        else if (worker === instance && !workerFailure)
          fail(new Error("SQLite writer stopped unexpectedly."));
      }
      worker = null;
      startup = null;
    });
  });
  return startup;
}

function call<T>(type: "invoke" | "flush" | "shutdown", payload?: unknown): Promise<T> {
  if (workerFailure) return Promise.reject(workerFailure);
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    if (!worker) {
      pending.delete(id);
      reject(new Error("SQLite writer is not started."));
      return;
    }
    worker.postMessage({ type, id, payload });
  });
}

export function writeDb<T>(command: string, args: unknown[] = []): Promise<T> {
  if (isDbWriterWorker) throw new Error("writeDb must not be called inside the SQLite writer.");
  const buffered = takeLowPriorityEvents();
  return appendTask(async () => {
    await writeBufferedEvents(buffered);
    return call<T>("invoke", { command, args });
  });
}

export function enqueueLowPriorityRuntimeEvent(event: NewRuntimeEvent): void {
  if (lowPriorityEvents.length >= MAX_LOW_PRIORITY_EVENTS) lowPriorityEvents.shift();
  lowPriorityEvents.push(event);
  if (!lowPriorityTimer) {
    lowPriorityTimer = setTimeout(() => {
      lowPriorityTimer = null;
      void flushLowPriorityRuntimeEvents();
    }, LOW_PRIORITY_FLUSH_MS);
  }
}

async function flushLowPriorityRuntimeEvents(): Promise<void> {
  const batch = takeLowPriorityEvents();
  if (batch.length === 0) return;
  await appendTask(() => writeBufferedEvents(batch));
}

function takeLowPriorityEvents(): NewRuntimeEvent[] {
  if (lowPriorityTimer) {
    clearTimeout(lowPriorityTimer);
    lowPriorityTimer = null;
  }
  const batch = lowPriorityEvents;
  lowPriorityEvents = [];
  return batch;
}

async function writeBufferedEvents(batch: NewRuntimeEvent[]): Promise<void> {
  for (const event of batch)
    await call<void>("invoke", { command: "insertRuntimeEvent", args: [event] });
}

function appendTask<T>(run: () => Promise<T>): Promise<T> {
  const task = queue.then(run);
  queue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

export async function flushDbWriter(): Promise<void> {
  if (!worker) return;
  await flushLowPriorityRuntimeEvents();
  await queue;
  await call<void>("flush");
}

export async function shutdownDbWriter(): Promise<void> {
  if (!worker) return;
  await flushDbWriter();
  if (!worker) return;
  await call<void>("shutdown");
  stoppingWorker = true;
  await worker.terminate();
  worker = null;
  startup = null;
  workerFailure = null;
  stoppingWorker = false;
  queue = Promise.resolve();
  pending.clear();
}
