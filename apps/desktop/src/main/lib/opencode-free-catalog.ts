import {
  CHAT_REASONING_LEVELS,
  SettingKey,
  type BuiltinModelCatalogSettings,
  type BuiltinModelInfo,
  type ChatReasoningLevel,
  type ModelCapabilities,
  type ModelCapabilitySources,
  type ModelOption,
} from "../../shared/types";
import { getSetting, setSetting } from "./db";

export const OPENCODE_FREE_PROVIDER_ID = "opencode-free";
export const OPENCODE_FREE_BASE_URL = "https://opencode.ai/zen/v1";
export const OPENCODE_FREE_MODELS_URL = `${OPENCODE_FREE_BASE_URL}/models`;
export const MODELS_DEV_URL = "https://models.dev/api.json";

export const OPENCODE_FREE_MODEL_PRIORITY = [
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "big-pickle",
  "hy3-free",
  "mimo-v2.5-free",
  "muse-spark-1.2-contributor-free",
  "x-preview-f-free",
] as const;

const DEFAULT_MODEL_TEMPERATURE = 0.7;
const DEFAULT_MODEL_TOP_P = 1;
const DEFAULT_MODEL_MAX_OUTPUT_TOKENS = 4096;
const DEFAULT_MODEL_CONTEXT_WINDOW = 32_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

const STATIC_MODELS: Array<
  Pick<
    BuiltinModelInfo,
    "id" | "label" | "maxOutputTokens" | "contextWindow" | "capabilities" | "reasoningLevels"
  >
> = [
  {
    id: "nemotron-3-ultra-free",
    label: "Nemotron 3 Ultra Free",
    maxOutputTokens: 128_000,
    contextWindow: 1_000_000,
    capabilities: reasoningCapabilities(),
    reasoningLevels: [...CHAT_REASONING_LEVELS],
  },
  {
    id: "nemotron-3.5-lightning-free",
    label: "Nemotron 3.5 Lightning Free",
    maxOutputTokens: 262_144,
    contextWindow: 262_144,
    capabilities: reasoningCapabilities(),
    reasoningLevels: [...CHAT_REASONING_LEVELS],
  },
  {
    id: "big-pickle",
    label: "Big Pickle",
    maxOutputTokens: 32_000,
    contextWindow: 200_000,
    capabilities: reasoningCapabilities(),
    reasoningLevels: [...CHAT_REASONING_LEVELS],
  },
  {
    id: "hy3-free",
    label: "Hy3 Free",
    maxOutputTokens: 64_000,
    contextWindow: 190_000,
    capabilities: reasoningCapabilities(),
    reasoningLevels: [...CHAT_REASONING_LEVELS],
  },
  {
    id: "mimo-v2.5-free",
    label: "MiMo V2.5 Free",
    maxOutputTokens: 32_000,
    contextWindow: 200_000,
    capabilities: { ...reasoningCapabilities(), vision: true },
    reasoningLevels: [...CHAT_REASONING_LEVELS],
  },
  {
    id: "muse-spark-1.2-contributor-free",
    label: "Muse Spark 1.2 Free",
    maxOutputTokens: 131_072,
    contextWindow: 1_048_576,
    capabilities: { ...reasoningCapabilities(), vision: true },
    reasoningLevels: [...CHAT_REASONING_LEVELS],
  },
  {
    id: "x-preview-f-free",
    label: "Ox Alpha Free (Unlimited)",
    maxOutputTokens: 131_072,
    contextWindow: 1_000_000,
    capabilities: { ...reasoningCapabilities(), vision: true },
    reasoningLevels: [...CHAT_REASONING_LEVELS],
  },
];

interface FetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

interface ModelsDevResponse {
  notModified: boolean;
  etag?: string;
  models: Map<string, Record<string, unknown>>;
}

export interface OpenCodeFreeCatalogRefreshResult {
  models: ModelOption[];
  discovered: number;
  added: number;
  updated: number;
  updatedCapabilities: number;
}

