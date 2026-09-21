import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type { ImageModel, LanguageModel, SpeechModel, streamText, TranscriptionModel } from "ai";
import type { ExactTokenCountInput } from "./context-engine";
import {
  deleteApiKey,
  deleteModelApiKey,
  deleteModelApiKeysForProvider,
  getApiKey,
  getModelApiKey,
  getSetting,
  listApiKeyProviders,
  listModelApiKeyRefs,
  setApiKey,
  setModelApiKey,
  setSetting,
} from "./db";
import {
  SettingKey,
  DEFAULT_CUSTOM_PROVIDER_API_FORMAT,
  type CustomModelInput,
  type CustomProviderApiFormat,
  type CustomProviderInput,
  type ChatToolId,
  type JsonObject,
  type ManagedModelInfo,
  type MediaGenerationKind,
  MODEL_CAPABILITY_KEYS,
  CHAT_REASONING_LEVELS,
  type ChatReasoningLevel,
  type ModelCapabilityKey,
  type ModelCapabilitySources,
  type ModelCapabilities,
  type ModelCatalogSettings,
  type ModelOption,
  type ProviderModelSyncResult,
  type ProviderInfo,
  type ProviderTestResult,
  type ProviderAuthKind,
  isChatReasoningLevel,
  isCustomProviderApiFormat,
} from "../../shared/types";
import {
  OPENCODE_FREE_BASE_URL,
  OPENCODE_FREE_PROVIDER_ID,
  ensureOpenCodeFreeCatalog,
  getOpenCodeFreeModelOptions,
  refreshOpenCodeFreeCatalog,
  setOpenCodeFreeModelEnabled,
} from "./opencode-free-catalog";

type ProviderConfig = Omit<ProviderInfo, "hasApiKey" | "hasProviderApiKey">;
type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;

const DEFAULT_MODEL_TEMPERATURE = 0.7;
const DEFAULT_MODEL_TOP_P = 1;
const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MODEL_CONTEXT_WINDOW = 32_000;

function normalizeCustomProviderApiFormat(raw: unknown): CustomProviderApiFormat {
  return isCustomProviderApiFormat(raw) ? raw : DEFAULT_CUSTOM_PROVIDER_API_FORMAT;
}

function getCustomProviderApiFormat(
  provider: Pick<ProviderInfo, "source" | "apiFormat">,
): CustomProviderApiFormat | undefined {
  return provider.source === "custom"
    ? normalizeCustomProviderApiFormat(provider.apiFormat)
    : undefined;
}

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

export interface ResolvedModelConfig {
  model: LanguageModel;
  providerId: string;
  providerKind: ProviderInfo["kind"];
  modelId: string;
  capabilities: ModelCapabilities;
  reasoningDefault?: ChatReasoningLevel;
  reasoningLevels?: ChatReasoningLevel[];
  capabilitySources?: ModelCapabilitySources;
  lastSyncedAt?: number;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  providerOptions?: ProviderOptions;
  nativeTools: NativeChatTool[];
  countInputTokens?: (input: ExactTokenCountInput) => Promise<number>;
}

/** Main-process-only model configuration for the Mem0 OpenAI adapter. */
export interface ResolvedMemoryModel {
  ref: string;
  providerId: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
}

export interface ResolvedMemoryConfiguration {
  llm: ResolvedMemoryModel | null;
  embedding: ResolvedMemoryModel | null;
}

export interface NativeChatTool {
  id: ChatToolId;
  toolName: string;
  tool: unknown;
  providerExecuted: true;
}

export type ResolvedMediaModelConfig =
  | {
      kind: "image";
      model: ImageModel;
      providerId: string;
      providerKind: ProviderInfo["kind"];
      modelId: string;
      capabilities: ModelCapabilities;
      providerOptions?: ProviderOptions;
    }
  | {
      kind: "speech";
      model: SpeechModel;
      providerId: string;
      providerKind: ProviderInfo["kind"];
      modelId: string;
      capabilities: ModelCapabilities;
      providerOptions?: ProviderOptions;
    }
  | {
      kind: "transcription";
      model: TranscriptionModel;
      providerId: string;
      providerKind: ProviderInfo["kind"];
      modelId: string;
      capabilities: ModelCapabilities;
      providerOptions?: ProviderOptions;
    };

function emptyCatalog(): ModelCatalogSettings {
  return { providers: [], models: [], modelStates: [] };
}

const BUILTIN_PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    source: "builtin",
    baseUrl: "https://api.openai.com/v1",
    models: [],
    helpUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.deepseek.com/v1",
    models: [],
    helpUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    source: "builtin",
    models: [],
    helpUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "google",
    label: "Google",
    kind: "google",
    source: "builtin",
    models: [],
    helpUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [],
    helpUrl: "https://openrouter.ai/settings/keys",
  },
  {
    id: "minimax-cn",
    label: "MiniMax CN",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.minimaxi.com/v1",
    models: [],
    helpUrl: "https://platform.minimaxi.com/console/access?tab=api-keys",
  },
  {
    id: "xiaomi",
    label: "Xiaomi MiMo",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.xiaomimimo.com/v1",
    models: [],
    helpUrl: "https://platform.xiaomimimo.com/console/api-keys",
  },
  {
    id: "siliconflow-cn",
    label: "硅基流动",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [],
    helpUrl: "https://cloud.siliconflow.cn/account/ak",
  },
  {
    id: "zai",
    label: "Z.ai",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.z.ai/api/paas/v4",
    models: [],
    helpUrl: "https://z.ai/manage-apikey/apikey-list",
  },
  {
    id: "moonshotai-cn",
    label: "Kimi CN",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [],
    helpUrl: "https://platform.kimi.com/console/api-keys",
  },
  {
    id: OPENCODE_FREE_PROVIDER_ID,
    label: "OpenCode Free",
    kind: "openai-compatible",
    source: "builtin",
    baseUrl: OPENCODE_FREE_BASE_URL,
    authKind: "none",
    models: [],
  },
];

function customModel(model: ModelCatalogSettings["models"][number], enabled: boolean): ModelOption {
  return {
    id: model.id,
    label: model.label,
    source: "custom",
    enabled,
    temperature: model.temperature,
    topP: model.topP,
    maxOutputTokens: model.maxOutputTokens,
    contextWindow: model.contextWindow,
    capabilities: model.capabilities,
    providerOptions: model.providerOptions as ProviderOptions,
    reasoningDefault: model.reasoningDefault,
    reasoningLevels: model.reasoningLevels,
    capabilitySources: model.capabilitySources,
    lastSyncedAt: model.lastSyncedAt,
  };
}

function readCatalog(): ModelCatalogSettings {
  const raw = getSetting(SettingKey.ModelCatalog);
  if (!raw) return emptyCatalog();
  try {
    const parsed = JSON.parse(raw) as Partial<ModelCatalogSettings>;
    return normalizeCatalog(parsed);
  } catch (err) {
    console.error("[providers] Failed to parse model catalog:", err);
    return emptyCatalog();
  }
}

function providerAuthKind(provider: Pick<ProviderInfo, "authKind">): ProviderAuthKind {
  return provider.authKind === "none" ? "none" : "api-key";
}

function builtinProviderConfigs(): ProviderConfig[] {
  return BUILTIN_PROVIDERS.map((provider) =>
    provider.id === OPENCODE_FREE_PROVIDER_ID
      ? { ...provider, models: getOpenCodeFreeModelOptions() }
      : { ...provider },
  );
}

async function writeCatalog(catalog: ModelCatalogSettings): Promise<void> {
  const normalized = normalizeCatalog(catalog);
  await setSetting(SettingKey.ModelCatalog, JSON.stringify(normalized));
  await clearInvalidSelectedModel(normalized);
}

