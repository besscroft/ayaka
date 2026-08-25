export const GENERIC_BINARY_MEDIA_TYPE = "application/octet-stream";

const MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
};

/**
 * Treat the generic binary MIME as unknown when a filename can provide a
 * more useful type. This repairs browser File objects and persisted
 * attachments whose original MIME was unavailable.
 */
export function inferAttachmentMediaType(filename?: string, declared?: string): string {
  const declaredType = normalizeMediaType(declared);
  if (isMimeType(declaredType) && declaredType !== GENERIC_BINARY_MEDIA_TYPE) return declaredType;

  const extension = filename
    ?.trim()
    .match(/\.[^.\\/]+$/)?.[0]
    ?.toLowerCase();
  return (
    MEDIA_TYPES_BY_EXTENSION[extension ?? ""] ??
    (isMimeType(declaredType) ? declaredType : GENERIC_BINARY_MEDIA_TYPE)
  );
}

function normalizeMediaType(value: string | undefined): string {
  return typeof value === "string" ? value.split(";", 1)[0]?.trim().toLowerCase() || "" : "";
}

function isMimeType(value: string): boolean {
  return /^[^\s/;,]+\/[^\s/;,]+$/.test(value);
}