function reasoningCapabilities(): ModelCapabilities {
  return {
    textGeneration: true,
    vision: false,
    imageOutput: false,
    speechOutput: false,
    transcription: false,
    toolCalling: true,
    reasoning: true,
    embedding: false,
  };
}

function providerCapabilities(raw: Record<string, unknown>): ModelCapabilities {
  const modalities = isRecord(raw.modalities) ? raw.modalities : {};
  const input = readStringList(modalities.input);
  const output = readStringList(modalities.output);
  return {
    textGeneration: input.includes("text") && output.includes("text"),
    vision: input.includes("image"),
    imageOutput: output.includes("image"),
    speechOutput: output.includes("audio"),
    transcription: false,
    toolCalling: raw.tool_call === true,
    reasoning: raw.reasoning === true,
    embedding: false,
  };
}

function providerCapabilitySources(): ModelCapabilitySources {
  return {
    textGeneration: "provider",
    vision: "provider",
    imageOutput: "provider",
    speechOutput: "provider",
    transcription: "provider",
    toolCalling: "provider",
    reasoning: "provider",
    embedding: "provider",
  };
}

function staticCatalog(now = Date.now()): BuiltinModelCatalogSettings {
  return {
    version: 1,
    models: STATIC_MODELS.map((model) => ({
      id: model.id,
      label: model.label,
      enabled: true,
      temperature: DEFAULT_MODEL_TEMPERATURE,
      topP: DEFAULT_MODEL_TOP_P,
      maxOutputTokens: model.maxOutputTokens,
      contextWindow: model.contextWindow,
      capabilities: { ...model.capabilities },
      providerOptions: {},
      reasoningDefault: "provider-default",
      reasoningLevels: [...(model.reasoningLevels ?? CHAT_REASONING_LEVELS)],
      capabilitySources: providerCapabilitySources(),
      createdAt: now,
      updatedAt: now,
    })),
    updatedAt: now,
  };
}

function readCatalog(): BuiltinModelCatalogSettings | null {
  const raw = getSetting(SettingKey.BuiltinModelCatalog);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BuiltinModelCatalogSettings>;
    if (parsed.version !== 1 || !Array.isArray(parsed.models)) return null;
    const models = parsed.models
      .map(normalizeStoredModel)
      .filter((model): model is BuiltinModelInfo => !!model);
    return {
      version: 1,
      models: orderModels(models),
      modelsDevEtag: typeof parsed.modelsDevEtag === "string" ? parsed.modelsDevEtag : undefined,
      updatedAt: readPositiveNumber(parsed.updatedAt),
    };
  } catch {
    return null;
  }
}

function normalizeStoredModel(raw: unknown): BuiltinModelInfo | null {
  if (!isRecord(raw)) return null;
  const id = readString(raw.id);
  if (!id) return null;
  const capabilities = normalizeCapabilities(raw.capabilities);
  const reasoningLevels = normalizeReasoningLevels(raw.reasoningLevels, capabilities);
  return {
    id,
    label: readOptionalString(raw.label),
    enabled: raw.enabled !== false,
    temperature: normalizeNumber(raw.temperature, DEFAULT_MODEL_TEMPERATURE, 0, 2),
    topP: normalizeNumber(raw.topP, DEFAULT_MODEL_TOP_P, 0, 1),
    maxOutputTokens: Math.floor(
      normalizeNumber(raw.maxOutputTokens, DEFAULT_MODEL_MAX_OUTPUT_TOKENS, 1, 32768),
    ),
    contextWindow: Math.floor(
      normalizeNumber(raw.contextWindow, DEFAULT_MODEL_CONTEXT_WINDOW, 1, 2_000_000),
    ),
    capabilities,
    providerOptions: isRecord(raw.providerOptions) ? raw.providerOptions : {},
    reasoningDefault: normalizeReasoningDefault(raw.reasoningDefault, reasoningLevels),
    reasoningLevels,
    capabilitySources: normalizeCapabilitySources(raw.capabilitySources),
    lastSyncedAt: readPositiveNumber(raw.lastSyncedAt),
    createdAt: readPositiveNumber(raw.createdAt) ?? Date.now(),
    updatedAt: readPositiveNumber(raw.updatedAt) ?? Date.now(),
  };
}

