import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getToolPartName,
  getToolSummary,
  isSilentToolPart,
  isGeneratedToolName,
  normalizeMemoryResults,
  normalizeSandboxArtifacts,
  normalizeSandboxCommand,
  normalizeWorkspaceCommand,
  normalizeWorkspaceCommandInput,
  estimateWorkspaceCommandRisk,
  normalizeStringList,
  normalizeToolState,
  normalizeWebOpenResult,
  normalizeWebSearchResult,
  safeJsonStringify,
  sanitizeToolUrl,
  truncateText,
} from "@renderer/lib/generated-tool-ui";

void describe("generated tool UI parsing", () => {
  void it("resolves static, dynamic, and unknown tool parts safely", () => {
    assert.equal(getToolPartName({ type: "tool-web_search" }), "web_search");
    assert.equal(
      getToolPartName({ type: "dynamic-tool", toolName: "memory_search" }),
      "memory_search",
    );
    assert.equal(getToolPartName({ type: "dynamic-tool" }), null);
    assert.equal(getToolPartName({ type: "text" }), null);
    assert.equal(isSilentToolPart({ type: "tool-complete_task" }), true);
    assert.equal(isSilentToolPart({ type: "dynamic-tool", toolName: "complete_task" }), true);
    assert.equal(isSilentToolPart({ type: "tool-web_search" }), false);
    assert.equal(isGeneratedToolName("web_open"), true);
    assert.equal(isGeneratedToolName("mcp_custom_tool"), false);
  });

  void it("normalizes valid and invalid tool states", () => {
    for (const state of [
      "input-streaming",
      "input-available",
      "approval-requested",
      "approval-responded",
      "output-available",
      "output-error",
      "output-denied",
    ]) {
      assert.equal(normalizeToolState(state), state);
    }
    assert.equal(normalizeToolState("unexpected"), "input-available");
    assert.equal(normalizeToolState(undefined), "input-available");
  });

  void it("extracts compact summaries for generated and provider tools", () => {
    assert.deepEqual(
      getToolSummary({
        type: "tool-web_search",
        input: { query: "vite plus" },
        output: { count: 3 },
      }),
      { key: "tool.generated.sources", params: { count: 3 } },
    );
    assert.deepEqual(
      getToolSummary({ type: "tool-memory_search", output: { results: [{ id: "1" }] } }),
      { key: "tool.generated.memories", params: { count: 1 } },
    );
    assert.deepEqual(
      getToolSummary({
        type: "tool-cron",
        input: { action: "list" },
        output: { status: "ok" },
      }),
      { key: "tool.generated.automation", params: { action: "list", status: "ok" } },
    );
    assert.deepEqual(
      getToolSummary({ type: "tool-sandbox_list_files", output: { files: ["a", "b"] } }),
      { key: "tool.generated.files", params: { count: 2 } },
    );
    assert.deepEqual(getToolSummary({ type: "tool-runtime_snapshot", output: {} }), {
      key: "tool.generated.runtime",
    });
    assert.deepEqual(
      getToolSummary({ type: "tool-file_search", output: { results: [{ title: "doc" }] } }),
      { key: "tool.generated.items", params: { count: 1 } },
    );
    assert.equal(getToolSummary({ type: "tool-unknown", output: { ok: true } }), null);
  });

  void it("keeps only safe web search links and tolerates malformed results", () => {
    assert.deepEqual(
      normalizeWebSearchResult({
        query: "test",
        results: [
          { title: "Safe", url: "https://example.com", snippet: "ok" },
          { title: "Unsafe", url: "javascript:alert(1)" },
          { title: "Missing URL" },
          null,
        ],
      }),
      {
        query: "test",
        results: [{ title: "Safe", url: "https://example.com", snippet: "ok" }],
      },
    );
    assert.deepEqual(normalizeWebSearchResult(null), { query: undefined, results: [] });
  });

  void it("normalizes web pages only when the safe URL and required text exist", () => {
    assert.deepEqual(
      normalizeWebOpenResult({
        requestedUrl: "https://example.com/requested",
        finalUrl: "https://example.com/final",
        title: "Example",
        text: "Body",
        truncated: true,
      }),
      {
        requestedUrl: "https://example.com/requested",
        finalUrl: "https://example.com/final",
        title: "Example",
        text: "Body",
        truncated: true,
      },
    );
    assert.equal(
      normalizeWebOpenResult({ title: "Unsafe", text: "Body", finalUrl: "data:text/html,x" }),
      null,
    );
    assert.equal(normalizeWebOpenResult({ finalUrl: "https://example.com" }), null);
  });

  void it("normalizes memory and sandbox records without trusting malformed fields", () => {
    assert.deepEqual(
      normalizeMemoryResults({
        query: "preferences",
        results: [
          { id: "m1", title: "Preference", content: "Dark mode", pinned: true },
          { id: "m2", title: "Broken" },
        ],
      }),
      {
        query: "preferences",
        results: [{ id: "m1", title: "Preference", content: "Dark mode", pinned: true }],
      },
    );
    assert.deepEqual(
      normalizeSandboxArtifacts({
        artifacts: [
          { id: "a1", path: "report.txt", url: "https://example.com/report.txt", size_bytes: 12 },
          { path: "unsafe", url: "javascript:alert(1)" },
          { url: "https://example.com/missing-path" },
        ],
      }),
      [
        { id: "a1", path: "report.txt", url: "https://example.com/report.txt", sizeBytes: 12 },
        { path: "unsafe" },
      ],
    );
    assert.deepEqual(normalizeStringList({ files: ["a.txt", { path: "b.txt" }, 3] }), [
      "a.txt",
      "b.txt",
    ]);
  });

  void it("truncates command logs and preserves provider fallback inputs", () => {
    const result = normalizeSandboxCommand({
      command: "npm",
      args: ["test"],
      stdout: "x".repeat(12_100),
      stderr: "",
      exitCode: 0,
    });
    assert.equal(result?.stdout.length, 12_000);
    assert.equal(result?.stdout.endsWith("..."), true);
    assert.equal(normalizeSandboxCommand({ stdout: "missing command" }), null);
    assert.equal(truncateText("abcdef", 5), "ab...");
    assert.match(safeJsonStringify({ provider: "fallback" }), /fallback/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.equal(safeJsonStringify(cyclic), "[unserializable]");
  });

  void it("normalizes workspace command results and redacts approval inputs", () => {
    const input = normalizeWorkspaceCommandInput({
      executable: "curl",
      args: ["--token", "secret-value", "$(echo nope)"],
      cwd: "src",
      env: { API_KEY: "hidden", NO_COLOR: "1" },
    });
    assert.deepEqual(input, {
      executable: "curl",
      args: ["--token", "[redacted]", "$(echo nope)"],
      cwd: "src",
      env: { API_KEY: "[redacted]", NO_COLOR: "[redacted]" },
    });
    assert.equal(estimateWorkspaceCommandRisk(input!), "network");
    assert.deepEqual(
      normalizeWorkspaceCommand({
        executable: "rg",
        args: ["--files"],
        cwd: ".",
        outcome: "completed",
        risk: "read_only",
        exitCode: 0,
        timedOut: false,
        aborted: false,
        stdout: "src/a.ts",
        stderr: "",
        stdoutBytes: 8,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 12,
      }),
      {
        executable: "rg",
        args: ["--files"],
        cwd: ".",
        outcome: "completed",
        risk: "read_only",
        exitCode: 0,
        signal: undefined,
        timedOut: false,
        aborted: false,
        stdout: "src/a.ts",
        stderr: "",
        stdoutBytes: 8,
        stderrBytes: 0,
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 12,
      },
    );
    assert.equal(normalizeWorkspaceCommand({ executable: "rg", outcome: "completed" }), null);
  });

  void it("accepts only safe external links", () => {
    assert.equal(sanitizeToolUrl("https://example.com/path"), "https://example.com/path");
    assert.equal(sanitizeToolUrl("mailto:test@example.com"), "mailto:test@example.com");
    assert.equal(sanitizeToolUrl("javascript:alert(1)"), null);
    assert.equal(sanitizeToolUrl("data:text/html;base64,PGgxPg=="), null);
    assert.equal(sanitizeToolUrl(""), null);
  });
});
