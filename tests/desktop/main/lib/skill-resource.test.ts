import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SkillPackage, ToolSkill } from "@shared/types";
import { MAX_SKILL_RESOURCE_BYTES, readSkillResourceFile } from "@desktop-main/lib/skill-resource";

let root = "";
let outside = "";

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ayaka-skill-resource-"));
  outside = await mkdtemp(path.join(tmpdir(), "ayaka-skill-resource-outside-"));
  await mkdir(path.join(root, "references"));
  await writeFile(path.join(root, "references", "base-en.txt"), "Base instructions", "utf8");
  await writeFile(path.join(outside, "outside.txt"), "outside", "utf8");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

void describe("Skill resource reader", () => {
  void it("reads package documentation and supports legacy installPath records", async () => {
    const skill = createSkill({ config_json: JSON.stringify({ installPath: root }) });
    const legacy = readSkillResourceFile({
      skill,
      packageInfo: null,
      relativePath: "references/base-en.txt",
    });
    assert.deepEqual(legacy, {
      skillId: skill.id,
      name: skill.name,
      path: "references/base-en.txt",
      bytes: Buffer.byteLength("Base instructions"),
      content: "Base instructions",
    });

    const packaged = readSkillResourceFile({
      skill,
      packageInfo: createPackage(skill.id),
      relativePath: "references/base-en.txt",
    });
    assert.equal(packaged.content, "Base instructions");
  });

  void it("rejects paths outside the package and symlink escapes", async () => {
    const skill = createSkill({ config_json: JSON.stringify({ installPath: root }) });
    const packageInfo = createPackage(skill.id);
    assert.throws(
      () => readSkillResourceFile({ skill, packageInfo, relativePath: "../outside.txt" }),
      /inside the installed package|escapes the installed package/,
    );
    assert.throws(
      () => readSkillResourceFile({ skill, packageInfo, relativePath: "C:/outside.txt" }),
      /relative path|inside the installed package/,
    );

    await symlink(outside, path.join(root, "references", "escape"), "junction");
    assert.throws(
      () =>
        readSkillResourceFile({
          skill,
          packageInfo: null,
          relativePath: "references/escape/outside.txt",
        }),
      /escapes the installed package/,
    );
  });

  void it("rejects unsupported, oversized, binary, and invalid UTF-8 resources", async () => {
    const skill = createSkill({ config_json: JSON.stringify({ installPath: root }) });
    await writeFile(path.join(root, "references", "script.js"), "console.log('no')", "utf8");
    await writeFile(
      path.join(root, "references", "large.txt"),
      Buffer.alloc(MAX_SKILL_RESOURCE_BYTES + 1, "x"),
    );
    await writeFile(path.join(root, "references", "binary.txt"), Buffer.from([0x41, 0x00, 0x42]));
    await writeFile(path.join(root, "references", "invalid.txt"), Buffer.from([0xc3, 0x28]));

    assert.throws(
      () =>
        readSkillResourceFile({ skill, packageInfo: null, relativePath: "references/script.js" }),
      /documentation text file/,
    );
    assert.throws(
      () =>
        readSkillResourceFile({ skill, packageInfo: null, relativePath: "references/large.txt" }),
      /too large/,
    );
    assert.throws(
      () =>
        readSkillResourceFile({ skill, packageInfo: null, relativePath: "references/binary.txt" }),
      /UTF-8 text/,
    );
    assert.throws(
      () =>
        readSkillResourceFile({ skill, packageInfo: null, relativePath: "references/invalid.txt" }),
      /valid UTF-8/,
    );
  });

  void it("rejects a package whose content hash changed", async () => {
    const skill = createSkill();
    const packageInfo = createPackage(skill.id);
    await writeFile(path.join(root, "references", "base-en.txt"), "changed", "utf8");
    assert.throws(
      () => readSkillResourceFile({ skill, packageInfo, relativePath: "references/base-en.txt" }),
      /content changed/,
    );
  });

  void it("rejects disabled Skills before touching their package", () => {
    const skill = createSkill({
      enabled: 0,
      config_json: JSON.stringify({ installPath: root }),
    });
    assert.throws(
      () =>
        readSkillResourceFile({ skill, packageInfo: null, relativePath: "references/base-en.txt" }),
      /Skill is disabled/,
    );
  });

  void it("reports a missing installed package clearly", () => {
    const skill = createSkill();
    assert.throws(
      () =>
        readSkillResourceFile({ skill, packageInfo: null, relativePath: "references/base-en.txt" }),
      /no installed package resources/,
    );
  });
});

function createSkill(overrides: Partial<ToolSkill> = {}): ToolSkill {
  return {
    id: "skill-resource-test",
    name: "Resource Skill",
    description: "Skill resource test",
    instructions: "Read references when needed.",
    category: "test",
    enabled: 1,
    auto_use: 1,
    requires_approval: 0,
    trigger_keywords_json: "[]",
    tags_json: "[]",
    config_schema_json: "{}",
    config_json: "{}",
    last_run_at: null,
    created_at: 1,
    updated_at: 1,
    deleted_at: null,
    purge_after_at: null,
    ...overrides,
  };
}

function createPackage(skillId: string): SkillPackage {
  return {
    id: "package-resource-test",
    skillId,
    source: "upload",
    rootPath: root,
    contentHash: hashDirectory(root),
    executionMode: "instructions",
    status: "ready",
    manifest: {},
    safety: {},
    lastError: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function hashDirectory(directory: string): string {
  const hash = createHash("sha256");
  hash.update("references/base-en.txt");
  hash.update(requireFile(path.join(directory, "references", "base-en.txt")));
  return hash.digest("hex");
}

function requireFile(file: string): Buffer {
  return readFileSync(file);
}
