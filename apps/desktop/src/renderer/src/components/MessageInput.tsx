import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type { ChatReasoningLevel, ChatToolSelectionRequest, ProviderInfo } from "@shared/types";
import { ModelSelector } from "./ModelSelector";
import { ReasoningSelector } from "./ReasoningSelector";
import { ToolSelector } from "./ToolSelector";
import {
  AttachmentChip,
  ContextPopover,
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type AttachmentItem,
  type ContextMetrics,
  type FilePartLike,
  type PromptInputMessage,
} from "./ai-elements";
import { IconPaperclip } from "./icons";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";

export interface PendingAttachment extends AttachmentItem {
  file: File;
}

interface MessageInputProps {
  isLoading: boolean;
  isRunActive?: boolean;
  onSend: (payload: { text: string; files: FilePartLike[] }) => void;
  onStop?: () => void;
  selectedModel: string | null;
  reasoningLevel: ChatReasoningLevel;
  toolSelection: ChatToolSelectionRequest;
  onModelChange: (modelRef: string | null) => void;
  onReasoningLevelChange: (level: ChatReasoningLevel) => void;
  onToolSelectionChange: (selection: ChatToolSelectionRequest) => void;
  providers: ProviderInfo[];
  maxFileSize?: number;
  accept?: string;
  contextMetrics?: ContextMetrics;
}

const DEFAULT_ACCEPT =
  "image/*,audio/*,video/*,application/pdf,text/*,application/json,application/zip,application/msword,application/vnd.openxmlformats-officedocument.*";
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

