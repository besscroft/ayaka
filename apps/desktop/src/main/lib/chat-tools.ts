import { isStepCount, jsonSchema, tool } from "ai";
import type { LanguageModel, streamText, ToolApprovalConfiguration, ToolChoice, ToolSet } from "ai";
import {
  CHAT_TOOL_IDS,
  DEFAULT_AGENT_ID,
  SILENT_ROOT_MEMORY_TOOL_IDS,
  isChatToolId,
  isToolRecordReference,
  isSkillToolReference,
  normalizeChatToolSelection,
  type ChatToolDescriptor,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type MemoryKind,
  type MemoryScope,
  type ModelCapabilities,
  type ModelProviderKind,
} from "../../shared/types";
import type { NativeChatTool } from "./providers";
import {
  getAgent,
  getMemoryById,
  getToolRecord,
  getRuntimeSnapshot,
  insertRuntimeEvent,
  listMessages,
  upsertAgentRuntimeState,
} from "./db";
import { memoryOrchestrator } from "./memory-orchestrator";
import {
  assertCanAccessMemoryRecord,
  createMemoryAccessContext,
  resolveAgentMemoryTarget,
  type MemoryAccessContext,
} from "./memory-access";
import { createMcpToolDescriptors, createMcpToolSet } from "./mcp-manager";
import { createSkillToolDescriptors, createSkillToolSet } from "./skill-runtime";
import {
  createCronJob,
  deleteCronJob,
  getCronJob,
  listCronJobs,
  setCronJobPaused,
  updateCronJob,
} from "./cron-store";
import { getCronScheduler } from "./cron-scheduler";
import type { CronJobInput } from "../../shared/types";
import { readWebPage } from "./web-page-reader";

type StreamTextOptions = Parameters<typeof streamText>[0];

export interface ChatToolModelContext {
  providerId: string;
  providerKind: ModelProviderKind;
  modelId: string;
  capabilities: ModelCapabilities;
  nativeTools: NativeChatTool[];
  languageModel?: LanguageModel;
  providerOptions?: NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;
}

export interface BuildChatToolRuntimeOptions {
  selection?: ChatToolSelectionRequest;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}

export interface ChatToolRuntimeConfig {
  descriptors: ChatToolDescriptor[];
  tools?: ToolSet;
  activeTools?: string[];
  builtinToolNames?: string[];
  approvalToolNames?: string[];
  toolChoice?: ToolChoice<ToolSet>;
  toolApproval?: ToolApprovalConfiguration<ToolSet, unknown>;
  stopWhen?: StreamTextOptions["stopWhen"];
  onStepEnd?: StreamTextOptions["onStepEnd"];
  instructions?: string;
}

export interface ChatToolAuditContext {
  runId?: string;
  agentId?: string | null;
}

export function auditChatToolApprovalResponses({
  messages,
  model,
  conversationId,
  agentId,
}: {
  messages: Array<{ role?: string; parts?: unknown[] }>;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): void {
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "assistant" || !Array.isArray(lastMessage.parts)) return;

  for (const part of lastMessage.parts) {
    const approval = getApprovalResponse(part);
    if (!approval) continue;
    const toolName = getToolPartName(part) ?? "unknown";
    recordRuntimeEvent({
      kind: "approval",
      title: `Approval ${approval.approved ? "approved" : "denied"}: ${toolName}`,
      status: approval.approved ? "succeeded" : "cancelled",
      detail: baseAuditDetail(model, conversationId, {
        agentId,
        toolName,
        approvalId: approval.id,
        approved: approval.approved,
        reason: approval.reason ? truncate(approval.reason, 240) : undefined,
      }),
    });
  }
}

interface ToolDefinition {
  id: ChatToolId;
  label: string;
  description: string;
  kind: "provider" | "host";
  category: ChatToolDescriptor["category"];
  defaultAuto: boolean;
  requiresApproval: boolean;
}

interface MemorySearchInput {
  query: string;
  limit?: number;
  scope?: MemoryScope;
  kind?: MemoryKind;
  agentId?: string;
}

interface RuntimeSnapshotInput {
  limit?: number;
}

interface WebSearchInput {
  query: string;
  maxResults?: number;
}

interface WebOpenInput {
  url: string;
}

interface ConversationSearchInput {
  query: string;
  limit?: number;
}

interface MemorySaveInput {
  title: string;
  content: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  salience?: number;
  pinned?: boolean;
  agentId?: string;
}

interface MemoryUpdateInput {
  id: string;
  title?: string;
  content?: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  salience?: number;
  pinned?: boolean;
  agentId?: string;
}

interface CronToolInput {
  action: "create" | "list" | "get" | "update" | "pause" | "resume" | "run" | "delete";
  id?: string;
  job?: Partial<CronJobInput>;
}

