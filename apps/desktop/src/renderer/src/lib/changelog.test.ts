import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectChangelogLanguage } from "./changelog";

const changelog = `# Changelog

## [0.1.16] - 2026-08-12

### 中文

#### 新增

- 新增对话工作区。

### English

#### Added

- Added conversation workspaces.

## [0.1.15] - 2026-08-04

### English

- Improved local path management.`;

void describe("localized changelog", () => {
  void it("selects Chinese sections and removes the language wrapper", () => {
    const result = selectChangelogLanguage(changelog, "zh-CN");

    assert.match(result, /## \[0\.1\.16\]/);
    assert.match(result, /#### 新增/);
    assert.match(result, /新增对话工作区/);
    assert.doesNotMatch(result, /### English/);
    assert.doesNotMatch(result, /Added\n\n- Added conversation workspaces/);
  });

  void it("falls back to the available language for a release", () => {
    const result = selectChangelogLanguage(changelog, "zh-CN");

    assert.match(result, /## \[0\.1\.15\]/);
    assert.match(result, /Improved local path management/);
  });

  void it("keeps legacy releases without language sections", () => {
    const result = selectChangelogLanguage("# Changelog\n\n## [0.1.0]\n\n- Legacy entry.", "en");

    assert.match(result, /- Legacy entry/);
  });
});
