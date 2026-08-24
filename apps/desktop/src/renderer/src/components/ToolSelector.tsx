import { useCallback, useEffect, useMemo, useState, type SVGProps } from "react";
import {
  Button,
  Chip,
  Popover,
  PopoverContent,
  PopoverDialog,
  PopoverHeading,
  PopoverTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "./ui";
import {
  CHAT_TOOL_IDS,
  isChatToolId,
  isChatToolMode,
  normalizeChatToolSelection,
  type ChatToolReference,
  type ChatToolDescriptor,
  type ChatToolId,
  type ChatToolMode,
  type ChatToolSelectionRequest,
  type ToolsSnapshot,
  type ProviderInfo,
} from "@shared/types";
import { api } from "../lib/api";
import {
  createClientChatToolDescriptors,
  filterUserVisibleChatToolDescriptors,
  getActiveChatToolIds,
} from "../lib/chat-tools";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import {
  IconBookOpen,
  IconCheck,
  IconCheckSquare,
  IconClock,
  IconCircle,
  IconCpu,
  IconDatabase,
  IconGlobe,
  IconList,
  IconMessage,
  IconTrash,
  IconTerminal,
  IconWrench,
} from "./icons";

interface ToolSelectorProps {
  value: ChatToolSelectionRequest;
  onChange: (next: ChatToolSelectionRequest) => void;
  selectedModel: string | null;
  providers: ProviderInfo[];
  disabled?: boolean;
}

const ICONS: Record<ChatToolId, (props: SVGProps<SVGSVGElement>) => React.JSX.Element> = {
  web_search: IconGlobe,
  web_open: IconGlobe,
  file_search: IconDatabase,
  code_interpreter: IconCpu,
  tool_search: IconList,
  current_time: IconClock,
  memory_search: IconDatabase,
  runtime_snapshot: IconList,
  model_capabilities: IconCpu,
  conversation_search: IconMessage,
  memory_save: IconWrench,
  memory_update: IconWrench,
  memory_delete: IconTrash,
  sandbox_list_files: IconList,
  sandbox_read_file: IconList,
  sandbox_write_file: IconWrench,
  sandbox_run_command: IconCpu,
  sandbox_snapshot: IconDatabase,
  sandbox_restore: IconDatabase,
  sandbox_list_artifacts: IconList,
  sandbox_preview_port: IconGlobe,
  sandbox_publish_artifact: IconBookOpen,
  sandbox_start_preview: IconGlobe,
  workspace_run_command: IconTerminal,
  cron: IconClock,
};

export function ToolSelector({
  value,
  onChange,
  selectedModel,
  providers,
  disabled = false,
}: ToolSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [tools, setTools] = useState<ToolsSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const selection = normalizeChatToolSelection(value);

  const refreshToolsSnapshot = useCallback(async (): Promise<void> => {
    try {
      setTools(await api.tools.snapshot());
    } catch {
      setTools(null);
    }
  }, []);

  useEffect(() => {
    void refreshToolsSnapshot();
    return api.mcp.onToolsChanged(() => void refreshToolsSnapshot());
  }, [refreshToolsSnapshot]);

  const descriptors = useMemo(
    () =>
      filterUserVisibleChatToolDescriptors(
        createClientChatToolDescriptors({ selectedModel, providers, tools }),
      ),
    [tools, providers, selectedModel],
  );
  const orderedDescriptors = useMemo(() => orderToolDescriptors(descriptors), [descriptors]);
  const activeToolIds = getActiveChatToolIds(selection, descriptors);
  const canUseAnyTool = descriptors.some((descriptor) => descriptor.available);
  const isDisabled = disabled || !canUseAnyTool;
  const summary = getSummaryLabel(selection.mode, activeToolIds.length, t);

  const updateMode = (mode: ChatToolMode): void => {
    onChange({ ...selection, mode });
  };

  const updateManualTool = (id: ChatToolReference): void => {
    const descriptor = descriptors.find((item) => item.id === id);
    if (!descriptor?.available) return;
    const availableIds = new Set(
      descriptors.filter((descriptor) => descriptor.available).map((descriptor) => descriptor.id),
    );
    const selected = new Set(selection.selectedToolIds.filter((item) => availableIds.has(item)));
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    onChange({ mode: "manual", selectedToolIds: Array.from(selected) });
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) void refreshToolsSnapshot();
      }}
    >
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger>
            <Button
              type="button"
              isIconOnly
              size="sm"
              variant="tertiary"
              isDisabled={isDisabled}
              aria-label={t("chatTools.selector.label")}
              className={cn(
                "relative size-8 shrink-0 rounded-xl text-foreground/65",
                activeToolIds.length > 0 && "text-primary",
              )}
            >
              <IconWrench className="size-4" />
              {activeToolIds.length > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-accent-foreground">
                  {activeToolIds.length}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{summary}</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="z-[1000] w-[420px] max-w-[calc(100vw-1rem)] select-none overflow-hidden rounded-lg border border-border bg-popover p-0 shadow-lg"
      >
        <PopoverDialog className="flex max-h-[min(560px,calc(100vh-7rem))] min-w-0 flex-col bg-background outline-none">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <PopoverHeading className="text-sm font-semibold text-foreground">
                {t("chatTools.selector.title")}
              </PopoverHeading>
              <p className="mt-0.5 max-w-[30rem] text-xs leading-relaxed text-foreground/55">
                {t("chatTools.selector.description")}
              </p>
            </div>
            <Chip size="sm" variant="secondary" className="shrink-0">
              <Chip.Label>{summary}</Chip.Label>
            </Chip>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <Tabs
              value={selection.mode}
              onValueChange={(key) => {
                if (isChatToolMode(key)) updateMode(key);
              }}
              aria-label={t("chatTools.mode.label")}
            >
              <TabsList className="w-full">
                <TabsTrigger value="off">{t("chatTools.mode.off")}</TabsTrigger>
                <TabsTrigger value="auto">{t("chatTools.mode.auto")}</TabsTrigger>
                <TabsTrigger value="manual">{t("chatTools.mode.manual")}</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="mt-3">
              {selection.mode === "manual" ? (
                <ManualToolGroup
                  orderedDescriptors={orderedDescriptors}
                  selectedIds={selection.selectedToolIds}
                  onToggle={updateManualTool}
                />
              ) : (
                <AutoToolList descriptors={orderedDescriptors} activeIds={activeToolIds} />
              )}
            </div>

            {!canUseAnyTool ? (
              <p className="mt-3 rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-xs leading-relaxed text-warning">
                {toolUnavailableReason(t, descriptors[0])}
              </p>
            ) : null}
          </div>

          {selection.mode === "manual" ? (
            <div className="shrink-0 border-t border-border px-4 py-3">
              <ActiveToolChips descriptors={descriptors} ids={activeToolIds} />
            </div>
          ) : null}
        </PopoverDialog>
      </PopoverContent>
    </Popover>
  );
}

