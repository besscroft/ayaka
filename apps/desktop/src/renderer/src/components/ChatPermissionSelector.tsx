import { useEffect, useState, type SVGProps } from "react";
import {
  Button,
  Chip,
  Popover,
  PopoverContent,
  PopoverDialog,
  PopoverHeading,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./ui";
import { IconCheck, IconHand, IconShieldAlert, IconUnlock } from "./icons";
import { useT } from "../lib/i18n";
import { cn } from "../lib/utils";
import type { ChatPermissionMode } from "@shared/types";

interface ChatPermissionSelectorProps {
  value: ChatPermissionMode;
  inherited?: boolean;
  onChange: (mode: ChatPermissionMode) => void;
  onReset?: () => void;
  disabled?: boolean;
  compact?: boolean;
}

export const CHAT_PERMISSION_MODE_OPTIONS: Array<{
  mode: ChatPermissionMode;
  Icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  labelKey: string;
  descriptionKey: string;
}> = [
  {
    mode: "ask",
    Icon: IconHand,
    labelKey: "chatPermission.mode.ask",
    descriptionKey: "chatPermission.mode.askDescription",
  },
  {
    mode: "approve_risky",
    Icon: IconShieldAlert,
    labelKey: "chatPermission.mode.approveRisky",
    descriptionKey: "chatPermission.mode.approveRiskyDescription",
  },
  {
    mode: "full_access",
    Icon: IconUnlock,
    labelKey: "chatPermission.mode.fullAccess",
    descriptionKey: "chatPermission.mode.fullAccessDescription",
  },
];

export function ChatPermissionSelector({
  value,
  inherited = false,
  onChange,
  onReset,
  disabled = false,
  compact = false,
}: ChatPermissionSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const selected =
    CHAT_PERMISSION_MODE_OPTIONS.find((option) => option.mode === value) ??
    CHAT_PERMISSION_MODE_OPTIONS[1];
  const SelectedIcon = selected.Icon;

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger>
          <PopoverTrigger>
            <Button
              type="button"
              size="sm"
              variant="tertiary"
              isDisabled={disabled}
              aria-label={t("chatPermission.selector.label")}
              className={cn(
                "min-w-0 shrink-0 rounded-xl text-foreground/70",
                compact ? "h-8 px-2" : "h-9 px-2.5",
                value === "full_access" && "text-warning",
              )}
            >
              <SelectedIcon className="size-4 shrink-0" />
              <span className="max-w-32 truncate text-xs font-medium">{t(selected.labelKey)}</span>
              {inherited ? (
                <span className="ml-0.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/55" />
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("chatPermission.selector.label")}</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={10}
        className="w-[min(390px,calc(100vw-1rem))] p-0"
      >
        <PopoverDialog className="bg-background outline-none">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <PopoverHeading className="text-sm">
                {t("chatPermission.selector.title")}
              </PopoverHeading>
              {inherited ? (
                <Chip size="sm" variant="secondary">
                  {t("chatPermission.inherited")}
                </Chip>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-foreground/55">
              {t("chatPermission.selector.description")}
            </p>
          </div>

          <div className="grid gap-1.5 p-2">
            {CHAT_PERMISSION_MODE_OPTIONS.map(({ mode, Icon, labelKey, descriptionKey }) => {
              const active = mode === value;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => {
                    onChange(mode);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-w-0 items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                    active
                      ? "border-accent/40 bg-accent/10 text-foreground"
                      : "border-transparent text-foreground/75 hover:border-border hover:bg-muted",
                    mode === "full_access" && active && "border-warning/45 bg-warning/10",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-5 shrink-0",
                      mode === "full_access" ? "text-warning" : "text-primary",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {t(labelKey)}
                      {active ? <IconCheck className="size-3.5 text-primary" /> : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-foreground/55">
                      {t(descriptionKey)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {onReset && !inherited ? (
            <div className="border-t border-border px-3 py-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                {t("chatPermission.followDefault")}
              </button>
            </div>
          ) : null}
        </PopoverDialog>
      </PopoverContent>
    </Popover>
  );
}
