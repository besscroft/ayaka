import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it, mock } from "node:test";
import type { MemoryRecord } from "@shared/types";

const testRoot = mkdtempSync(join(tmpdir(), "ayaka-memory-files-"));
process.env.AYAKA_USER_DATA_DIR = testRoot;

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = { app: { getPath: () => testRoot } };
require.cache[electronPath] = electronModule;

const dbGetSetting = mock.fn<() => string | null>(() => null);
const dbInsertRuntimeEvent = mock.fn();
const dbListMemories = mock.fn<() => MemoryRecord[]>(() => []);
const dbQueueMemoryJob = mock.fn();
const generateTextMock = mock.fn(async () => ({ text: "" }));
const resolveModelMock = mock.fn(() => ({
  model: {},
  maxOutputTokens: 4_000,
  providerOptions: undefined,
}));

mock.module(new URL("../../../../apps/desktop/src/main/lib/db.ts", import.meta.url).href, {
  namedExports: {
    getSetting: dbGetSetting,
    insertRuntimeEvent: dbInsertRuntimeEvent,
    listMemories: dbListMemories,
    queueMemoryJob: dbQueueMemoryJob,
  },
});

mock.module(new URL("../../../../apps/desktop/src/main/lib/providers.ts", import.meta.url).href, {
  namedExports: { resolveModel: resolveModelMock },
});
mock.module("ai", { namedExports: { generateText: generateTextMock } });

let memoryFiles: typeof import("@desktop-main/lib/agent-memory-files");
let crypto: typeof import("@desktop-main/lib/crypto");

before(async () => {
  memoryFiles = await import("@desktop-main/lib/agent-memory-files");
  crypto = await import("@desktop-main/lib/crypto");
});

afterEach(() => {
  rmSync(join(testRoot, "data", "agent-memories"), { recursive: true, force: true });
  dbGetSetting.mock.mockImplementation(() => null);
  dbInsertRuntimeEvent.mock.resetCalls();
  dbListMemories.mock.mockImplementation(() => []);
  dbQueueMemoryJob.mock.resetCalls();
  generateTextMock.mock.mockImplementation(async () => ({ text: "" }));
  resolveModelMock.mock.resetCalls();
});

after(() => {
  delete process.env.AYAKA_USER_DATA_DIR;
  rmSync(testRoot, { recursive: true, force: true });
});