function normalizeCapabilities(raw: unknown): ModelCapabilities {
  const value = isRecord(raw) ? raw : {};
  return {
    textGeneration: value.textGeneration !== false,
    vision: value.vision === true,
    imageOutput: value.imageOutput === true,
    speechOutput: value.speechOutput === true,
    transcription: value.transcription === true,
    toolCalling: value.toolCalling !== false,
    reasoning: value.reasoning === true,
    embedding: value.embedding === true,
  };
}

function normalizeCapabilitySources(raw: unknown): ModelCapabilitySources {
  if (!isRecord(raw)) return providerCapabilitySources();
  const result: ModelCapabilitySources = {};
  for (const key of Object.keys(providerCapabilitySources()) as Array<
    keyof ModelCapabilitySources
  >) {
    const value = raw[key];
    if (value === "provider" || value === "inferred" || value === "manual") result[key] = value;
  }
  return result;
}

function normalizeReasoningLevels(
  raw: unknown,
  capabilities: ModelCapabilities,
): ChatReasoningLevel[] {
  if (Array.isArray(raw)) {
    const levels = raw.filter(
      (value): value is ChatReasoningLevel =>
        typeof value === "string" && (CHAT_REASONING_LEVELS as readonly string[]).includes(value),
    );
    if (levels.length > 0) return [...new Set(levels)];
  }
  return capabilities.reasoning ? [...CHAT_REASONING_LEVELS] : ["provider-default", "none"];
}

function normalizeReasoningDefault(
  raw: unknown,
  levels: readonly ChatReasoningLevel[],
): ChatReasoningLevel {
  return typeof raw === "string" && levels.includes(raw as ChatReasoningLevel)
    ? (raw as ChatReasoningLevel)
    : "provider-default";
}

function toModelOption(model: BuiltinModelInfo): ModelOption {
  return {
    id: model.id,
    label: model.label,
    source: "builtin",
    enabled: model.enabled,
    temperature: model.temperature,
    topP: model.topP,
    maxOutputTokens: model.maxOutputTokens,
    contextWindow: model.contextWindow,
    capabilities: { ...model.capabilities },
    providerOptions: { ...model.providerOptions },
    reasoningDefault: model.reasoningDefault,
    reasoningLevels: model.reasoningLevels ? [...model.reasoningLevels] : undefined,
    capabilitySources: model.capabilitySources ? { ...model.capabilitySources } : undefined,
    lastSyncedAt: model.lastSyncedAt,
  };
}

export function getOpenCodeFreeModelOptions(): ModelOption[] {
  const catalog = readCatalog() ?? staticCatalog();
  return orderModels(catalog.models).map(toModelOption);
}

export function getOpenCodeFreeCatalog(): BuiltinModelCatalogSettings {
  return readCatalog() ?? staticCatalog();
}

export async function ensureOpenCodeFreeCatalog(): Promise<void> {
  const existing = readCatalog();
  if (existing?.models.length) return;
  await setSetting(SettingKey.BuiltinModelCatalog, JSON.stringify(staticCatalog()));
}

export async function setOpenCodeFreeModelEnabled(
  modelId: string,
  enabled: boolean,
): Promise<void> {
  const catalog = readCatalog() ?? staticCatalog();
  const model = catalog.models.find((item) => item.id === modelId);
  if (!model) throw new Error("Unknown model: " + OPENCODE_FREE_PROVIDER_ID + "/" + modelId);
  model.enabled = enabled;
  model.updatedAt = Date.now();
  await setSetting(SettingKey.BuiltinModelCatalog, JSON.stringify(catalog));
}

