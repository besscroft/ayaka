import {
  experimental_generateVideo as generateVideo,
  generateImage,
  generateSpeech,
  transcribe,
  type UIMessage,
} from "ai";
import {
  DEFAULT_MEDIA_GENERATION_SETTINGS,
  SettingKey,
  type ManagedModelInfo,
  type MediaGenerationErrorResponse,
  type MediaGenerationFile,
  type MediaGenerationKind,
  type MediaGenerationOptions,
  type MediaGenerationRequest,
  type MediaGenerationResponse,
  type MediaGenerationSettings,
  type MediaGenerationToolInput,
} from "../../shared/types";
import { writeWorkspaceOutput } from "./conversation-workspace";

export interface MediaGenerationDependencies {
  resolveMediaModel?: typeof import("./providers").resolveMediaModel;
  writeMediaAsset?: typeof import("./media-assets").writeMediaAsset;
  conversationId?: string;
}

export interface MediaGenerationToolRequestDependencies {
  getSetting?: (key: string) => string | null;
  listManagedModels?: () => ManagedModelInfo[];
}

/** Execute a validated media request and persist generated binary assets locally. */
export async function executeMediaGeneration(
  request: MediaGenerationRequest,
  dependencies: MediaGenerationDependencies = {},
): Promise<MediaGenerationResponse> {
  const resolve = dependencies.resolveMediaModel ?? (await import("./providers")).resolveMediaModel;
  const write = dependencies.writeMediaAsset ?? (await import("./media-assets")).writeMediaAsset;

  switch (request.kind) {
    case "image": {
      const resolved = resolve(request.model, "image");
      const result = await generateImage({
        model: resolved.model,
        prompt: request.prompt,
        n: normalizeCount(request.options?.count, 1, 8),
        size: normalizeSize(request.options?.size),
        aspectRatio: normalizeAspectRatio(request.options?.aspectRatio),
        seed: normalizeInteger(request.options?.seed),
        providerOptions: resolved.providerOptions,
      });
      const files = await Promise.all(
        result.images.map((image, index) =>
          writeGeneratedAsset(write, dependencies.conversationId, {
            data: image.uint8Array,
            mediaType: image.mediaType,
            kind: "image",
            filename: `image-${index + 1}`,
          }),
        ),
      );
      return {
        kind: "image",
        text: files.length === 1 ? "Image generated." : `${files.length} images generated.`,
        files,
        metadata: buildMediaMetadata(result.warnings, result.providerMetadata),
      };
    }
    case "speech": {
      const resolved = resolve(request.model, "speech");
      const result = await generateSpeech({
        model: resolved.model,
        text: request.text,
        voice: request.options?.voice?.trim() || defaultSpeechVoice(resolved.providerKind),
        outputFormat: normalizeOutputFormat(request.options?.outputFormat),
        speed: normalizeNumberOption(request.options?.speed, 0.25, 4),
        language: normalizeOptionalText(request.options?.language),
        instructions: normalizeOptionalText(request.options?.instructions),
        providerOptions: resolved.providerOptions,
      });
      const file = await writeGeneratedAsset(write, dependencies.conversationId, {
        data: result.audio.uint8Array,
        mediaType: result.audio.mediaType,
        kind: "speech",
        filename: "speech",
      });
      return {
        kind: "speech",
        text: "Speech audio generated.",
        files: [file],
        metadata: buildMediaMetadata(result.warnings, result.providerMetadata),
      };
    }
    case "transcription": {
      const resolved = resolve(request.model, "transcription");
      const result = await transcribe({
        model: resolved.model,
        audio: dataUrlToUint8Array(request.audio.url),
        providerOptions: withTranscriptionLanguage(
          resolved.providerOptions,
          resolved.providerId,
          request.options?.language,
        ),
      });
      return {
        kind: "transcription",
        text: result.text,
        files: [],
        metadata: {
          ...buildMediaMetadata(result.warnings, result.providerMetadata),
          language: result.language,
          durationInSeconds: result.durationInSeconds,
          segments: result.segments,
        },
      };
    }
    case "video": {
      const resolved = resolve(request.model, "video");
      const result = await generateVideo({
        model: resolved.model,
        prompt: request.prompt,
        n: normalizeCount(request.options?.count, 1, 4),
        aspectRatio: normalizeAspectRatio(request.options?.aspectRatio),
        resolution: normalizeSize(request.options?.resolution),
        duration: normalizeNumberOption(request.options?.duration, 1, 60),
        fps: normalizeNumberOption(request.options?.fps, 1, 120),
        seed: normalizeInteger(request.options?.seed),
        generateAudio:
          typeof request.options?.generateAudio === "boolean"
            ? request.options.generateAudio
            : undefined,
        providerOptions: resolved.providerOptions,
      });
      const files = await Promise.all(
        result.videos.map((video, index) =>
          writeGeneratedAsset(write, dependencies.conversationId, {
            data: video.uint8Array,
            mediaType: video.mediaType,
            kind: "video",
            filename: `video-${index + 1}`,
          }),
        ),
      );
      return {
        kind: "video",
        text: files.length === 1 ? "Video generated." : `${files.length} videos generated.`,
        files,
        metadata: buildMediaMetadata(result.warnings, result.providerMetadata),
      };
    }
  }
}

