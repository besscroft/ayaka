import {
  normalizeChatToolSelection,
  type ChatToolDescriptor,
  type ChatToolId,
  type ChatToolReference,
  type ChatToolSelectionRequest,
  type ModelCapabilities,
  type ModelProviderKind,
} from "../../shared/types";
import type { NativeChatTool } from "./providers";
import { DEFAULT_BUILTIN_TOOL_SEEDS } from "./runtime-defaults";

export interface ChatToolModelContext {
  providerId: string;
  providerKind: ModelProviderKind;
  modelId: string;
  capabilities: ModelCapabilities;
  nativeTools: NativeChatTool[];
}

export type ToolRegistryChoice = "auto" | "none" | "required" | { type: "tool"; toolName: string };

export interface ToolRegistryPreview {
  descriptors: ChatToolDescriptor[];
  activeTools: string[];
  toolChoice: ToolRegistryChoice;
}

export class ToolRegistrySelectionError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ToolRegistrySelectionError";
  }
}

const NATIVE_ONLY_TOOL_IDS = new Set<ChatToolId>([
  "file_search",
  "code_interpreter",
  "tool_search",
]);

const DEFAULT_AUTO_TOOL_IDS = new Set<ChatToolId>([
  "web_search",
  "current_time",
  "runtime_snapshot",
  "model_capabilities",
  "sandbox_list_files",
  "sandbox_read_file",
  "sandbox_snapshot",
  "sandbox_list_artifacts",
  "cron",
]);

export function createBuiltinToolDescriptors(model: ChatToolModelContext): ChatToolDescriptor[] {
  const supportsTools = model.capabilities.toolCalling;
  const webSearchExecution = getWebSearchExecution(model);

  return DEFAULT_BUILTIN_TOOL_SEEDS.map((seed) => {
    const id = seed.id as ChatToolId;
    const isWebSearch = id === "web_search";
    const isNativeOnly = NATIVE_ONLY_TOOL_IDS.has(id);
    const nativeTool = model.nativeTools.find((tool) => tool.id === id);
    const overridden = model.capabilities.toolCapabilities?.[id];
    const available =
      supportsTools &&
      overridden !== false &&
      (isWebSearch ? !!webSearchExecution : isNativeOnly ? !!nativeTool : true);
    const execution = isWebSearch
      ? webSearchExecution
      : isNativeOnly && nativeTool
        ? "provider"
        : undefined;

    return {
      id,
      label: seed.title,
      description:
        isWebSearch && webSearchExecution === "provider"
          ? "Search the live web with the selected model provider."
          : isWebSearch && webSearchExecution === "host"
            ? "Search the live web through the app when native provider search is unavailable."
            : seed.description,
      kind:
        (isWebSearch && webSearchExecution === "provider") || isNativeOnly ? "provider" : "host",
      execution,
      category: seed.category,
      defaultAuto: DEFAULT_AUTO_TOOL_IDS.has(id),
      requiresApproval: seed.requiresApproval === 1,
      available,
      unavailableReason: available
        ? undefined
        : !supportsTools
          ? "Selected model does not advertise tool calling."
          : isNativeOnly && overridden === false
            ? "This tool is disabled for the selected model."
            : isNativeOnly
              ? "This provider has not registered the hosted tool for the selected model."
              : isWebSearch
                ? webSearchUnavailableReason(model)
                : "Tool calling is unavailable for the selected model.",
    } satisfies ChatToolDescriptor;
  });
}

export function buildToolRegistryPreview({
  selection: rawSelection,
  model,
}: {
  selection?: ChatToolSelectionRequest;
  model: ChatToolModelContext;
}): ToolRegistryPreview {
  const selection = normalizeChatToolSelection(rawSelection);
  const descriptors = createBuiltinToolDescriptors(model);
  const descriptorById = new Map<ChatToolReference, ChatToolDescriptor>(
    descriptors.map((descriptor) => [descriptor.id, descriptor]),
  );

  if (selection.mode === "off" || !model.capabilities.toolCalling) {
    if (selection.mode === "manual" && selection.selectedToolIds.length > 0) {
      throw new ToolRegistrySelectionError("Selected model does not support chat tools.");
    }
    return { descriptors, activeTools: [], toolChoice: "none" };
  }

  const selectedIds =
    selection.mode === "auto"
      ? descriptors
          .filter((descriptor) => descriptor.defaultAuto && descriptor.available)
          .map((descriptor) => descriptor.id)
      : selection.selectedToolIds;

  const activeTools = selectedIds.map((id) => {
    const descriptor = descriptorById.get(id);
    if (!descriptor) throw new ToolRegistrySelectionError("Unknown chat tool: " + id);
    if (!descriptor.available) {
      throw new ToolRegistrySelectionError(
        `${descriptor.label} is unavailable: ${descriptor.unavailableReason ?? "unsupported"}`,
      );
    }
    return model.nativeTools.find((tool) => tool.id === id)?.toolName ?? id;
  });

  return {
    descriptors,
    activeTools,
    toolChoice: resolveToolChoice(selection.mode, activeTools, model),
  };
}

function resolveToolChoice(
  mode: ChatToolSelectionRequest["mode"],
  activeTools: string[],
  model: ChatToolModelContext,
): ToolRegistryChoice {
  if (activeTools.length === 0) return "none";
  if (mode !== "manual") return "auto";
  if (model.providerKind === "openai-compatible") return "auto";
  return activeTools.length === 1 ? { type: "tool", toolName: activeTools[0] } : "required";
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
  return "host";
}

function webSearchUnavailableReason(model: ChatToolModelContext): string {
  if (!isNativeWebSearchProvider(model)) return "Web search requires a tool-calling model.";
  return "Native web search is not available for this provider configuration.";
}
