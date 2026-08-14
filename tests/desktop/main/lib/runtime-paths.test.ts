import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { removeLegacyCompanionData } from "@desktop-main/lib/runtime-paths";

void describe("legacy companion data cleanup", () => {
  void it("removes the retired companion directory without touching sibling data", () => {
    const root = mkdtempSync(join(tmpdir(), "void-ai-runtime-paths-"));
    const pets = join(root, "data", "pets");
    mkdirSync(pets, { recursive: true });
    writeFileSync(join(pets, "legacy.txt"), "legacy");
    writeFileSync(join(root, "data", "keep.txt"), "keep");

    removeLegacyCompanionData(root);

    assert.equal(existsSync(pets), false);
    assert.equal(existsSync(join(root, "data", "keep.txt")), true);
  });

  void it("treats a missing retired companion directory as already clean", () => {
    const root = mkdtempSync(join(tmpdir(), "void-ai-runtime-paths-"));
    assert.doesNotThrow(() => removeLegacyCompanionData(root));
  });
});
