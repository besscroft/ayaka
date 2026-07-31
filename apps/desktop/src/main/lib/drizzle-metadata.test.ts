import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

void describe("drizzle metadata", () => {
  void it("keeps migration metadata as parseable BOM-free JSON", () => {
    const metadataDir = path.join(process.cwd(), "drizzle", "meta");
    const files = readdirSync(metadataDir).filter((file) => file.endsWith(".json"));

    assert.ok(files.length > 0, "expected drizzle metadata JSON files");
    for (const file of files) {
      const bytes = readFileSync(path.join(metadataDir, file));
      const content = bytes.toString("utf8");

      assert.notEqual(bytes[0], 0xef, `${file} starts with a UTF-8 BOM`);
      assert.notEqual(content.charCodeAt(0), 0xfeff, `${file} starts with a UTF-8 BOM`);
      assert.doesNotThrow(() => JSON.parse(content), `${file} must be valid JSON`);
    }
  });

  void it("tracks only the consolidated initial migration", () => {
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string }> };

    assert.equal(journal.entries.length, 1);
    assert.equal(journal.entries[0]?.idx, 0);
    assert.equal(journal.entries[0]?.tag, "0000_initial");
  });
});