function normalizeCatalog(raw: Partial<ModelCatalogSettings>): ModelCatalogSettings {
  const providers = Array.isArray(raw.providers)
    ? raw.providers
        .map((provider) => ({
          id: normalizeProviderId(provider.id),
          label: String(provider.label ?? "").trim(),
          kind: "openai-compatible" as const,
          baseUrl: normalizeBaseUrl(provider.baseUrl ?? ""),
          apiFormat: normalizeCustomProviderApiFormat(provider.apiFormat),
          createdAt: Number(provider.createdAt) || Date.now(),
          updatedAt: Number(provider.updatedAt) || Date.now(),
        }))
        .filter((provider) => provider.id && provider.label && provider.baseUrl)
    : [];

  const providerIds = new Set([
    ...BUILTIN_PROVIDERS.map((provider) => provider.id),
    ...providers.map((provider) => provider.id),
  ]);

  const models = Array.isArray(raw.models)
    ? raw.models
        .map((model) => {
          const capabilities = normalizeCapabilities(
            (model as { capabilities?: unknown }).capabilities,
          );
          const reasoningLevels = normalizeReasoningLevels(
            (model as { reasoningLevels?: unknown }).reasoningLevels,
            capabilities,
          );
          return {
            providerId: normalizeProviderId(model.providerId),
            id: String(model.id ?? "").trim(),
            label: normalizeOptionalText(model.label),
            enabled: (model as { enabled?: boolean }).enabled !== false,
            temperature: normalizeTemperature((model as { temperature?: unknown }).temperature),
            topP: normalizeTopP((model as { topP?: unknown }).topP),
            maxOutputTokens: normalizeMaxOutputTokens(
              (model as { maxOutputTokens?: unknown }).maxOutputTokens,
            ),
            contextWindow: normalizeContextWindow(
              (model as { contextWindow?: unknown }).contextWindow,
            ),
            capabilities,
            providerOptions: normalizeProviderOptions(
              (model as { providerOptions?: unknown }).providerOptions,
            ),
            reasoningDefault: normalizeReasoningDefault(
              (model as { reasoningDefault?: unknown }).reasoningDefault,
              reasoningLevels,
            ),
            reasoningLevels,
            capabilitySources: normalizeCapabilitySources(
              (model as { capabilitySources?: unknown }).capabilitySources,
            ),
            lastSyncedAt: normalizeOptionalTimestamp(
              (model as { lastSyncedAt?: unknown }).lastSyncedAt,
            ),
            createdAt: Number(model.createdAt) || Date.now(),
            updatedAt: Number(model.updatedAt) || Date.now(),
          };
        })
        .filter((model) => providerIds.has(model.providerId) && model.id)
    : [];

  const modelRefs = new Set(models.map((model) => providerModelRef(model.providerId, model.id)));
  const modelStatesByRef = new Map<string, ModelCatalogSettings["modelStates"][number]>();
  if (Array.isArray(raw.modelStates)) {
    for (const state of raw.modelStates) {
      const providerId = normalizeProviderId(state.providerId);
      const id = String(state.id ?? "").trim();
      const ref = providerModelRef(providerId, id);
      if (!modelRefs.has(ref)) continue;
      modelStatesByRef.set(ref, {
        providerId,
        id,
        enabled: state.enabled !== false,
        updatedAt: Number(state.updatedAt) || Date.now(),
      });
    }
  }

  const normalizedModels = models.map((model) => {
    const state = modelStatesByRef.get(providerModelRef(model.providerId, model.id));
    return { ...model, enabled: state?.enabled ?? model.enabled };
  });

  return {
    providers,
    models: normalizedModels,
    modelStates: [...modelStatesByRef.values()],
  };
}

function normalizeProviderId(raw: string | undefined): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeOptionalText(raw: unknown): string | undefined {
  const text = primitiveToString(raw).trim();
  return text ? text : undefined;
}

function normalizeBaseUrl(raw: string): string {
  const text = raw.trim().replace(/\/+$/, "");
  if (!text) return "";
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Base URL must start with http:// or https://");
  }
  return url.toString().replace(/\/+$/, "");
}

function primitiveToString(raw: unknown): string {
  if (raw == null) return "";
  switch (typeof raw) {
    case "string":
      return raw;
    case "number":
    case "boolean":
    case "bigint":
      return String(raw);
    default:
      return "";
  }
}

function normalizeTemperature(raw: unknown): number {
  return normalizeNumber(raw, DEFAULT_MODEL_TEMPERATURE, 0, 2);
}

function normalizeTopP(raw: unknown): number {
  return normalizeNumber(raw, DEFAULT_MODEL_TOP_P, 0, 1);
}

function normalizeMaxOutputTokens(raw: unknown): number {
  return Math.floor(normalizeNumber(raw, DEFAULT_MODEL_MAX_OUTPUT_TOKENS, 1, 32768));
}

function normalizeContextWindow(raw: unknown): number {
  return Math.floor(normalizeNumber(raw, DEFAULT_MODEL_CONTEXT_WINDOW, 1, 2_000_000));
}

function normalizeCapabilities(raw: unknown): ModelCapabilities {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CAPABILITIES };
  const value = raw as Partial<Record<keyof ModelCapabilities, unknown>>;
  const embedding = value.embedding === true;
  const imageOutput = value.imageOutput === true;
  const speechOutput = value.speechOutput === true;
  const transcription = value.transcription === true;
  const toolCapabilities = isPlainJsonObject(value.toolCapabilities)
    ? Object.fromEntries(
        Object.entries(value.toolCapabilities).filter(
          (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
        ),
      )
    : undefined;
  const textGeneration =
    typeof value.textGeneration === "boolean"
      ? value.textGeneration
      : !embedding && !imageOutput && !speechOutput && !transcription;
  return {
    textGeneration,
    vision: value.vision === true,
    imageOutput,
    speechOutput,
    transcription,
    toolCalling: textGeneration && value.toolCalling !== false,
    reasoning: value.reasoning === true,
    embedding,
    toolCapabilities,
  };
}

function normalizeCapabilitySources(raw: unknown): ModelCapabilitySources {
  if (!isPlainJsonObject(raw)) return {};
  const sources: ModelCapabilitySources = {};
  for (const key of MODEL_CAPABILITY_KEYS) {
    const source = raw[key];
    if (source === "provider" || source === "inferred" || source === "manual") {
      sources[key] = source;
    }
  }
  return sources;
}

function normalizeReasoningLevels(raw: unknown, capabilitiesRaw?: unknown): ChatReasoningLevel[] {
  if (Array.isArray(raw)) {
    const levels = raw.filter((value): value is ChatReasoningLevel => isChatReasoningLevel(value));
    if (levels.length > 0) return [...new Set(levels)];
  }

  const capabilities = normalizeCapabilities(capabilitiesRaw);
  return capabilities.reasoning ? [...CHAT_REASONING_LEVELS] : ["provider-default", "none"];
}

function normalizeReasoningDefault(
  raw: unknown,
  levels: readonly ChatReasoningLevel[] | undefined,
): ChatReasoningLevel {
  if (isChatReasoningLevel(raw) && (!levels || levels.includes(raw))) return raw;
  return "provider-default";
}

function normalizeOptionalTimestamp(raw: unknown): number | undefined {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

function isPlainJsonObject(raw: unknown): raw is JsonObject {
  return !!raw && typeof raw === "object" && !Array.isArray(raw);
}

function normalizeProviderOptions(raw: unknown): JsonObject {
  if (raw == null || raw === "") return {};
  if (!isPlainJsonObject(raw)) throw new Error("Provider options must be a JSON object");
  return raw;
}

export function parseProviderOptionsJson(raw: string | undefined): JsonObject | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}") return {};
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return normalizeProviderOptions(parsed);
  } catch (error) {
    if (error instanceof Error && error.message === "Provider options must be a JSON object") {
      throw error;
    }
    throw new Error("Provider options must be valid JSON");
  }
}

function stringifyProviderOptions(options: JsonObject): string {
  return Object.keys(options).length === 0 ? "{}" : JSON.stringify(options, null, 2);
}

function normalizeNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function providerModelRef(providerId: string, modelId: string): string {
  return providerId + "/" + modelId;
}

function isModelEnabled(
  catalog: ModelCatalogSettings,
  providerId: string,
  modelId: string,
): boolean {
  const state = catalog.modelStates.find(
    (item) => item.providerId === providerId && item.id === modelId,
  );
  if (state) return state.enabled;
  return (
    catalog.models.find((model) => model.providerId === providerId && model.id === modelId)
      ?.enabled ?? true
  );
}

function setModelState(
  catalog: ModelCatalogSettings,
  providerId: string,
  modelId: string,
  enabled: boolean,
): void {
  const now = Date.now();
  const existing = catalog.modelStates.find(
    (state) => state.providerId === providerId && state.id === modelId,
  );
  const nextState = { providerId, id: modelId, enabled, updatedAt: now };
  catalog.modelStates = existing
    ? catalog.modelStates.map((state) =>
        state.providerId === providerId && state.id === modelId ? nextState : state,
      )
    : [...catalog.modelStates, nextState];
  catalog.models = catalog.models.map((model) =>
    model.providerId === providerId && model.id === modelId
      ? { ...model, enabled, updatedAt: now }
      : model,
  );
}

function removeModelState(
  catalog: ModelCatalogSettings,
  providerId: string,
  modelId: string,
): void {
  catalog.modelStates = catalog.modelStates.filter(
    (state) => !(state.providerId === providerId && state.id === modelId),
  );
}

function isSelectedModelValid(catalog: ModelCatalogSettings, selectedModel: string): boolean {
  const slashIdx = selectedModel.indexOf("/");
  if (slashIdx <= 0) return false;
  const providerId = normalizeProviderId(selectedModel.slice(0, slashIdx));
  const modelId = selectedModel.slice(slashIdx + 1).trim();
  if (!modelId) return false;
  const customModel = catalog.models.find(
    (item) => item.providerId === providerId && item.id === modelId,
  );
  if (customModel) return isModelEnabled(catalog, providerId, modelId);
  const builtinModel = builtinProviderConfigs()
    .find((provider) => provider.id === providerId)
    ?.models.find((model) => model.id === modelId);
  return !!builtinModel && builtinModel.enabled;
}

