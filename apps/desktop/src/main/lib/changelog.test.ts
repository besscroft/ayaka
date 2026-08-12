import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveChangelogPath } from "./changelog";

void describe("changelog path", () => {
  void it("reads the repository changelog from the development app path", () => {
    assert.equal(
      resolveChangelogPath({
        isDev: true,
        appPath: "C:/github/void-ai/apps/desktop",
        resourcesPath: "C:/unused/resources",
      }),
      "C:\\github\\void-ai\\CHANGELOG.md",
    );
  });

  void it("reads the packaged changelog from Electron resources", () => {
    assert.equal(
      resolveChangelogPath({
        isDev: false,
        appPath: "C:/app/resources/app.asar",
        resourcesPath: "C:/app/resources",
      }),
      "C:\\app\\resources\\CHANGELOG.md",
    );
  });
});