void describe("agent memory files", () => {
  void it("preserves a user baseline through automatic append and consolidation", async () => {
    memoryFiles.writeMemoryFile("user", "# USER\n\n- Prefers concise answers.", { source: "user" });
    await memoryFiles.incorporateNewMemories([
      memoryRecord({
        id: "preference-1",
        kind: "preference",
        title: "Uses TypeScript",
        content: "The user primarily works in TypeScript.",
      }),
    ]);

    assert.match(memoryFiles.readMemoryFile("user"), /Prefers concise answers/);
    assert.match(memoryFiles.readMemoryFile("user"), /primarily works in TypeScript/);

    enableConsolidationModel();
    generateTextMock.mock.mockImplementation(async () => ({
      text: [
        "===SOUL===",
        "# SOUL",
        "Ayaka remains a capable assistant.",
        "===USER===",
        "# USER",
        "- Prefers concise answers.",
        "- Uses TypeScript: The user primarily works in TypeScript.",
        "===MEMORY===",
        "# MEMORY",
        "No long-term working memories yet.",
      ].join("\n"),
    }));

    await memoryFiles.consolidateMemoryFiles();

    const consolidated = memoryFiles.readMemoryFile("user");
    assert.match(consolidated, /Prefers concise answers/);
    assert.match(consolidated, /primarily works in TypeScript/);
    const envelope = readEnvelope("USER.md.enc");
    assert.equal(envelope.version, 2);
    assert.equal(crypto.decrypt(envelope.manualBaseline), "# USER\n\n- Prefers concise answers.");
    assert.equal("userLocked" in envelope, false);
  });

  void it("migrates a legacy locked envelope into a user-authored baseline", () => {
    const directory = memoryDirectory();
    mkdirSync(directory, { recursive: true });
    const original = "# USER\n\n- Keep this manual preference.";
    writeFileSync(
      join(directory, "USER.md.enc"),
      JSON.stringify({ payload: crypto.encrypt(original), updatedAt: 123, userLocked: true }),
      "utf8",
    );

    assert.equal(memoryFiles.reloadMemoryFile("user").content, original);
    memoryFiles.writeMemoryFile("user", `${original}\n- Automatic addition.`, { source: "system" });

    const migrated = readEnvelope("USER.md.enc");
    assert.equal(migrated.version, 2);
    assert.equal(crypto.decrypt(migrated.manualBaseline), original);
    assert.equal(migrated.manualEditedAt, 123);
  });

  void it("recovers a corrupt primary file from its encrypted backup", () => {
    memoryFiles.writeMemoryFile("user", "# USER\n\nFirst valid version.");
    memoryFiles.writeMemoryFile("user", "# USER\n\nSecond valid version.");
    writeFileSync(join(memoryDirectory(), "USER.md.enc"), "{broken", "utf8");

    assert.equal(memoryFiles.reloadMemoryFile("user").content, "# USER\n\nFirst valid version.");
    assert.ok(
      dbInsertRuntimeEvent.mock.calls.some(
        (call) =>
          (call.arguments[0] as { detail?: { action?: string } }).detail?.action ===
          "recovered-backup",
      ),
    );
  });

  void it("falls back to safe defaults when both primary and backup are invalid", () => {
    const directory = memoryDirectory();
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "MEMORY.md.enc"), "invalid", "utf8");
    writeFileSync(join(directory, "MEMORY.md.enc.bak"), "invalid", "utf8");

    assert.equal(
      memoryFiles.reloadMemoryFile("memory").content,
      "# MEMORY\n\nNo long-term working memories yet.",
    );
  });

  void it("rejects incomplete or baseline-losing consolidation output", async () => {
    memoryFiles.writeMemoryFile("user", "# USER\n\n- Never remove this line.", { source: "user" });
    const before = memoryFiles.readMemoryFile("user");
    enableConsolidationModel();
    generateTextMock.mock.mockImplementation(async () => ({
      text: "===SOUL===\n# SOUL\nChanged\n===USER===\n# USER\nBaseline removed",
    }));

    await memoryFiles.consolidateMemoryFiles();

    assert.equal(memoryFiles.readMemoryFile("user"), before);
    assert.ok(
      dbInsertRuntimeEvent.mock.calls.some(
        (call) =>
          (call.arguments[0] as { detail?: { action?: string } }).detail?.action ===
          "consolidation-rejected",
      ),
    );
  });

  void it("parses only complete bounded consolidation output", () => {
    assert.equal(memoryFiles.parseConsolidationOutput("===SOUL===\n# SOUL\nOnly one"), null);
    assert.deepEqual(
      memoryFiles.parseConsolidationOutput(
        "===SOUL===\n# SOUL\nSoul\n===USER===\n# USER\nUser\n===MEMORY===\n# MEMORY\nMemory",
      ),
      { soul: "# SOUL\nSoul", user: "# USER\nUser", memory: "# MEMORY\nMemory" },
    );
  });

  void it("keeps SOUL files isolated per agent while sharing USER and MEMORY", () => {
    memoryFiles.writeMemoryFile("soul", "# SOUL\n\nAgent A", {
      source: "user",
      agentId: "agent-a",
    });
    memoryFiles.writeMemoryFile("soul", "# SOUL\n\nAgent B", {
      source: "user",
      agentId: "agent-b",
    });

    assert.equal(memoryFiles.readMemoryFile("soul", "agent-a"), "# SOUL\n\nAgent A");
    assert.equal(memoryFiles.readMemoryFile("soul", "agent-b"), "# SOUL\n\nAgent B");
  });
});

function enableConsolidationModel(): void {
  dbGetSetting.mock.mockImplementation(() => "test/model");
}

function memoryDirectory(): string {
  return join(testRoot, "data", "agent-memories", "global");
}

function readEnvelope(name: string): {
  version: number;
  manualBaseline: import("@desktop-main/lib/crypto").EncryptedPayload;
  manualEditedAt?: number;
  userLocked?: boolean;
} {
  return JSON.parse(readFileSync(join(memoryDirectory(), name), "utf8"));
}

function memoryRecord(
  patch: Pick<MemoryRecord, "id" | "kind" | "title" | "content">,
): MemoryRecord {
  return {
    id: patch.id,
    scope: "agent",
    kind: patch.kind,
    title: patch.title,
    content: patch.content,
    agent_id: "agent-root",
    conversation_id: null,
    source_run_id: null,
    salience: 80,
    pinned: 0,
    confidence: 80,
    origin: "auto",
    status: "active",
    evidence_json: "[]",
    last_used_at: null,
    expires_at: null,
    supersedes_id: null,
    created_at: 1,
    updated_at: 1,
  };
}