async function clearInvalidSelectedModel(catalog = readCatalog()): Promise<void> {
  const selectedModel = getSetting(SettingKey.SelectedModel);
  if (selectedModel && !isSelectedModelValid(catalog, selectedModel)) {
    await setSetting(SettingKey.SelectedModel, "");
  }
}

function assertKnownModel(providerId: string, modelId: string): void {
  const provider = getProviderConfig(providerId);
  if (!provider) throw new Error("Unknown provider: " + providerId);
  if (!provider.models.some((model) => model.id === modelId)) {
    throw new Error("Unknown model: " + providerModelRef(providerId, modelId));
  }
}

function mergeModels(provider: ProviderConfig, catalog: ModelCatalogSettings): ModelOption[] {
  if (provider.id === OPENCODE_FREE_PROVIDER_ID) return getOpenCodeFreeModelOptions();
  return catalog.models
    .filter((model) => model.providerId === provider.id)
    .map((model) => customModel(model, isModelEnabled(catalog, provider.id, model.id)));
}

/**
 * Merge persisted custom providers over built-ins without mutating either input.
 * A legacy custom provider that now shares a built-in ID keeps the built-in slot,
 * while custom-only providers retain their persisted order after the built-ins.
 */
function mergeProviderConfigs(
  builtins: readonly ProviderConfig[],
  customProviders: readonly ProviderConfig[],
): ProviderConfig[] {
  const customById = new Map<string, ProviderConfig>();
  for (const provider of customProviders) customById.set(provider.id, provider);

  const merged: ProviderConfig[] = [];
  const seenIds = new Set<string>();
  for (const builtin of builtins) {
    if (seenIds.has(builtin.id)) continue;
    merged.push(customById.get(builtin.id) ?? builtin);
    seenIds.add(builtin.id);
  }

  for (const custom of customProviders) {
    if (seenIds.has(custom.id)) continue;
    merged.push(customById.get(custom.id) ?? custom);
    seenIds.add(custom.id);
  }

  return merged;
}

export function listProviders(): ProviderInfo[] {
  const catalog = readCatalog();
  const providerKeys = new Set(listApiKeyProviders());
  const modelKeyRefs = new Set(listModelApiKeyRefs());
  const customProviders: ProviderConfig[] = catalog.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    source: "custom",
    baseUrl: provider.baseUrl,
    apiFormat: provider.apiFormat,
    models: [],
  }));

  return mergeProviderConfigs(builtinProviderConfigs(), customProviders).map((provider) => {
    // Listing metadata must not decrypt secrets. A successful decryption is only
    // needed when the provider is actually used to make a request.
    const hasProviderApiKey = providerKeys.has(provider.id);
    const models = mergeModels(provider, catalog).map((model) => ({
      ...model,
      hasApiKey: hasProviderApiKey || modelKeyRefs.has(providerModelRef(provider.id, model.id)),
    }));
    return {
      ...provider,
      authKind: providerAuthKind(provider),
      hasProviderApiKey,
      hasApiKey: hasProviderApiKey || models.some((model) => model.hasApiKey),
      models,
    };
  });
}

export function listManagedModels(): ManagedModelInfo[] {
  const keyRefs = new Set(listModelApiKeyRefs());
  const providerKeys = new Set(listApiKeyProviders());
  return listProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      ref: providerModelRef(provider.id, model.id),
      providerId: provider.id,
      providerLabel: provider.label,
      providerKind: provider.kind,
      providerSource: provider.source,
      providerBaseUrl: provider.baseUrl,
      providerApiFormat: provider.apiFormat,
      providerHelpUrl: provider.helpUrl,
      authKind: providerAuthKind(provider),
      modelId: model.id,
      modelLabel: model.label,
      modelSource: model.source,
      enabled: model.enabled,
      hasApiKey:
        providerKeys.has(provider.id) || keyRefs.has(providerModelRef(provider.id, model.id)),
      temperature: model.temperature,
      topP: model.topP,
      maxOutputTokens: model.maxOutputTokens,
      contextWindow: model.contextWindow,
      capabilities: model.capabilities,
      providerOptions: model.providerOptions,
      providerOptionsJson: stringifyProviderOptions(model.providerOptions),
      reasoningDefault: model.reasoningDefault,
      reasoningLevels: model.reasoningLevels,
      capabilitySources: model.capabilitySources,
      lastSyncedAt: model.lastSyncedAt,
    })),
  );
}

export function getProviderConfig(providerId: string): ProviderInfo | null {
  return listProviders().find((provider) => provider.id === providerId) ?? null;
}

/**
 * Resolve the two independent models used by Mem0. This function is intentionally
 * main-process-only because its result contains decrypted API keys.
 */
export function resolveMemoryConfiguration(): ResolvedMemoryConfiguration {
  const providers = listProviders();
  const apiKeyCache = new Map<string, string | null>();
  const llmCandidates = providers.flatMap((provider) =>
    provider.models
      .filter(
        (model) =>
          isMemoryProvider(provider) &&
          model.enabled &&
          model.hasApiKey &&
          model.capabilities.textGeneration,
      )
      .map((model) => resolveMemoryModel(provider, model, apiKeyCache))
      .filter(isResolvedMemoryModel),
  );
  const embeddingCandidates = providers.flatMap((provider) =>
    provider.models
      .filter(
        (model) =>
          isMemoryProvider(provider) &&
          model.enabled &&
          model.hasApiKey &&
          model.capabilities.embedding,
      )
      .map((model) => resolveMemoryModel(provider, model, apiKeyCache))
      .filter(isResolvedMemoryModel),
  );

  const llm =
    resolveConfiguredMemoryModel(getSetting(SettingKey.MemoryLlmModel), llmCandidates) ??
    resolveSelectedChatMemoryModel(llmCandidates) ??
    llmCandidates[0] ??
    null;
  const embedding =
    resolveConfiguredMemoryModel(
      getSetting(SettingKey.MemoryEmbeddingModel),
      embeddingCandidates,
    ) ??
    embeddingCandidates.find((candidate) => candidate?.providerId === llm?.providerId) ??
    embeddingCandidates[0] ??
    null;

  return { llm, embedding };
}

export function hasUsableMemoryConfiguration(): boolean {
  // This is called from configuration-change notifications, so it must remain
  // metadata-only. The actual API key is decrypted later by getMemory() when a
  // memory operation really needs the client.
  const providers = listProviders();
  const hasCandidate = (capability: "textGeneration" | "embedding"): boolean =>
    providers.some(
      (provider) =>
        isMemoryProvider(provider) &&
        provider.models.some(
          (model) => model.enabled && model.hasApiKey && model.capabilities[capability],
        ),
    );
  return hasCandidate("textGeneration") && hasCandidate("embedding");
}

function isMemoryProvider(provider: ProviderInfo): boolean {
  if (provider.kind !== "openai" && provider.kind !== "openai-compatible") return false;
  if (provider.authKind === "none" || !provider.baseUrl) return false;
  return (
    provider.source !== "custom" || getCustomProviderApiFormat(provider) === "chat-completions"
  );
}

function resolveMemoryModel(
  provider: ProviderInfo,
  model: ModelOption,
  apiKeyCache?: Map<string, string | null>,
): ResolvedMemoryModel | null {
  const apiKey = resolveProviderCredential(provider, model.id, apiKeyCache);
  if (!apiKey || !provider.baseUrl) return null;
  return {
    ref: providerModelRef(provider.id, model.id),
    providerId: provider.id,
    modelId: model.id,
    baseUrl: provider.baseUrl,
    apiKey,
  };
}

function isResolvedMemoryModel(model: ResolvedMemoryModel | null): model is ResolvedMemoryModel {
  return model !== null;
}

function resolveConfiguredMemoryModel(
  rawRef: string | null,
  candidates: readonly ResolvedMemoryModel[],
): ResolvedMemoryModel | null {
  const ref = rawRef?.trim();
  if (!ref) return null;
  return candidates.find((candidate) => candidate?.ref === ref) ?? null;
}

function resolveSelectedChatMemoryModel(
  candidates: readonly ResolvedMemoryModel[],
): ResolvedMemoryModel | null {
  const selectedRef = getSetting(SettingKey.SelectedModel)?.trim();
  if (!selectedRef) return null;
  return candidates.find((candidate) => candidate?.ref === selectedRef) ?? null;
}

