import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isTransientCronError,
  nextRunForSchedule,
  normalizeCronSchedule,
} from "@desktop-main/lib/cron-schedule";

void describe("cron schedules", () => {
  void it("supports five and six field expressions", () => {
    assert.equal(
      normalizeCronSchedule({ kind: "cron", expression: "0 9 * * 1-5", timezone: "UTC" }).kind,
      "cron",
    );
    assert.equal(
      normalizeCronSchedule({ kind: "cron", expression: "30 0 9 * * 1-5", timezone: "UTC" }).kind,
      "cron",
    );
  });

  void it("uses IANA timezone rules across daylight saving changes", () => {
    const next = nextRunForSchedule(
      {
        kind: "cron",
        expression: "0 9 * * *",
        timezone: "America/New_York",
      },
      Date.parse("2026-03-07T15:00:00.000Z"),
    );
    assert.equal(new Date(next!).toISOString(), "2026-03-08T13:00:00.000Z");
  });

  void it("skips missed interval ticks and returns the next future tick", () => {
    const next = nextRunForSchedule(
      {
        kind: "interval",
        everyMs: 60_000,
        anchorAt: "2026-01-01T00:00:00.000Z",
      },
      Date.parse("2026-01-01T00:05:30.000Z"),
    );
    assert.equal(new Date(next!).toISOString(), "2026-01-01T00:06:00.000Z");
  });

  void it("classifies retryable failures", () => {
    assert.equal(isTransientCronError(new Error("HTTP 429 rate limit")), true);
    assert.equal(isTransientCronError(new Error("invalid model configuration")), false);
  });
});
