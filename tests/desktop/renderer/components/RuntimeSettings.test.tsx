import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updateRuntimeSource } from "@renderer/components/RuntimeSettings";

void describe("runtime settings", () => {
  void it("updates a manifest source without retaining the DOM event", () => {
    const current = { node: "node-source", uv: "uv-source" } as const;
    assert.deepEqual(updateRuntimeSource(current, "uv", "https://mirror.example/uv"), {
      node: "node-source",
      uv: "https://mirror.example/uv",
    });
  });
});