const TOOL_DEFINITIONS: Record<ChatToolId, ToolDefinition> = {
  web_search: {
    id: "web_search",
    label: "Web search",
    description: "Search the live web with native provider search or a host fallback.",
    kind: "provider",
    category: "web",
    defaultAuto: true,
    requiresApproval: false,
  },
  web_open: {
    id: "web_open",
    label: "Open web page",
    description: "Read a public HTML web page provided by the user.",
    kind: "host",
    category: "web",
    defaultAuto: true,
    requiresApproval: false,
  },
  file_search: {
    id: "file_search",
    label: "File search",
    description: "Search configured OpenAI vector stores for relevant file content.",
    kind: "provider",
    category: "conversation",
    defaultAuto: false,
    requiresApproval: false,
  },
  code_interpreter: {
    id: "code_interpreter",
    label: "Code interpreter",
    description: "Run Python code in the selected OpenAI hosted analysis environment.",
    kind: "provider",
    category: "sandbox",
    defaultAuto: false,
    requiresApproval: false,
  },
  tool_search: {
    id: "tool_search",
    label: "Tool search",
    description: "Search and load deferred tools when the model needs them.",
    kind: "provider",
    category: "model",
    defaultAuto: false,
    requiresApproval: false,
  },
  current_time: {
    id: "current_time",
    label: "Current time",
    description: "Read the current system date, time, and timezone from the host device.",
    kind: "host",
    category: "system",
    defaultAuto: true,
    requiresApproval: false,
  },
  memory_search: {
    id: "memory_search",
    label: "Memory search",
    description: "Search saved local memories relevant to the conversation.",
    kind: "host",
    category: "memory",
    defaultAuto: false,
    requiresApproval: false,
  },
  runtime_snapshot: {
    id: "runtime_snapshot",
    label: "Runtime snapshot",
    description: "Read a compact local runtime summary.",
    kind: "host",
    category: "runtime",
    defaultAuto: true,
    requiresApproval: false,
  },
  model_capabilities: {
    id: "model_capabilities",
    label: "Model capabilities",
    description: "Inspect the selected model and enabled chat tools.",
    kind: "host",
    category: "model",
    defaultAuto: true,
    requiresApproval: false,
  },
  conversation_search: {
    id: "conversation_search",
    label: "Conversation search",
    description: "Search messages in this conversation.",
    kind: "host",
    category: "conversation",
    defaultAuto: false,
    requiresApproval: false,
  },
  memory_save: {
    id: "memory_save",
    label: "Save memory",
    description: "Save a new local memory.",
    kind: "host",
    category: "memory",
    defaultAuto: false,
    requiresApproval: false,
  },
  memory_update: {
    id: "memory_update",
    label: "Update memory",
    description: "Update an existing local memory.",
    kind: "host",
    category: "memory",
    defaultAuto: false,
    requiresApproval: false,
  },
  memory_delete: {
    id: "memory_delete",
    label: "Delete memory",
    description: "Delete an existing local memory.",
    kind: "host",
    category: "memory",
    defaultAuto: false,
    requiresApproval: false,
  },
  sandbox_list_files: {
    id: "sandbox_list_files",
    label: "Sandbox files",
    description: "List files inside the current sandbox session.",
    kind: "host",
    category: "sandbox",
    defaultAuto: true,
    requiresApproval: false,
  },
  sandbox_read_file: {
    id: "sandbox_read_file",
    label: "Read sandbox file",
    description: "Read a text file inside the current sandbox session.",
    kind: "host",
    category: "sandbox",
    defaultAuto: true,
    requiresApproval: false,
  },
  sandbox_write_file: {
    id: "sandbox_write_file",
    label: "Write sandbox file",
    description: "Write or overwrite a file inside the current sandbox session.",
    kind: "host",
    category: "sandbox",
    defaultAuto: false,
    requiresApproval: false,
  },
  sandbox_run_command: {
    id: "sandbox_run_command",
    label: "Run sandbox command",
    description: "Run a command in the current sandbox session.",
    kind: "host",
    category: "sandbox",
    defaultAuto: false,
    requiresApproval: false,
  },
  sandbox_snapshot: {
    id: "sandbox_snapshot",
    label: "Create sandbox snapshot",
    description: "Create a restorable snapshot of the current sandbox files.",
    kind: "host",
    category: "sandbox",
    defaultAuto: true,
    requiresApproval: false,
  },
  sandbox_restore: {
    id: "sandbox_restore",
    label: "Restore sandbox snapshot",
    description: "Restore a sandbox snapshot.",
    kind: "host",
    category: "sandbox",
    defaultAuto: false,
    requiresApproval: false,
  },
  sandbox_list_artifacts: {
    id: "sandbox_list_artifacts",
    label: "Sandbox artifacts",
    description: "List files and previews exported from the sandbox.",
    kind: "host",
    category: "sandbox",
    defaultAuto: true,
    requiresApproval: false,
  },
  sandbox_preview_port: {
    id: "sandbox_preview_port",
    label: "Sandbox preview port",
    description: "Register a local preview port for the sandbox.",
    kind: "host",
    category: "sandbox",
    defaultAuto: false,
    requiresApproval: false,
  },
  sandbox_publish_artifact: {
    id: "sandbox_publish_artifact",
    label: "Publish sandbox artifact",
    description:
      "Publish generated HTML or a static app after writing its files so the workspace panel can render it.",
    kind: "host",
    category: "sandbox",
    defaultAuto: true,
    requiresApproval: false,
  },
  sandbox_start_preview: {
    id: "sandbox_start_preview",
    label: "Start sandbox preview",
    description:
      "Start an approval-gated local preview process for Vite, React, or another server-backed app.",
    kind: "host",
    category: "sandbox",
    defaultAuto: true,
    requiresApproval: true,
  },
  workspace_run_command: {
    id: "workspace_run_command",
    label: "Run workspace command",
    description:
      "Run a structured executable and argument list in the conversation workspace. This is not an OS sandbox.",
    kind: "host",
    category: "execution",
    defaultAuto: true,
    requiresApproval: true,
  },
  cron: {
    id: "cron",
    label: "Automation",
    description:
      "Create, inspect, update, pause, run, or delete scheduled isolated agent turns. " +
      "Use this for reminders and recurring tasks.",
    kind: "host",
    category: "automation",
    defaultAuto: true,
    requiresApproval: false,
  },
};

export class ChatToolSelectionError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ChatToolSelectionError";
  }
}

export function createChatToolDescriptors(model: ChatToolModelContext): ChatToolDescriptor[] {
  const supportsTools = model.capabilities.toolCalling;
  const webSearchExecution = getWebSearchExecution(model);
  const workspaceCommandRecord = getToolRecord("workspace_run_command");

  const builtInDescriptors = CHAT_TOOL_IDS.map((id) => {
    const base = TOOL_DEFINITIONS[id];
    const nativeTool = model.nativeTools.find((item) => item.id === id);
    const isNativeOnly = base.kind === "provider" && id !== "web_search";
    const overridden = model.capabilities.toolCapabilities?.[id];
    const available =
      supportsTools &&
      overridden !== false &&
      (id === "web_search" ? !!webSearchExecution : isNativeOnly ? !!nativeTool : true);
    const unavailableReason = available
      ? undefined
      : !supportsTools
        ? "Selected model does not advertise tool calling."
        : id === "web_search"
          ? webSearchUnavailableReason(model)
          : isNativeOnly && overridden === false
            ? "This tool is disabled for the selected model."
            : isNativeOnly
              ? "This provider has not registered the hosted tool for the selected model."
              : "Tool calling is unavailable for the selected model.";

    const requiresApproval =
      id === "workspace_run_command" && workspaceCommandRecord
        ? workspaceCommandRecord.requires_approval !== 0
        : base.requiresApproval;

    return {
      ...base,
      ...((id === "web_search" && webSearchExecution) || (isNativeOnly && nativeTool)
        ? {
            kind: id === "web_search" ? webSearchExecution : "provider",
            execution: id === "web_search" ? webSearchExecution : "provider",
            description:
              id === "web_search"
                ? webSearchExecution === "provider"
                  ? "Search the live web with the selected model provider."
                  : "Search the live web through the app when native provider search is unavailable."
                : base.description,
          }
        : {}),
      requiresApproval,
      available,
      unavailableReason,
    };
  });

  const dynamicDescriptors = [...createMcpToolDescriptors(), ...createSkillToolDescriptors()].map(
    (descriptor) =>
      supportsTools
        ? descriptor
        : {
            ...descriptor,
            available: false,
            defaultAuto: false,
            unavailableReason: "Selected model does not advertise tool calling.",
          },
  );

  return [...builtInDescriptors, ...dynamicDescriptors];
}

