import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatRuntimeEventDetail,
  formatRuntimeEventTime,
} from "@renderer/lib/runtime-diagnostics";

void describe("runtime diagnostics helpers", () => {
  void it("pretty-prints structured event details and preserves malformed data", () => {
    assert.equal(
      formatRuntimeEventDetail(JSON.stringify({ ok: true, nested: { count: 2 } })),
      '{\n  "ok": true,\n  "nested": {\n    "count": 2\n  }\n}',
    );
    assert.equal(formatRuntimeEventDetail("{bad"), "{bad");
  });

  void it("formats event times in Beijing time", () => {
    assert.equal(
      formatRuntimeEventTime(Date.UTC(2026, 0, 2, 16, 1, 2), "zh-CN"),
      "2026/01/03 00:01:02",
    );
  });
});
