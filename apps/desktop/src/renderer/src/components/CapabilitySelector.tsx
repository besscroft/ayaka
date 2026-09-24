import { useEffect, useState } from "react";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverDialog,
  PopoverHeading,
  PopoverTrigger,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui";
import {
  CHAT_CAPABILITY_TOOL_IDS,
  normalizeChatToolSelection,
  type ChatToolSelectionRequest,
} from "@shared/types";
import { IconBrain, IconGlobe, IconSliders } from "./icons";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";

interface CapabilitySelectorProps {
  value: ChatToolSelectionRequest;
  onChange: (next: ChatToolSelectionRequest) => void;
  disabled?: boolean;
}

const CAPABILITIES = [
  { id: "memory", Icon: IconBrain, labelKey: "chatCapabilities.memory" },
  { id: "web", Icon: IconGlobe, labelKey: "chatCapabilities.web" },
] as const;

export function CapabilitySelector({
  value,
  onChange,
  disabled = false,
}: CapabilitySelectorProps): React.JSX.Element {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const selection = normalizeChatToolSelection(value);
  const disabledIds = new Set(selection.disabledToolIds ?? []);
  const anyDisabled = CAPABILITIES.some(({ id }) =>
    CHAT_CAPABILITY_TOOL_IDS[id].some((toolId) => disabledIds.has(toolId)),
  );

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggleCapability = (id: (typeof CAPABILITIES)[number]["id"], enabled: boolean): void => {
    const nextDisabled = new Set(selection.disabledToolIds ?? []);
    for (const toolId of CHAT_CAPABILITY_TOOL_IDS[id]) {
      if (enabled) nextDisabled.delete(toolId);
      else nextDisabled.add(toolId);
    }
    onChange({
      ...selection,
      disabledToolIds: [...nextDisabled],
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  isDisabled={disabled}
                  aria-label={t("chatCapabilities.selector")}
                  className={cn(
                    "relative size-8 shrink-0 rounded-xl text-foreground/65",
                    anyDisabled && "text-primary",
                  )}
                >
                  <IconSliders className="size-4" />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{t("chatCapabilities.selector")}</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[min(280px,calc(100vw-1rem))] p-0"
      >
        <PopoverDialog className="bg-background outline-none">
          <div className="border-b border-border px-4 py-3">
            <PopoverHeading className="text-sm font-semibold">
              {t("chatCapabilities.title")}
            </PopoverHeading>
            <p className="mt-1 text-xs leading-relaxed text-foreground/55">
              {t("chatCapabilities.description")}
            </p>
          </div>
          <div className="grid gap-1.5 p-2">
            {CAPABILITIES.map(({ id, Icon, labelKey }) => {
              const enabled = !CHAT_CAPABILITY_TOOL_IDS[id].some((toolId) =>
                disabledIds.has(toolId),
              );
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-muted"
                >
                  <Icon className="size-5 shrink-0 text-foreground/65" />
                  <span className="min-w-0 flex-1 text-sm font-medium">{t(labelKey)}</span>
                  <Switch
                    size="sm"
                    isSelected={enabled}
                    isDisabled={disabled}
                    onChange={(nextEnabled) => toggleCapability(id, nextEnabled)}
                    aria-label={t(labelKey)}
                  />
                </div>
              );
            })}
          </div>
        </PopoverDialog>
      </PopoverContent>
    </Popover>
  );
}