async function writeGeneratedAsset(
  fallback: NonNullable<MediaGenerationDependencies["writeMediaAsset"]>,
  conversationId: string | undefined,
  input: { data: Uint8Array; mediaType: string; kind: MediaGenerationKind; filename: string },
): Promise<MediaGenerationFile> {
  if (conversationId) {
    const ref = await writeWorkspaceOutput(conversationId, {
      data: input.data,
      mediaType: input.mediaType,
      filename: input.filename,
    });
    return {
      type: "file",
      mediaType: ref.mediaType,
      filename: ref.filename,
      url: `workspace://${ref.path}`,
      size: ref.size,
    };
  }
  return fallback(input);
}

/** Build a media request from hidden-tool input, global defaults, and chat attachments. */
export async function buildMediaGenerationToolRequest(
  input: MediaGenerationToolInput,
  messages: readonly UIMessage[],
  dependencies: MediaGenerationToolRequestDependencies = {},
): Promise<MediaGenerationRequest> {
  const getSetting = dependencies.getSetting ?? (await import("./db")).getSetting;
  const listModels =
    dependencies.listManagedModels ?? (await import("./providers")).listManagedModels;
  const settings = parseMediaGenerationSettings(getSetting(SettingKey.MediaGeneration));
  const model = selectConfiguredMediaModel(input.kind, settings, listModels());
  if (!model) throw new Error(`No ${input.kind} model is available.`);
  const options = compactMediaOptions(input.kind, {
    ...settings.defaults[input.kind].options,
    ...input.options,
  });
  const content = normalizeOptionalText(input.content);

  switch (input.kind) {
    case "image":
      if (!content) throw new Error("Image prompt is required.");
      return { kind: "image", model, prompt: content, options };
    case "speech":
      if (!content) throw new Error("Speech text is required.");
      return { kind: "speech", model, text: content, options };
    case "video":
      if (!content) throw new Error("Video prompt is required.");
      return { kind: "video", model, prompt: content, options };
    case "transcription": {
      const audio = findAudioAttachment(messages, input.sourceFilename);
      if (!audio) throw new Error("An audio attachment is required for transcription.");
      return {
        kind: "transcription",
        model,
        audio,
        options,
      };
    }
  }
}

export function validateMediaGenerationRequest(
  body: Partial<MediaGenerationRequest>,
): string | null {
  if (!body || typeof body !== "object") return "request body is required";
  if (!body.kind) return "kind is required";
  if (
    body.kind !== "image" &&
    body.kind !== "speech" &&
    body.kind !== "transcription" &&
    body.kind !== "video"
  ) {
    return "kind must be one of: image, speech, transcription, video";
  }
  if (!body.model || typeof body.model !== "string") {
    return "model is required in provider/model format";
  }
  switch (body.kind) {
    case "image":
    case "video":
      return typeof body.prompt === "string" && body.prompt.trim() ? null : "prompt is required";
    case "speech":
      return typeof body.text === "string" && body.text.trim() ? null : "text is required";
    case "transcription":
      return body.audio && typeof body.audio.url === "string" && body.audio.url.trim()
        ? null
        : "audio.url is required";
  }
}

