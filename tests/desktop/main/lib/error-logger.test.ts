import assert from "node:assert/strict";
import { beforeEach, afterEach, describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ErrorLogger,
  getErrorLogFilename,
  getErrorLogDateKey,
  normalizeErrorLogInput,
} from "@desktop-main/lib/error-logger";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ayaka-error-logger-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

void describe("error logger", () => {
  void it("writes redacted JSONL records and removes previous days", async () => {
    let now = new Date(2026, 0, 2, 12).getTime();
    const logger = new ErrorLogger({ userDataDir: root, now: () => now });
    const oldFile = join(root, "logs", getErrorLogFilename("2026-01-01"));
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(oldFile, "old\n", "utf8");

    await logger.initialize();
    logger.record({
      source: "main",
      level: "error",
      origin: "console",
      args: [
        "request failed token=super-secret",
        { apiKey: "secret-key", nested: { authorization: "Bearer hidden" } },
      ],
      error: new Error("provider failed"),
    });
    await logger.flush();

    const filePath = join(root, "logs", getErrorLogFilename(getErrorLogDateKey(now)));
    const records = (await readFile(filePath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const details = records[0]?.details as unknown[];
    const serialized = JSON.stringify(records[0]);

    assert.equal(records.length, 1);
    assert.equal(records[0]?.source, "main");
    assert.equal((records[0]?.error as { message: string }).message, "provider failed");
    assert.equal(serialized.includes("super-secret"), false);
    assert.equal(serialized.includes("secret-key"), false);
    assert.equal(serialized.includes("hidden"), false);
    assert.equal((details[1] as { apiKey: string }).apiKey, "[redacted]");
    assert.equal(
      (await readdir(join(root, "logs"))).includes(getErrorLogFilename("2026-01-01")),
      false,
    );
  });

  void it("rotates to a new local day on the next write", async () => {
    let now = new Date(2026, 0, 2, 23, 59).getTime();
    const logger = new ErrorLogger({ userDataDir: root, now: () => now });
    await logger.initialize();
    logger.record({
      source: "main",
      level: "warning",
      origin: "console",
      message: "before",
    });
    await logger.flush();

    now = new Date(2026, 0, 3, 0, 1).getTime();
    logger.record({
      source: "main",
      level: "error",
      origin: "window-error",
      message: "after",
    });
    await logger.flush();

    const files = await readdir(join(root, "logs"));
    assert.deepEqual(files, [getErrorLogFilename("2026-01-03")]);
    assert.match(await readFile(join(root, "logs", files[0]!), "utf8"), /after/);
  });

  void it("exports the current file, and distinguishes empty and cancelled exports", async () => {
    const now = new Date(2026, 0, 2, 12).getTime();
    const logger = new ErrorLogger({ userDataDir: root, now: () => now });
    await logger.initialize();

    assert.equal(
      await logger.exportCurrent(async () => ({
        canceled: false,
        filePath: join(root, "empty"),
      })),
      "empty",
    );

    logger.record({
      source: "renderer",
      level: "error",
      origin: "unhandledrejection",
      message: "boom",
    });
    await logger.flush();
    const exportPath = join(root, "export.jsonl");
    const saved = await logger.exportCurrent(async (options) => {
      assert.equal(options.defaultPath, getErrorLogFilename("2026-01-02"));
      return { canceled: false, filePath: exportPath };
    });
    assert.equal(saved, "saved");
    assert.match(await readFile(exportPath, "utf8"), /boom/);

    assert.equal(await logger.exportCurrent(async () => ({ canceled: true })), "cancelled");
  });

  void it("keeps logging failures isolated from the caller", async () => {
    const blockedPath = join(root, "blocked");
    await writeFile(blockedPath, "not a directory", "utf8");
    const logger = new ErrorLogger({ userDataDir: blockedPath });

    await assert.rejects(logger.initialize());
    logger.record({
      source: "main",
      level: "error",
      origin: "console",
      message: "ignored",
    });
    await assert.doesNotReject(logger.flush());
  });
});

void describe("error log normalization", () => {
  void it("preserves error metadata while redacting inline secrets", () => {
    const record = normalizeErrorLogInput({
      source: "renderer",
      level: "error",
      origin: "unhandledrejection",
      message: "authorization=hidden-token",
      error: { name: "TypeError", message: "bad token=hidden", stack: "stack" },
    });

    assert.equal(record.error?.name, "TypeError");
    assert.equal(record.error?.stack, "stack");
    assert.equal(record.message.includes("hidden-token"), false);
    assert.equal(record.error?.message.includes("hidden"), false);
  });
});