export function buildChatToolRuntime({
  selection: rawSelection,
  model,
  conversationId,
  agentId,
}: BuildChatToolRuntimeOptions): ChatToolRuntimeConfig {
  const selection = normalizeChatToolSelection(rawSelection);
  const descriptors = createChatToolDescriptors(model);
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));

  if (selection.mode === "off" || !model.capabilities.toolCalling) {
    if (selection.mode === "manual" && selection.selectedToolIds.length > 0) {
      throw new ChatToolSelectionError("Selected model does not support chat tools.");
    }
    return { descriptors, toolChoice: "none" };
  }

  const selectedIds =
    selection.mode === "auto"
      ? descriptors
          .filter((descriptor) => descriptor.defaultAuto && descriptor.available)
          .map((descriptor) => descriptor.id)
      : selection.selectedToolIds;

  const unknown = selectedIds.filter((id) => !descriptorById.has(id));
  if (unknown.length > 0) {
    throw new ChatToolSelectionError("Unknown chat tool: " + unknown[0]);
  }

  const unavailable = selectedIds
    .map((id) => descriptorById.get(id))
    .filter(
      (descriptor): descriptor is ChatToolDescriptor => !!descriptor && !descriptor.available,
    );
  if (unavailable.length > 0) {
    const first = unavailable[0];
    throw new ChatToolSelectionError(
      `${first.label} is unavailable: ${first.unavailableReason ?? "unsupported"}`,
    );
  }

  const toolSet: ToolSet = {};
  const activeTools: string[] = [];
  const builtinToolNames: string[] = [];
  const providerExecutedToolNames = new Set<string>();
  const hostTools = createHostTools({ model, descriptors, conversationId, agentId });
  const approvalToolNames: string[] = [];

  for (const id of selectedIds.filter(isChatToolId)) {
    const nativeTool = model.nativeTools.find((item) => item.id === id);
    if (nativeTool) {
      assignTool(toolSet, nativeTool.toolName, nativeTool.tool);
      activeTools.push(nativeTool.toolName);
      builtinToolNames.push(nativeTool.toolName);
      providerExecutedToolNames.add(nativeTool.toolName);
      continue;
    }

    if (id === "web_search") {
      const hostTool = hostTools.web_search;
      if (!hostTool) continue;
      assignTool(toolSet, "web_search", hostTool);
      activeTools.push("web_search");
      builtinToolNames.push("web_search");
      continue;
    }

    const hostTool = hostTools[id];
    if (!hostTool) continue;
    assignTool(toolSet, id, hostTool);
    activeTools.push(id);
    builtinToolNames.push(id);
  }

  const dynamicRuntimes = [
    createMcpToolSet({
      references: selectedIds.filter(isToolRecordReference),
      model,
      conversationId,
      agentId,
    }),
    createSkillToolSet({
      references: selectedIds.filter(isSkillToolReference),
      model,
      conversationId,
      agentId,
    }),
  ];
  for (const runtime of dynamicRuntimes) {
    for (const [toolName, value] of Object.entries(runtime.tools)) {
      assignTool(toolSet, toolName, value);
    }
    activeTools.push(...runtime.activeTools);
    approvalToolNames.push(...runtime.approvalToolNames);
  }

  if (model.providerKind === "openai" && activeTools.includes("tool_search")) {
    for (const [toolName, value] of Object.entries(toolSet)) {
      if (toolName === "tool_search") continue;
      toolSet[toolName] = markOpenAIToolAsDeferred(value);
    }
  }

  if (activeTools.length === 0) return { descriptors, toolChoice: "none" };

  const toolChoice = resolveToolChoice(selection.mode, activeTools, model);

  return {
    descriptors,
    tools: toolSet,
    activeTools,
    builtinToolNames,
    approvalToolNames,
    toolChoice,
    toolApproval: createToolApproval(conversationId, agentId, model, approvalToolNames),
    stopWhen: isStepCount(5),
    onStepEnd: createStepAuditor({
      model,
      conversationId,
      providerExecutedToolNames,
    }),
    instructions: createToolInstructions(activeTools),
  };
}

export async function executeChatHostTool({
  toolId,
  input,
  model,
  conversationId,
  agentId,
  audit,
}: {
  toolId: ChatToolId;
  input: unknown;
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
  audit?: ChatToolAuditContext;
}): Promise<unknown> {
  const descriptor = TOOL_DEFINITIONS[toolId];
  return executeWithAudit(
    toolId,
    descriptor.label,
    model,
    conversationId,
    async () => {
      switch (toolId) {
        case "file_search":
        case "code_interpreter":
        case "tool_search":
          throw new Error(toolId + " is only available through the provider-native runtime.");
        case "current_time":
          return getCurrentSystemTime();
        case "web_search":
          return searchWebFallback(input as WebSearchInput);
        case "web_open":
          return readWebPage((input as WebOpenInput).url);
        case "memory_search": {
          const value = input as MemorySearchInput;
          const query = normalizeQuery(value.query);
          const limit = normalizeLimit(value.limit, 6, 12);
          const results = await searchMemories(query, limit, requireMemoryAccess(agentId), {
            scope: value.scope,
            kind: value.kind,
            agentId: value.agentId,
          });
          return { query, count: results.length, results };
        }
        case "runtime_snapshot": {
          const value = input as RuntimeSnapshotInput;
          return summarizeRuntimeSnapshot(normalizeLimit(value.limit, 5, 10));
        }
        case "model_capabilities":
          return {
            providerId: model.providerId,
            providerKind: model.providerKind,
            modelId: model.modelId,
            capabilities: model.capabilities,
            tools: createChatToolDescriptors(model).map((item) => ({
              id: item.id,
              available: item.available,
              defaultAuto: item.defaultAuto,
              requiresApproval: item.requiresApproval,
              unavailableReason: item.unavailableReason,
            })),
          };
        case "conversation_search": {
          const value = input as ConversationSearchInput;
          const query = normalizeQuery(value.query);
          const limit = normalizeLimit(value.limit, 6, 12);
          return searchConversation(conversationId, query, limit);
        }
        case "memory_save":
          return await saveChatMemory(
            input as MemorySaveInput,
            conversationId,
            requireMemoryAccess(agentId),
          );
        case "memory_update":
          return await updateChatMemory(input as MemoryUpdateInput, requireMemoryAccess(agentId));
        case "memory_delete":
          return await deleteChatMemory(input as { id: string }, requireMemoryAccess(agentId));
        case "cron":
          return await executeCronTool(input as CronToolInput);
        case "sandbox_list_files":
        case "sandbox_read_file":
        case "sandbox_write_file":
        case "sandbox_run_command":
        case "sandbox_snapshot":
        case "sandbox_restore":
        case "sandbox_list_artifacts":
        case "sandbox_preview_port":
        case "sandbox_publish_artifact":
        case "sandbox_start_preview":
        case "workspace_run_command":
          throw new Error(
            toolId === "workspace_run_command"
              ? "workspace_run_command is only available through the root Agent runtime."
              : toolId + " is only available through the agent sandbox runtime.",
          );
      }
      throw new Error("Unsupported chat tool: " + toolId);
    },
    audit,
  );
}

function resolveToolChoice(
  mode: ChatToolSelectionRequest["mode"],
  activeTools: string[],
  model: ChatToolModelContext,
): ToolChoice<ToolSet> {
  if (mode !== "manual") return "auto";
  if (model.providerKind === "openai-compatible") return "auto";
  return activeTools.length === 1 ? { type: "tool", toolName: activeTools[0] } : "required";
}

function createToolInstructions(activeTools: string[]): string | undefined {
  const instructions: string[] = [];
  const hasWebSearch = activeTools.includes("web_search") || activeTools.includes("google_search");
  if (hasWebSearch) {
    instructions.push(
      "When the user's request depends on current, live, recent, or time-sensitive information, call the available web search tool before answering.",
      "This includes weather, news, prices, schedules, versions, laws, availability, and questions using words like today, latest, now, current, or recent.",
      "Use the search results in the final answer and include source links or source names when available.",
    );
  }
  if (activeTools.includes("web_open")) {
    instructions.push(
      "When the user provides a URL and asks you to read, summarize, explain, or find information on that page, call the web_open tool before answering.",
      "Use the returned page text and final URL as the source of truth; do not infer page contents from the URL alone.",
    );
  }
  if (activeTools.includes("cron")) {
    instructions.push(
      "When the user asks to schedule a reminder or recurring task, use the cron tool instead of only describing a schedule.",
      "For relative dates or times, call current_time first, then create an unambiguous ISO 8601 timestamp or a cron expression with an IANA timezone.",
      "Do not claim that an automation was created until the cron tool returns the saved job.",
    );
  }
  return instructions.length ? instructions.join(" ") : undefined;
}

