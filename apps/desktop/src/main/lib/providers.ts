import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import type {
  experimental_generateVideo,
  ImageModel,
  LanguageModel,
  SpeechModel,
  streamText,
  TranscriptionModel,
} from "ai";
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
  type CustomModelInput,
  type CustomProviderInput,
  type ChatToolId,
  type JsonObject,
  type ManagedModelInfo,
  type MediaGenerationKind,
  type ModelCapabilities,
  type ModelCatalogSettings,
  type ModelOption,
  type ProviderModelSyncResult,
  type ProviderInfo,
  type ProviderTestResult,
} from "../../shared/types";

type ProviderConfig = Omit<ProviderInfo, "hasApiKey" | "hasProviderApiKey">;
type ProviderOptions = NonNullable<Parameters<typeof streamText>[0]["providerOptions"]>;
type VideoModel = Parameters<typeof experimental_generateVideo>[0]["model"];

const DEFAULT_MODEL_TEMPERATURE = 0.7;
const DEFAULT_MODEL_TOP_P = 1;
const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MODEL_CONTEXT_WINDOW = 32_000;

const DEFAULT_CAPABILITIES: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
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
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  providerOptions?: ProviderOptions;
  nativeTools: NativeChatTool[];
  countInputTokens?: (input: ExactTokenCountInput) => Promise<number>;
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
    }
  | {
      kind: "video";
      model: VideoModel;
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

function writeCatalog(catalog: ModelCatalogSettings): void {
  const normalized = normalizeCatalog(catalog);
  setSetting(SettingKey.ModelCatalog, JSON.stringify(normalized));
  clearInvalidSelectedModel(normalized);
}

function normalizeCatalog(raw: Partial<ModelCatalogSettings>): ModelCatalogSettings {
  const providers = Array.isArray(raw.providers)
    ? raw.providers
        .map((provider) => ({
          id: normalizeProviderId(provider.id),
          label: String(provider.label ?? "").trim(),
          kind: "openai-compatible" as const,
          baseUrl: normalizeBaseUrl(provider.baseUrl ?? ""),
          helpUrl: normalizeOptionalUrl(provider.helpUrl),
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
        .map((model) => ({
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
          capabilities: normalizeCapabilities((model as { capabilities?: unknown }).capabilities),
          providerOptions: normalizeProviderOptions(
            (model as { providerOptions?: unknown }).providerOptions,
          ),
          createdAt: Number(model.createdAt) || Date.now(),
          updatedAt: Number(model.updatedAt) || Date.now(),
        }))
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

function normalizeOptionalUrl(raw: unknown): string | undefined {
  const text = primitiveToString(raw).trim();
  if (!text) return undefined;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Help URL must start with http:// or https://");
  }
  return url.toString();
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
  const videoOutput = value.videoOutput === true;
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
      : !embedding && !imageOutput && !speechOutput && !transcription && !videoOutput;
  return {
    textGeneration,
    vision: value.vision === true,
    imageOutput,
    speechOutput,
    transcription,
    videoOutput,
    toolCalling: textGeneration && value.toolCalling !== false,
    reasoning: value.reasoning === true,
    embedding,
    toolCapabilities,
  };
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
  const model = catalog.models.find(
    (item) => item.providerId === providerId && item.id === modelId,
  );
  return !!model && isModelEnabled(catalog, providerId, modelId);
}

function clearInvalidSelectedModel(catalog = readCatalog()): void {
  const selectedModel = getSetting(SettingKey.SelectedModel);
  if (selectedModel && !isSelectedModelValid(catalog, selectedModel)) {
    setSetting(SettingKey.SelectedModel, "");
  }
}

function assertKnownProvider(providerId: string): void {
  if (!listProviders().some((provider) => provider.id === providerId)) {
    throw new Error("Unknown provider: " + providerId);
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
  const modelKeyRefs = listModelApiKeyRefs();
  const customProviders: ProviderConfig[] = catalog.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    kind: provider.kind,
    source: "custom",
    baseUrl: provider.baseUrl,
    helpUrl: provider.helpUrl ?? provider.baseUrl,
    models: [],
  }));

  return mergeProviderConfigs(BUILTIN_PROVIDERS, customProviders).map((provider) => ({
    ...provider,
    hasProviderApiKey: providerKeys.has(provider.id),
    hasApiKey:
      providerKeys.has(provider.id) ||
      modelKeyRefs.some((ref) => ref.startsWith(provider.id + "/")),
    models: mergeModels(provider, catalog),
  }));
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
      providerHelpUrl: provider.helpUrl,
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
    })),
  );
}