export async function refreshOpenCodeFreeCatalog(
  options: FetchOptions = {},
): Promise<OpenCodeFreeCatalogRefreshResult> {
  const previous = readCatalog() ?? staticCatalog();
  const [modelsDev, visibleModelIds] = await Promise.all([
    fetchModelsDev(previous.modelsDevEtag, options),
    fetchVisibleOpenCodeModels(options),
  ]);
  const eligible = modelsDev.notModified
    ? previous.models
        .filter((model) => visibleModelIds.has(model.id))
        .map((model) => ({ ...model }))
    : [...modelsDev.models.entries()]
        .filter(([id, model]) => visibleModelIds.has(id) && isEligibleFreeModel(model))
        .map(([id, model]) =>
          toBuiltinModel(
            id,
            model,
            previous.models.find((item) => item.id === id),
          ),
        );
  if (eligible.length === 0) {
    throw new Error("OpenCode Free returned no eligible models.");
  }

  const now = Date.now();
  const previousById = new Map(previous.models.map((model) => [model.id, model]));
  const models = orderModels(
    eligible.map((model) => ({
      ...model,
      enabled: previousById.get(model.id)?.enabled ?? false,
      createdAt: previousById.get(model.id)?.createdAt ?? now,
      updatedAt: now,
    })),
  );
  const next: BuiltinModelCatalogSettings = {
    version: 1,
    models,
    modelsDevEtag: modelsDev.etag ?? previous.modelsDevEtag,
    updatedAt: now,
  };
  await setSetting(SettingKey.BuiltinModelCatalog, JSON.stringify(next));

  const oldById = new Map(previous.models.map((model) => [model.id, model]));
  const updatedModels = models.filter((model) => {
    const old = oldById.get(model.id);
    return (
      !old || JSON.stringify(toComparableModel(old)) !== JSON.stringify(toComparableModel(model))
    );
  });
  return {
    models: models.map(toModelOption),
    discovered: models.length,
    added: models.filter((model) => !oldById.has(model.id)).length,
    updated: updatedModels.length,
    updatedCapabilities: models.filter((model) => {
      const old = oldById.get(model.id);
      return old && JSON.stringify(old.capabilities) !== JSON.stringify(model.capabilities);
    }).length,
  };
}

