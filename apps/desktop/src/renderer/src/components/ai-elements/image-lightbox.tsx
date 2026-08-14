import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FolderOpen, X } from "lucide-react";
import { api } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { notify } from "../../lib/toast";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { clampImageIndex, wrapImageIndex } from "./image-lightbox-model";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

export interface ImageLightboxItem {
  id: string;
  name: string;
  mediaType: string;
  src: string;
  workspacePath?: string;
}

interface ImageLightboxProps {
  open: boolean;
  conversationId?: string;
  images: ImageLightboxItem[];
  initialIndex: number;
  onOpenChange: (open: boolean) => void;
}

export function ImageLightbox({
  open,
  conversationId,
  images,
  initialIndex,
  onOpenChange,
}: ImageLightboxProps): React.JSX.Element {
  const { t, locale } = useT();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [saving, setSaving] = useState(false);
  const image = images[currentIndex] ?? images[0];
  const hasMultiple = images.length > 1;

  useEffect(() => {
    if (!open) return;
    setCurrentIndex(clampImageIndex(initialIndex, images.length));
  }, [images.length, initialIndex, open]);

  const move = useCallback(
    (direction: -1 | 1) => {
      if (images.length < 2) return;
      setCurrentIndex((index) => wrapImageIndex(index, direction, images.length));
    },
    [images.length],
  );

  useEffect(() => {
    if (!open || images.length < 2) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        move(1);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [images.length, move, open]);

  const saveImage = useCallback(async (): Promise<void> => {
    if (!image || saving) return;
    setSaving(true);
    try {
      const response = await fetch(image.src);
      if (!response.ok) throw new Error(`Image request failed with status ${response.status}.`);
      const result = await api.workspace.saveMediaAs({
        filename: image.name,
        mediaType: image.mediaType,
        data: await response.arrayBuffer(),
      });
      if (result.saved) notify.success(t("image.toast.saved"));
    } catch (error) {
      notify.error(t("image.toast.saveFailed"), error, locale);
    } finally {
      setSaving(false);
    }
  }, [image, locale, saving, t]);

  const revealImage = useCallback(async (): Promise<void> => {
    if (!conversationId || !image?.workspacePath) return;
    try {
      await api.workspace.revealFile({ conversationId, path: image.workspacePath });
    } catch (error) {
      notify.error(t("image.toast.revealFailed"), error, locale);
    }
  }, [conversationId, image, locale, t]);

  const counter = useMemo(
    () =>
      hasMultiple
        ? t("image.lightbox.counter", { current: currentIndex + 1, total: images.length })
        : "",
    [currentIndex, hasMultiple, images.length, t],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[calc(100vh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none gap-0 rounded-xl border-border/60 bg-black/95 p-0 text-white shadow-2xl transition-[opacity,transform] duration-200 ease-out"
      >
        <DialogTitle className="sr-only">{t("image.lightbox.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("image.lightbox.description")}</DialogDescription>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8">
          {image ? (
            <img
              key={image.id}
              src={image.src}
              alt={image.name}
              className="max-h-[85vh] max-w-[90vw] object-contain"
              draggable={false}
            />
          ) : null}

          {hasMultiple && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/70 hover:text-white sm:left-6"
                aria-label={t("image.action.previous")}
                title={t("image.action.previous")}
                onPress={() => move(-1)}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/45 text-white hover:bg-black/70 hover:text-white sm:right-6"
                aria-label={t("image.action.next")}
                title={t("image.action.next")}
                onPress={() => move(1)}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="absolute right-3 top-3 rounded-full bg-black/45 text-white hover:bg-black/70 hover:text-white sm:right-6 sm:top-6"
            aria-label={t("image.action.close")}
            title={t("image.action.close")}
            onPress={() => onOpenChange(false)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>

        <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-white/10 px-3 py-2 sm:px-5">
          <div className="min-w-0 text-xs text-white/65">
            <div className="truncate" title={image?.name}>
              {image?.name}
            </div>
            {counter ? <div className="mt-0.5 text-white/45">{counter}</div> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {image?.workspacePath && conversationId ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 hover:bg-white/10 hover:text-white"
                aria-label={t("image.action.reveal")}
                title={t("image.action.reveal")}
                onPress={() => void revealImage()}
              >
                <FolderOpen aria-hidden="true" />
                <span className="hidden sm:inline">{t("image.action.reveal")}</span>
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              className={cn("border-white/15 bg-white/10 text-white hover:bg-white/20")}
              isPending={saving}
              aria-label={t("image.action.save")}
              title={t("image.action.save")}
              onPress={() => void saveImage()}
            >
              <Download aria-hidden="true" />
              <span className="hidden sm:inline">{t("image.action.save")}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
