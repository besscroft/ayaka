import { useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { useMediaResourceStates } from "../../lib/media-resource";
import { AttachmentChip } from "./attachment-chip";
import type { AttachmentItem } from "./attachment-chip";
import { sanitizeRichContentUrl } from "./rich-content-utils";
import { ImageLightbox, type ImageLightboxItem } from "./image-lightbox";

export interface FilePartLike {
  type: string;
  mediaType?: string;
  filename?: string;
  url?: string;
  data?: string;
}

interface MessageAttachmentsProps {
  conversationId?: string;
  parts: FilePartLike[];
  className?: string;
}

export function MessageAttachments({
  conversationId,
  parts,
  className,
}: MessageAttachmentsProps): React.JSX.Element | null {
  const { t } = useT();
  const { states, markFailed } = useMediaResourceStates(conversationId, parts);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (parts.length === 0) return null;

  const items: Array<AttachmentItem & { workspacePath?: string }> = parts.map((p, i) => ({
    id: `${p.type}-${i}`,
    name: p.filename ?? t("attachment.file"),
    mediaType: p.mediaType ?? "application/octet-stream",
    size: 0,
    url: states[`${p.type}-${i}`]?.url,
    workspacePath: p.url?.startsWith("workspace://")
      ? p.url.slice("workspace://".length)
      : undefined,
    variant: p.mediaType?.startsWith("image/")
      ? "image"
      : p.mediaType?.startsWith("video/")
        ? "video"
        : p.mediaType?.startsWith("audio/")
          ? "audio"
          : "file",
  }));

  const images = items.filter((it) => it.variant === "image");
  const audio = items.filter((it) => it.variant === "audio");
  const videos = items.filter((it) => it.variant === "video");
  const files = items.filter(
    (it) => it.variant !== "image" && it.variant !== "audio" && it.variant !== "video",
  );

  const lightboxImages: ImageLightboxItem[] = images.flatMap((item) => {
    const src = item.url ? sanitizeRichContentUrl(item.url, "image") : null;
    return src
      ? [
          {
            id: item.id,
            name: item.name,
            mediaType: item.mediaType,
            src,
            workspacePath: item.workspacePath,
          },
        ]
      : [];
  });

  return (
    <div data-slot="message-attachments" className={cn("flex w-full flex-col gap-2", className)}>
      {images.length > 0 && (
        <div
          data-slot="message-image-grid"
          className={cn(
            "grid max-w-[420px] gap-1.5",
            images.length === 1
              ? "w-fit max-w-full grid-cols-1"
              : images.length === 2
                ? "grid-cols-2"
                : "grid-cols-3",
          )}
        >
          {images.map((img) => (
            <ImageTile
              key={img.id}
              item={img}
              loading={states[img.id]?.loading === true}
              error={states[img.id]?.error === true}
              onError={() => markFailed(img.id)}
              onOpen={() => {
                const index = lightboxImages.findIndex((image) => image.id === img.id);
                if (index >= 0) setLightboxIndex(index);
              }}
              compact={images.length > 1}
              openLabel={t("image.action.open", { name: img.name })}
              errorText={t("attachment.loadFailed", { name: img.name })}
            />
          ))}
        </div>
      )}

      {audio.length > 0 && (
        <div data-slot="message-audio-list" className="flex flex-col gap-1.5">
          {audio.map((item) => (
            <AudioAttachment
              key={item.id}
              item={item}
              loading={states[item.id]?.loading === true}
              error={states[item.id]?.error === true}
              onError={() => markFailed(item.id)}
              errorText={t("attachment.loadFailed", { name: item.name })}
            />
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div data-slot="message-video-list" className="grid gap-2 sm:grid-cols-2">
          {videos.map((item) => (
            <VideoAttachment
              key={item.id}
              item={item}
              loading={states[item.id]?.loading === true}
              error={states[item.id]?.error === true}
              onError={() => markFailed(item.id)}
              errorText={t("attachment.loadFailed", { name: item.name })}
            />
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div data-slot="message-file-list" className="flex flex-wrap gap-1.5">
          {files.map((it) => (
            <AttachmentChip key={it.id} item={it} compact />
          ))}
        </div>
      )}

      <ImageLightbox
        open={lightboxIndex !== null}
        conversationId={conversationId}
        images={lightboxImages}
        initialIndex={lightboxIndex ?? 0}
        onOpenChange={(open) => {
          if (!open) setLightboxIndex(null);
        }}
      />
    </div>
  );
}

function ImageTile({
  item,
  loading,
  error,
  onError,
  onOpen,
  compact,
  openLabel,
  errorText,
}: {
  item: AttachmentItem;
  loading: boolean;
  error: boolean;
  onError: () => void;
  onOpen: () => void;
  compact: boolean;
  openLabel: string;
  errorText: string;
}): ReactNode {
  const src = item.url ? sanitizeRichContentUrl(item.url, "image") : null;
  if (error) {
    return <MediaError text={errorText} square={compact} />;
  }
  if (loading) {
    return <MediaLoading name={item.name} square={compact} />;
  }
  if (!src) {
    return (
      <div className="flex min-h-20 items-center justify-center rounded-lg bg-muted px-3 text-center text-xs text-muted-foreground">
        {item.name}
      </div>
    );
  }
  return (
    <button
      type="button"
      className={cn(
        "group/tile relative flex min-w-0 items-center justify-center overflow-hidden rounded-lg bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
        compact ? "aspect-[4/3]" : "max-h-[320px] max-w-full",
      )}
      title={item.name}
      aria-label={openLabel}
      onClick={onOpen}
    >
      <img
        src={src}
        alt={item.name}
        className={cn(
          "block max-w-full object-contain",
          compact ? "max-h-full max-w-full" : "max-h-[320px] max-w-[420px]",
        )}
        loading="lazy"
        draggable={false}
        onError={onError}
      />
    </button>
  );
}

function AudioAttachment({
  item,
  loading,
  error,
  onError,
  errorText,
}: {
  item: AttachmentItem;
  loading: boolean;
  error: boolean;
  onError: () => void;
  errorText: string;
}): React.JSX.Element {
  const src = item.url ? sanitizeRichContentUrl(item.url, "media") : null;
  if (error) return <MediaError text={errorText} />;
  if (loading) return <MediaLoading name={item.name} />;
  if (!src) return <AttachmentChip item={item} compact />;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2">
      <div className="mb-1 truncate text-xs font-medium text-foreground" title={item.name}>
        {item.name}
      </div>
      <audio controls src={src} className="w-full" preload="metadata" onError={onError} />
    </div>
  );
}

function VideoAttachment({
  item,
  loading,
  error,
  onError,
  errorText,
}: {
  item: AttachmentItem;
  loading: boolean;
  error: boolean;
  onError: () => void;
  errorText: string;
}): React.JSX.Element {
  const src = item.url ? sanitizeRichContentUrl(item.url, "media") : null;
  if (error) return <MediaError text={errorText} />;
  if (loading) return <MediaLoading name={item.name} />;
  if (!src) return <AttachmentChip item={item} compact />;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30" title={item.name}>
      <video
        controls
        src={src}
        className="aspect-video w-full bg-black object-contain"
        preload="metadata"
        onError={onError}
      />
      <div className="truncate px-2 py-1.5 text-xs font-medium text-foreground">{item.name}</div>
    </div>
  );
}

function MediaLoading({
  name,
  square = false,
}: {
  name: string;
  square?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg bg-muted px-3 text-center text-xs text-muted-foreground",
        square ? "aspect-square" : "rounded-lg border border-border bg-muted/30 py-2",
      )}
    >
      {name}
    </div>
  );
}

function MediaError({
  text,
  square = false,
}: {
  text: string;
  square?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-lg border border-danger/30 bg-danger/10 px-3 text-center text-xs text-danger",
        square ? "aspect-square" : "py-2",
      )}
    >
      {text}
    </div>
  );
}
