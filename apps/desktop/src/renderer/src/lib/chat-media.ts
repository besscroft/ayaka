import {
  DEFAULT_MEDIA_GENERATION_SETTINGS,
  type MediaGenerationKind,
  type MediaGenerationKindSettings,
  type MediaGenerationOptions,
  type MediaGenerationSettings,
  type ProviderInfo,
  type VisionModelSettings,
} from "@shared/types";

export const MEDIA_GENERATION_KINDS: readonly MediaGenerationKind[] = [
  "image",
  "speech",
  "transcription",
];

export function parseMediaGenerationSettings(
  raw: string | null | undefined,
): MediaGenerationSettings {
  if (!raw) return cloneDefaultMediaSettings();
  try {
    return normalizeMediaGenerationSettings(JSON.parse(raw) as unknown);
  } catch {
    return cloneDefaultMediaSettings();
  }
}

export function normalizeMediaGenerationSettings(value: unknown): MediaGenerationSettings {
  const source =
    value && typeof value === "object" ? (value as Partial<MediaGenerationSettings>) : {};
  const defaults = cloneDefaultMediaSettings().defaults;
  const rawDefaults =
    source.defaults && typeof source.defaults === "object"
      ? (source.defaults as Partial<
          Record<MediaGenerationKind, Partial<MediaGenerationKindSettings>>
        >)
      : {};

  for (const kind of MEDIA_GENERATION_KINDS) {
    const raw = rawDefaults[kind];
    defaults[kind] = {
      modelRef: normalizeOptionalString(raw?.modelRef) ?? null,
      options: normalizeMediaOptions(raw?.options),
    };
  }

  const rawVision =
    source.vision && typeof source.vision === "object"
      ? (source.vision as Partial<VisionModelSettings>)
      : {};
  const vision: VisionModelSettings = {
    mode: rawVision.mode === "model" ? "model" : "inherit",
    modelRef: normalizeOptionalString(rawVision.modelRef) ?? null,
  };

  return { version: 1, defaults, vision };
}

export function serializeMediaGenerationSettings(settings: MediaGenerationSettings): string {
  return JSON.stringify(normalizeMediaGenerationSettings(settings));
}

export function getMediaCapableProviders(
  providers: readonly ProviderInfo[],
  kind: MediaGenerationKind,
): ProviderInfo[] {
  return providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) => model.enabled && modelSupportsMediaKind(model, kind),
      ),
    }))
    .filter((provider) => provider.models.length > 0);
}

export function getVisionCapableProviders(providers: readonly ProviderInfo[]): ProviderInfo[] {
  return providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) => model.enabled && model.capabilities.textGeneration && model.capabilities.vision,
      ),
    }))
    .filter((provider) => provider.models.length > 0);
}

function cloneDefaultMediaSettings(): MediaGenerationSettings {
  return {
    version: 1,
    defaults: {
      image: { modelRef: DEFAULT_MEDIA_GENERATION_SETTINGS.defaults.image.modelRef, options: {} },
      speech: { modelRef: DEFAULT_MEDIA_GENERATION_SETTINGS.defaults.speech.modelRef, options: {} },
      transcription: {
        modelRef: DEFAULT_MEDIA_GENERATION_SETTINGS.defaults.transcription.modelRef,
        options: {},
      },
    },
    vision: { ...DEFAULT_MEDIA_GENERATION_SETTINGS.vision },
  };
}

function modelSupportsMediaKind(
  model: ProviderInfo["models"][number],
  kind: MediaGenerationKind,
): boolean {
  switch (kind) {
    case "image":
      return model.capabilities.imageOutput;
    case "speech":
      return model.capabilities.speechOutput;
    case "transcription":
      return model.capabilities.transcription;
  }
}

function normalizeMediaOptions(value: unknown): MediaGenerationOptions {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const options: MediaGenerationOptions = {};
  setStringOption(options, "size", source.size);
  setStringOption(options, "aspectRatio", source.aspectRatio);
  setNumberOption(options, "count", source.count, true);
  setNumberOption(options, "seed", source.seed, true);
  setStringOption(options, "voice", source.voice);
  setStringOption(options, "outputFormat", source.outputFormat);
  setNumberOption(options, "speed", source.speed, false);
  setStringOption(options, "language", source.language);
  setStringOption(options, "instructions", source.instructions);
  return options;
}

function setStringOption<T extends keyof MediaGenerationOptions>(
  target: MediaGenerationOptions,
  key: T,
  value: unknown,
): void {
  const normalized = normalizeOptionalString(value);
  if (normalized !== undefined) (target as Record<string, unknown>)[key] = normalized;
}

function setNumberOption<T extends keyof MediaGenerationOptions>(
  target: MediaGenerationOptions,
  key: T,
  value: unknown,
  integer: boolean,
): void {
  if (value === undefined || value === null || value === "") return;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return;
  (target as Record<string, unknown>)[key] = integer ? Math.floor(numberValue) : numberValue;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
