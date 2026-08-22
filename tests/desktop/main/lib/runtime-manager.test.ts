import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { zipSync } from "fflate";
import {
  extractRuntimeArchive,
  normalizeManifestAsset,
  normalizeRuntimeManifestUrl,
  detectRuntimeTarget,
  runtimeKindForCommand,
  resolveRuntimeArchitecture,
  resolveRuntimePlatform,
  resolveManagedRuntimeCommand,
  buildRuntimeProcessEnv,
  verifyRuntimeBinaries,
  validateRuntimeManifestAsset,
} from "@desktop-main/lib/runtime-manager";
import type { ManagedRuntime } from "@shared/types";

test("maps only explicit Runtime command basenames", () => {
  assert.equal(runtimeKindForCommand("node"), "node");
  assert.equal(runtimeKindForCommand("C:/managed/node.exe"), "node");
  assert.equal(runtimeKindForCommand("uvx"), "uv");
  assert.equal(runtimeKindForCommand("node --version"), null);
  assert.equal(runtimeKindForCommand("python"), null);
});

test("sanitizes Electron and Node-only environment variables for Runtime children", () => {
  const environment = buildRuntimeProcessEnv({
    PATH: "C:/runtime",
    ELECTRON_RUN_AS_NODE: "1",
    ELECTRON_RENDERER_URL: "http://localhost:5173",
    NODE_OPTIONS: "--require missing-module",
    NODE_PATH: "C:/electron/node_modules",
    electron_custom_flag: "removed",
    node_options: "removed",
    AYAKA_RUNTIME_TEST: "kept",
  });

  assert.deepEqual(environment, {
    PATH: "C:/runtime",
    AYAKA_RUNTIME_TEST: "kept",
  });
});

