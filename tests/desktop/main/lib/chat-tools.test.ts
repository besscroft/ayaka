import { afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type { ChatToolModelContext } from "@desktop-main/lib/chat-tools";
import {
  CHAT_TOOL_IDS,
  type MemoryRecord,
  type ModelCapabilities,
  type ModelProviderKind,
  type ToolRecord,
  type ToolServer,
} from "@shared/types";

const require = createRequire(import.meta.url);
const electronPath = require.resolve("electron");
const electronModule = new Module(electronPath);
electronModule.filename = electronPath;
electronModule.paths = [];
electronModule.loaded = true;
electronModule.exports = {
  app: {
    isPackaged: false,
    getPath: () => process.cwd(),
  },
};
require.cache[electronPath] = electronModule;

const capabilities: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

let chatTools: typeof import("@desktop-main/lib/chat-tools");
let mcpManager: typeof import("@desktop-main/lib/mcp-manager");
const originalFetch = globalThis.fetch;

const dbSaveMemory = mock.fn();
const dbDeleteMemory = mock.fn();
const dbGetAgent = mock.fn((id: string) => ({ id }));
const dbGetMemoryById = mock.fn<() => MemoryRecord | null>();
const dbInsertRuntimeEvent = mock.fn();
const dbUpsertAgentRuntimeState = mock.fn();
const dbGetRuntimeSnapshot = mock.fn(() => ({
  agents: [],
  memories: [],
  runtimeEvents: [],
  syncState: { mode: "off", status: "disabled", encryption_enabled: 0 },
}));
const dbListMessages = mock.fn(() => []);
let mcpServer: ToolServer | null = null;
let mcpTool: ToolRecord | null = null;
const dbGetMcpServer = mock.fn(() => mcpServer);
const dbGetMcpToolByReference = mock.fn(() => mcpTool);
const dbListMcpServers = mock.fn(() => (mcpServer ? [mcpServer] : []));
const dbListMcpTools = mock.fn(() => (mcpTool ? [mcpTool] : []));

mock.module(new URL("../../../../apps/desktop/src/main/lib/db.ts", import.meta.url).href, {
  namedExports: {
    deleteMemory: dbDeleteMemory,
    getAgent: dbGetAgent,
    getMemoryById: dbGetMemoryById,
    getRuntimeSnapshot: dbGetRuntimeSnapshot,
    insertRuntimeEvent: dbInsertRuntimeEvent,
    getMcpServer: dbGetMcpServer,
    getMcpToolByReference: dbGetMcpToolByReference,
    listMcpServers: dbListMcpServers,
    listMcpTools: dbListMcpTools,
    listMessages: dbListMessages,
    saveMemory: dbSaveMemory,
    upsertAgentRuntimeState: dbUpsertAgentRuntimeState,
  },
});

mock.module(
  new URL("../../../../apps/desktop/src/main/lib/mem0-service.ts", import.meta.url).href,
  {
    namedExports: {
      deleteMemoryFromMem0: mock.fn(() => Promise.resolve()),
      resetMem0Index: mock.fn(() => Promise.resolve(true)),
      searchMem0: mock.fn(() => Promise.resolve([])),
      upsertMemoryInMem0: mock.fn(() => Promise.resolve("mem0-test")),
    },
  },
);

mock.module(
  new URL("../../../../apps/desktop/src/main/lib/agent-memory-files.ts", import.meta.url).href,
  {
    namedExports: {
      incorporateNewMemories: mock.fn(() => Promise.resolve()),
      dreamMemoryFiles: mock.fn(() => Promise.resolve()),
    },
  },
);

before(async () => {
  mcpManager = await import("@desktop-main/lib/mcp-manager");
  chatTools = await import("@desktop-main/lib/chat-tools");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  dbSaveMemory.mock.resetCalls();
  dbDeleteMemory.mock.resetCalls();
  dbGetAgent.mock.resetCalls();
  dbGetMemoryById.mock.resetCalls();
  dbInsertRuntimeEvent.mock.resetCalls();
  dbUpsertAgentRuntimeState.mock.resetCalls();
  dbGetRuntimeSnapshot.mock.resetCalls();
  dbListMessages.mock.resetCalls();
  dbGetMcpServer.mock.resetCalls();
  dbGetMcpToolByReference.mock.resetCalls();
  dbListMcpServers.mock.resetCalls();
  dbListMcpTools.mock.resetCalls();
  mcpServer = null;
  mcpTool = null;
});

void describe("chat tool runtime", () => {
  void it("maps off mode to no tools and toolChoice none", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "off", selectedToolIds: ["memory_search"] },
      model: modelContext("openai", "web_search"),
      conversationId: "c1",
    });

    assert.equal(runtime.tools, undefined);
    assert.equal(runtime.activeTools, undefined);
    assert.equal(runtime.toolChoice, "none");
  });

  void it("maps auto mode to safe default tools including web search and cron", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "auto", selectedToolIds: [] },
      model: modelContext("openai", "web_search"),
      conversationId: "c1",
    });

    assert.deepEqual(runtime.activeTools, [
      "web_search",
      "web_open",
      "current_time",
      "runtime_snapshot",
      "model_capabilities",
      "cron",
    ]);
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof runtime.stopWhen, "function");
    assert.match(runtime.instructions ?? "", /use the cron tool/);
  });

  void it("maps manual single and multiple selections to forced tool choices", () => {
    const single = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["memory_search"] },
      model: modelContext("openai", "web_search"),
    });
    assert.deepEqual(single.activeTools, ["memory_search"]);
    assert.deepEqual(single.toolChoice, { type: "tool", toolName: "memory_search" });

    const multiple = chatTools.buildChatToolRuntime({
      selection: {
        mode: "manual",
        selectedToolIds: ["memory_search", "runtime_snapshot"],
      },
      model: modelContext("openai", "web_search"),
    });
    assert.deepEqual(multiple.activeTools, ["memory_search", "runtime_snapshot"]);
    assert.equal(multiple.toolChoice, "required");
  });

  void it("describes workspace command as automatic, risk-gated Agent execution", () => {
    const descriptor = chatTools
      .createChatToolDescriptors(modelContext("openai", "web_search"))
      .find((item) => item.id === "workspace_run_command");
    assert.equal(descriptor?.category, "execution");
    assert.equal(descriptor?.defaultAuto, true);
    assert.equal(descriptor?.requiresApproval, true);
    assert.equal(descriptor?.available, true);

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["workspace_run_command"] },
      model: modelContext("openai", "web_search"),
    });
    assert.equal(runtime.toolChoice, "none");
    assert.equal(runtime.activeTools, undefined);
  });

  void it("uses MCP tool-level automation and approval settings in the AI SDK ToolSet", () => {
    mcpServer = {
      id: "srv-1",
      name: "Search MCP",
      enabled: 1,
      auto_use: 0,
      requires_approval: 1,
    } as ToolServer;
    mcpTool = {
      id: "tool-1",
      server_id: "srv-1",
      name: "search",
      enabled: 1,
      auto_use: 1,
      requires_approval: 0,
    } as ToolRecord;

    const toolName = mcpManager.mcpToolRuntimeName("srv-1", "search");
    const descriptor = mcpManager.createMcpToolDescriptors()[0];
    assert.equal(descriptor?.defaultAuto, true);
    assert.equal(descriptor?.requiresApproval, false);

    const runtime = mcpManager.createMcpToolSet({
      references: ["mcp:srv-1:search"],
      model: modelContext("openai-compatible"),
    });

    assert.deepEqual(runtime.activeTools, [toolName]);
    assert.deepEqual(runtime.approvalToolNames, []);

    mcpTool.requires_approval = 1;
    const approvalRuntime = mcpManager.createMcpToolSet({
      references: ["mcp:srv-1:search"],
      model: modelContext("openai-compatible"),
    });
    assert.deepEqual(approvalRuntime.approvalToolNames, [toolName]);
  });

  void it("uses provider-native web search internal tool names", () => {
    const openai = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai", "web_search"),
    });
    assert.deepEqual(openai.activeTools, ["web_search"]);
    assert.deepEqual(openai.toolChoice, { type: "tool", toolName: "web_search" });

    const anthropic = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("anthropic", "web_search"),
    });
    assert.deepEqual(anthropic.activeTools, ["web_search"]);
    assert.deepEqual(anthropic.toolChoice, { type: "tool", toolName: "web_search" });

    const google = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("google", "google_search"),
    });
    assert.deepEqual(google.activeTools, ["google_search"]);
    assert.deepEqual(google.toolChoice, { type: "tool", toolName: "google_search" });
    assert.deepEqual(google.builtinToolNames, ["google_search"]);
  });

  void it("reads a user-provided public page through the host tool", async () => {
    globalThis.fetch = (async () =>
      new Response(
        "<html><head><title>Public page</title></head><body><main><p>Page text.</p></main></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      )) as typeof fetch;

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_open"] },
      model: modelContext("openai"),
      conversationId: "c1",
    });
    const webOpen = runtime.tools?.web_open as {
      execute?: (input: { url: string }) => Promise<unknown>;
    };

    assert.deepEqual(runtime.activeTools, ["web_open"]);
    assert.deepEqual(runtime.toolChoice, { type: "tool", toolName: "web_open" });
    const output = (await webOpen.execute?.({ url: "https://93.184.216.34/page" })) as {
      finalUrl: string;
      title: string;
      text: string;
      sources: Array<{ url: string }>;
    };
    assert.equal(output.finalUrl, "https://93.184.216.34/page");
    assert.equal(output.title, "Public page");
    assert.equal(output.text, "Page text.");
    assert.deepEqual(output.sources, [
      { type: "url", url: "https://93.184.216.34/page", title: "Public page" },
    ]);
    assert.equal(dbInsertRuntimeEvent.mock.callCount(), 1);
  });

  void it("exposes configured provider-native hosted tools without host executors", () => {
    const model = modelContext("openai", "web_search");
    model.nativeTools.push(
      {
        id: "code_interpreter",
        toolName: "code_interpreter",
        tool: { type: "provider-defined" },
        providerExecuted: true,
      },
      {
        id: "file_search",
        toolName: "file_search",
        tool: { type: "provider-defined" },
        providerExecuted: true,
      },
    );

    const descriptors = chatTools.createChatToolDescriptors(model);
    assert.equal(descriptors.find((item) => item.id === "code_interpreter")?.available, true);
    assert.equal(descriptors.find((item) => item.id === "file_search")?.available, true);

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["code_interpreter", "file_search"] },
      model,
    });
    assert.deepEqual(runtime.activeTools, ["code_interpreter", "file_search"]);
    assert.equal(typeof runtime.tools?.code_interpreter, "object");
    assert.equal(typeof runtime.tools?.file_search, "object");
  });

  void it("marks OpenAI function tools as deferred when tool search is active", () => {
    const model = modelContext("openai", "web_search");
    model.nativeTools.push({
      id: "tool_search",
      toolName: "tool_search",
      tool: { type: "provider-defined" },
      providerExecuted: true,
    });

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["tool_search", "memory_search"] },
      model,
    });
    const memoryTool = runtime.tools?.memory_search as {
      providerOptions?: { openai?: { deferLoading?: boolean } };
    };
    assert.equal(memoryTool.providerOptions?.openai?.deferLoading, true);
  });

  void it("uses host fallback web search for compatible providers without native search", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    assert.deepEqual(runtime.activeTools, ["web_search"]);
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof runtime.tools?.web_search, "object");
    assert.match(runtime.instructions ?? "", /current, live, recent/);

    const web = chatTools
      .createChatToolDescriptors(modelContext("openai-compatible"))
      .find((descriptor) => descriptor.id === "web_search");
    assert.equal(web?.available, true);
    assert.equal(web?.execution, "host");
  });

  void it("executes the current time tool with host time metadata", async () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["current_time"] },
      model: modelContext("openai-compatible"),
    });
    const timeTool = runtime.tools?.current_time as {
      execute?: (input: Record<string, never>) => Promise<unknown>;
    };
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof timeTool.execute, "function");

    const before = Date.now();
    const output = (await timeTool.execute?.({})) as {
      timestampMs: number;
      utcIso: string;
      timeZone: string;
      locale: string;
      utcOffsetMinutes: number;
      localDateTime: string;
    };
    const after = Date.now();

    assert.equal(typeof output.timestampMs, "number");
    assert.ok(output.timestampMs >= before);
    assert.ok(output.timestampMs <= after);
    assert.equal(new Date(output.utcIso).getTime(), output.timestampMs);
    assert.equal(typeof output.timeZone, "string");
    assert.equal(typeof output.locale, "string");
    assert.equal(typeof output.utcOffsetMinutes, "number");
    assert.equal(typeof output.localDateTime, "string");
  });

  void it("executes host tools with agent audit context", async () => {
    const before = Date.now();
    const output = (await chatTools.executeChatHostTool({
      toolId: "current_time",
      input: {},
      model: modelContext("openai-compatible"),
      conversationId: "c1",
      agentId: "agent-analyst",
      audit: { runId: "run-1", agentId: "agent-analyst" },
    })) as { timestampMs: number; utcIso: string };
    const after = Date.now();

    assert.ok(output.timestampMs >= before);
    assert.ok(output.timestampMs <= after);
    assert.equal(new Date(output.utcIso).getTime(), output.timestampMs);
  });

  void it("limits manual compatible-provider tools without forcing tool choice", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: {
        mode: "manual",
        selectedToolIds: ["web_search", "memory_search"],
      },
      model: modelContext("openai-compatible"),
    });

    assert.deepEqual(runtime.activeTools, ["web_search", "memory_search"]);
    assert.equal(runtime.toolChoice, "auto");
    assert.equal(typeof runtime.tools?.web_search, "object");
    assert.equal(typeof runtime.tools?.memory_search, "object");
    assert.equal(runtime.tools?.runtime_snapshot, undefined);
  });

  void it("rejects web search when the model cannot call tools", () => {
    assert.throws(
      () =>
        chatTools.buildChatToolRuntime({
          selection: { mode: "manual", selectedToolIds: ["web_search"] },
          model: modelContext("openai-compatible", undefined, {
            ...capabilities,
            toolCalling: false,
          }),
        }),
      (error) => error instanceof chatTools.ChatToolSelectionError && error.status === 400,
    );
  });

  void it("executes host fallback web search with parsed public results", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `
        <html><body>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">One &amp; Result</a>
          <div class="result__snippet">First snippet &amp; detail.</div>
          <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Ftwo">Two Result</a>
          <div class="result__snippet">Second snippet.</div>
        </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } },
      )) as typeof fetch;

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    const webTool = runtime.tools?.web_search as {
      execute?: (input: { query: string; maxResults?: number }) => Promise<unknown>;
    };

    const output = (await webTool.execute?.({ query: "fresh news", maxResults: 2 })) as {
      query: string;
      source: string;
      count: number;
      results: Array<{ title: string; url: string; snippet: string }>;
      sources: Array<{ type: "url"; url: string; title: string }>;
    };

    assert.equal(output.query, "fresh news");
    assert.equal(output.source, "host_fallback");
    assert.equal(output.count, 2);
    assert.deepEqual(output.sources, [
      { type: "url", url: "https://example.com/one", title: "One & Result" },
      { type: "url", url: "https://example.org/two", title: "Two Result" },
    ]);
    assert.deepEqual(output.results[0], {
      title: "One & Result",
      url: "https://example.com/one",
      snippet: "First snippet & detail.",
    });
  });

  void it("extracts weather answers from public search result cards", async () => {
    globalThis.fetch = (async () =>
      new Response(
        `
        <html><body>
          <div class="weather201016">
            <h3 class="vr-title">
              <a href="https://weatherol.cn/index.html?cityid1=420100">姝︽眽澶╂皵棰勬姤</a>
            </h3>
            <div class="w-desc currentDay">
              <div class="desc">
                <div class="temperature">26~31 <i>鈩?/i></div>
                <p class="w-info"><span>灏忛洦杞槾</span><span>鍗楅3绾?/span></p>
              </div>
            </div>
          </div>
        </body></html>
        `,
        { status: 200, headers: { "Content-Type": "text/html" } },
      )) as typeof fetch;

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    const webTool = runtime.tools?.web_search as {
      execute?: (input: { query: string; maxResults?: number }) => Promise<unknown>;
    };

    const output = (await webTool.execute?.({ query: "Wuhan weather today", maxResults: 3 })) as {
      count: number;
      results: Array<{ title: string; url: string; snippet: string }>;
    };

    assert.equal(output.count, 1);
    assert.equal(output.results[0]?.title, "姝︽眽澶╂皵棰勬姤");
    assert.match(output.results[0]?.snippet ?? "", /26~31/);
    assert.match(output.results[0]?.snippet ?? "", /灏忛洦杞槾/);
  });

  void it("reports host fallback web search request failures clearly", async () => {
    globalThis.fetch = (async () =>
      new Response("blocked", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["web_search"] },
      model: modelContext("openai-compatible"),
    });
    const webTool = runtime.tools?.web_search as {
      execute?: (input: { query: string; maxResults?: number }) => Promise<unknown>;
    };
    assert.equal(typeof webTool.execute, "function");

    await assert.rejects(() => webTool.execute!({ query: "fresh news" }), /HTTP 503/);
  });

  void it("excludes memory modification tools from auto mode defaults", () => {
    const descriptors = chatTools.createChatToolDescriptors(modelContext("openai-compatible"));
    for (const id of ["memory_save", "memory_update", "memory_delete"] as const) {
      const descriptor = descriptors.find((d) => d.id === id);
      assert.ok(descriptor);
      assert.equal(descriptor.defaultAuto, false);
      assert.equal(descriptor.requiresApproval, false);
    }

    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "auto", selectedToolIds: [] },
      model: modelContext("openai-compatible"),
    });
    assert.equal(typeof runtime.tools?.memory_save, "undefined");
    assert.equal(typeof runtime.tools?.memory_update, "undefined");
    assert.equal(typeof runtime.tools?.memory_delete, "undefined");
  });

  void it("marks built-in chat tools approval-free except workspace execution", () => {
    const descriptors = chatTools.createChatToolDescriptors(modelContext("openai-compatible"));
    for (const id of CHAT_TOOL_IDS) {
      assert.equal(
        descriptors.find((descriptor) => descriptor.id === id)?.requiresApproval,
        id === "workspace_run_command",
      );
    }
  });

  void it("includes memory tools in manual mode", () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: {
        mode: "manual",
        selectedToolIds: ["memory_save", "memory_update", "memory_delete"],
      },
      model: modelContext("openai-compatible"),
    });
    assert.deepEqual(runtime.activeTools, ["memory_save", "memory_update", "memory_delete"]);
    assert.equal(typeof runtime.tools?.memory_save, "object");
    assert.equal(typeof runtime.tools?.memory_update, "object");
    assert.equal(typeof runtime.tools?.memory_delete, "object");
  });

  void it("exposes cron creation with a structured schema without approval", async () => {
    const runtime = chatTools.buildChatToolRuntime({
      selection: { mode: "manual", selectedToolIds: ["cron"] },
      model: modelContext("openai-compatible"),
    });
    const cronTool = runtime.tools?.cron as {
      inputSchema?: unknown;
      execute?: (input: unknown) => Promise<unknown>;
    };

    assert.equal(typeof cronTool.execute, "function");
    assert.match(JSON.stringify(cronTool.inputSchema), /Asia\/Shanghai/);
    assert.match(JSON.stringify(cronTool.inputSchema), /everyMs/);
    assert.match(runtime.instructions ?? "", /current_time first/);

    const approvals = runtime.toolApproval as Record<
      string,
      (input: unknown) => Promise<string | undefined> | string | undefined
    >;
    assert.equal(approvals.cron, undefined);
    assert.equal(approvals.conversation_search, undefined);
  });

  void it("merges all silent memory tools into an off-mode root runtime", () => {
    const model = modelContext("openai-compatible");
    const base = chatTools.buildChatToolRuntime({
      selection: { mode: "off", selectedToolIds: [] },
      model,
      conversationId: "c1",
    });
    const merged = chatTools.mergeSilentRootMemoryTools(
      base,
      chatTools.createMemoryHostTools({
        model,
        conversationId: "c1",
        agentId: "agent-ayaka",
      }),
    );

    assert.deepEqual(merged.activeTools, [
      "memory_search",
      "memory_save",
      "memory_update",
      "memory_delete",
    ]);
    for (const id of merged.activeTools) assert.equal(typeof merged.tools[id], "object");
    assert.throws(
      () => chatTools.createMemoryHostTools({ model, agentId: "agent-child" }),
      /only available to the root/i,
    );
  });

  void it("executes memory_save and persists a new memory", async () => {
    const output = (await chatTools.executeChatHostTool({
      toolId: "memory_save",
      input: {
        title: "Test title",
        content: "Test content",
        scope: "global",
        kind: "fact",
        salience: 80,
        pinned: true,
      },
      model: modelContext("openai-compatible"),
      conversationId: "c1",
      agentId: "agent-1",
    })) as {
      id: string;
      scope: string;
      kind: string;
      title: string;
      salience: number;
      pinned: boolean;
    };

    assert.equal(dbSaveMemory.mock.callCount(), 1);
    const saved = dbSaveMemory.mock.calls[0].arguments[0] as MemoryRecord;
    assert.equal(saved.title, "Test title");
    assert.equal(saved.content, "Test content");
    assert.equal(saved.scope, "global");
    assert.equal(saved.kind, "fact");
    assert.equal(saved.salience, 80);
    assert.equal(saved.pinned, 1);
    assert.equal(output.title, "Test title");
    assert.equal(output.pinned, true);
  });

  void it("executes memory_update and persists changes", async () => {
    const existing: MemoryRecord = {
      id: "m1",
      scope: "agent",
      kind: "preference",
      title: "Old title",
      content: "Old content",
      agent_id: "agent-1",
      conversation_id: null,
      source_run_id: null,
      salience: 50,
      pinned: 0,
      created_at: 1,
      updated_at: 1,
    };
    dbGetMemoryById.mock.mockImplementation(() => existing);

    const output = (await chatTools.executeChatHostTool({
      toolId: "memory_update",
      input: { id: "m1", title: "New title", salience: 90, pinned: true },
      model: modelContext("openai-compatible"),
      conversationId: "c1",
      agentId: "agent-1",
    })) as { id: string; title: string; salience: number; pinned: boolean };

    assert.equal(dbGetMemoryById.mock.callCount(), 2);
    assert.equal(dbSaveMemory.mock.callCount(), 1);
    const saved = dbSaveMemory.mock.calls[0].arguments[0] as MemoryRecord;
    assert.equal(saved.id, "m1");
    assert.equal(saved.title, "New title");
    assert.equal(saved.content, "Old content");
    assert.equal(saved.salience, 90);
    assert.equal(saved.pinned, 1);
    assert.equal(output.title, "New title");
    assert.equal(output.pinned, true);
  });

  void it("denies child mutations of another agent memory while allowing root", async () => {
    const existing: MemoryRecord = {
      id: "private-memory",
      scope: "agent",
      kind: "fact",
      title: "Private",
      content: "Owned by another agent",
      agent_id: "agent-2",
      conversation_id: null,
      source_run_id: null,
      salience: 70,
      pinned: 0,
      created_at: 1,
      updated_at: 1,
    };
    dbGetMemoryById.mock.mockImplementation(() => existing);

    await assert.rejects(
      () =>
        chatTools.executeChatHostTool({
          toolId: "memory_update",
          input: { id: existing.id, title: "Nope" },
          model: modelContext("openai-compatible"),
          agentId: "agent-1",
        }),
      /cannot access this memory/i,
    );
    await assert.rejects(
      () =>
        chatTools.executeChatHostTool({
          toolId: "memory_delete",
          input: { id: existing.id },
          model: modelContext("openai-compatible"),
          agentId: "agent-1",
        }),
      /cannot access this memory/i,
    );
    assert.equal(dbSaveMemory.mock.callCount(), 0);
    assert.equal(dbDeleteMemory.mock.callCount(), 0);

    await chatTools.executeChatHostTool({
      toolId: "memory_update",
      input: { id: existing.id, title: "Root update" },
      model: modelContext("openai-compatible"),
      agentId: "agent-ayaka",
    });
    assert.equal(dbSaveMemory.mock.callCount(), 1);
  });

  void it("executes memory_delete and removes the memory", async () => {
    const existing: MemoryRecord = {
      id: "m2",
      scope: "global",
      kind: "episode",
      title: "To delete",
      content: "Content",
      agent_id: null,
      conversation_id: "c1",
      source_run_id: null,
      salience: 60,
      pinned: 0,
      created_at: 1,
      updated_at: 1,
    };
    dbGetMemoryById.mock.mockImplementation(() => existing);

    const output = (await chatTools.executeChatHostTool({
      toolId: "memory_delete",
      input: { id: "m2" },
      model: modelContext("openai-compatible"),
      conversationId: "c1",
      agentId: "agent-1",
    })) as { success: boolean; id: string };

    assert.equal(dbGetMemoryById.mock.callCount(), 1);
    assert.equal(dbDeleteMemory.mock.callCount(), 1);
    assert.equal(dbDeleteMemory.mock.calls[0].arguments[0], "m2");
    assert.equal(output.success, true);
    assert.equal(output.id, "m2");
  });
});

function modelContext(
  providerKind: ModelProviderKind,
  webSearchToolName?: string,
  modelCapabilities: ModelCapabilities = capabilities,
): ChatToolModelContext {
  return {
    providerId: providerKind,
    providerKind,
    modelId: "model",
    capabilities: modelCapabilities,
    nativeTools: webSearchToolName
      ? [
          {
            id: "web_search",
            toolName: webSearchToolName,
            tool: { type: "provider-defined" },
            providerExecuted: true,
          },
        ]
      : [],
  };
}