function createHostTools({
  model,
  descriptors,
  conversationId,
  agentId,
}: {
  model: ChatToolModelContext;
  descriptors: ChatToolDescriptor[];
  conversationId?: string;
  agentId?: string | null;
}): Partial<Record<ChatToolId, ToolSet[string]>> {
  return {
    current_time: tool({
      description: TOOL_DEFINITIONS.current_time.description,
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: () =>
        executeWithAudit("current_time", "Current time", model, conversationId, async () =>
          getCurrentSystemTime(),
        ),
    }),
    web_search: canUseHostWebSearch(model)
      ? tool({
          description: TOOL_DEFINITIONS.web_search.description,
          inputSchema: jsonSchema<WebSearchInput>({
            type: "object",
            properties: {
              query: { type: "string", description: "Search query." },
              maxResults: {
                type: "number",
                description: "Maximum search results to return.",
              },
            },
            required: ["query"],
            additionalProperties: false,
          }),
          execute: (input) =>
            executeWithAudit("web_search", "Web search", model, conversationId, async () =>
              searchWebFallback(input),
            ),
        })
      : undefined,
    web_open: model.capabilities.toolCalling
      ? tool({
          description: TOOL_DEFINITIONS.web_open.description,
          inputSchema: jsonSchema<WebOpenInput>({
            type: "object",
            properties: {
              url: { type: "string", description: "Public HTTP(S) page URL to read." },
            },
            required: ["url"],
            additionalProperties: false,
          }),
          execute: (input) =>
            executeWithAudit("web_open", "Open web page", model, conversationId, async () =>
              readWebPage(input.url),
            ),
        })
      : undefined,
    memory_search: tool({
      description: TOOL_DEFINITIONS.memory_search.description,
      inputSchema: jsonSchema<MemorySearchInput>({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum results to return." },
          scope: { type: "string", enum: ["global", "agent"] },
          kind: {
            type: "string",
            enum: ["fact", "preference", "episode", "profile", "skill"],
          },
          agentId: { type: "string", description: "Optional agent-scoped memory owner." },
        },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit("memory_search", "Memory search", model, conversationId, async () => {
          const query = normalizeQuery(input.query);
          const limit = normalizeLimit(input.limit, 6, 12);
          const results = await searchMemories(query, limit, requireMemoryAccess(agentId), {
            scope: input.scope,
            kind: input.kind,
            agentId: input.agentId,
          });
          return { query, count: results.length, results };
        }),
    }),
    runtime_snapshot: tool({
      description: TOOL_DEFINITIONS.runtime_snapshot.description,
      inputSchema: jsonSchema<RuntimeSnapshotInput>({
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum recent items per section." },
        },
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit("runtime_snapshot", "Runtime snapshot", model, conversationId, async () =>
          summarizeRuntimeSnapshot(normalizeLimit(input.limit, 5, 10)),
        ),
    }),
    model_capabilities: tool({
      description: TOOL_DEFINITIONS.model_capabilities.description,
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
        additionalProperties: false,
      }),
      execute: () =>
        executeWithAudit(
          "model_capabilities",
          "Model capabilities",
          model,
          conversationId,
          async () => ({
            providerId: model.providerId,
            providerKind: model.providerKind,
            modelId: model.modelId,
            capabilities: model.capabilities,
            tools: descriptors.map((descriptor) => ({
              id: descriptor.id,
              available: descriptor.available,
              defaultAuto: descriptor.defaultAuto,
              requiresApproval: descriptor.requiresApproval,
              unavailableReason: descriptor.unavailableReason,
            })),
          }),
        ),
    }),
    conversation_search: tool({
      description: TOOL_DEFINITIONS.conversation_search.description,
      inputSchema: jsonSchema<ConversationSearchInput>({
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum messages to return." },
        },
        required: ["query"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit(
          "conversation_search",
          "Conversation search",
          model,
          conversationId,
          async () => {
            const query = normalizeQuery(input.query);
            const limit = normalizeLimit(input.limit, 6, 12);
            return searchConversation(conversationId, query, limit);
          },
        ),
    }),
    memory_save: tool({
      description: TOOL_DEFINITIONS.memory_save.description,
      inputSchema: jsonSchema<MemorySaveInput>({
        type: "object",
        properties: {
          title: { type: "string", description: "Short memory title." },
          content: { type: "string", description: "Memory content." },
          scope: { type: "string", enum: ["global", "agent"] },
          kind: {
            type: "string",
            enum: ["fact", "preference", "episode", "profile", "skill"],
          },
          salience: { type: "number", description: "Importance from 1 to 100." },
          pinned: { type: "boolean", description: "Whether to pin the memory." },
          agentId: {
            type: "string",
            description: "Target owner when scope is agent. Root may target any agent.",
          },
        },
        required: ["title", "content"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit(
          "memory_save",
          "Save memory",
          model,
          conversationId,
          async () => await saveChatMemory(input, conversationId, requireMemoryAccess(agentId)),
        ),
    }),
    memory_update: tool({
      description: TOOL_DEFINITIONS.memory_update.description,
      inputSchema: jsonSchema<MemoryUpdateInput>({
        type: "object",
        properties: {
          id: { type: "string", description: "Memory ID to update." },
          title: { type: "string", description: "Short memory title." },
          content: { type: "string", description: "Memory content." },
          scope: { type: "string", enum: ["global", "agent"] },
          kind: {
            type: "string",
            enum: ["fact", "preference", "episode", "profile", "skill"],
          },
          salience: { type: "number", description: "Importance from 1 to 100." },
          pinned: { type: "boolean", description: "Whether to pin the memory." },
          agentId: {
            type: "string",
            description: "Target owner when the resulting scope is agent.",
          },
        },
        required: ["id"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit(
          "memory_update",
          "Update memory",
          model,
          conversationId,
          async () => await updateChatMemory(input, requireMemoryAccess(agentId)),
        ),
    }),
    memory_delete: tool({
      description: TOOL_DEFINITIONS.memory_delete.description,
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: {
          id: { type: "string", description: "Memory ID to delete." },
        },
        required: ["id"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit(
          "memory_delete",
          "Delete memory",
          model,
          conversationId,
          async () => await deleteChatMemory(input, requireMemoryAccess(agentId)),
        ),
    }),
    cron: tool({
      description: TOOL_DEFINITIONS.cron.description,
      inputSchema: jsonSchema<CronToolInput>({
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "list", "get", "update", "pause", "resume", "run", "delete"],
          },
          id: { type: "string", description: "Automation job id." },
          job: {
            type: "object",
            description:
              "Automation fields. Create requires name, schedule, and payload. Update accepts any subset.",
            properties: {
              name: { type: "string", description: "Short automation name." },
              description: { type: "string", description: "Optional human-readable purpose." },
              schedule: {
                description: "One-time, fixed interval, or cron schedule.",
                oneOf: [
                  {
                    type: "object",
                    properties: {
                      kind: { type: "string", const: "once" },
                      at: {
                        type: "string",
                        description: "ISO 8601 timestamp with an explicit UTC offset.",
                      },
                    },
                    required: ["kind", "at"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      kind: { type: "string", const: "interval" },
                      everyMs: {
                        type: "integer",
                        minimum: 1000,
                        description: "Interval duration in milliseconds.",
                      },
                      anchorAt: {
                        type: "string",
                        description: "Optional ISO 8601 timestamp used as the interval anchor.",
                      },
                    },
                    required: ["kind", "everyMs"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      kind: { type: "string", const: "cron" },
                      expression: {
                        type: "string",
                        description: "A 5- or 6-field cron expression.",
                      },
                      timezone: {
                        type: "string",
                        description: "IANA timezone such as Asia/Shanghai or America/New_York.",
                      },
                    },
                    required: ["kind", "expression", "timezone"],
                    additionalProperties: false,
                  },
                ],
              },
              payload: {
                type: "object",
                description: "The isolated agent turn to run on schedule.",
                properties: {
                  prompt: {
                    type: "string",
                    description: "Self-contained instruction for each scheduled run.",
                  },
                  agentId: { type: "string", description: "Optional agent profile id." },
                  modelRef: {
                    type: "string",
                    description:
                      "Optional provider/model reference. Defaults to the selected model.",
                  },
                  reasoning: {
                    type: "string",
                    enum: ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"],
                  },
                  skillIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional skill ids available to the scheduled turn.",
                  },
                },
                required: ["prompt"],
                additionalProperties: false,
              },
            },
            additionalProperties: false,
          },
        },
        required: ["action"],
        additionalProperties: false,
      }),
      execute: (input) =>
        executeWithAudit("cron", `Automation: ${input.action}`, model, conversationId, async () =>
          executeCronTool(input),
        ),
    }),
  };
}

export function createMemoryHostTools({
  model,
  conversationId,
  agentId,
}: {
  model: ChatToolModelContext;
  conversationId?: string;
  agentId?: string | null;
}): Partial<Record<ChatToolId, ToolSet[string]>> {
  if (agentId !== DEFAULT_AGENT_ID) {
    throw new Error("Silent root memory tools are only available to the root agent.");
  }
  const hostTools = createHostTools({
    model,
    descriptors: createChatToolDescriptors(model),
    conversationId,
    agentId,
  });
  const result: Partial<Record<ChatToolId, ToolSet[string]>> = {};
  for (const id of SILENT_ROOT_MEMORY_TOOL_IDS) {
    const memoryTool = hostTools[id];
    if (memoryTool) result[id] = memoryTool;
  }
  return result;
}

export function mergeSilentRootMemoryTools(
  base: ChatToolRuntimeConfig,
  memoryTools: Partial<Record<ChatToolId, ToolSet[string]>>,
): { tools: ToolSet; activeTools: string[]; builtinToolNames: string[] } {
  const tools: ToolSet = { ...base.tools };
  const activeTools = new Set(base.activeTools ?? []);
  const builtinToolNames = new Set(base.builtinToolNames ?? []);
  for (const id of SILENT_ROOT_MEMORY_TOOL_IDS) {
    const memoryTool = memoryTools[id];
    if (!memoryTool) continue;
    assignTool(tools, id, memoryTool);
    activeTools.add(id);
    builtinToolNames.add(id);
  }
  return { tools, activeTools: [...activeTools], builtinToolNames: [...builtinToolNames] };
}

async function executeCronTool(input: CronToolInput): Promise<unknown> {
  switch (input.action) {
    case "list":
      return listCronJobs();
    case "get":
      return getCronJob(requireCronId(input));
    case "create":
      return await createCronJob(requireCronCreateJob(input));
    case "update":
      if (!input.job) throw new Error("job is required for cron.update");
      return await updateCronJob(requireCronId(input), input.job);
    case "pause":
      return await setCronJobPaused(requireCronId(input), true);
    case "resume":
      return await setCronJobPaused(requireCronId(input), false);
    case "run":
      return await getCronScheduler().runNow(requireCronId(input));
    case "delete":
      return { deleted: await deleteCronJob(requireCronId(input)) };
  }
}

function requireCronCreateJob(input: CronToolInput): CronJobInput {
  const job = input.job;
  if (!job?.name?.trim()) throw new Error("job.name is required for cron.create");
  if (!job.schedule) throw new Error("job.schedule is required for cron.create");
  if (!job.payload?.prompt?.trim())
    throw new Error("job.payload.prompt is required for cron.create");
  return job as CronJobInput;
}

function requireCronId(input: CronToolInput): string {
  if (!input.id?.trim()) throw new Error(`id is required for cron.${input.action}`);
  return input.id.trim();
}

function getCurrentSystemTime(): {
  timestampMs: number;
  utcIso: string;
  timeZone: string;
  locale: string;
  utcOffsetMinutes: number;
  localDateTime: string;
} {
  const now = new Date();
  const resolved = Intl.DateTimeFormat().resolvedOptions();
  return {
    timestampMs: now.getTime(),
    utcIso: now.toISOString(),
    timeZone: resolved.timeZone || "UTC",
    locale: resolved.locale || "en-US",
    utcOffsetMinutes: -now.getTimezoneOffset(),
    localDateTime: new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "long",
    }).format(now),
  };
}

function createToolApproval(
  conversationId: string | undefined,
  agentId: string | null | undefined,
  model: ChatToolModelContext,
  dynamicToolNames: string[] = [],
): ToolApprovalConfiguration<ToolSet, unknown> {
  const approvals: Record<string, (input: unknown) => "user-approval" | undefined> = {};

  for (const toolName of dynamicToolNames) {
    approvals[toolName] = () => {
      recordRuntimeEvent({
        kind: "approval",
        title: "Approval requested: " + toolName,
        status: "queued",
        detail: baseAuditDetail(model, conversationId, { agentId, toolName, source: "tool" }),
      });
      return "user-approval";
    };
  }

  return approvals as ToolApprovalConfiguration<ToolSet, unknown>;
}

function createStepAuditor({
  model,
  conversationId,
  providerExecutedToolNames,
}: {
  model: ChatToolModelContext;
  conversationId?: string;
  providerExecutedToolNames: Set<string>;
}): StreamTextOptions["onStepEnd"] {
  return (event) => {
    const results = Array.isArray(event.toolResults) ? event.toolResults : [];
    for (const result of results) {
      const toolName = getUnknownString(result, "toolName");
      if (!toolName || !providerExecutedToolNames.has(toolName)) continue;
      recordRuntimeEvent({
        kind: "tool",
        title: `Provider tool: ${toolName}`,
        status: "succeeded",
        detail: baseAuditDetail(model, conversationId, {
          toolName,
          providerExecuted: true,
          sourceCount: countSources((result as { output?: unknown }).output),
        }),
      });
    }
  };
}

async function executeWithAudit<T>(
  toolId: ChatToolId,
  title: string,
  model: ChatToolModelContext,
  conversationId: string | undefined,
  execute: () => Promise<T>,
  audit?: ChatToolAuditContext,
): Promise<T> {
  const started = Date.now();
  if (audit?.agentId) {
    recordAgentRuntimeState({
      agent_id: audit.agentId,
      status: "tool_calling",
      current_run_id: audit.runId ?? null,
      last_tool_at: started,
      last_error: null,
    });
  }
  try {
    const output = await execute();
    recordRuntimeEvent({
      kind: "tool",
      title,
      status: "succeeded",
      detail: baseAuditDetail(model, conversationId, {
        runId: audit?.runId,
        agentId: audit?.agentId,
        toolId,
        durationMs: Date.now() - started,
        summary: summarizeToolOutput(output),
      }),
    });
    if (audit?.agentId) {
      recordAgentRuntimeState({
        agent_id: audit.agentId,
        status: "running",
        current_run_id: audit.runId ?? null,
        last_tool_at: Date.now(),
        last_error: null,
      });
    }
    return output;
  } catch (error) {
    recordRuntimeEvent({
      kind: "error",
      title,
      status: "failed",
      detail: baseAuditDetail(model, conversationId, {
        runId: audit?.runId,
        agentId: audit?.agentId,
        toolId,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    if (audit?.agentId) {
      recordAgentRuntimeState({
        agent_id: audit.agentId,
        status: "failed",
        current_run_id: audit.runId ?? null,
        last_tool_at: Date.now(),
        last_error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

function recordAgentRuntimeState(patch: Parameters<typeof upsertAgentRuntimeState>[0]): void {
  try {
    upsertAgentRuntimeState(patch);
  } catch (error) {
    console.warn(
      "[chat-tools] failed to record agent runtime state:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function searchMemories(
  query: string,
  limit: number,
  access: MemoryAccessContext,
  filters?: Pick<MemorySearchInput, "scope" | "kind" | "agentId">,
): Promise<
  Array<{
    id: string;
    scope: MemoryScope;
    kind: MemoryKind;
    title: string;
    content: string;
    salience: number;
    pinned: boolean;
  }>
> {
  // Mem0 语义搜索（无 API Key 时内部降级到全量过滤）
  const results = await memoryOrchestrator.retrieve({
    query,
    access,
    agentId: filters?.agentId,
    scope: filters?.scope,
    kind: filters?.kind,
    limit,
  });
  return results.map((memory) => ({
    id: memory.id,
    scope: memory.scope,
    kind: memory.kind,
    title: memory.title,
    content: truncate(memory.content, 600),
    salience: memory.salience,
    pinned: memory.pinned === 1,
  }));
}

function summarizeRuntimeSnapshot(limit: number): unknown {
  const snapshot = getRuntimeSnapshot();
  return {
    agents: {
      total: snapshot.agents.length,
      active: snapshot.agents.filter((agent) => agent.status === "active").length,
      recent: snapshot.agents.slice(0, limit).map((agent) => ({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
      })),
    },
    memories: {
      total: snapshot.memories.length,
      pinned: snapshot.memories.filter((memory) => memory.pinned === 1).length,
      recent: snapshot.memories.slice(0, limit).map((memory) => ({
        id: memory.id,
        scope: memory.scope,
        kind: memory.kind,
        title: memory.title,
        content: truncate(memory.content, 360),
      })),
    },
    agentRuns: snapshot.runtimeRuns.slice(0, limit).map((run) => ({
      id: run.id,
      origin: run.origin,
      status: run.status,
      finishReason: run.finish_reason,
    })),
    runtimeEvents: snapshot.runtimeEvents.slice(0, limit).map((event) => ({
      kind: event.kind,
      title: event.title,
      status: event.status,
      created_at: event.created_at,
    })),
    sync: {
      mode: snapshot.syncState.mode,
      status: snapshot.syncState.status,
      encryption_enabled: snapshot.syncState.encryption_enabled === 1,
    },
  };
}

function searchConversation(
  conversationId: string | undefined,
  query: string,
  limit: number,
): unknown {
  if (!conversationId) throw new Error("conversationId is required for conversation_search.");
  const terms = splitTerms(query);
  const results = listMessages(conversationId)
    .map((message) => {
      const text = extractMessageText(message.content);
      return { message, text, score: scoreText(text, terms) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.message.created_at - a.message.created_at)
    .slice(0, limit)
    .map((item) => ({
      id: item.message.id,
      role: item.message.role,
      text: truncate(item.text, 700),
      created_at: item.message.created_at,
    }));
  return { query, count: results.length, results };
}

async function saveChatMemory(
  input: MemorySaveInput,
  conversationId: string | undefined,
  access: MemoryAccessContext,
): Promise<unknown> {
  const scope = input.scope ?? "global";
  const targetAgentId = scope === "agent" ? resolveAgentMemoryTarget(access, input.agentId) : null;
  if (targetAgentId) requireMemoryAgent(targetAgentId);
  const memory = await memoryOrchestrator.saveExplicit({
    title: input.title,
    content: input.content,
    scope,
    kind: input.kind ?? "fact",
    agentId: targetAgentId,
    sourceConversationId: conversationId ?? null,
    salience: input.salience,
    pinned: input.pinned,
  });

  // 双写 Mem0（fire-and-forget，不阻塞返回；Mem0 不可用时静默降级）
  return {
    id: memory.id,
    scope: memory.scope,
    kind: memory.kind,
    title: memory.title,
    salience: memory.salience,
    pinned: memory.pinned === 1,
  };
}

async function updateChatMemory(
  input: MemoryUpdateInput,
  access: MemoryAccessContext,
): Promise<unknown> {
  const existing = getMemoryById(input.id);
  if (!existing) throw new Error(`Memory not found: ${input.id}`);
  assertCanAccessMemoryRecord(access, existing);
  const nextScope = input.scope ?? existing.scope;
  const targetAgentId =
    nextScope === "agent"
      ? resolveAgentMemoryTarget(access, input.agentId ?? existing.agent_id)
      : null;
  if (targetAgentId) requireMemoryAgent(targetAgentId);
  const memory = await memoryOrchestrator.update(input.id, {
    title: input.title?.trim().slice(0, 120),
    content: input.content?.trim().slice(0, 4_000),
    scope: input.scope,
    kind: input.kind,
    agent_id: targetAgentId,
    salience: input.salience !== undefined ? clampNumber(input.salience, 1, 100) : undefined,
    pinned: input.pinned !== undefined ? (input.pinned ? 1 : 0) : undefined,
  });

  return {
    id: memory.id,
    scope: memory.scope,
    kind: memory.kind,
    title: memory.title,
    salience: memory.salience,
    pinned: memory.pinned === 1,
  };
}

async function deleteChatMemory(
  input: { id: string },
  access: MemoryAccessContext,
): Promise<unknown> {
  const existing = getMemoryById(input.id);
  if (!existing) throw new Error(`Memory not found: ${input.id}`);
  assertCanAccessMemoryRecord(access, existing);
  await memoryOrchestrator.remove(input.id);
  return { success: true, id: input.id };
}

function requireMemoryAccess(agentId: string | null | undefined): MemoryAccessContext {
  if (!agentId) throw new Error("Memory tools require an acting agent.");
  return createMemoryAccessContext(agentId);
}

function requireMemoryAgent(agentId: string): void {
  if (!getAgent(agentId)) throw new Error(`Agent not found: ${agentId}`);
}

async function searchWebFallback(input: WebSearchInput): Promise<{
  query: string;
  source: "host_fallback";
  count: number;
  results: Array<{ title: string; url: string; snippet: string }>;
  sources: Array<{ type: "url"; url: string; title: string }>;
}> {
  const query = normalizeQuery(input.query);
  const maxResults = normalizeLimit(input.maxResults, 5, 10);
  const attempts = createSearchAttempts(query);
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const html = await fetchSearchHtml(attempt.url, attempt.timeoutMs);
      const results = attempt.parse(html, maxResults);
      if (results.length > 0) {
        return {
          query,
          source: "host_fallback",
          count: results.length,
          results,
          sources: results.map((result) => ({
            type: "url" as const,
            url: result.url,
            title: result.title,
          })),
        };
      }
      errors.push(`${attempt.label}: no parseable results`);
    } catch (error) {
      errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error("Web search failed: " + errors.join("; "));
}

interface SearchAttempt {
  label: string;
  url: URL;
  timeoutMs: number;
  parse: (
    html: string,
    maxResults: number,
  ) => Array<{ title: string; url: string; snippet: string }>;
}

function createSearchAttempts(query: string): SearchAttempt[] {
  const attempts: SearchAttempt[] = [];
  if (isWeatherQuery(query)) {
    const sogouWeatherUrl = new URL("https://www.sogou.com/web");
    sogouWeatherUrl.searchParams.set("query", query);
    attempts.push({
      label: "Sogou weather search",
      url: sogouWeatherUrl,
      timeoutMs: 8_000,
      parse: parseSogouWeatherResults,
    });

    const soWeatherUrl = new URL("https://www.so.com/s");
    soWeatherUrl.searchParams.set("q", query);
    attempts.push({
      label: "360 weather search",
      url: soWeatherUrl,
      timeoutMs: 8_000,
      parse: parseSoWeatherResults,
    });
  }

  const duckDuckGoUrl = new URL("https://duckduckgo.com/html/");
  duckDuckGoUrl.searchParams.set("q", query);

  const bingUrl = new URL("https://www.bing.com/search");
  bingUrl.searchParams.set("q", query);

  return [
    ...attempts,
    {
      label: "DuckDuckGo",
      url: duckDuckGoUrl,
      timeoutMs: 4_000,
      parse: parseDuckDuckGoResults,
    },
    {
      label: "Bing",
      url: bingUrl,
      timeoutMs: 12_000,
      parse: parseBingResults,
    },
  ];
}

function isWeatherQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return (
    /天气|气温|降雨|下雨|温度|weather|forecast|rain/.test(normalized) &&
    /今天|今日|现在|当前|实时|today|current|now|tonight/.test(normalized)
  );
}

async function fetchSearchHtml(url: URL, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`Web search request failed with HTTP ${response.status}.`);
    }
    return response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Web search request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseSogouWeatherResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  if (maxResults <= 0) return [];
  const weatherIndex = html.indexOf("weather201016");
  const currentDayIndex = html.indexOf("w-desc currentDay");
  if (weatherIndex < 0 || currentDayIndex < 0) return [];

  const titleBlock = html.slice(Math.max(0, weatherIndex - 800), weatherIndex + 1_500);
  const currentBlock = html.slice(currentDayIndex, currentDayIndex + 1_500);
  const titleLink =
    /<h3[^>]*class=["'][^"']*vr-title[^"']*["'][\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
      titleBlock,
    );
  const temperature = cleanHtmlText(
    /<div[^>]+class=["'][^"']*temperature[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
      currentBlock,
    )?.[1],
  );
  const info = extractSpanTexts(
    /<p[^>]+class=["'][^"']*w-info[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(currentBlock)?.[1],
  );
  if (!temperature && info.length === 0) return [];

  const title = cleanHtmlText(titleLink?.[2]) || "Weather search result";
  const url =
    normalizeResultUrl(titleLink?.[1], "https://www.sogou.com") ?? "https://www.sogou.com";
  const snippet = ["Current weather", temperature, ...info].filter(Boolean).join("; ");
  return [{ title, url, snippet }];
}

function parseSoWeatherResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  if (maxResults <= 0) return [];
  const weatherIndex = html.indexOf("mohe-weather");
  if (weatherIndex < 0) return [];

  const weatherBlock = html.slice(weatherIndex, weatherIndex + 80_000);
  const currentBlock = /<div[^>]+class=["'][^"']*mh-date js-mh-date[^"']*["'][\s\S]*?<\/a>/i.exec(
    weatherBlock,
  )?.[0];
  if (!currentBlock) return [];

  const title =
    cleanHtmlText(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]) || "Weather search result";
  const url =
    normalizeResultUrl(
      /<a[^>]+href=["']([^"']+)["'][^>]*data-md=["'][^"']*\bcont\b/i.exec(currentBlock)?.[1],
      "https://www.so.com",
    ) ?? "https://www.so.com";
  const temperature = [
    cleanHtmlText(
      /<span[^>]+class=["'][^"']*mh-ico-num[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
        currentBlock,
      )?.[1],
    ),
    cleanHtmlText(
      /<span[^>]+class=["'][^"']*mh-ico-unit[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
        currentBlock,
      )?.[1],
    ),
  ]
    .filter(Boolean)
    .join("");
  const currentInfo = extractSpanTexts(
    /<div[^>]+class=["'][^"']*mh-desc-3[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(currentBlock)?.[1],
  );
  const alerts = extractSpanTexts(currentBlock).filter(
    (item) => item.includes("预警") || /优|良|轻度|中度|重度/.test(item),
  );
  const todayBlock =
    /mh-active[\s\S]*?(?=<div[^>]+class=["'][^"']*g-slider-item|<\/div><\/div><\/div>)/i.exec(
      weatherBlock,
    )?.[0];
  const todaySummary = todayBlock
    ? [
        cleanHtmlText(
          /<span[^>]+class=["'][^"']*mh-des-temperature[^"']*["'][^>]*title=["']([^"']+)["']/i.exec(
            todayBlock,
          )?.[1],
        ),
        cleanHtmlText(
          /<span[^>]+class=["'][^"']*mh-des-temperature-num[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(
            todayBlock,
          )?.[1],
        ),
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const snippet = [
    "Current weather",
    temperature,
    ...currentInfo,
    ...alerts,
    todaySummary ? `Today's forecast ${todaySummary}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  if (!snippet) return [];
  return [{ title, url, snippet }];
}

function parseDuckDuckGoResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();
  const resultPattern =
    /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class=["'][^"']*result__a[^"']*["']|<\/body>|$)/gi;

  for (const match of html.matchAll(resultPattern)) {
    const url = normalizeSearchResultUrl(match[1]);
    const title = cleanHtmlText(match[2]);
    const snippet = extractSnippet(match[3] ?? "");
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet });
    if (results.length >= maxResults) return results;
  }

  const litePattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(litePattern)) {
    const url = normalizeSearchResultUrl(match[1]);
    const title = cleanHtmlText(match[2]);
    if (!url || !title || seen.has(url) || isDuckDuckGoNavigation(title, url)) continue;
    seen.add(url);
    results.push({ title, url, snippet: "" });
    if (results.length >= maxResults) return results;
  }

  return results;
}

function parseBingResults(
  html: string,
  maxResults: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const seen = new Set<string>();
  const resultPattern =
    /<li[^>]+class=["'][^"']*\bb_algo\b[^"']*["'][^>]*>([\s\S]*?)(?=<li[^>]+class=["'][^"']*\bb_algo\b|<\/ol>|<\/body>|$)/gi;

  for (const match of html.matchAll(resultPattern)) {
    const block = match[1] ?? "";
    const linkMatch = /<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(
      block,
    );
    if (!linkMatch) continue;
    const url = normalizeBingResultUrl(linkMatch[1]);
    const title = cleanHtmlText(linkMatch[2]);
    const snippet = extractBingSnippet(block);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, snippet });
    if (results.length >= maxResults) return results;
  }

  return results;
}

function extractSnippet(html: string): string {
  const match =
    /<(?:a|div)[^>]+class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(
      html,
    );
  return match ? cleanHtmlText(match[1]) : "";
}

function extractBingSnippet(html: string): string {
  const match = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  return match ? cleanHtmlText(match[1]) : "";
}

function extractSpanTexts(html: string | undefined): string[] {
  if (!html) return [];
  return [...html.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => cleanHtmlText(match[1]))
    .filter(Boolean);
}

function normalizeResultUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeHtmlEntities(raw), baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeSearchResultUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const withProtocol = raw.startsWith("//") ? "https:" + raw : decodeHtmlEntities(raw);
  try {
    const url = new URL(withProtocol, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    const finalUrl = redirected ? new URL(decodeURIComponent(redirected)) : url;
    if (finalUrl.protocol !== "https:" && finalUrl.protocol !== "http:") return null;
    if (finalUrl.hostname.endsWith("duckduckgo.com")) return null;
    return finalUrl.toString();
  } catch {
    return null;
  }
}

function normalizeBingResultUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(decodeHtmlEntities(raw), "https://www.bing.com");
    const redirected = decodeBingRedirect(url);
    const finalUrl = redirected ? new URL(redirected) : url;
    if (finalUrl.protocol !== "https:" && finalUrl.protocol !== "http:") return null;
    if (finalUrl.hostname.endsWith("bing.com")) return null;
    return finalUrl.toString();
  } catch {
    return null;
  }
}

function decodeBingRedirect(url: URL): string | null {
  const encoded = url.searchParams.get("u");
  if (!encoded) return null;
  const value = encoded.startsWith("a1") ? encoded.slice(2) : encoded;
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
}

function cleanHtmlText(raw: string | undefined): string {
  if (!raw) return "";
  return decodeHtmlEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

function isDuckDuckGoNavigation(title: string, url: string): boolean {
  const lowerTitle = title.toLowerCase();
  return (
    url.includes("duckduckgo.com") ||
    lowerTitle === "next" ||
    lowerTitle === "previous" ||
    lowerTitle.includes("duckduckgo")
  );
}

function isNativeWebSearchProvider(model: ChatToolModelContext): boolean {
  return (
    model.providerKind === "openai" ||
    model.providerKind === "anthropic" ||
    model.providerKind === "google"
  );
}

function getWebSearchExecution(model: ChatToolModelContext): "provider" | "host" | undefined {
  if (!model.capabilities.toolCalling) return undefined;
  const hasNativeWebSearch = model.nativeTools.some((item) => item.id === "web_search");
  if (isNativeWebSearchProvider(model)) return hasNativeWebSearch ? "provider" : undefined;
  return canUseHostWebSearch(model) ? "host" : undefined;
}

function canUseHostWebSearch(model: ChatToolModelContext): boolean {
  return model.capabilities.toolCalling && !isNativeWebSearchProvider(model);
}

function webSearchUnavailableReason(model: ChatToolModelContext): string {
  if (!isNativeWebSearchProvider(model)) {
    return "Web search requires a tool-calling model.";
  }
  return "Native web search is not available for this provider configuration.";
}

function assignTool(toolSet: ToolSet, name: string, value: unknown): void {
  (toolSet as Record<string, ToolSet[string]>)[name] = value as ToolSet[string];
}

function markOpenAIToolAsDeferred(value: ToolSet[string]): ToolSet[string] {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { execute?: unknown }).execute !== "function"
  ) {
    return value;
  }
  const tool = value as ToolSet[string] & {
    providerOptions?: Record<string, Record<string, unknown>>;
  };
  return {
    ...tool,
    providerOptions: {
      ...tool.providerOptions,
      openai: {
        ...tool.providerOptions?.openai,
        deferLoading: true,
      },
    },
  };
}

function normalizeQuery(raw: string): string {
  const query = raw.trim();
  if (!query) throw new Error("query is required.");
  return query.slice(0, 500);
}

function normalizeLimit(raw: number | undefined, fallback: number, max: number): number {
  return Math.floor(clampNumber(raw ?? fallback, 1, max));
}

function clampNumber(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.min(max, Math.max(min, raw));
}

function splitTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function scoreText(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (lower.includes(term) ? term.length : 0), 0);
}

function extractMessageText(content: string): string {
  const parsed = safeJsonParse(content, null) as {
    parts?: Array<{ type?: string; text?: string }>;
  } | null;
  if (!parsed?.parts) return content;
  return parsed.parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n\n");
}

function safeJsonParse(raw: string, fallback: unknown): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength - 3) + "..." : text;
}

function getUnknownString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" ? raw : null;
}

function getApprovalResponse(part: unknown): {
  id: string;
  approved: boolean;
  reason?: string;
} | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;
  if (record.state !== "approval-responded") return null;
  const approval = record.approval;
  if (!approval || typeof approval !== "object") return null;
  const approvalRecord = approval as Record<string, unknown>;
  if (typeof approvalRecord.id !== "string" || typeof approvalRecord.approved !== "boolean") {
    return null;
  }
  return {
    id: approvalRecord.id,
    approved: approvalRecord.approved,
    reason: typeof approvalRecord.reason === "string" ? approvalRecord.reason : undefined,
  };
}

function getToolPartName(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const record = part as Record<string, unknown>;
  if (record.type === "dynamic-tool") return getUnknownString(part, "toolName");
  const type = getUnknownString(part, "type");
  return type?.startsWith("tool-") ? type.slice("tool-".length) : null;
}

function countSources(output: unknown): number | undefined {
  if (!output || typeof output !== "object") return undefined;
  const sources = (output as { sources?: unknown }).sources;
  return Array.isArray(sources) ? sources.length : undefined;
}

function summarizeToolOutput(output: unknown): Record<string, unknown> {
  if (Array.isArray(output)) return { type: "array", count: output.length };
  if (!output || typeof output !== "object") return { type: typeof output };
  const record = output as Record<string, unknown>;
  return {
    type: "object",
    count: typeof record.count === "number" ? record.count : undefined,
    id: typeof record.id === "string" ? record.id : undefined,
    sourceCount: countSources(output),
  };
}

function baseAuditDetail(
  model: ChatToolModelContext,
  conversationId: string | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    providerId: model.providerId,
    providerKind: model.providerKind,
    modelId: model.modelId,
    conversationId,
    ...extra,
  };
}

function recordRuntimeEvent(input: {
  kind:
    | "model"
    | "tool"
    | "approval"
    | "handoff"
    | "memory"
    | "loop_input"
    | "skill"
    | "budget"
    | "sandbox"
    | "guardrail"
    | "diagnostic"
    | "error";
  title: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  detail: unknown;
}): void {
  try {
    insertRuntimeEvent(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[chat-tools] failed to record Runtime event:", message);
  }
}