test("maps Windows Managed npm and npx through node CLI scripts", () => {
  if (process.platform !== "win32") return;
  const root = mkdtempSync(join(tmpdir(), "ayaka-runtime-"));
  const nodeRoot = join(root, "node-v24.19.0-win-x64");
  const npmBin = join(nodeRoot, "node_modules", "npm", "bin");
  const nodePath = join(nodeRoot, "node.exe");
  mkdirSync(npmBin, { recursive: true });
  writeFileSync(nodePath, "placeholder");
  writeFileSync(join(npmBin, "npm-cli.js"), "placeholder");
  writeFileSync(join(npmBin, "npx-cli.js"), "placeholder");
  const runtime = {
    kind: "node",
    rootPath: root,
    executablePath: nodePath,
  } as ManagedRuntime;

  try {
    assert.deepEqual(resolveManagedRuntimeCommand(runtime, "npx"), {
      executablePath: nodePath,
      argsPrefix: [join(npmBin, "npx-cli.js")],
    });
    assert.deepEqual(resolveManagedRuntimeCommand(runtime, "npm"), {
      executablePath: nodePath,
      argsPrefix: [join(npmBin, "npm-cli.js")],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("includes the native verification cause in Runtime errors", async () => {
  const target = mkdtempSync(join(tmpdir(), "ayaka-runtime-"));
  const executable = "not-a-runtime.bin";
  try {
    writeFileSync(join(target, executable), "not an executable");

    await assert.rejects(
      () =>
        verifyRuntimeBinaries(target, {
          runtime: "node",
          version: "22.0.0",
          platform: resolveRuntimePlatform(),
          architecture: resolveRuntimeArchitecture(),
          archiveUrl: "https://example.com/node.zip",
          archiveType: "zip",
          sha256: "a".repeat(64),
          executableRelativePath: executable,
          providedCommands: ["node"],
          executables: [{ command: "node", relativePath: executable }],
        }),
      (error: unknown) => {
        assert.match(
          String(error),
          /Runtime executable verification failed for node at .+\((?:code|exit)=/,
        );
        return true;
      },
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("verifies an external Runtime executable and reports it as available", async () => {
  const executable = basename(process.execPath);
  const verified = await verifyRuntimeBinaries(dirname(process.execPath), {
    runtime: "node",
    version: "22.0.0",
    platform: resolveRuntimePlatform(),
    architecture: resolveRuntimeArchitecture(),
    archiveUrl: "https://example.com/node.zip",
    archiveType: "zip",
    sha256: "a".repeat(64),
    executableRelativePath: executable,
    providedCommands: ["node"],
    executables: [{ command: "node", relativePath: executable }],
  });

  assert.deepEqual(verified, ["node"]);
});

test("rejects unsafe Runtime manifest versions and executable paths", () => {
  const base = {
    runtime: "node" as const,
    version: "22.1.0",
    platform: process.platform as "win32" | "darwin" | "linux",
    architecture: process.arch as "x64" | "arm64",
    archiveUrl: "https://example.com/node.zip",
    archiveType: "zip" as const,
    sha256: "a".repeat(64),
    executableRelativePath: "node.exe",
    providedCommands: ["node"],
  };

  assert.equal(validateRuntimeManifestAsset(base, "node").version, "22.1.0");
  assert.throws(
    () => validateRuntimeManifestAsset({ ...base, version: "../escape" }, "node"),
    /version is invalid/,
  );
  assert.throws(
    () => validateRuntimeManifestAsset({ ...base, executableRelativePath: "../escape" }, "node"),
    /executable path is unsafe/,
  );
  assert.throws(
    () => validateRuntimeManifestAsset({ ...base, sha256: "not-a-hash" }, "node"),
    /SHA-256/,
  );
});

test("parses the official uv release asset list instead of treating it as a custom manifest", () => {
  const platform = resolveRuntimePlatform();
  const architecture = resolveRuntimeArchitecture();
  const target =
    platform === "win32"
      ? `${architecture === "x64" ? "x86_64" : "aarch64"}-pc-windows-msvc`
      : platform === "darwin"
        ? `${architecture === "x64" ? "x86_64" : "aarch64"}-apple-darwin`
        : `${architecture === "x64" ? "x86_64" : "aarch64"}-unknown-linux-gnu`;
  const archiveType = platform === "win32" ? "zip" : "tar.gz";
  const name = `uv-${target}.${archiveType}`;
  const asset = normalizeManifestAsset("uv", {
    tag_name: "0.12.5",
    assets: [
      {
        name: `${name}.sha256`,
        browser_download_url: `https://example.com/${name}.sha256`,
        digest: `sha256:${"b".repeat(64)}`,
      },
      {
        name,
        browser_download_url: `https://example.com/${name}`,
        digest: `sha256:${"a".repeat(64)}`,
      },
    ],
  });

  assert.equal(asset.runtime, "uv");
  assert.equal(asset.version, "0.12.5");
  assert.equal(asset.platform, platform);
  assert.equal(asset.architecture, architecture);
  assert.equal(asset.archiveUrl, `https://example.com/${name}`);
  assert.equal(asset.archiveLayout, platform === "win32" ? "flat" : "top-level-directory");
  assert.deepEqual(
    asset.executables?.map((item) => item.command),
    ["uv", "uvx"],
  );
  assert.equal(
    asset.executables?.[0]?.relativePath,
    platform === "win32" ? "uv.exe" : `${name.replace(/\.tar\.gz$/, "")}/uv`,
  );
});

test("reports a concrete runtime target without shell probing", () => {
  const target = detectRuntimeTarget();
  assert.equal(target.platform, process.platform);
  assert.equal(target.architecture, process.arch);
  if (process.platform === "linux")
    assert.ok(target.libc === "gnu" || target.libc === "musl" || target.libc === null);
  else assert.equal(target.libc, null);
});

test("normalizes the versioned custom manifest shape and keeps both uv paths explicit", () => {
  const target = detectRuntimeTarget();
  const asset = normalizeManifestAsset("uv", {
    schema: "ayaka-runtime-manifest-v2",
    runtime: "uv",
    channel: "stable",
    generatedAt: "2026-08-21T00:00:00.000Z",
    releases: [
      {
        version: "0.12.5",
        assets: [
          {
            platform: target.platform,
            architecture: target.architecture,
            libc: target.libc,
            archiveUrl: "https://mirror.example/uv.tar.gz",
            archiveType: "tar.gz",
            archiveLayout: "top-level-directory",
            sha256: "c".repeat(64),
            executables: [
              { command: "uv", relativePath: "uv-0.12.5/uv" },
              { command: "uvx", relativePath: "uv-0.12.5/uvx" },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(asset.version, "0.12.5");
  assert.deepEqual(
    asset.executables?.map((item) => item.relativePath),
    ["uv-0.12.5/uv", "uv-0.12.5/uvx"],
  );
});

test("accepts official uv release pages as manifest URLs", () => {
  assert.equal(
    normalizeRuntimeManifestUrl("uv", "https://github.com/astral-sh/uv/releases"),
    "https://api.github.com/repos/astral-sh/uv/releases/latest",
  );
  assert.equal(
    normalizeRuntimeManifestUrl("uv", "https://github.com/astral-sh/uv/releases/tag/0.12.5"),
    "https://api.github.com/repos/astral-sh/uv/releases/tags/0.12.5",
  );
  assert.equal(
    normalizeRuntimeManifestUrl("uv", "https://mirror.example/uv/releases"),
    "https://mirror.example/uv/releases",
  );
});

test("extracts ZIP directory entries before writing their children", () => {
  const target = mkdtempSync(join(tmpdir(), "ayaka-runtime-"));
  try {
    const root = "node-v24.19.0-win-x64";
    const archive = zipSync({
      [`${root}/`]: new Uint8Array(),
      [`${root}/node.exe`]: new Uint8Array([1, 2, 3]),
      [`${root}/node_modules/`]: new Uint8Array(),
      [`${root}/node_modules/npm.js`]: new Uint8Array([4, 5, 6]),
    });

    extractRuntimeArchive(archive, "zip", target);

    assert.deepEqual(readFileSync(join(target, root, "node.exe")), Buffer.from([1, 2, 3]));
    assert.deepEqual(
      readFileSync(join(target, root, "node_modules", "npm.js")),
      Buffer.from([4, 5, 6]),
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test("rejects archive traversal entries", () => {
  const target = mkdtempSync(join(tmpdir(), "ayaka-runtime-"));
  try {
    assert.throws(
      () => extractRuntimeArchive(zipSync({ "../escape": new Uint8Array([1]) }), "zip", target),
      /unsafe path/,
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