export async function upsertCustomProvider(input: CustomProviderInput): Promise<ProviderInfo> {
  const catalog = readCatalog();
  const label = input.label.trim();
  if (!label) throw new Error("Provider label is required");

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("Base URL is required");

  // The provider ID is optional in the form. Empty or whitespace-only values
  // should fall back to a stable identifier instead of being treated as an
  // explicitly supplied (but invalid) ID. Prefer the display name and use the
  // endpoint hostname for labels that do not contain ASCII identifier chars.
  const requestedId = typeof input.id === "string" ? input.id.trim() : "";
  const id =
    normalizeProviderId(requestedId || label) ||
    normalizeProviderId(new URL(baseUrl).hostname) ||
    "provider";

  // Existing custom records may collide with a newly introduced built-in. Keep
  // them editable; only reject attempts to create a fresh built-in collision.
  const existing = catalog.providers.find((provider) => provider.id === id);
  if (BUILTIN_PROVIDERS.some((provider) => provider.id === id) && !existing) {
    throw new Error("Built-in providers cannot be overwritten");
  }

  const now = Date.now();
  const nextProvider = {
    id,
    label,
    kind: "openai-compatible" as const,
    baseUrl,
    apiFormat: normalizeCustomProviderApiFormat(input.apiFormat),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  catalog.providers = existing
    ? catalog.providers.map((provider) => (provider.id === id ? nextProvider : provider))
    : [...catalog.providers, nextProvider];
  await writeCatalog(catalog);

  const saved = getProviderConfig(id);
  if (!saved) throw new Error("Failed to save provider");
  return saved;
}

export async function deleteCustomProvider(providerId: string): Promise<void> {
  const id = normalizeProviderId(providerId);
  const catalog = readCatalog();
  const existing = catalog.providers.find((provider) => provider.id === id);
  if (!existing && BUILTIN_PROVIDERS.some((provider) => provider.id === id)) {
    throw new Error("Built-in providers cannot be modified");
  }
  if (!existing) throw new Error("Custom provider not found");

  catalog.providers = catalog.providers.filter((provider) => provider.id !== id);
  catalog.models = catalog.models.filter((model) => model.providerId !== id);
  catalog.modelStates = catalog.modelStates.filter((state) => state.providerId !== id);
  await writeCatalog(catalog);
  await deleteApiKey(id);
  await deleteModelApiKeysForProvider(id);
}

export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  const normalizedProviderId = normalizeProviderId(providerId);
  const key = apiKey.trim();
  if (!key) throw new Error("API key is required");
  const provider = getProviderConfig(normalizedProviderId);
  if (!provider) throw new Error("Unknown provider: " + normalizedProviderId);
  if (providerAuthKind(provider) === "none") {
    throw new Error("This provider does not use an API key");
  }
  await setApiKey(normalizedProviderId, key);
}

export async function clearProviderApiKey(providerId: string): Promise<void> {
  const normalizedProviderId = normalizeProviderId(providerId);
  const provider = getProviderConfig(normalizedProviderId);
  if (!provider) throw new Error("Unknown provider: " + normalizedProviderId);
  if (providerAuthKind(provider) === "none") {
    throw new Error("This provider does not use an API key");
  }
  await deleteApiKey(normalizedProviderId);
}

export function resolveProviderApiKeyFallback({
  providerId,
  modelId,
  providerKey,
  legacyModelRefs,
  getLegacyModelKey,
}: {
  providerId: string;
  modelId?: string;
  providerKey: string | null;
  legacyModelRefs: string[];
  getLegacyModelKey: (modelId: string) => string | null;
}): string | null {
  if (providerKey) return providerKey;
  if (modelId) return getLegacyModelKey(modelId);
  const prefix = providerId + "/";
  const legacyRef = legacyModelRefs.find((ref) => ref.startsWith(prefix));
  return legacyRef ? getLegacyModelKey(legacyRef.slice(prefix.length)) : null;
}

function getProviderOrLegacyModelApiKey(
  providerId: string,
  modelId?: string,
  apiKeyCache?: Map<string, string | null>,
): string | null {
  const providerCacheKey = providerId + "\u0000<provider>";
  const cachedProviderKey = apiKeyCache?.get(providerCacheKey);
  const providerKey =
    cachedProviderKey !== undefined || apiKeyCache?.has(providerCacheKey)
      ? cachedProviderKey
      : getApiKey(providerId);
  apiKeyCache?.set(providerCacheKey, providerKey ?? null);
  if (providerKey) return providerKey;

  if (!modelId) {
    const legacyRefs = listModelApiKeyRefs();
    const legacyRef = legacyRefs.find((ref) => ref.startsWith(providerId + "/"));
    return legacyRef ? getModelApiKey(providerId, legacyRef.slice(providerId.length + 1)) : null;
  }

  const cacheKey = providerId + "\u0000" + modelId;
  const cached = apiKeyCache?.get(cacheKey);
  if (cached !== undefined || apiKeyCache?.has(cacheKey)) return cached ?? null;

  const value = resolveProviderApiKeyFallback({
    providerId,
    modelId,
    providerKey: null,
    legacyModelRefs: listModelApiKeyRefs(),
    getLegacyModelKey: (id) => getModelApiKey(providerId, id),
  });
  apiKeyCache?.set(cacheKey, value);
  return value;
}

function resolveProviderCredential(
  provider: ProviderInfo,
  modelId?: string,
  apiKeyCache?: Map<string, string | null>,
): string | undefined {
  if (providerAuthKind(provider) === "none") return undefined;
  return getProviderOrLegacyModelApiKey(provider.id, modelId, apiKeyCache) ?? undefined;
}

function providerNeedsApiKey(provider: ProviderInfo): boolean {
  return providerAuthKind(provider) !== "none";
}

export async function initializeBuiltinProviderCatalog(): Promise<void> {
  await ensureOpenCodeFreeCatalog();
  await ensureDefaultSelectedModel();
}