export function classifyMediaGenerationError(
  message: string,
  request: MediaGenerationRequest,
): MediaGenerationErrorResponse {
  const lower = message.toLowerCase();
  const base = { error: message, kind: request.kind, model: request.model };
  if (lower.includes("api key") || lower.includes("not configured")) {
    return { ...base, code: "no_model" };
  }
  if (lower.includes("disabled") || lower.includes("unknown model")) {
    return { ...base, code: "no_model" };
  }
  if (lower.includes("does not support")) return { ...base, code: "unsupported_model" };
  if (
    lower.includes("not enabled for this group") ||
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("unauthorized")
  ) {
    return { ...base, code: "permission_denied" };
  }
  return { ...base, code: "upstream_error" };
}

export function mediaErrorStatus(
  code: MediaGenerationErrorResponse["code"],
  error: unknown,
): 400 | 401 | 403 | 500 {
  if (code === "unauthorized") return 401;
  if (code === "permission_denied") return 403;
  if (code === "invalid_request" || code === "no_model" || code === "unsupported_model") {
    return 400;
  }
  return getHttpErrorStatus(error);
}

function parseMediaGenerationSettings(raw: string | null): MediaGenerationSettings {
  if (!raw) return cloneDefaultMediaSettings();
  try {
    const value = JSON.parse(raw) as unknown;
    const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const defaults = cloneDefaultMediaSettings().defaults;
    const rawDefaults =
      source.defaults && typeof source.defaults === "object"
        ? (source.defaults as Record<string, unknown>)
        : {};
    for (const kind of ["image", "speech", "transcription", "video"] as const) {
      const rawKind =
        rawDefaults[kind] && typeof rawDefaults[kind] === "object"
          ? (rawDefaults[kind] as Record<string, unknown>)
          : {};
      defaults[kind] = {
        modelRef: normalizeOptionalText(rawKind.modelRef) ?? null,
        options: normalizeMediaOptions(rawKind.options),
      };
    }
    return { version: 1, defaults };
  } catch {
    return cloneDefaultMediaSettings();
  }
}

function selectConfiguredMediaModel(
  kind: MediaGenerationKind,
  settings: MediaGenerationSettings,
  models: ManagedModelInfo[],
): string | null {
  const supports = (model: ManagedModelInfo): boolean =>
    model.enabled && model.hasApiKey && modelSupportsMediaKind(model, kind);
  const configured = settings.defaults[kind]?.modelRef;
  if (configured) {
    const selected = models.find((model) => model.ref === configured);
    if (selected && supports(selected)) return selected.ref;
  }
  return models.find(supports)?.ref ?? null;
}

function findAudioAttachment(
  messages: readonly UIMessage[],
  sourceFilename?: string,
): { url: string; mediaType?: string; filename?: string } | null {
  const normalizedName = normalizeOptionalText(sourceFilename)?.toLowerCase();
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const parts = Array.isArray(message.parts) ? [...message.parts].reverse() : [];
    for (const part of parts) {
      if (part.type !== "file" || !part.mediaType?.startsWith("audio/")) continue;
      const filename = part.filename;
      if (normalizedName && filename?.toLowerCase() !== normalizedName) continue;
      const url = part.url;
      if (url) return { url, mediaType: part.mediaType, filename };
    }
  }
  return null;
}

function modelSupportsMediaKind(model: ManagedModelInfo, kind: MediaGenerationKind): boolean {
  switch (kind) {
    case "image":
      return model.capabilities.imageOutput;
    case "speech":
      return model.capabilities.speechOutput;
    case "transcription":
      return model.capabilities.transcription;
    case "video":
      return model.capabilities.videoOutput;
  }
}