export function MessageInput({
  isLoading,
  isRunActive = isLoading,
  onSend,
  onStop,
  selectedModel,
  reasoningLevel,
  toolSelection,
  onModelChange,
  onReasoningLevelChange,
  onToolSelectionChange,
  providers,
  maxFileSize = DEFAULT_MAX_SIZE,
  accept = DEFAULT_ACCEPT,
  contextMetrics,
}: MessageInputProps): React.JSX.Element {
  const { t } = useT();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const selectedReasoningModel = useMemo(() => {
    if (!selectedModel) return undefined;
    const separator = selectedModel.indexOf("/");
    if (separator <= 0) return undefined;
    const providerId = selectedModel.slice(0, separator);
    const modelId = selectedModel.slice(separator + 1);
    return providers
      .find((provider) => provider.id === providerId)
      ?.models.find((model) => model.id === modelId);
  }, [providers, selectedModel]);

  const hasContent = input.trim().length > 0 || attachments.length > 0;
  const modelReady = !!selectedModel;
  const canSend = modelReady && hasContent;

  const handleSubmit = (message: PromptInputMessage): void => {
    if (!canSend) return;
    void flushSubmit(message.text);
  };

  const flushSubmit = async (text: string): Promise<void> => {
    try {
      const files: FilePartLike[] = await Promise.all(
        attachments.map(async (attachment) => ({
          type: "file",
          mediaType: attachment.mediaType,
          filename: attachment.name,
          url: await readFileAsDataURL(attachment.file),
        })),
      );
      onSend({ text, files });
      setInput("");
      setAttachments([]);
    } catch (error) {
      console.error("[MessageInput] failed to read attachments:", error);
    }
  };

  const ingestFiles = useCallback(
    (files: FileList | File[]) => {
      const next: PendingAttachment[] = [];
      for (const file of Array.from(files)) {
        if (file.size > maxFileSize) {
          console.warn(
            `[MessageInput] skip ${file.name}: ${(file.size / 1024 / 1024).toFixed(1)}MB > limit`,
          );
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          mediaType: file.type || "application/octet-stream",
          size: file.size,
        });
      }
      if (next.length > 0) setAttachments((current) => [...current, ...next]);
    },
    [maxFileSize],
  );

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (event.currentTarget.files) ingestFiles(event.currentTarget.files);
    event.currentTarget.value = "";
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer?.files) ingestFiles(event.dataTransfer.files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = event.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind !== "file") continue;
      const pasted = item.getAsFile();
      if (!pasted) continue;
      if (!pasted.name) {
        const extension = (pasted.type.split("/")[1] || "png").toLowerCase();
        files.push(new File([pasted], `pasted-${Date.now()}.${extension}`, { type: pasted.type }));
      } else {
        files.push(pasted);
      }
    }
    if (files.length > 0) {
      event.preventDefault();
      ingestFiles(files);
    }
  };

  const handleKeyDownExtra = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <div className="shrink-0 bg-background/70 px-3 pb-3 pt-2 backdrop-blur-xl sm:px-4">
      <div className="mx-auto w-full max-w-[min(1400px,100%)]">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "select-none rounded-lg border bg-background/95 shadow-lg transition-all duration-200",
            "focus-within:border-accent/45 focus-within:ring-4 focus-within:ring-accent/10",
            isDragging
              ? "border-accent/60 ring-4 ring-accent/15"
              : modelReady
                ? "border-border"
                : "border-warning/35",
          )}
        >
          <div className="px-4 pb-2 pt-4">
            <PromptInput
              status={isLoading ? "streaming" : "ready"}
              onSubmit={handleSubmit}
              className="relative"
            >
              {attachments.length > 0 ? (
                <div
                  className="mb-2 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pb-1"
                  data-slot="composer-attachments"
                >
                  {attachments.map((attachment) => (
                    <AttachmentChip
                      key={attachment.id}
                      item={attachment}
                      onRemove={(id) =>
                        setAttachments((current) => current.filter((item) => item.id !== id))
                      }
                    />
                  ))}
                </div>
              ) : null}

              <PromptInputTextarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.currentTarget.value)}
                onPaste={handlePaste}
                onKeyDown={handleKeyDownExtra}
                placeholder={
                  attachments.length > 0
                    ? t("input.placeholder.withAttachments")
                    : t("input.placeholder")
                }
                aria-label={t("input.placeholder")}
                className="select-text"
              />

              <div className="relative flex min-h-11 items-start gap-2 px-3 pt-2">
                <div className="inline-flex w-fit min-w-0 max-w-[calc(100%-2.75rem)] flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={t("input.attach")}
                    title={t("input.attach")}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  >
                    <IconPaperclip className="size-4" />
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={accept}
                    onChange={handleFileInputChange}
                    className="hidden"
                    aria-hidden
                  />

                  <span className="mx-1 h-4 w-px shrink-0 bg-border" />

                  <ToolSelector
                    value={toolSelection}
                    onChange={onToolSelectionChange}
                    selectedModel={selectedModel}
                    providers={providers}
                    disabled={isRunActive}
                  />
                  <ModelSelector
                    value={selectedModel}
                    onChange={onModelChange}
                    placement="top"
                    disabled={isRunActive}
                  />
                  <ReasoningSelector
                    value={reasoningLevel}
                    onChange={onReasoningLevelChange}
                    placement="top"
                    model={selectedReasoningModel}
                    disabled={isRunActive}
                  />
                  {contextMetrics ? (
                    <ContextPopover metrics={contextMetrics} trigger="hover" className="ml-1" />
                  ) : null}
                </div>

                <PromptInputSubmit
                  status="ready"
                  disabled={!canSend}
                  aria-label={t("input.send")}
                  className="ml-auto size-8"
                />
                {isRunActive && onStop ? (
                  <button
                    type="button"
                    onClick={onStop}
                    aria-label={t("input.stop")}
                    data-slot="prompt-input-stop"
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground/80 transition hover:bg-accent"
                  >
                    <span className="size-3 rounded-[2px] bg-current" aria-hidden />
                  </button>
                ) : null}
              </div>

              {isDragging ? (
                <div
                  data-slot="composer-drop-overlay"
                  className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 text-sm text-primary"
                >
                  {t("input.dropHint")}
                </div>
              ) : null}
            </PromptInput>

            {!modelReady ? (
              <p
                id="message-input-model-warning"
                className="mt-2 inline-flex max-w-full rounded-full bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning"
              >
                {t("input.noModel")}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read file as a data URL"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