export async function refreshBuiltinProviderCatalog(): Promise<ProviderModelSyncResult> {
  try {
    const result = await refreshOpenCodeFreeCatalog();
    await ensureDefaultSelectedModel();
    notifyProviderCatalogUpdated(OPENCODE_FREE_PROVIDER_ID);
    const provider = getProviderConfig(OPENCODE_FREE_PROVIDER_ID);
    if (!provider) throw new Error("Failed to save provider");
    return {
      provider,
      discovered: result.discovered,
      added: result.added,
      updated: result.updated,
      updatedCapabilities: result.updatedCapabilities,
    };
  } catch (error) {
    console.warn(
      "[providers] OpenCode Free catalog refresh failed:",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

export function subscribeProviderCatalogUpdated(
  listener: (providerId: string) => void,
): () => void {
  providerCatalogListeners.add(listener);
  return () => providerCatalogListeners.delete(listener);
}

const providerCatalogListeners = new Set<(providerId: string) => void>();

function notifyProviderCatalogUpdated(providerId: string): void {
  for (const listener of providerCatalogListeners) listener(providerId);
}

async function ensureDefaultSelectedModel(): Promise<void> {
  const selectedModel = getApiSetting(SettingKey.SelectedModel);
  const providers = listProviders();
  const selectedIsValid = selectedModel
    ? providers.some((provider) =>
        provider.models.some(
          (model) => model.enabled && providerModelRef(provider.id, model.id) === selectedModel,
        ),
      )
    : false;
  if (selectedIsValid) return;
  const defaultModel = providers
    .find((provider) => provider.id === OPENCODE_FREE_PROVIDER_ID)
    ?.models.find((model) => model.enabled);
  await setSetting(
    SettingKey.SelectedModel,
    defaultModel ? providerModelRef(OPENCODE_FREE_PROVIDER_ID, defaultModel.id) : "",
  );
}

function getApiSetting(key: string): string | null {
  return getSetting(key);
}

export interface RemoteModelInfo {
  id: string;
  label?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: Partial<ModelCapabilities>;
  capabilitySources?: ModelCapabilitySources;
  reasoningLevels?: ChatReasoningLevel[];
  reasoningDefault?: ChatReasoningLevel;
}

export function inferModelCapabilities(modelId: string): ModelCapabilities {
  const lower = modelId.toLowerCase();
  const embedding = /embed|embedding/.test(lower);
  const speechOutput = /(^|[-_/])tts([-_/]|$)|gpt-4o-mini-tts|gemini[-_.\w]*tts/.test(lower);
  const transcription = /whisper|transcribe|transcription/.test(lower);
  const videoOnly = /(^|[-_/])veo([-_/]|$)|video/.test(lower);
  const imageOutput = /gpt-image|dall-e|imagen|gemini[-_.\w]*image|(^|[-_/])image([-_/]|$)/.test(
    lower,
  );
  const pureImage = /gpt-image|dall-e|imagen/.test(lower);
  const textGeneration = !embedding && !speechOutput && !transcription && !videoOnly && !pureImage;
  return {
    textGeneration,
    vision:
      textGeneration &&
      /\bvision\b|gpt-4o|gpt-5|gemini|claude-3|claude-sonnet|claude-opus/.test(lower),
    imageOutput,
    speechOutput,
    transcription,
    toolCalling: textGeneration && !imageOutput,
    reasoning:
      textGeneration &&
      /(^|[-_/])(o1|o3|o4)([-_/]|$)|reason|thinking|deepseek-reasoner|gpt-5/.test(lower),
    embedding,
  };
}

function readStringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.map((value) => primitiveToString(value).toLowerCase()).filter(Boolean)
    : [];
}

function readFiniteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}

function providerCapabilityMetadata(raw: Record<string, unknown>): {
  capabilities: Partial<ModelCapabilities>;
  capabilitySources: ModelCapabilitySources;
} {
  const capabilities: Partial<ModelCapabilities> = {};
  const capabilitySources: ModelCapabilitySources = {};
  const rawCapabilities = isPlainJsonObject(raw.capabilities) ? raw.capabilities : {};
  const architecture = isPlainJsonObject(raw.architecture) ? raw.architecture : {};
  const inputModalities = readStringList(
    raw.input_modalities ?? raw.inputModalities ?? architecture.input_modalities,
  );
  const outputModalities = readStringList(
    raw.output_modalities ?? raw.outputModalities ?? architecture.output_modalities,
  );
  const supportedParameters = readStringList(raw.supported_parameters ?? raw.supportedParameters);
  const supportedMethods = readStringList(
    raw.supported_generation_methods ?? raw.supportedGenerationMethods,
  );

  for (const key of MODEL_CAPABILITY_KEYS) {
    if (typeof rawCapabilities[key] === "boolean") {
      capabilities[key] = rawCapabilities[key] as boolean;
      capabilitySources[key] = "provider";
    }
  }

  const setCapability = (key: ModelCapabilityKey, value: boolean): void => {
    if (capabilities[key] !== undefined) return;
    capabilities[key] = value;
    capabilitySources[key] = "provider";
  };

  if (inputModalities.length > 0) {
    setCapability(
      "vision",
      inputModalities.some((item) => item.includes("image")),
    );
  }
  if (outputModalities.length > 0) {
    setCapability(
      "textGeneration",
      outputModalities.some((item) => item.includes("text")),
    );
    setCapability(
      "imageOutput",
      outputModalities.some((item) => item.includes("image")),
    );
    setCapability(
      "speechOutput",
      outputModalities.some((item) => item.includes("audio")),
    );
  }
  if (supportedMethods.length > 0) {
    if (supportedMethods.some((item) => /generatecontent|chat|completion/.test(item))) {
      setCapability("textGeneration", true);
    }
    if (supportedMethods.some((item) => /embed|embedding/.test(item))) {
      setCapability("embedding", true);
    }
    if (supportedMethods.some((item) => /transcrib|speech_to_text/.test(item))) {
      setCapability("transcription", true);
    }
    if (supportedMethods.some((item) => item === "predict" || /image/.test(item))) {
      setCapability("imageOutput", true);
    }
  }
  if (supportedParameters.some((item) => /tool|function/.test(item))) {
    setCapability("toolCalling", true);
  }
  if (supportedParameters.some((item) => /reasoning|thinking|include_reasoning/.test(item))) {
    setCapability("reasoning", true);
  }

  return { capabilities, capabilitySources };
}

function reasoningMetadata(raw: Record<string, unknown>): {
  reasoningLevels?: ChatReasoningLevel[];
  reasoningDefault?: ChatReasoningLevel;
} {
  const nested = isPlainJsonObject(raw.reasoning) ? raw.reasoning : {};
  const levels =
    raw.reasoning_levels ??
    raw.reasoningLevels ??
    raw.supported_reasoning_levels ??
    raw.supportedReasoningLevels ??
    nested.levels;
  const reasoningLevels = Array.isArray(levels)
    ? levels.filter((value): value is ChatReasoningLevel => isChatReasoningLevel(value))
    : undefined;
  const defaultValue =
    raw.reasoning_default ??
    raw.reasoningDefault ??
    raw.default_reasoning_level ??
    raw.defaultReasoningLevel ??
    nested.default;
  const reasoningDefault = isChatReasoningLevel(defaultValue) ? defaultValue : undefined;
  return { reasoningLevels, reasoningDefault };
}

function inferContextWindow(modelId: string): number {
  const lower = modelId.toLowerCase();
  if (lower.includes("gemini-1.5") || lower.includes("gemini-2")) return 1_000_000;
  if (lower.includes("claude")) return 200_000;
  if (lower.includes("gpt-4o") || lower.includes("gpt-5") || /^o[134]/.test(lower)) return 128_000;
  if (lower.includes("deepseek")) return 64_000;
  return DEFAULT_MODEL_CONTEXT_WINDOW;
}

export function normalizeRemoteModels(models: RemoteModelInfo[]): RemoteModelInfo[] {
  const byId = new Map<string, RemoteModelInfo>();
  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    const inferredCapabilities = inferModelCapabilities(id);
    const suppliedCapabilities = model.capabilities ?? {};
    const capabilities = normalizeCapabilities({
      ...inferredCapabilities,
      ...suppliedCapabilities,
    });
    const capabilitySources = normalizeCapabilitySources(model.capabilitySources);
    for (const key of MODEL_CAPABILITY_KEYS) {
      capabilitySources[key] ??= Object.prototype.hasOwnProperty.call(suppliedCapabilities, key)
        ? "provider"
        : "inferred";
    }
    const reasoningLevels = normalizeReasoningLevels(model.reasoningLevels, capabilities);
    const contextWindow =
      model.contextWindow === undefined ? undefined : normalizeContextWindow(model.contextWindow);
    const maxOutputTokens =
      model.maxOutputTokens === undefined
        ? undefined
        : normalizeMaxOutputTokens(model.maxOutputTokens);
    byId.set(id, {
      ...model,
      id,
      label: normalizeOptionalText(model.label),
      contextWindow,
      maxOutputTokens,
      capabilities,
      capabilitySources,
      reasoningLevels,
      reasoningDefault: normalizeReasoningDefault(model.reasoningDefault, reasoningLevels),
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function parseOpenAIModelListResponse(json: unknown): RemoteModelInfo[] {
  const data = (json as { data?: Array<Record<string, unknown>> }).data;
  return normalizeRemoteModels(
    (Array.isArray(data) ? data : []).map((item) => {
      const id = primitiveToString(item.id ?? item.name);
      const metadata = providerCapabilityMetadata(item);
      return {
        id,
        label: normalizeOptionalText(item.display_name ?? item.displayName ?? item.name),
        contextWindow: readFiniteNumber(
          item.context_length,
          item.contextWindow,
          item.context_window,
          item.max_context_length,
        ),
        maxOutputTokens: readFiniteNumber(
          item.max_output_tokens,
          item.maxOutputTokens,
          item.max_completion_tokens,
          item.maxCompletionTokens,
          item.output_token_limit,
          item.outputTokenLimit,
        ),
        capabilities: metadata.capabilities,
        capabilitySources: metadata.capabilitySources,
        ...reasoningMetadata(item),
      };
    }),
  );
}

export function parseAnthropicModelListResponse(json: unknown): RemoteModelInfo[] {
  const data = (json as { data?: Array<Record<string, unknown>> }).data;
  return normalizeRemoteModels(
    (Array.isArray(data) ? data : []).map((item) => {
      const metadata = providerCapabilityMetadata(item);
      return {
        id: primitiveToString(item.id),
        label: normalizeOptionalText(item.display_name ?? item.name),
        contextWindow: readFiniteNumber(
          item.context_window,
          item.contextWindow,
          item.input_token_limit,
          item.max_input_tokens,
          item.maxInputTokens,
        ),
        maxOutputTokens: readFiniteNumber(
          item.max_output_tokens,
          item.maxOutputTokens,
          item.output_token_limit,
          item.outputTokenLimit,
        ),
        capabilities: metadata.capabilities,
        capabilitySources: metadata.capabilitySources,
        ...reasoningMetadata(item),
      };
    }),
  );
}

export function parseGoogleModelListResponse(json: unknown): RemoteModelInfo[] {
  const models = (
    json as {
      models?: Array<Record<string, unknown>>;
    }
  ).models;
  return normalizeRemoteModels(
    (Array.isArray(models) ? models : [])
      .map((item) => {
        const name = primitiveToString(item.name).replace(/^models\//, "");
        const metadata = providerCapabilityMetadata(item);
        return {
          id: name,
          label: normalizeOptionalText(item.displayName),
          supportedGenerationMethods: item.supportedGenerationMethods,
          contextWindow: readFiniteNumber(item.inputTokenLimit, item.input_token_limit),
          maxOutputTokens: readFiniteNumber(
            item.outputTokenLimit,
            item.output_token_limit,
            item.maxOutputTokens,
            item.max_output_tokens,
          ),
          capabilities: metadata.capabilities,
          capabilitySources: metadata.capabilitySources,
          ...reasoningMetadata(item),
        };
      })
      .filter((item) => {
        if (!item.id) return false;
        const methods = item.supportedGenerationMethods;
        if (!Array.isArray(methods)) return true;
        const lowerMethods = methods.map((method) => primitiveToString(method).toLowerCase());
        const capabilities = {
          ...inferModelCapabilities(item.id),
          ...item.capabilities,
        };
        return (
          lowerMethods.includes("generatecontent") ||
          capabilities.imageOutput ||
          capabilities.speechOutput
        );
      })
      .map(({ supportedGenerationMethods: _methods, ...item }) => item),
  );
}

export function mergeRemoteModelsIntoCatalog(
  catalog: ModelCatalogSettings,
  providerId: string,
  remoteModels: RemoteModelInfo[],
  now = Date.now(),
): {
  catalog: ModelCatalogSettings;
  discovered: number;
  added: number;
  updated: number;
  updatedCapabilities: number;
} {
  const normalizedRemoteModels = normalizeRemoteModels(remoteModels);
  const nextCatalog: ModelCatalogSettings = {
    providers: catalog.providers.map((provider) => ({ ...provider })),
    models: catalog.models.map((model) => ({
      ...model,
      capabilities: { ...model.capabilities },
      providerOptions: { ...model.providerOptions },
    })),
    modelStates: catalog.modelStates.map((state) => ({ ...state })),
  };
  let added = 0;
  let updated = 0;
  let updatedCapabilities = 0;

  for (const remote of normalizedRemoteModels) {
    const existing = nextCatalog.models.find(
      (model) => model.providerId === providerId && model.id === remote.id,
    );
    if (existing) {
      const nextCapabilities = normalizeCapabilities(remote.capabilities);
      const nextReasoningLevels = normalizeReasoningLevels(
        remote.reasoningLevels,
        nextCapabilities,
      );
      const nextReasoningDefault = normalizeReasoningDefault(
        existing.reasoningDefault ?? remote.reasoningDefault,
        nextReasoningLevels,
      );
      const nextLabel = remote.label ?? existing.label;
      const nextContextWindow = remote.contextWindow ?? existing.contextWindow;
      const nextMaxOutputTokens = remote.maxOutputTokens ?? existing.maxOutputTokens;
      const capabilitiesChanged =
        JSON.stringify(existing.capabilities) !== JSON.stringify(nextCapabilities) ||
        existing.contextWindow !== nextContextWindow ||
        JSON.stringify(existing.reasoningLevels ?? []) !== JSON.stringify(nextReasoningLevels) ||
        JSON.stringify(existing.capabilitySources ?? {}) !==
          JSON.stringify(remote.capabilitySources ?? {});
      const defaultsChanged =
        existing.contextWindow !== nextContextWindow ||
        existing.maxOutputTokens !== nextMaxOutputTokens;
      const changed =
        nextLabel !== existing.label ||
        capabilitiesChanged ||
        defaultsChanged ||
        nextReasoningDefault !== (existing.reasoningDefault ?? "provider-default");
      if (changed) updated += 1;
      if (capabilitiesChanged) updatedCapabilities += 1;
      nextCatalog.models = nextCatalog.models.map((model) =>
        model.providerId === providerId && model.id === remote.id
          ? {
              ...model,
              label: nextLabel,
              contextWindow: nextContextWindow,
              maxOutputTokens: nextMaxOutputTokens,
              capabilities: nextCapabilities,
              reasoningLevels: nextReasoningLevels,
              reasoningDefault: nextReasoningDefault,
              capabilitySources: remote.capabilitySources,
              lastSyncedAt: now,
              updatedAt: changed ? now : model.updatedAt,
            }
          : model,
      );
      continue;
    }

    added += 1;
    updatedCapabilities += 1;
    const reasoningLevels = normalizeReasoningLevels(remote.reasoningLevels, remote.capabilities);
    nextCatalog.models.push({
      providerId,
      id: remote.id,
      label: remote.label,
      enabled: false,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      topP: DEFAULT_MODEL_TOP_P,
      maxOutputTokens: normalizeMaxOutputTokens(remote.maxOutputTokens),
      contextWindow: normalizeContextWindow(remote.contextWindow ?? inferContextWindow(remote.id)),
      capabilities: normalizeCapabilities(remote.capabilities ?? inferModelCapabilities(remote.id)),
      providerOptions: {},
      reasoningDefault: normalizeReasoningDefault(remote.reasoningDefault, reasoningLevels),
      reasoningLevels,
      capabilitySources: remote.capabilitySources,
      lastSyncedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    setModelState(nextCatalog, providerId, remote.id, false);
  }

  return {
    catalog: nextCatalog,
    discovered: normalizedRemoteModels.length,
    added,
    updated,
    updatedCapabilities,
  };
}

async function fetchJson(url: URL, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body.trim() ? ": " + body.trim().slice(0, 300) : "";
    throw new Error("Provider request failed (" + response.status + ")" + detail);
  }
  return response.json();
}

async function fetchRemoteModels(
  provider: ProviderInfo,
  apiKey?: string,
): Promise<RemoteModelInfo[]> {
  const customApiFormat = getCustomProviderApiFormat(provider);
  if (customApiFormat) {
    if (!provider.baseUrl) throw new Error(provider.label + " base URL is not configured.");
    const url = new URL(provider.baseUrl.replace(/\/+$/, "") + "/models");
    const headers: Record<string, string> =
      customApiFormat === "anthropic-messages"
        ? {
            "x-api-key": apiKey ?? "",
            "anthropic-version": "2023-06-01",
          }
        : apiKey
          ? { Authorization: "Bearer " + apiKey }
          : {};
    const json = await fetchJson(url, { headers });
    return customApiFormat === "anthropic-messages"
      ? parseAnthropicModelListResponse(json)
      : parseOpenAIModelListResponse(json);
  }

  switch (provider.kind) {
    case "openai":
    case "openai-compatible": {
      if (!provider.baseUrl) throw new Error(provider.label + " base URL is not configured.");
      const url = new URL(provider.baseUrl.replace(/\/+$/, "") + "/models");
      const json = await fetchJson(url, {
        headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
      });
      return parseOpenAIModelListResponse(json);
    }
    case "anthropic": {
      const url = new URL("https://api.anthropic.com/v1/models");
      const json = await fetchJson(url, {
        headers: {
          "x-api-key": apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
      });
      return parseAnthropicModelListResponse(json);
    }
    case "google": {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey ?? "");
      const json = await fetchJson(url, {});
      return parseGoogleModelListResponse(json);
    }
  }
}

export async function testProvider(providerId: string): Promise<ProviderTestResult> {
  const id = normalizeProviderId(providerId);
  const provider = getProviderConfig(id);
  if (!provider) throw new Error("Unknown provider: " + id);

  try {
    const apiKey = resolveProviderCredential(provider);
    if (providerNeedsApiKey(provider) && !apiKey) throw new Error("API key is required");
    const models = await fetchRemoteModels(provider, apiKey);
    return {
      ok: true,
      providerId: id,
      checkedModels: models.length,
      message: "Provider is available.",
    };
  } catch (error) {
    return {
      ok: false,
      providerId: id,
      checkedModels: 0,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncAvailableModels(providerId: string): Promise<ProviderModelSyncResult> {
  const id = normalizeProviderId(providerId);
  const provider = getProviderConfig(id);
  if (!provider) throw new Error("Unknown provider: " + id);

  if (id === OPENCODE_FREE_PROVIDER_ID) return refreshBuiltinProviderCatalog();

  const apiKey = getProviderOrLegacyModelApiKey(id);
  if (!apiKey) throw new Error("API key is required");

  const remoteModels = await fetchRemoteModels(provider, apiKey);
  const result = mergeRemoteModelsIntoCatalog(readCatalog(), id, remoteModels);
  await writeCatalog(result.catalog);
  const saved = getProviderConfig(id);
  if (!saved) throw new Error("Failed to save provider");
  return {
    provider: saved,
    discovered: result.discovered,
    added: result.added,
    updated: result.updated,
    updatedCapabilities: result.updatedCapabilities,
  };
}

export async function upsertCustomModel(input: CustomModelInput): Promise<ProviderInfo> {
  const providerId = normalizeProviderId(input.providerId);
  const providerConfig = getProviderConfig(providerId);
  if (!providerConfig) throw new Error("Unknown provider: " + providerId);
  if (providerConfig.id === OPENCODE_FREE_PROVIDER_ID) {
    throw new Error("Built-in providers cannot be modified");
  }

  const modelId = input.id.trim();
  if (!modelId) throw new Error("Model id is required");

  const catalog = readCatalog();
  const existing = catalog.models.find(
    (model) => model.providerId === providerId && model.id === modelId,
  );
  const now = Date.now();
  const providerOptions =
    parseProviderOptionsJson(input.providerOptionsJson) ??
    (input.providerOptions !== undefined
      ? normalizeProviderOptions(input.providerOptions)
      : existing?.providerOptions);
  const capabilities = normalizeCapabilities(input.capabilities ?? existing?.capabilities);
  const reasoningLevels = normalizeReasoningLevels(
    input.reasoningLevels ?? existing?.reasoningLevels,
    capabilities,
  );
  const capabilitySources = normalizeCapabilitySources(
    input.capabilitySources ?? existing?.capabilitySources,
  );
  if (input.capabilities) {
    for (const key of MODEL_CAPABILITY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(input.capabilities, key)) {
        capabilitySources[key] = input.capabilitySources?.[key] ?? "manual";
      }
    }
  }
  const nextModel = {
    providerId,
    id: modelId,
    label: normalizeOptionalText(input.label),
    enabled: input.enabled ?? existing?.enabled ?? true,
    temperature: normalizeTemperature(input.temperature ?? existing?.temperature),
    topP: normalizeTopP(input.topP ?? existing?.topP),
    maxOutputTokens: normalizeMaxOutputTokens(input.maxOutputTokens ?? existing?.maxOutputTokens),
    contextWindow: normalizeContextWindow(input.contextWindow ?? existing?.contextWindow),
    capabilities,
    providerOptions: normalizeProviderOptions(providerOptions ?? {}),
    reasoningDefault: normalizeReasoningDefault(
      input.reasoningDefault ?? existing?.reasoningDefault,
      reasoningLevels,
    ),
    reasoningLevels,
    capabilitySources,
    lastSyncedAt: existing?.lastSyncedAt,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  catalog.models = existing
    ? catalog.models.map((model) =>
        model.providerId === providerId && model.id === modelId ? nextModel : model,
      )
    : [...catalog.models, nextModel];
  setModelState(catalog, providerId, modelId, nextModel.enabled);
  await writeCatalog(catalog);

  const savedProvider = getProviderConfig(providerId);
  if (!savedProvider) throw new Error("Failed to save model");
  return savedProvider;
}

export async function updateModelEnabled(
  providerId: string,
  modelId: string,
  enabled: boolean,
): Promise<void> {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  if (normalizedProviderId === OPENCODE_FREE_PROVIDER_ID) {
    await setOpenCodeFreeModelEnabled(normalizedModelId, enabled);
    await ensureDefaultSelectedModel();
    notifyProviderCatalogUpdated(OPENCODE_FREE_PROVIDER_ID);
    return;
  }
  assertKnownModel(normalizedProviderId, normalizedModelId);

  const catalog = readCatalog();
  setModelState(catalog, normalizedProviderId, normalizedModelId, enabled);
  await writeCatalog(catalog);
}

export async function saveModelApiKey(
  providerId: string,
  modelId: string,
  apiKey: string,
): Promise<void> {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  const key = apiKey.trim();
  if (!key) throw new Error("API key is required");
  const provider = getProviderConfig(normalizedProviderId);
  if (!provider) throw new Error("Unknown provider: " + normalizedProviderId);
  if (!providerNeedsApiKey(provider)) throw new Error("This provider does not use an API key");
  assertKnownModel(normalizedProviderId, normalizedModelId);
  await setModelApiKey(normalizedProviderId, normalizedModelId, key);
}

export async function clearModelApiKey(providerId: string, modelId: string): Promise<void> {
  const normalizedProviderId = normalizeProviderId(providerId);
  const provider = getProviderConfig(normalizedProviderId);
  if (!provider) throw new Error("Unknown provider: " + normalizedProviderId);
  if (!providerNeedsApiKey(provider)) throw new Error("This provider does not use an API key");
  await deleteModelApiKey(normalizedProviderId, modelId.trim());
}

export async function deleteCustomModel(providerId: string, modelId: string): Promise<void> {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  const provider = getProviderConfig(normalizedProviderId);
  if (provider?.source === "builtin") throw new Error("Built-in providers cannot be modified");
  const catalog = readCatalog();
  const before = catalog.models.length;
  catalog.models = catalog.models.filter(
    (model) => !(model.providerId === normalizedProviderId && model.id === normalizedModelId),
  );
  if (catalog.models.length === before) throw new Error("Custom model not found");
  removeModelState(catalog, normalizedProviderId, normalizedModelId);
  await writeCatalog(catalog);
  await deleteModelApiKey(normalizedProviderId, normalizedModelId);
}

export async function migrateProviderApiKeysToModelKeys(): Promise<void> {
  for (const provider of listProviders()) {
    if (getApiKey(provider.id)) continue;
    const legacyKey = getProviderOrLegacyModelApiKey(provider.id);
    if (legacyKey) await setApiKey(provider.id, legacyKey);
  }
  await clearInvalidSelectedModel();
}

export function resolveMediaModel(
  modelRef: string,
  kind: "image",
): Extract<ResolvedMediaModelConfig, { kind: "image" }>;
export function resolveMediaModel(
  modelRef: string,
  kind: "speech",
): Extract<ResolvedMediaModelConfig, { kind: "speech" }>;
export function resolveMediaModel(
  modelRef: string,
  kind: "transcription",
): Extract<ResolvedMediaModelConfig, { kind: "transcription" }>;

export function resolveMediaModel(
  modelRef: string,
  kind: MediaGenerationKind,
): ResolvedMediaModelConfig {
  const { providerId, modelId } = parseModelRef(modelRef);
  const config = getProviderConfig(providerId);
  if (!config) throw new Error("Unknown provider: " + providerId);

  const model = config.models.find((item) => item.id === modelId);
  if (!model) throw new Error("Unknown model: " + modelRef);
  if (!model.enabled) throw new Error((model.label ?? model.id) + " is disabled.");
  if (!modelSupportsMediaKind(model.capabilities, kind)) {
    throw new Error((model.label ?? model.id) + " does not support " + kind + ".");
  }

  const apiKey = resolveProviderCredential(config, modelId);
  if (providerNeedsApiKey(config) && !apiKey) {
    throw new Error(
      config.label + " API key is not configured. Please add it in model management.",
    );
  }

  return {
    kind,
    model: createMediaModel(config, apiKey, modelId, kind),
    providerId,
    providerKind: config.kind,
    modelId,
    capabilities: model.capabilities,
    providerOptions: model.providerOptions as ProviderOptions,
  } as ResolvedMediaModelConfig;
}

function parseModelRef(modelRef: string): { providerId: string; modelId: string } {
  const slashIdx = modelRef.indexOf("/");
  if (slashIdx <= 0) {
    throw new Error(
      "Invalid model reference " + JSON.stringify(modelRef) + "; expected provider/model",
    );
  }
  const providerId = normalizeProviderId(modelRef.slice(0, slashIdx));
  const modelId = modelRef.slice(slashIdx + 1).trim();
  if (!modelId) {
    throw new Error(
      "Invalid model reference " + JSON.stringify(modelRef) + "; expected provider/model",
    );
  }
  return { providerId, modelId };
}

function modelSupportsMediaKind(
  capabilities: ModelCapabilities,
  kind: MediaGenerationKind,
): boolean {
  switch (kind) {
    case "image":
      return capabilities.imageOutput;
    case "speech":
      return capabilities.speechOutput;
    case "transcription":
      return capabilities.transcription;
  }
}

function createMediaModel(
  config: ProviderInfo,
  apiKey: string | undefined,
  modelId: string,
  kind: MediaGenerationKind,
): ImageModel | SpeechModel | TranscriptionModel {
  if (getCustomProviderApiFormat(config) === "anthropic-messages") {
    throw new Error("Custom Anthropic Messages providers do not support media generation.");
  }

  switch (config.kind) {
    case "openai": {
      if (!config.baseUrl) throw new Error(config.label + " base URL is not configured.");
      const provider = createOpenAI({
        apiKey: apiKey ?? "",
        baseURL: config.baseUrl,
        name: config.id,
      });
      switch (kind) {
        case "image":
          return provider.image(modelId);
        case "speech":
          return provider.speech(modelId);
        case "transcription":
          return provider.transcription(modelId);
      }
      break;
    }
    case "openai-compatible": {
      if (providerAuthKind(config) === "none") {
        throw new Error(config.label + " does not support media generation.");
      }
      if (!config.baseUrl) throw new Error(config.label + " base URL is not configured.");
      const provider = createOpenAI({
        apiKey: apiKey ?? "",
        baseURL: config.baseUrl,
        name: config.id,
      });
      switch (kind) {
        case "image":
          return provider.image(modelId);
        case "speech":
          return provider.speech(modelId);
        case "transcription":
          return provider.transcription(modelId);
      }
      break;
    }
    case "google": {
      const provider = createGoogle({ apiKey: apiKey ?? "" });
      switch (kind) {
        case "image":
          return provider.image(modelId);
        case "speech":
          return provider.speech(modelId);
        case "transcription":
          throw new Error("Google transcription is not available in this build.");
      }
      break;
    }
    case "anthropic":
      throw new Error("Anthropic does not support media generation in this build.");
  }
}

export function resolveModel(modelRef: string): ResolvedModelConfig {
  const { providerId, modelId } = parseModelRef(modelRef);

  const config = getProviderConfig(providerId);
  if (!config) throw new Error("Unknown provider: " + providerId);

  const model = config.models.find((item) => item.id === modelId);
  if (!model) throw new Error("Unknown model: " + modelRef);
  if (!model.enabled) throw new Error((model.label ?? model.id) + " is disabled.");
  if (!model.capabilities.textGeneration) {
    throw new Error((model.label ?? model.id) + " does not support text generation.");
  }

  const apiKey = resolveProviderCredential(config, modelId);
  if (providerNeedsApiKey(config) && !apiKey) {
    throw new Error(
      config.label + " API key is not configured. Please add it in model management.",
    );
  }

  const customApiFormat = getCustomProviderApiFormat(config);
  const providerOptions =
    customApiFormat && customApiFormat !== "chat-completions"
      ? (model.providerOptions as ProviderOptions)
      : config.kind === "openai-compatible"
        ? normalizeOpenAICompatibleProviderOptions(config.id, model.providerOptions)
        : (model.providerOptions as ProviderOptions);

  return {
    model: createLanguageModel(config, apiKey, modelId),
    providerId,
    providerKind: config.kind,
    modelId,
    capabilities: model.capabilities,
    reasoningDefault: model.reasoningDefault,
    reasoningLevels: model.reasoningLevels,
    capabilitySources: model.capabilitySources,
    lastSyncedAt: model.lastSyncedAt,
    temperature: model.temperature,
    topP: model.topP,
    maxOutputTokens: model.maxOutputTokens,
    contextWindow: model.contextWindow,
    providerOptions,
    nativeTools: createNativeChatTools(config, apiKey, modelId, model.providerOptions),
    countInputTokens:
      config.kind === "openai"
        ? (input) => countOpenAIInputTokens(config.baseUrl, apiKey ?? "", modelId, input)
        : undefined,
  };
}

async function countOpenAIInputTokens(
  baseUrl: string | undefined,
  apiKey: string,
  modelId: string,
  input: ExactTokenCountInput,
): Promise<number> {
  const endpoint = `${(baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "")}/responses/input_tokens`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      instructions: input.staticInstructions,
      input: input.messages.map((message) => ({
        role: message.role,
        content:
          typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI input token count failed (${response.status}).`);
  }
  const body = (await response.json()) as { input_tokens?: unknown };
  if (typeof body.input_tokens !== "number" || !Number.isFinite(body.input_tokens)) {
    throw new Error("OpenAI input token count returned an invalid response.");
  }
  return body.input_tokens;
}

function createLanguageModel(
  config: ProviderInfo,
  apiKey: string | undefined,
  modelId: string,
): LanguageModel {
  const customApiFormat = getCustomProviderApiFormat(config);
  if (customApiFormat) {
    if (!config.baseUrl) throw new Error(config.label + " base URL is not configured.");
    switch (customApiFormat) {
      case "chat-completions":
        return createOpenAICompatible({
          apiKey,
          baseURL: config.baseUrl,
          name: config.id,
          includeUsage: true,
        })(modelId);
      case "responses":
        return createOpenAI({
          apiKey: apiKey ?? "",
          baseURL: config.baseUrl,
          name: config.id,
        }).responses(modelId);
      case "anthropic-messages":
        return createAnthropic({
          apiKey: apiKey ?? "",
          baseURL: config.baseUrl,
          name: config.id,
        }).messages(modelId);
    }
  }

  switch (config.kind) {
    case "openai":
      return createOpenAI({ apiKey: apiKey ?? "", baseURL: config.baseUrl, name: config.id })(
        modelId,
      );
    case "openai-compatible":
      if (!config.baseUrl) throw new Error(config.label + " base URL is not configured.");
      return createOpenAICompatible({
        apiKey,
        baseURL: config.baseUrl,
        name: config.id,
        includeUsage: true,
      })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: apiKey ?? "" })(modelId);
    case "google":
      return createGoogle({ apiKey: apiKey ?? "" })(modelId);
  }
}

/**
 * The compatible provider used to be backed by the OpenAI adapter, so saved
 * model options used the `openai` namespace. Keep those settings working when
 * the model is served by the official OpenAI-compatible adapter.
 */
export function normalizeOpenAICompatibleProviderOptions(
  providerId: string,
  providerOptions: JsonObject,
): ProviderOptions {
  const legacy = providerOptions.openai;
  if (!isPlainJsonObject(legacy)) return providerOptions as ProviderOptions;

  const compatible = isPlainJsonObject(providerOptions.openaiCompatible)
    ? providerOptions.openaiCompatible
    : {};
  const providerSpecific = isPlainJsonObject(providerOptions[providerId])
    ? providerOptions[providerId]
    : {};

  return {
    ...providerOptions,
    openaiCompatible: { ...legacy, ...compatible },
    [providerId]: { ...legacy, ...providerSpecific },
  } as ProviderOptions;
}

function createNativeChatTools(
  config: ProviderInfo,
  apiKey: string | undefined,
  modelId: string,
  providerOptions: JsonObject,
): NativeChatTool[] {
  switch (config.kind) {
    case "openai": {
      const provider = createOpenAI({
        apiKey: apiKey ?? "",
        baseURL: config.baseUrl,
        name: config.id,
      });
      const tools: NativeChatTool[] = [
        {
          id: "web_search",
          toolName: "web_search",
          tool: provider.tools.webSearch({
            externalWebAccess: true,
            searchContextSize: "medium",
          }),
          providerExecuted: true,
        },
      ];
      const hosted = readOpenAIHostedToolOptions(providerOptions);
      if (hosted.codeInterpreter !== false && isLikelyOpenAIResponsesModel(modelId)) {
        tools.push({
          id: "code_interpreter",
          toolName: "code_interpreter",
          tool: provider.tools.codeInterpreter(hosted.codeInterpreterOptions),
          providerExecuted: true,
        });
      }
      if (hosted.vectorStoreIds.length > 0) {
        tools.push({
          id: "file_search",
          toolName: "file_search",
          tool: provider.tools.fileSearch({
            vectorStoreIds: hosted.vectorStoreIds,
            maxNumResults: hosted.maxNumResults,
          }),
          providerExecuted: true,
        });
      }
      if (hosted.toolSearch === true) {
        tools.push({
          id: "tool_search",
          toolName: "tool_search",
          tool: provider.tools.toolSearch(),
          providerExecuted: true,
        });
      }
      return tools;
    }
    case "anthropic": {
      const provider = createAnthropic({ apiKey: apiKey ?? "" });
      return [
        {
          id: "web_search",
          toolName: "web_search",
          tool: provider.tools.webSearch_20250305({ maxUses: 5 }),
          providerExecuted: true,
        },
      ];
    }
    case "google": {
      const provider = createGoogle({ apiKey: apiKey ?? "" });
      return [
        {
          id: "web_search",
          toolName: "google_search",
          tool: provider.tools.googleSearch({ searchTypes: { webSearch: {} } }),
          providerExecuted: true,
        },
      ];
    }
    case "openai-compatible":
      return [];
  }
}

interface OpenAIHostedToolOptions {
  codeInterpreter?: boolean;
  codeInterpreterOptions?: { container?: string | { fileIds?: string[] } };
  vectorStoreIds: string[];
  maxNumResults?: number;
  toolSearch?: boolean;
}

function readOpenAIHostedToolOptions(raw: JsonObject): OpenAIHostedToolOptions {
  const source = isPlainJsonObject(raw.openaiTools)
    ? raw.openaiTools
    : isPlainJsonObject(raw.openai)
      ? raw.openai
      : {};
  const vectorStoreIds = Array.isArray(source.vectorStoreIds)
    ? source.vectorStoreIds.filter(
        (value): value is string => typeof value === "string" && value.trim() !== "",
      )
    : [];
  const codeInterpreterOptions = isPlainJsonObject(source.codeInterpreterOptions)
    ? source.codeInterpreterOptions
    : undefined;
  const maxNumResults =
    typeof source.maxNumResults === "number" && Number.isFinite(source.maxNumResults)
      ? Math.max(1, Math.min(50, Math.floor(source.maxNumResults)))
      : undefined;
  return {
    codeInterpreter: source.codeInterpreter !== false,
    codeInterpreterOptions:
      codeInterpreterOptions as OpenAIHostedToolOptions["codeInterpreterOptions"],
    vectorStoreIds,
    maxNumResults,
    toolSearch: source.toolSearch === true,
  };
}

function isLikelyOpenAIResponsesModel(modelId: string): boolean {
  return /^(gpt-|o[1-9](?:$|-)|codex)/i.test(modelId);
}