function normalizeMediaOptions(value: unknown): MediaGenerationOptions {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const options: MediaGenerationOptions = {};
  for (const key of [
    "size",
    "aspectRatio",
    "voice",
    "outputFormat",
    "language",
    "instructions",
    "resolution",
  ] as const) {
    const normalized = normalizeOptionalText(source[key]);
    if (normalized) options[key] = normalized;
  }
  for (const [key, integer] of [
    ["count", true],
    ["seed", true],
    ["speed", false],
    ["duration", false],
    ["fps", false],
  ] as const) {
    const value = source[key];
    if (value === undefined || value === null || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue))
      options[key] = integer ? Math.floor(numberValue) : numberValue;
  }
  if (typeof source.generateAudio === "boolean") options.generateAudio = source.generateAudio;
  return options;
}

function compactMediaOptions(
  kind: MediaGenerationKind,
  value: MediaGenerationOptions,
): MediaGenerationOptions {
  const normalized = normalizeMediaOptions(value);
  const keys = {
    image: ["size", "aspectRatio", "count", "seed"],
    speech: ["voice", "outputFormat", "speed", "language", "instructions"],
    transcription: ["language"],
    video: ["aspectRatio", "resolution", "duration", "fps", "generateAudio", "count", "seed"],
  }[kind] as readonly (keyof MediaGenerationOptions)[];
  return Object.fromEntries(
    keys
      .filter((key) => normalized[key] !== undefined && normalized[key] !== "")
      .map((key) => [key, normalized[key]]),
  ) as MediaGenerationOptions;
}

function cloneDefaultMediaSettings(): MediaGenerationSettings {
  return JSON.parse(JSON.stringify(DEFAULT_MEDIA_GENERATION_SETTINGS)) as MediaGenerationSettings;
}

function normalizeOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeCount(value: unknown, fallback: number, max: number): number {
  const numberValue = Math.floor(Number(value));
  if (!Number.isFinite(numberValue) || numberValue <= 0) return fallback;
  return Math.min(max, numberValue);
}

function normalizeInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.floor(numberValue) : undefined;
}

function normalizeNumberOption(value: unknown, min: number, max: number): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.min(max, Math.max(min, numberValue)) : undefined;
}

function normalizeSize(value: unknown): `${number}x${number}` | undefined {
  if (typeof value !== "string" || !/^\d+x\d+$/.test(value.trim())) return undefined;
  return value.trim() as `${number}x${number}`;
}

function normalizeAspectRatio(value: unknown): `${number}:${number}` | undefined {
  if (typeof value !== "string" || !/^\d+:\d+$/.test(value.trim())) return undefined;
  return value.trim() as `${number}:${number}`;
}

function normalizeOutputFormat(value: unknown): string | undefined {
  return normalizeOptionalText(value);
}

function defaultSpeechVoice(providerKind: string | undefined): string | undefined {
  if (providerKind === "google") return "Kore";
  if (providerKind === "openai" || providerKind === "openai-compatible") return "alloy";
  return undefined;
}

function dataUrlToUint8Array(url: string): Uint8Array {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/i.exec(url.trim());
  if (!match) throw new Error("audio.url must be a base64 data URL");
  return new Uint8Array(Buffer.from(match[2] ?? "", "base64"));
}

function withTranscriptionLanguage(
  providerOptions: Parameters<typeof transcribe>[0]["providerOptions"],
  providerId: string,
  language: unknown,
): Parameters<typeof transcribe>[0]["providerOptions"] {
  const normalized = normalizeOptionalText(language);
  if (!normalized) return providerOptions;
  return {
    ...providerOptions,
    [providerId]: {
      ...(providerOptions?.[providerId] as Record<string, unknown> | undefined),
      language: normalized,
    },
  };
}

function buildMediaMetadata(warnings: unknown, providerMetadata: unknown): Record<string, unknown> {
  return {
    warnings: Array.isArray(warnings) ? warnings : [],
    providerMetadata: providerMetadata ?? {},
  };
}

function getHttpErrorStatus(error: unknown): 400 | 500 {
  if (error && typeof error === "object" && (error as { status?: unknown }).status === 400) {
    return 400;
  }
  return 500;
}
