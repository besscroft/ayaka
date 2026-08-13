import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { useMediaResourceStates } from "../../lib/media-resource";
import { AttachmentChip } from "./attachment-chip";
import type { AttachmentItem } from "./attachment-chip";
import { sanitizeRichContentUrl } from "./rich-content-utils";

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
  if (parts.length === 0) return null;

  const items: AttachmentItem[] = parts.map((p, i) => ({
    id: `${p.type}-${i}`,
    name: p.filename ?? t("attachment.file"),
    mediaType: p.mediaType ?? "application/octet-stream",
    size: 0,
    url: states[`${p.type}-${i}`]?.url,
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

  return (
    <div data-slot="message-attachments" className={cn("flex w-full flex-col gap-2", className)}>
      {images.length > 0 && (
        <div
          className={cn(
            "grid gap-1.5",
            images.length === 1
              ? "grid-cols-1"
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
              errorText={t("attachment.loadFailed", { name: img.name })}
            />
          ))}
        </div>
      )}

      {audio.length > 0 && (
        <div className="flex flex-col gap-1.5">
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
        <div className="grid gap-2 sm:grid-cols-2">
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
        <div className="flex flex-wrap gap-1.5">
          {files.map((it) => (
            <AttachmentChip key={it.id} item={it} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function ImageTile({
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
}): ReactNode {
  const src = item.url ? sanitizeRichContentUrl(item.url, "image") : null;
  if (error) {
    return <MediaError text={errorText} square />;
  }
  if (loading) {
    return <MediaLoading name={item.name} square />;
  }
  if (!src) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">
        {item.name}
      </div>
    );
  }
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer noopener"
      className="group/tile relative block aspect-square overflow-hidden rounded-lg bg-muted"
      title={item.name}
    >
      <img
        src={src}
        alt={item.name}
        className="size-full object-cover transition group-hover/tile:scale-105"
        loading="lazy"
        onError={onError}
      />
    </a>
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