function ManualToolGroup({
  orderedDescriptors,
  selectedIds,
  onToggle,
}: {
  orderedDescriptors: ChatToolDescriptor[];
  selectedIds: ChatToolReference[];
  onToggle: (id: ChatToolReference) => void;
}): React.JSX.Element {
  const { t } = useT();
  const selectedSet = new Set(selectedIds);
  return (
    <div role="group" aria-label={t("chatTools.manual.label")} className="grid gap-1.5">
      {orderedDescriptors.map((descriptor) => {
        const id = descriptor.id;
        const Icon = iconForTool(descriptor);
        const selected = descriptor.available && selectedSet.has(id);
        return (
          <button
            key={id}
            type="button"
            disabled={!descriptor.available}
            aria-pressed={selected}
            onClick={() => onToggle(id)}
            className={cn(
              "flex min-h-[4.5rem] w-full min-w-0 items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition",
              selected
                ? "border-accent/35 bg-accent/10 text-foreground"
                : "border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted",
              !descriptor.available &&
                "cursor-not-allowed border-border bg-muted text-muted-foreground hover:border-border hover:bg-muted",
            )}
          >
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-primary">
              {selected ? (
                <IconCheckSquare className="size-4" />
              ) : (
                <IconCircle className="size-4" />
              )}
            </span>
            <Icon className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5 leading-5">
                <span className="break-words text-xs font-semibold">
                  {toolLabel(t, id, descriptor)}
                </span>
                <ToolBadges descriptor={descriptor} />
              </span>
              <span className="mt-0.5 block break-words text-[11px] leading-snug text-foreground/55">
                {descriptor.available
                  ? toolDescription(t, id, descriptor)
                  : toolUnavailableReason(t, descriptor)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AutoToolList({
  descriptors,
  activeIds,
}: {
  descriptors: ChatToolDescriptor[];
  activeIds: ChatToolReference[];
}): React.JSX.Element {
  const { t } = useT();
  const active = new Set(activeIds);
  return (
    <div className="grid gap-1">
      {descriptors.map((descriptor) => {
        const id = descriptor.id;
        const Icon = iconForTool(descriptor);
        const enabled = active.has(id);
        return (
          <div
            key={id}
            className={cn(
              "flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2",
              enabled
                ? "border-accent/20 bg-accent/5 text-foreground"
                : "border-border bg-muted text-muted-foreground",
            )}
          >
            <Icon className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="break-words text-xs font-semibold">
                  {toolLabel(t, id, descriptor)}
                </span>
                {enabled ? <IconCheck className="size-3 text-primary" /> : null}
                <ToolBadges descriptor={descriptor} compact />
              </div>
              <p className="mt-0.5 break-words text-[11px] leading-snug text-foreground/55">
                {descriptor.available
                  ? descriptor.defaultAuto
                    ? toolDescription(t, id, descriptor)
                    : t("chatTools.auto.manualOnly")
                  : toolUnavailableReason(t, descriptor)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ActiveToolChips({
  descriptors,
  ids,
}: {
  descriptors: ChatToolDescriptor[];
  ids: ChatToolReference[];
}): React.JSX.Element | null {
  const { t } = useT();
  if (ids.length === 0) {
    return <p className="text-xs text-foreground/50">{t("chatTools.manual.none")}</p>;
  }
  const available = ids.filter((id) =>
    descriptors.some((descriptor) => descriptor.id === id && descriptor.available),
  );
  if (available.length === 0) {
    return <p className="text-xs text-foreground/50">{t("chatTools.manual.none")}</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {available.map((id) => (
        <Chip key={id} size="sm" variant="secondary">
          <Chip.Label>
            {toolLabel(
              t,
              id,
              descriptors.find((descriptor) => descriptor.id === id),
            )}
          </Chip.Label>
        </Chip>
      ))}
    </div>
  );
}

function getSummaryLabel(
  mode: ChatToolMode,
  activeCount: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (mode === "off") return t("chatTools.summary.off");
  if (mode === "manual") return t("chatTools.summary.manual", { count: activeCount });
  return t("chatTools.summary.auto", { count: activeCount });
}

function toolLabel(
  t: (key: string) => string,
  id: ChatToolReference,
  descriptor?: ChatToolDescriptor,
): string {
  if (!isChatToolId(id)) return descriptor?.label ?? id;
  return t(`chatTools.${id}.label`);
}

function toolDescription(
  t: (key: string) => string,
  id: ChatToolReference,
  descriptor?: ChatToolDescriptor,
): string {
  if (id === "web_search" && descriptor?.execution === "host") {
    return t("chatTools.web_search.description.host");
  }
  if (id === "web_search" && descriptor?.execution === "provider") {
    return t("chatTools.web_search.description.provider");
  }
  if (!isChatToolId(id)) {
    if (descriptor?.description) return descriptor.description;
    return descriptor?.category === "skill"
      ? t("tools.skill.noDescription")
      : t("tools.mcp.noDescription");
  }
  return t(`chatTools.${id}.description`);
}

function toolUnavailableReason(
  t: (key: string) => string,
  descriptor?: ChatToolDescriptor,
): string {
  const reason = descriptor?.unavailableReason;
  if (!reason) return t("chatTools.unavailable.toolCalling");
  return reason.startsWith("chatTools.unavailable.") ? t(reason) : reason;
}

function ToolBadges({
  descriptor,
  compact = false,
}: {
  descriptor: ChatToolDescriptor;
  compact?: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const badgeClass = cn(
    "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 font-medium leading-none",
    compact ? "text-[9px]" : "text-[10px]",
  );
  return (
    <>
      {descriptor.requiresApproval ? (
        <span className={cn(badgeClass, "bg-warning/12 text-warning")}>
          {t("chatTools.badge.approval")}
        </span>
      ) : null}
      {descriptor.id === "web_search" && descriptor.execution === "provider" ? (
        <span className={cn(badgeClass, "bg-accent/10 text-primary")}>
          {t("chatTools.badge.native")}
        </span>
      ) : null}
      {descriptor.id === "web_search" && descriptor.execution === "host" ? (
        <span className={cn(badgeClass, "bg-success/10 text-success")}>
          {t("chatTools.badge.host")}
        </span>
      ) : null}
      {descriptor.category === "mcp" ? (
        <span className={cn(badgeClass, "bg-accent/10 text-primary")}>
          {t("chatTools.badge.mcp")}
        </span>
      ) : null}
      {descriptor.category === "skill" ? (
        <span className={cn(badgeClass, "bg-success/10 text-success")}>
          {t("chatTools.badge.skill")}
        </span>
      ) : null}
    </>
  );
}

function orderToolDescriptors(descriptors: ChatToolDescriptor[]): ChatToolDescriptor[] {
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  return [
    ...CHAT_TOOL_IDS.map((id) => byId.get(id)).filter((item): item is ChatToolDescriptor => !!item),
    ...descriptors.filter((descriptor) => !isChatToolId(descriptor.id)),
  ];
}

function iconForTool(
  descriptor: ChatToolDescriptor,
): (props: SVGProps<SVGSVGElement>) => React.JSX.Element {
  if (isChatToolId(descriptor.id)) return ICONS[descriptor.id];
  if (descriptor.category === "skill") return IconCheckSquare;
  return IconWrench;
}
