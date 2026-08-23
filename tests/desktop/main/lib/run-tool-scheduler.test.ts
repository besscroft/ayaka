import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jsonSchema, type ToolSet } from "ai";
import {
  createToolTurnControl,
  RunToolScheduler,
  scheduleToolSet,
} from "@desktop-main/lib/run-tool-scheduler";

void describe("RunToolScheduler", () => {
  void it("allows read-only tools to acquire concurrently", async () => {
    const scheduler = new RunToolScheduler();
    const signal = new AbortController().signal;
    const first = await scheduler.acquire("memory_search", signal);
    const second = await scheduler.acquire("runtime_snapshot", signal);
    const third = await scheduler.acquire("soul_read", signal);
    const fourth = await scheduler.acquire("memory_list", signal);
    first();
    second();
    third();
    fourth();
  });

  void it("serializes side effects in acquisition order", async () => {
    const scheduler = new RunToolScheduler();
    const signal = new AbortController().signal;
    const first = await scheduler.acquire("memory_save", signal);
    let secondStarted = false;
    const secondPromise = scheduler.acquire("workspace_run_command", signal).then((release) => {
      secondStarted = true;
      return release;
    });
    await Promise.resolve();
    assert.equal(secondStarted, false);
    first();
    const second = await secondPromise;
    assert.equal(secondStarted, true);
    second();
  });

  void it("does not start a queued side effect after abort", async () => {
    const scheduler = new RunToolScheduler();
    const controller = new AbortController();
    const first = await scheduler.acquire("memory_save", controller.signal);
    const queued = scheduler.acquire("sandbox_write_file", controller.signal);
    controller.abort("cancelled");
    first();
    await assert.rejects(queued, { name: "AbortError" });
  });
});

void describe("run tool turn control", () => {
  void it("exposes concludeTurn to tool execution options", async () => {
    const control = createToolTurnControl();
    const tools = {
      terminal: {
        description: "A test terminal tool.",
        inputSchema: jsonSchema<Record<string, never>>({
          type: "object",
          properties: {},
          additionalProperties: false,
        }),
        execute: async (_input: unknown, options: { concludeTurn?: () => void }) => {
          options.concludeTurn?.();
          return { ok: true };
        },
      },
    } as ToolSet;
    const scheduled = scheduleToolSet(
      tools,
      new RunToolScheduler(),
      new AbortController().signal,
      undefined,
      control,
    );
    const execute = scheduled.terminal?.execute as unknown as (
      input: unknown,
      options: Record<string, unknown>,
    ) => AsyncIterable<unknown>;

    const outputs: unknown[] = [];
    for await (const output of execute({}, {})) outputs.push(output);

    assert.deepEqual(outputs, [{ ok: true }]);
    assert.equal(control.concluded, true);
  });

  void it("can reset the conclusion for the next model step", () => {
    const control = createToolTurnControl();
    control.concludeTurn();
    assert.equal(control.concluded, true);
    control.reset();
    assert.equal(control.concluded, false);
  });
});
