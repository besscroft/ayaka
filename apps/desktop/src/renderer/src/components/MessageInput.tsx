import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import type {
  ChatPermissionMode,
  ChatReasoningLevel,
  ChatToolSelectionRequest,
  ProviderInfo,
} from "@shared/types";
import { inferAttachmentMediaType } from "@shared/media-type";
import { ModelSelector } from "./ModelSelector";
import { ReasoningSelector } from "./ReasoningSelector";
import { ToolSelector } from "./ToolSelector";
import { ChatPermissionSelector } from "./ChatPermissionSelector";
import {
  AttachmentChip,
  ContextPopover,
  PromptInput,
  PromptInputSubmit,
  SkillTokenInput,
  type SkillTokenInputHandle,
  type AttachmentItem,
  type ContextMetrics,
  type FilePartLike,
  type PromptInputMessage,
} from "./ai-elements";
import { IconCheck, IconPaperclip } from "./icons";
import { useT } from "../lib/i18n";
import { notify } from "../lib/toast";
import { cn } from "../lib/utils";
import type { MentionSkill } from "../lib/chat-tools";
import { getNextMentionSkillIndex } from "../lib/skill-menu";
import { isSkillOnlyInvocation } from "@shared/skill-invocation";

export interface PendingAttachment extends AttachmentItem {
  file: File;
}

export interface MessageInputProps {
  conversationId?: string;
  isLoading: boolean;
  isRunActive?: boolean;
  onSend: (payload: { text: string; files: FilePartLike[] }) => void;
  onStop?: () => void;
  selectedModel: string | null;
  reasoningLevel: ChatReasoningLevel;
  toolSelection: ChatToolSelectionRequest;
  permissionMode: ChatPermissionMode;
  permissionInherited: boolean;
  onModelChange: (modelRef: string | null) => void;
  onReasoningLevelChange: (level: ChatReasoningLevel) => void;
  onToolSelectionChange: (selection: ChatToolSelectionRequest) => void;
  onPermissionChange: (mode: ChatPermissionMode) => void;
  onPermissionReset: () => void;
  providers: ProviderInfo[];
  maxFileSize?: number;
  accept?: string;
  contextMetrics?: ContextMetrics;
  mentionSkills?: MentionSkill[];
}

const DEFAULT_ACCEPT =
  "image/*,audio/*,video/*,application/pdf,text/*,application/json,application/zip,application/msword,application/vnd.openxmlformats-officedocument.*";
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024;

