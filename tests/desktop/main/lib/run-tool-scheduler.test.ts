import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RunToolScheduler } from "@desktop-main/lib/run-tool-scheduler";

void describe("RunToolScheduler", () => {
  void it("allows read-only tools to acquire concurrently", async () => {
    const scheduler = new RunToolScheduler();
    const signal = new AbortController().signal;
    const first = await scheduler.acquire("memory_search", signal);
    const second = await scheduler.acquire("runtime_snapshot", signal);
    first();
    second();
  });

  void it("serializes side effects in acquisition order", async () => {
    const scheduler = new RunToolScheduler();
    const signal = new AbortController().signal;
    const first = await scheduler.acquire("memory_save", signal);
    let secondStarted = false;
    const secondPromise = scheduler.acquire("sandbox_run_command", signal).then((release) => {
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
