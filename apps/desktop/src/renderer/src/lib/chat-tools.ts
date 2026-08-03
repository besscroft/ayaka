import {
  CHAT_TOOL_IDS,
  isSilentRootMemoryTool,
  normalizeChatToolSelection,
  type ChatToolReference,
  type ChatToolDescriptor,
  type ChatToolId,
  type ChatToolSelectionRequest,
  type ToolsSnapshot,
  type ModelOption,
  type ProviderInfo,
} from "@shared/types";

const DEFAULT_AUTO_TOOL_IDS = new Set<ChatToolId>([
  "web_search",
  "web_open",
  "current_time",
  "runtime_snapshot",
  "model_capabilities",
  "sandbox_list_files",
  "sandbox_read_file",
  "sandbox_snapshot",
  "sandbox_list_artifacts",
  "cron",
]);

const TOOL_METADATA: Record<
  ChatToolId,
  Pick<ChatToolDescriptor, "label" | "description" | "kind" | "category" | "requiresApproval">
> = {
  web_search: {
    label: "Web search",
    description: "Search the live web with native provider search or a host fallback.",
    kind: "provider",
    category: "web",
    requiresApproval: false,
  },
  web_open: {
    label: "Open web page",
    description: "Read a public HTML web page provided by the user.",
    kind: "host",
    category: "web",
    requiresApproval: false,
  },
  file_search: {
    label: "File search",
    description: "Search configured OpenAI vector stores for relevant file content.",
    kind: "provider",
    category: "conversation",
    requiresApproval: false,
  },
  code_interpreter: {
    label: "Code interpreter",
    description: "Run Python code in the selected OpenAI hosted analysis environment.",
    kind: "provider",
    category: "sandbox",
    requiresApproval: false,
  },
  tool_search: {
    label: "Tool search",
    description: "Search and load deferred tools when the model needs them.",
    kind: "provider",
    category: "model",
    requiresApproval: false,
  },
  current_time: {
    label: "Current time",
    description: "Read the current system date, time, and timezone from the host device.",
    kind: "host",
    category: "system",
    requiresApproval: false,
  },
  memory_search: {
    label: "Memory search",
    description: "Search saved local memories relevant to the conversation.",
    kind: "host",
    category: "memory",
    requiresApproval: false,
  },
  runtime_snapshot: {
    label: "Runtime snapshot",
    description: "Read a compact local runtime summary.",
    kind: "host",
    category: "runtime",
    requiresApproval: false,
  },
  model_capabilities: {
    label: "Model capabilities",
    description: "Inspect the selected model and enabled chat tools.",
    kind: "host",
    category: "model",
    requiresApproval: false,
  },
  conversation_search: {
    label: "Conversation search",
    description: "Search messages in this conversation after approval.",
    kind: "host",
    category: "conversation",
    requiresApproval: true,
  },
  memory_save: {
    label: "Save memory",
    description: "Save a new local memory.",
    kind: "host",
    category: "memory",
    requiresApproval: false,
  },
  memory_update: {
    label: "Update memory",
    description: "Update an existing local memory.",
    kind: "host",
    category: "memory",
    requiresApproval: false,
  },
  memory_delete: {
    label: "Delete memory",
    description: "Delete an existing local memory.",
    kind: "host",
    category: "memory",
    requiresApproval: false,
  },
  sandbox_list_files: {
    label: "Sandbox files",
    description: "List files inside the current sandbox session.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_read_file: {
    label: "Read sandbox file",
    description: "Read a text file inside the current sandbox session.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_write_file: {
    label: "Write sandbox file",
    description: "Write or overwrite a file inside the current sandbox session after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
  sandbox_run_command: {
    label: "Run sandbox command",
    description: "Run a command in the current sandbox session after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
  sandbox_snapshot: {
    label: "Create sandbox snapshot",
    description: "Create a restorable snapshot of the current sandbox files.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_restore: {
    label: "Restore sandbox snapshot",
    description: "Restore a sandbox snapshot after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
  sandbox_list_artifacts: {
    label: "Sandbox artifacts",
    description: "List files and previews exported from the sandbox.",
    kind: "host",
    category: "sandbox",
    requiresApproval: false,
  },
  sandbox_preview_port: {
    label: "Sandbox preview port",
    description: "Register a local preview port for the sandbox after approval.",
    kind: "host",
    category: "sandbox",
    requiresApproval: true,
  },
  cron: {
    label: "Automation",
    description: "List or manage scheduled isolated agent turns.",
    kind: "host",
    category: "automation",
    requiresApproval: true,
  },
};

export interface SelectedChatModelInfo {
  provider: ProviderInfo;
  model: ModelOption;
}

export function findSelectedChatModel(
  selectedModel: string | null | undefined,
  providers: ProviderInfo[],
): SelectedChatModelInfo | null {
  if (!selectedModel) return null;
  const slashIdx = selectedModel.indexOf("/");
  if (slashIdx <= 0) return null;
  const providerId = selectedModel.slice(0, slashIdx);
  const modelId = selectedModel.slice(slashIdx + 1);
  const provider = providers.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  return provider && model ? { provider, model } : null;
}

export function createClientChatToolDescriptors({
  selectedModel,
  providers,
  tools,
}: {
  selectedModel: string | null | undefined;
  providers: ProviderInfo[];
  tools?: ToolsSnapshot | null;
}): ChatToolDescriptor[] {
  const selected = findSelectedChatModel(selectedModel, providers);
  const supportsToolCalling = selected?.model.capabilities.toolCalling === true;

  const builtIn = CHAT_TOOL_IDS.map((id) => {
    const meta = TOOL_METADATA[id];
    const webSearchExecution =
      id === "web_search" && selected ? getWebSearchExecution(selected.provider.kind) : undefined;
    const available = !!selected && supportsToolCalling && isClientToolAvailable(id, selected);

    return {
      id,
      ...meta,
      ...(id === "web_search" && webSearchExecution
        ? {
            kind: webSearchExecution,
            execution: webSearchExecution,
            description:
              webSearchExecution === "provider"
                ? "Search the live web with the selected model provider."
                : "Search the live web through the app when native provider search is unavailable.",
          }
        : {}),
      defaultAuto: DEFAULT_AUTO_TOOL_IDS.has(id),
      available,
      unavailableReason: available
        ? undefined
        : getUnavailableReason({ id, selected, supportsToolCalling }),
    };
  });

  return [...builtIn, ...createtoolChatToolDescriptors(tools, supportsToolCalling)];
}

export function filterUserVisibleChatToolDescriptors(
  descriptors: ChatToolDescriptor[],
): ChatToolDescriptor[] {
  return descriptors.filter(
    (descriptor) =>
      !isSilentRootMemoryTool(descriptor.id) && descriptor.id !== "conversation_search",
  );
}

export function getActiveChatToolIds(
  selection: ChatToolSelectionRequest,
  descriptors: ChatToolDescriptor[],
): ChatToolReference[] {
  const normalized = normalizeChatToolSelection(selection);
  if (normalized.mode === "off") return [];
  if (normalized.mode === "auto") {
    return descriptors
      .filter((descriptor) => descriptor.available && descriptor.defaultAuto)
      .map((descriptor) => descriptor.id);
  }
  const availableIds = new Set(
    descriptors.filter((descriptor) => descriptor.available).map((descriptor) => descriptor.id),
  );
  return normalized.selectedToolIds.filter((id) => availableIds.has(id));
}

function createtoolChatToolDescriptors(
  tools: ToolsSnapshot | null | undefined,
  supportsToolCalling: boolean,
): ChatToolDescriptor[] {
  if (!tools) return [];
  const serverById = new Map(tools.toolServers.map((server) => [server.id, server]));
  const mcpDescriptors = tools.toolRecords
    .filter((toolRecord) => toolRecord.kind === "mcp")
    .map((toolRecord) => {
      const serverId = toolRecord.server_id ?? "";
      const server = serverId ? serverById.get(serverId) : undefined;
      const enabled = !!server && server.enabled !== 0 && toolRecord.enabled !== 0;
      const available = supportsToolCalling && enabled;
      return {
        id: `mcp:${serverId}:${toolRecord.name}`,
        label: toolRecord.title || `${server?.name ?? serverId}: ${toolRecord.name}`,
        description: toolRecord.description || `MCP tool from ${server?.name ?? "server"}.`,
        kind: "host",
        execution: "host",
        category: "mcp",
        defaultAuto:
          supportsToolCalling &&
          enabled &&
          (server?.auto_use ?? 0) !== 0 &&
          toolRecord.auto_use !== 0,
        requiresApproval:
          (server?.requires_approval ?? 1) !== 0 || toolRecord.requires_approval !== 0,
        available,
        unavailableReason: available
          ? undefined
          : supportsToolCalling
            ? "chatTools.unavailable.mcpDisabled"
            : "chatTools.unavailable.toolCalling",
        sourceId: serverId || undefined,
        sourceName: server?.name,
      } satisfies ChatToolDescriptor;
    });

  const skillDescriptors = tools.skills.map((skill) => {
    const available = false;
    return {
      id: `skill:${skill.id}`,
      label: skill.name,
      description: skill.description || "",
      kind: "host",
      execution: "host",
      category: "skill",
      defaultAuto: false,
      requiresApproval: skill.requires_approval !== 0,
      available,
      unavailableReason: available
        ? undefined
        : skill.enabled === 0
          ? "chatTools.unavailable.skillDisabled"
          : supportsToolCalling
            ? "chatTools.unavailable.skillInstructionsOnly"
            : "chatTools.unavailable.toolCalling",
      sourceId: skill.id,
      sourceName: skill.category,
    } satisfies ChatToolDescriptor;
  });

  return [...mcpDescriptors, ...skillDescriptors];
}

function isNativeWebSearchProvider(kind: ProviderInfo["kind"]): boolean {
  return kind === "openai" || kind === "anthropic" || kind === "google";
}

function getWebSearchExecution(kind: ProviderInfo["kind"]): "provider" | "host" {
  return isNativeWebSearchProvider(kind) ? "provider" : "host";
}

function getUnavailableReason({
  id,
  selected,
  supportsToolCalling,
}: {
  id: ChatToolId;
  selected: SelectedChatModelInfo | null;
  supportsToolCalling: boolean;
}): string {
  if (!selected) return "chatTools.unavailable.selectModel";
  if (!supportsToolCalling) return "chatTools.unavailable.toolCalling";
  if (id === "web_search") {
    return "chatTools.unavailable.webSearchToolCalling";
  }
  if (id === "file_search") {
    return "chatTools.unavailable.fileSearchConfig";
  }
  if (id === "tool_search") {
    return "chatTools.unavailable.toolSearchConfig";
  }
  if (id === "code_interpreter") {
    return "chatTools.unavailable.codeInterpreter";
  }
  return "chatTools.unavailable.generic";
}

function isClientToolAvailable(id: ChatToolId, selected: SelectedChatModelInfo): boolean {
  if (selected.model.capabilities.toolCapabilities?.[id] === false) return false;
  if (id === "web_search" || !["file_search", "code_interpreter", "tool_search"].includes(id)) {
    return true;
  }
  if (selected.provider.kind !== "openai") return false;
  const options = readOpenAIHostedToolOptions(selected.model.providerOptions);
  if (id === "file_search") return options.vectorStoreIds.length > 0;
  if (id === "tool_search") return options.toolSearch === true;
  return options.codeInterpreter !== false && isLikelyOpenAIResponsesModel(selected.model.id);
}

function readOpenAIHostedToolOptions(raw: Record<string, unknown>): {
  codeInterpreter?: boolean;
  vectorStoreIds: string[];
  toolSearch?: boolean;
} {
  const source = isPlainObject(raw.openaiTools)
    ? raw.openaiTools
    : isPlainObject(raw.openai)
      ? raw.openai
      : {};
  return {
    codeInterpreter: source.codeInterpreter !== false,
    vectorStoreIds: Array.isArray(source.vectorStoreIds)
      ? source.vectorStoreIds.filter(
          (value): value is string => typeof value === "string" && value.trim() !== "",
        )
      : [],
    toolSearch: source.toolSearch === true,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isLikelyOpenAIResponsesModel(modelId: string): boolean {
  return /^(gpt-|o[1-9](?:$|-)|codex)/i.test(modelId);
}
