import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";
import { api } from "../../lib/api";
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
  if (parts.length === 0) return null;

  const [workspaceUrls, setWorkspaceUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    setWorkspaceUrls({});
    void Promise.all(
      parts.map(async (part, index): Promise<[string, string] | null> => {
        const url = part.url ?? part.data;
        if (!conversationId || !url?.startsWith("workspace://")) return null;
        const content = await api.workspace.read({
          conversationId,
          path: url.slice("workspace://".length),
        });
        const blobUrl = URL.createObjectURL(
          new Blob([new Uint8Array(content.data)], { type: content.mediaType }),
        );
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return null;
        }
        created.push(blobUrl);
        return [`${part.type}-${index}`, blobUrl];
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setWorkspaceUrls(Object.fromEntries(entries.filter((entry) => entry !== null)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [conversationId, parts]);

  const items: AttachmentItem[] = parts.map((p, i) => ({
    id: `${p.type}-${i}`,
    name: p.filename ?? t("attachment.file"),
    mediaType: p.mediaType ?? "application/octet-stream",
    size: 0,
    url: workspaceUrls[`${p.type}-${i}`] ?? p.url ?? p.data,
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
            <ImageTile key={img.id} item={img} />
          ))}
        </div>
      )}

      {audio.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {audio.map((item) => (
            <AudioAttachment key={item.id} item={item} />
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {videos.map((item) => (
            <VideoAttachment key={item.id} item={item} />
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

function ImageTile({ item }: { item: AttachmentItem }): ReactNode {
  const src = item.url ? sanitizeRichContentUrl(item.url, "image") : null;
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
      />
    </a>
  );
}

function AudioAttachment({ item }: { item: AttachmentItem }): React.JSX.Element {
  const src = item.url ? sanitizeRichContentUrl(item.url, "media") : null;
  if (!src) return <AttachmentChip item={item} compact />;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2">
      <div className="mb-1 truncate text-xs font-medium text-foreground" title={item.name}>
        {item.name}
      </div>
      <audio controls src={src} className="w-full" preload="metadata" />
    </div>
  );
}

function VideoAttachment({ item }: { item: AttachmentItem }): React.JSX.Element {
  const src = item.url ? sanitizeRichContentUrl(item.url, "media") : null;
  if (!src) return <AttachmentChip item={item} compact />;
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30" title={item.name}>
      <video
        controls
        src={src}
        className="aspect-video w-full bg-black object-contain"
        preload="metadata"
      />
      <div className="truncate px-2 py-1.5 text-xs font-medium text-foreground">{item.name}</div>
    </div>
  );
}