export function getProviderConfig(providerId: string): ProviderInfo | null {
  return listProviders().find((provider) => provider.id === providerId) ?? null;
}

export function upsertCustomProvider(input: CustomProviderInput): ProviderInfo {
  const catalog = readCatalog();
  const id = normalizeProviderId(input.id ?? input.label);
  if (!id) throw new Error("Provider id is required");

  // Existing custom records may collide with a newly introduced built-in. Keep
  // them editable; only reject attempts to create a fresh built-in collision.
  const existing = catalog.providers.find((provider) => provider.id === id);
  if (BUILTIN_PROVIDERS.some((provider) => provider.id === id) && !existing) {
    throw new Error("Built-in providers cannot be overwritten");
  }

  const label = input.label.trim();
  if (!label) throw new Error("Provider label is required");

  const baseUrl = normalizeBaseUrl(input.baseUrl);
  if (!baseUrl) throw new Error("Base URL is required");

  const now = Date.now();
  const nextProvider = {
    id,
    label,
    kind: "openai-compatible" as const,
    baseUrl,
    helpUrl: normalizeOptionalUrl(input.helpUrl),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  catalog.providers = existing
    ? catalog.providers.map((provider) => (provider.id === id ? nextProvider : provider))
    : [...catalog.providers, nextProvider];
  writeCatalog(catalog);

  const saved = getProviderConfig(id);
  if (!saved) throw new Error("Failed to save provider");
  return saved;
}

export function deleteCustomProvider(providerId: string): void {
  const id = normalizeProviderId(providerId);
  const catalog = readCatalog();
  const existing = catalog.providers.find((provider) => provider.id === id);
  if (!existing) throw new Error("Custom provider not found");

  catalog.providers = catalog.providers.filter((provider) => provider.id !== id);
  catalog.models = catalog.models.filter((model) => model.providerId !== id);
  catalog.modelStates = catalog.modelStates.filter((state) => state.providerId !== id);
  writeCatalog(catalog);
  deleteApiKey(id);
  deleteModelApiKeysForProvider(id);
}

export function saveProviderApiKey(providerId: string, apiKey: string): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const key = apiKey.trim();
  if (!key) throw new Error("API key is required");
  assertKnownProvider(normalizedProviderId);
  setApiKey(normalizedProviderId, key);
}

