import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  ensureDefaultWorkspaceAsset,
  resolveBundledDefaultAssetPath,
  resolveDefaultWorkspaceAssetPath,
  seedDefaultWorkspaceAsset,
} from "@desktop-main/lib/default-workspace-assets";

let root = "";

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ayaka-default-assets-test-"));
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

void describe("default workspace assets", () => {
  void it("resolves the development asset from the repository root", () => {
    assert.equal(
      resolveBundledDefaultAssetPath({
        isDev: true,
        appPath: path.join(root, "apps", "desktop"),
      }),
      path.join(root, "ayaka.png"),
    );
  });

  void it("resolves the packaged asset under the Electron resources directory", () => {
    assert.equal(
      resolveBundledDefaultAssetPath({
        isDev: false,
        resourcesPath: path.join(root, "resources"),
      }),
      path.join(root, "resources", "default", "ayaka.png"),
    );
  });

  void it("copies the default asset once and preserves user changes", async () => {
    const sourcePath = path.join(root, "source.png");
    const targetPath = resolveDefaultWorkspaceAssetPath(path.join(root, "user-data"));
    await writeFile(sourcePath, "bundled asset");

    assert.equal((await ensureDefaultWorkspaceAsset({ sourcePath, targetPath })).copied, true);
    assert.equal((await readFile(targetPath)).toString(), "bundled asset");

    await writeFile(targetPath, "user asset");
    assert.equal((await ensureDefaultWorkspaceAsset({ sourcePath, targetPath })).copied, false);
    assert.equal((await readFile(targetPath)).toString(), "user asset");
  });

  void it("seeds a new sandbox without overwriting an existing file", async () => {
    const sourcePath = path.join(root, "sandbox-source.png");
    const sandboxRoot = path.join(root, "sandbox");
    await writeFile(sourcePath, "sandbox asset");

    const first = await seedDefaultWorkspaceAsset(sandboxRoot, { sourcePath });
    assert.equal(first.copied, true);
    assert.equal((await readFile(first.targetPath)).toString(), "sandbox asset");

    await writeFile(first.targetPath, "sandbox user asset");
    const second = await seedDefaultWorkspaceAsset(sandboxRoot, { sourcePath });
    assert.equal(second.copied, false);
    assert.equal((await readFile(second.targetPath)).toString(), "sandbox user asset");
  });
});
