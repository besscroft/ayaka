import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { app, protocol } from "electron";
import type { MediaGenerationFile, MediaGenerationKind } from "../../shared/types";

const MEDIA_SCHEME = "ayaka-media";
const MEDIA_HOST = "asset";
let protocolRegistered = false;

export function getMediaDir(): string {
  return join(app.getPath("userData"), "media");
}

export function registerAyakaMediaProtocol(): void {
  if (protocolRegistered) return;
  protocol.registerFileProtocol(MEDIA_SCHEME, (request, callback) => {
    const path = resolveAyakaMediaPath(request.url);
    if (!path) {
      callback({ error: -6 });
      return;
    }
    callback({ path });
  });
  protocolRegistered = true;
}

export function writeMediaAsset({
  data,
  mediaType,
  kind,
  filename,
}: {
  data: Uint8Array;
  mediaType: string;
  kind: MediaGenerationKind;
  filename?: string;
}): MediaGenerationFile {
  const tool = toolForMediaType(mediaType, kind);
  const normalizedFilename = normalizeFilename(filename, kind, tool);
  const dir = getMediaDir();
  mkdirSync(dir, { recursive: true });
  const storedName = `${Date.now()}-${randomUUID()}.${tool}`;
  const filePath = join(dir, storedName);
  writeFileSync(filePath, data);
  return {
    type: "file",
    mediaType,
    filename: normalizedFilename,
    url: toAyakaMediaUrl(storedName),
    size: statSync(filePath).size,
  };
}

export function toAyakaMediaUrl(storedName: string): string {
  return `${MEDIA_SCHEME}://${MEDIA_HOST}/${encodeURIComponent(storedName)}`;
}

export function resolveAyakaMediaPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== MEDIA_SCHEME + ":" || parsed.hostname !== MEDIA_HOST) return null;
  const storedName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!/^[a-zA-Z0-9._-]+$/.test(storedName)) return null;

  const mediaDir = resolve(getMediaDir());
  const fullPath = resolve(mediaDir, storedName);
  if (fullPath !== mediaDir && !fullPath.startsWith(mediaDir + sep)) return null;
  return existsSync(fullPath) ? fullPath : null;
}

function toolForMediaType(mediaType: string, kind: MediaGenerationKind): string {
  const normalized = mediaType.toLowerCase().split(";")[0]?.trim() ?? "";
  const known: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/wave": "wav",
    "audio/x-wav": "wav",
    "audio/ogg": "ogg",
  };
  if (known[normalized]) return known[normalized];
  switch (kind) {
    case "image":
      return "png";
    case "speech":
      return "mp3";
    case "transcription":
      return "bin";
  }
}

function normalizeFilename(
  filename: string | undefined,
  kind: MediaGenerationKind,
  tool: string,
): string {
  const trimmed = filename?.trim();
  if (!trimmed) return defaultFilename(kind, tool);
  return /\.[a-z0-9]{1,8}$/i.test(trimmed) ? trimmed : `${trimmed}.${tool}`;
}
function defaultFilename(kind: MediaGenerationKind, tool: string): string {
  switch (kind) {
    case "image":
      return `image.${tool}`;
    case "speech":
      return `speech.${tool}`;
    case "transcription":
      return `audio.${tool}`;
  }
}