async function fetchModelsDev(
  etag: string | undefined,
  options: FetchOptions,
): Promise<ModelsDevResponse> {
  const response = await fetchWithTimeout(
    MODELS_DEV_URL,
    {
      headers: {
        Accept: "application/json",
        ...(etag ? { "If-None-Match": etag } : {}),
      },
    },
    options,
  );
  if (response.status === 304) return { notModified: true, etag, models: new Map() };
  const json = await readJson(response, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
  if (!response.ok) throw httpError("models.dev", response.status, json);
  return {
    notModified: false,
    etag: response.headers.get("etag") ?? undefined,
    models: extractModelsDev(json),
  };
}

async function fetchVisibleOpenCodeModels(options: FetchOptions): Promise<Set<string>> {
  const response = await fetchWithTimeout(
    OPENCODE_FREE_MODELS_URL,
    { headers: { Accept: "application/json" } },
    options,
  );
  const json = await readJson(response, options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES);
  if (!response.ok) throw httpError("OpenCode /models", response.status, json);
  const data = isRecord(json) ? json.data : undefined;
  if (!Array.isArray(data)) throw new Error("OpenCode /models returned an invalid response.");
  return new Set(
    data
      .map((item) => (isRecord(item) ? readString(item.id) : undefined))
      .filter((id): id is string => !!id),
  );
}

function extractModelsDev(json: unknown): Map<string, Record<string, unknown>> {
  if (!isRecord(json)) throw new Error("models.dev returned an invalid response.");
  const provider = json.opencode ?? json["opencode-zen"];
  if (!isRecord(provider) || !isRecord(provider.models)) {
    throw new Error("models.dev does not contain the OpenCode model catalog.");
  }
  const result = new Map<string, Record<string, unknown>>();
  for (const [id, raw] of Object.entries(provider.models)) {
    if (isRecord(raw)) result.set(id, raw);
  }
  return result;
}

function isEligibleFreeModel(model: Record<string, unknown>): boolean {
  const cost = isRecord(model.cost) ? model.cost : {};
  const modalities = isRecord(model.modalities) ? model.modalities : {};
  return (
    cost.input === 0 &&
    cost.output === 0 &&
    model.status !== "deprecated" &&
    model.deprecated !== true &&
    model.tool_call === true &&
    readStringList(modalities.input).includes("text") &&
    readStringList(modalities.output).includes("text")
  );
}

function toBuiltinModel(
  id: string,
  raw: Record<string, unknown>,
  previous: BuiltinModelInfo | undefined,
): BuiltinModelInfo {
  const capabilities = providerCapabilities(raw);
  const reasoningLevels = readReasoningLevels(raw, capabilities);
  const limit = isRecord(raw.limit) ? raw.limit : {};
  return {
    id,
    label: readOptionalString(raw.name) ?? previous?.label,
    enabled: previous?.enabled ?? false,
    temperature: previous?.temperature ?? DEFAULT_MODEL_TEMPERATURE,
    topP: previous?.topP ?? DEFAULT_MODEL_TOP_P,
    maxOutputTokens: clampInteger(
      limit.output,
      previous?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS,
      1,
      32768,
    ),
    contextWindow: clampInteger(
      limit.context,
      previous?.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW,
      1,
      2_000_000,
    ),
    capabilities,
    providerOptions: previous?.providerOptions ?? {},
    reasoningDefault: previous?.reasoningDefault ?? "provider-default",
    reasoningLevels,
    capabilitySources: providerCapabilitySources(),
    lastSyncedAt: Date.now(),
    createdAt: previous?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
}

function readReasoningLevels(
  raw: Record<string, unknown>,
  capabilities: ModelCapabilities,
): ChatReasoningLevel[] {
  const options = Array.isArray(raw.reasoning_options) ? raw.reasoning_options : [];
  const values = options.flatMap((option) => {
    if (!isRecord(option) || !Array.isArray(option.values)) return [];
    return option.values.filter(
      (value): value is ChatReasoningLevel =>
        typeof value === "string" && (CHAT_REASONING_LEVELS as readonly string[]).includes(value),
    );
  });
  if (values.length > 0) return ["provider-default", ...new Set(values)];
  return capabilities.reasoning ? [...CHAT_REASONING_LEVELS] : ["provider-default", "none"];
}

function orderModels<T extends { id: string }>(models: T[]): T[] {
  const priority = new Map<string, number>(
    OPENCODE_FREE_MODEL_PRIORITY.map((id, index) => [id, index]),
  );
  return [...models].sort((a, b) => {
    const ai = priority.get(a.id) ?? OPENCODE_FREE_MODEL_PRIORITY.length;
    const bi = priority.get(b.id) ?? OPENCODE_FREE_MODEL_PRIORITY.length;
    return ai - bi || a.id.localeCompare(b.id);
  });
}

function toComparableModel(model: BuiltinModelInfo): unknown {
  return {
    id: model.id,
    label: model.label,
    capabilities: model.capabilities,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    reasoningLevels: model.reasoningLevels,
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: FetchOptions,
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response, maxBodyBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new Error("Provider catalog response is too large.");
  }
  const text = await readBodyText(response, maxBodyBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Provider catalog returned invalid JSON.");
  }
}

async function readBodyText(response: Response, maxBodyBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
      throw new Error("Provider catalog response is too large.");
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel();
        throw new Error("Provider catalog response is too large.");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function httpError(source: string, status: number, body: unknown): Error {
  const detail = typeof body === "string" ? body : JSON.stringify(body);
  return new Error(
    `${source} request failed (${status})${detail ? `: ${detail.slice(0, 300)}` : ""}`,
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return readString(value);
}

function readPositiveNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : undefined;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.toLowerCase())
    : [];
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(normalizeNumber(value, fallback, min, max));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