export function MessageInput({
  conversationId,
  isLoading,
  isRunActive = isLoading,
  onSend,
  onStop,
  selectedModel,
  reasoningLevel,
  toolSelection,
  permissionMode,
  permissionInherited,
  onModelChange,
  onReasoningLevelChange,
  onToolSelectionChange,
  onPermissionChange,
  onPermissionReset,
  providers,
  maxFileSize = DEFAULT_MAX_SIZE,
  accept = DEFAULT_ACCEPT,
  contextMetrics,
  mentionSkills = [],
}: MessageInputProps): React.JSX.Element {
  const { t } = useT();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillMenuIndex, setSkillMenuIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<SkillTokenInputHandle | null>(null);
  const skillMenuRangeRef = useRef<{ start: number; end: number } | null>(null);
  const skillMenuIndexRef = useRef(0);
  const skillOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const resetSkillMenuIndex = useCallback((): void => {
    skillMenuIndexRef.current = 0;
    setSkillMenuIndex(0);
  }, []);

  const updateSkillMenu = useCallback(
    (value: string, cursor: number): void => {
      const beforeCursor = value.slice(0, cursor);
      const match = /(?:^|\s)\/([^\s]*)$/.exec(beforeCursor);
      const query = match?.[1] ?? "";
      if (!match || query.startsWith("skill:")) {
        skillMenuRangeRef.current = null;
        setSkillMenuOpen(false);
        setSkillQuery("");
        resetSkillMenuIndex();
        return;
      }
      const slashOffset = match[0].indexOf("/");
      skillMenuRangeRef.current = {
        start: (match.index ?? 0) + slashOffset,
        end: cursor,
      };
      setSkillQuery(query);
      resetSkillMenuIndex();
      setSkillMenuOpen(true);
    },
    [resetSkillMenuIndex],
  );

  const filteredMentionSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    if (!query) return mentionSkills;
    return mentionSkills.filter((skill) =>
      `${skill.id} ${skill.name} ${skill.description}`.toLowerCase().includes(query),
    );
  }, [mentionSkills, skillQuery]);

  const closeSkillMenu = useCallback(
    (focusInput: boolean): void => {
      setSkillMenuOpen(false);
      setSkillQuery("");
      skillMenuRangeRef.current = null;
      resetSkillMenuIndex();
      if (focusInput) requestAnimationFrame(() => editorRef.current?.focus());
    },
    [resetSkillMenuIndex],
  );

  const selectMentionSkill = useCallback(
    (skill: MentionSkill): void => {
      const range = skillMenuRangeRef.current;
      if (!range) return;
      const token = `/skill:${skill.id} `;
      const next = input.slice(0, range.start) + token + input.slice(range.end);
      const cursor = range.start + token.length;
      setInput(next);
      closeSkillMenu(false);
      requestAnimationFrame(() => {
        editorRef.current?.focus();
        editorRef.current?.setCaretOffset(cursor);
      });
    },
    [closeSkillMenu, input],
  );

  useEffect(() => {
    const handleInsertPrompt = (event: Event): void => {
      const detail = (event as CustomEvent<{ conversationId?: string; text?: string }>).detail;
      if (
        !conversationId ||
        detail?.conversationId !== conversationId ||
        typeof detail.text !== "string" ||
        detail.text.trim().length === 0
      ) {
        return;
      }
      setInput((current) => (current.trim() ? `${current}\n\n${detail.text}` : detail.text!));
      requestAnimationFrame(() => editorRef.current?.focus());
    };
    window.addEventListener("ayaka:mcp-insert-prompt", handleInsertPrompt);
    return () => window.removeEventListener("ayaka:mcp-insert-prompt", handleInsertPrompt);
  }, [conversationId]);
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
    if (attachments.length === 0 && isSkillOnlyInvocation(message.text)) {
      notify.error(t("input.error.skillOnly"));
      return;
    }
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
          mediaType: inferAttachmentMediaType(file.name, file.type),
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

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
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

  const handleSkillMenuKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (!skillMenuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeSkillMenu(true);
      return;
    }
    const nextIndex = getNextMentionSkillIndex(
      skillMenuIndexRef.current,
      filteredMentionSkills.length,
      event.key,
    );
    if (nextIndex !== null) {
      event.preventDefault();
      event.stopPropagation();
      skillMenuIndexRef.current = nextIndex;
      setSkillMenuIndex(nextIndex);
      requestAnimationFrame(() =>
        skillOptionRefs.current[nextIndex]?.scrollIntoView({ block: "nearest" }),
      );
      return;
    }
    if ((event.key === "Enter" || event.key === "Tab") && filteredMentionSkills.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const selectedSkill = filteredMentionSkills[skillMenuIndexRef.current];
      if (selectedSkill) selectMentionSkill(selectedSkill);
      return;
    }
  };

  const handlePromptKeyDownCapture = (event: KeyboardEvent<HTMLElement>): void => {
    handleSkillMenuKeyDown(event);
    if (
      event.defaultPrevented ||
      event.key !== "/" ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      skillMenuOpen
    ) {
      return;
    }

    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      updateSkillMenu(editor.getValue(), editor.getCaretOffset());
    });
  };

  const handleKeyDownExtra = (event: KeyboardEvent<HTMLDivElement>): void => {
    handleSkillMenuKeyDown(event);
    if (event.defaultPrevented) return;
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.closest("form")?.requestSubmit();
    }
  };

  return (
    <div
      className="shrink-0 bg-background/70 px-3 pb-2 pt-1 backdrop-blur-xl sm:px-4"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="mx-auto w-full max-w-[min(1400px,100%)]">
        <div
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
          <div className="px-2 pb-1 pt-2">
            <PromptInput
              value={input}
              status={isLoading ? "streaming" : "ready"}
              onSubmit={handleSubmit}
              onKeyDownCapture={handlePromptKeyDownCapture}
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

              <SkillTokenInput
                ref={editorRef}
                value={input}
                skills={mentionSkills}
                onValueChange={(value, caretOffset) => {
                  setInput(value);
                  updateSkillMenu(value, caretOffset);
                }}
                onPaste={handlePaste}
                onKeyDown={handleKeyDownExtra}
                placeholder={
                  attachments.length > 0
                    ? t("input.placeholder.withAttachments")
                    : t("input.placeholder")
                }
                aria-label={t("input.placeholder")}
                aria-expanded={skillMenuOpen}
                aria-controls={skillMenuOpen ? "skill-mention-menu" : undefined}
                aria-activedescendant={
                  skillMenuOpen && filteredMentionSkills.length > 0
                    ? `skill-mention-option-${skillMenuIndex}`
                    : undefined
                }
                className="min-h-16 px-1 py-0 select-text sm:min-h-20"
              />

              {skillMenuOpen ? (
                <div
                  role="listbox"
                  aria-label={t("skill.selector.title")}
                  id="skill-mention-menu"
                  data-slot="skill-mention-menu"
                  onKeyDown={handleSkillMenuKeyDown}
                  className="absolute inset-x-3 bottom-[4.25rem] z-20 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1.5 shadow-xl"
                >
                  <div className="px-2.5 py-1.5 text-[11px] font-medium text-foreground/55">
                    {skillQuery ? t("skill.selector.search") : t("skill.selector.hint")}
                  </div>
                  {filteredMentionSkills.length > 0 ? (
                    filteredMentionSkills.map((skill, index) => {
                      const active = index === skillMenuIndex;
                      return (
                        <button
                          key={skill.id}
                          ref={(node) => {
                            skillOptionRefs.current[index] = node;
                          }}
                          id={`skill-mention-option-${index}`}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          aria-selected={active}
                          data-active={active ? "true" : undefined}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectMentionSkill(skill)}
                          className={cn(
                            "flex w-full min-w-0 items-start gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors",
                            active
                              ? "bg-accent text-accent-foreground ring-1 ring-accent/60"
                              : "text-foreground/80 hover:bg-muted",
                          )}
                        >
                          <span className="flex min-w-0 flex-1 items-start gap-2">
                            {active ? <IconCheck className="mt-0.5 size-3.5 shrink-0" /> : null}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold">
                                {skill.name}
                              </span>
                              <span
                                className={cn(
                                  "mt-0.5 block truncate text-[11px]",
                                  active ? "text-accent-foreground/75" : "text-foreground/50",
                                )}
                              >
                                {skill.description || skill.id}
                              </span>
                            </span>
                          </span>
                          <span
                            className={cn(
                              "shrink-0 pt-0.5 text-[10px]",
                              active ? "text-accent-foreground/75" : "text-foreground/40",
                            )}
                          >
                            {skill.id}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="px-2.5 py-2 text-xs text-foreground/50">
                      {t("skill.selector.empty")}
                    </div>
                  )}
                </div>
              ) : null}

              <div className="relative mt-1 flex min-h-11 flex-wrap items-center gap-2 px-0 pt-0">
                <div className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-icon-only="true"
                    data-icon-tone="neutral"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label={t("input.attach")}
                    title={t("input.attach")}
                    data-slot="prompt-input-attach"
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
                </div>

                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
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
                  <PromptInputSubmit
                    status="ready"
                    disabled={!canSend}
                    aria-label={t("input.send")}
                    className="size-8"
                  />
                  {isRunActive && onStop ? (
                    <button
                      type="button"
                      data-icon-only="true"
                      data-icon-tone="danger"
                      onClick={onStop}
                      aria-label={t("input.stop")}
                      data-slot="prompt-input-stop"
                      className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground/80 transition hover:bg-accent"
                    >
                      <span className="size-3 rounded-[2px] bg-current" aria-hidden />
                    </button>
                  ) : null}
                </div>
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
        <div
          data-slot="composer-toolbar"
          className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1"
        >
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <ToolSelector
              value={toolSelection}
              onChange={onToolSelectionChange}
              selectedModel={selectedModel}
              providers={providers}
              disabled={isRunActive}
            />
            <ChatPermissionSelector
              value={permissionMode}
              inherited={permissionInherited}
              onChange={onPermissionChange}
              onReset={onPermissionReset}
              disabled={isRunActive}
              compact
            />
          </div>
          {contextMetrics ? <ContextPopover metrics={contextMetrics} trigger="hover" /> : null}
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