export function clearProviderApiKey(providerId: string): void {
  deleteApiKey(normalizeProviderId(providerId));
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

function getProviderOrLegacyModelApiKey(providerId: string, modelId?: string): string | null {
  return resolveProviderApiKeyFallback({
    providerId,
    modelId,
    providerKey: getApiKey(providerId),
    legacyModelRefs: listModelApiKeyRefs(),
    getLegacyModelKey: (id) => getModelApiKey(providerId, id),
  });
}

export interface RemoteModelInfo {
  id: string;
  label?: string;
  contextWindow?: number;
  capabilities?: Partial<ModelCapabilities>;
}

export function inferModelCapabilities(modelId: string): ModelCapabilities {
  const lower = modelId.toLowerCase();
  const embedding = /embed|embedding/.test(lower);
  const speechOutput = /(^|[-_/])tts([-_/]|$)|gpt-4o-mini-tts|gemini[-_.\w]*tts/.test(lower);
  const transcription = /whisper|transcribe|transcription/.test(lower);
  const videoOutput = /(^|[-_/])veo([-_/]|$)|video/.test(lower);
  const imageOutput = /gpt-image|dall-e|imagen|gemini[-_.\w]*image|(^|[-_/])image([-_/]|$)/.test(
    lower,
  );
  const pureImage = /gpt-image|dall-e|imagen/.test(lower);
  const textGeneration =
    !embedding && !speechOutput && !transcription && !videoOutput && !pureImage;
  return {
    textGeneration,
    vision:
      textGeneration &&
      /\bvision\b|gpt-4o|gpt-5|gemini|claude-3|claude-sonnet|claude-opus/.test(lower),
    imageOutput,
    speechOutput,
    transcription,
    videoOutput,
    toolCalling: textGeneration && !imageOutput,
    reasoning:
      textGeneration &&
      /(^|[-_/])(o1|o3|o4)([-_/]|$)|reason|thinking|deepseek-reasoner|gpt-5/.test(lower),
    embedding,
  };
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
    byId.set(id, {
      ...model,
      id,
      label: normalizeOptionalText(model.label),
      contextWindow: normalizeContextWindow(model.contextWindow ?? inferContextWindow(id)),
      capabilities: normalizeCapabilities(model.capabilities ?? inferModelCapabilities(id)),
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function parseOpenAIModelListResponse(json: unknown): RemoteModelInfo[] {
  const data = (json as { data?: Array<{ id?: unknown; name?: unknown; display_name?: unknown }> })
    .data;
  return normalizeRemoteModels(
    (Array.isArray(data) ? data : []).map((item) => ({
      id: primitiveToString(item.id ?? item.name),
      label: normalizeOptionalText(item.display_name),
    })),
  );
}

export function parseAnthropicModelListResponse(json: unknown): RemoteModelInfo[] {
  const data = (json as { data?: Array<{ id?: unknown; display_name?: unknown }> }).data;
  return normalizeRemoteModels(
    (Array.isArray(data) ? data : []).map((item) => ({
      id: primitiveToString(item.id),
      label: normalizeOptionalText(item.display_name),
    })),
  );
}

export function parseGoogleModelListResponse(json: unknown): RemoteModelInfo[] {
  const models = (
    json as {
      models?: Array<{
        name?: unknown;
        displayName?: unknown;
        supportedGenerationMethods?: unknown;
      }>;
    }
  ).models;
  return normalizeRemoteModels(
    (Array.isArray(models) ? models : [])
      .map((item) => {
        const name = primitiveToString(item.name).replace(/^models\//, "");
        return {
          id: name,
          label: normalizeOptionalText(item.displayName),
          supportedGenerationMethods: item.supportedGenerationMethods,
        };
      })
      .filter((item) => {
        if (!item.id) return false;
        const methods = item.supportedGenerationMethods;
        if (!Array.isArray(methods)) return true;
        const lowerMethods = methods.map((method) => primitiveToString(method).toLowerCase());
        const capabilities = inferModelCapabilities(item.id);
        return (
          lowerMethods.includes("generatecontent") ||
          capabilities.imageOutput ||
          capabilities.speechOutput ||
          capabilities.videoOutput
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

  for (const remote of normalizedRemoteModels) {
    const existing = nextCatalog.models.find(
      (model) => model.providerId === providerId && model.id === remote.id,
    );
    if (existing) {
      const nextLabel = existing.label ?? remote.label;
      const changed = nextLabel !== existing.label;
      if (changed) updated += 1;
      nextCatalog.models = nextCatalog.models.map((model) =>
        model.providerId === providerId && model.id === remote.id
          ? { ...model, label: nextLabel, updatedAt: changed ? now : model.updatedAt }
          : model,
      );
      continue;
    }

    added += 1;
    nextCatalog.models.push({
      providerId,
      id: remote.id,
      label: remote.label,
      enabled: false,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      topP: DEFAULT_MODEL_TOP_P,
      maxOutputTokens: DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
      contextWindow: normalizeContextWindow(remote.contextWindow),
      capabilities: normalizeCapabilities(remote.capabilities ?? inferModelCapabilities(remote.id)),
      providerOptions: {},
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
  apiKey: string,
): Promise<RemoteModelInfo[]> {
  switch (provider.kind) {
    case "openai":
    case "openai-compatible": {
      if (!provider.baseUrl) throw new Error(provider.label + " base URL is not configured.");
      const url = new URL(provider.baseUrl.replace(/\/+$/, "") + "/models");
      const json = await fetchJson(url, {
        headers: { Authorization: "Bearer " + apiKey },
      });
      return parseOpenAIModelListResponse(json);
    }
    case "anthropic": {
      const url = new URL("https://api.anthropic.com/v1/models");
      const json = await fetchJson(url, {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      return parseAnthropicModelListResponse(json);
    }
    case "google": {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey);
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
    const apiKey = getProviderOrLegacyModelApiKey(id);
    if (!apiKey) throw new Error("API key is required");
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

  const apiKey = getProviderOrLegacyModelApiKey(id);
  if (!apiKey) throw new Error("API key is required");

  const remoteModels = await fetchRemoteModels(provider, apiKey);
  const result = mergeRemoteModelsIntoCatalog(readCatalog(), id, remoteModels);
  writeCatalog(result.catalog);
  const saved = getProviderConfig(id);
  if (!saved) throw new Error("Failed to save provider");
  return {
    provider: saved,
    discovered: result.discovered,
    added: result.added,
    updated: result.updated,
  };
}

export function upsertCustomModel(input: CustomModelInput): ProviderInfo {
  const providerId = normalizeProviderId(input.providerId);
  assertKnownProvider(providerId);

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
  const nextModel = {
    providerId,
    id: modelId,
    label: normalizeOptionalText(input.label),
    enabled: input.enabled ?? existing?.enabled ?? true,
    temperature: normalizeTemperature(input.temperature ?? existing?.temperature),
    topP: normalizeTopP(input.topP ?? existing?.topP),
    maxOutputTokens: normalizeMaxOutputTokens(input.maxOutputTokens ?? existing?.maxOutputTokens),
    contextWindow: normalizeContextWindow(input.contextWindow ?? existing?.contextWindow),
    capabilities: normalizeCapabilities(input.capabilities ?? existing?.capabilities),
    providerOptions: normalizeProviderOptions(providerOptions ?? {}),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  catalog.models = existing
    ? catalog.models.map((model) =>
        model.providerId === providerId && model.id === modelId ? nextModel : model,
      )
    : [...catalog.models, nextModel];
  setModelState(catalog, providerId, modelId, nextModel.enabled);
  writeCatalog(catalog);

  const provider = getProviderConfig(providerId);
  if (!provider) throw new Error("Failed to save model");
  return provider;
}

export function updateModelEnabled(providerId: string, modelId: string, enabled: boolean): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  assertKnownModel(normalizedProviderId, normalizedModelId);

  const catalog = readCatalog();
  setModelState(catalog, normalizedProviderId, normalizedModelId, enabled);
  writeCatalog(catalog);
}

export function saveModelApiKey(providerId: string, modelId: string, apiKey: string): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  const key = apiKey.trim();
  if (!key) throw new Error("API key is required");
  assertKnownModel(normalizedProviderId, normalizedModelId);
  setModelApiKey(normalizedProviderId, normalizedModelId, key);
}

export function clearModelApiKey(providerId: string, modelId: string): void {
  deleteModelApiKey(normalizeProviderId(providerId), modelId.trim());
}

export function deleteCustomModel(providerId: string, modelId: string): void {
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = modelId.trim();
  const catalog = readCatalog();
  const before = catalog.models.length;
  catalog.models = catalog.models.filter(
    (model) => !(model.providerId === normalizedProviderId && model.id === normalizedModelId),
  );
  if (catalog.models.length === before) throw new Error("Custom model not found");
  removeModelState(catalog, normalizedProviderId, normalizedModelId);
  writeCatalog(catalog);
  deleteModelApiKey(normalizedProviderId, normalizedModelId);
}

export function migrateProviderApiKeysToModelKeys(): void {
  for (const provider of listProviders()) {
    if (getApiKey(provider.id)) continue;
    const legacyKey = getProviderOrLegacyModelApiKey(provider.id);
    if (legacyKey) setApiKey(provider.id, legacyKey);
  }
  clearInvalidSelectedModel();
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
  kind: "video",
): Extract<ResolvedMediaModelConfig, { kind: "video" }>;

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

  const apiKey = getProviderOrLegacyModelApiKey(providerId, modelId);
  if (!apiKey) {
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
    case "video":
      return capabilities.videoOutput;
  }
}

function createMediaModel(
  config: ProviderInfo,
  apiKey: string,
  modelId: string,
  kind: MediaGenerationKind,
): ImageModel | SpeechModel | TranscriptionModel | VideoModel {
  switch (config.kind) {
    case "openai":
    case "openai-compatible": {
      if (!config.baseUrl) throw new Error(config.label + " base URL is not configured.");
      const provider = createOpenAI({ apiKey, baseURL: config.baseUrl, name: config.id });
      switch (kind) {
        case "image":
          return provider.image(modelId);
        case "speech":
          return provider.speech(modelId);
        case "transcription":
          return provider.transcription(modelId);
        case "video":
          throw new Error(config.label + " does not support video generation.");
      }
      break;
    }
    case "google": {
      const provider = createGoogle({ apiKey });
      switch (kind) {
        case "image":
          return provider.image(modelId);
        case "speech":
          return provider.speech(modelId);
        case "video":
          return provider.video(modelId);
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

  const apiKey = getProviderOrLegacyModelApiKey(providerId, modelId);
  if (!apiKey) {
    throw new Error(
      config.label + " API key is not configured. Please add it in model management.",
    );
  }

  return {
    model: createLanguageModel(config, apiKey, modelId),
    providerId,
    providerKind: config.kind,
    modelId,
    capabilities: model.capabilities,
    temperature: model.temperature,
    topP: model.topP,
    maxOutputTokens: model.maxOutputTokens,
    contextWindow: model.contextWindow,
    providerOptions: model.providerOptions as ProviderOptions,
    nativeTools: createNativeChatTools(config, apiKey, modelId, model.providerOptions),
    countInputTokens:
      config.kind === "openai"
        ? (input) => countOpenAIInputTokens(config.baseUrl, apiKey, modelId, input)
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

function createLanguageModel(config: ProviderInfo, apiKey: string, modelId: string): LanguageModel {
  switch (config.kind) {
    case "openai":
      return createOpenAI({ apiKey, baseURL: config.baseUrl, name: config.id })(modelId);
    case "openai-compatible":
      if (!config.baseUrl) throw new Error(config.label + " base URL is not configured.");
      return createOpenAI({ apiKey, baseURL: config.baseUrl, name: config.id }).chat(modelId);
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "google":
      return createGoogle({ apiKey })(modelId);
  }
}

function createNativeChatTools(
  config: ProviderInfo,
  apiKey: string,
  modelId: string,
  providerOptions: JsonObject,
): NativeChatTool[] {
  switch (config.kind) {
    case "openai": {
      const provider = createOpenAI({ apiKey, baseURL: config.baseUrl, name: config.id });
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
      const provider = createAnthropic({ apiKey });
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
      const provider = createGoogle({ apiKey });
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
