import { useEffect, useRef, useState } from "react";
import { useT, type TranslationKey } from "../lib/i18n";
import { CHAT_REASONING_LEVELS, type ChatReasoningLevel, type ModelOption } from "@shared/types";
import { IconBrain, IconCheck } from "./icons";

interface ReasoningSelectorProps {
  value: ChatReasoningLevel;
  onChange: (level: ChatReasoningLevel) => void;
  placement?: "top" | "bottom";
  model?: ModelOption;
  disabled?: boolean;
}

const REASONING_LABEL_KEYS: Record<ChatReasoningLevel, TranslationKey> = {
  "provider-default": "reasoning.level.provider-default",
  none: "reasoning.level.none",
  minimal: "reasoning.level.minimal",
  low: "reasoning.level.low",
  medium: "reasoning.level.medium",
  high: "reasoning.level.high",
  xhigh: "reasoning.level.xhigh",
};

const REASONING_DESCRIPTION_KEYS: Record<ChatReasoningLevel, TranslationKey> = {
  "provider-default": "reasoning.tradeoff.provider-default",
  none: "reasoning.tradeoff.none",
  minimal: "reasoning.tradeoff.minimal",
  low: "reasoning.tradeoff.low",
  medium: "reasoning.tradeoff.medium",
  high: "reasoning.tradeoff.high",
  xhigh: "reasoning.tradeoff.xhigh",
};

export function ReasoningSelector({
  value,
  onChange,
  placement = "bottom",
  model,
  disabled = false,
}: ReasoningSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = (level: ChatReasoningLevel): void => {
    if (!supportsReasoningLevel(model, level)) return;
    onChange(level);
    setOpen(false);
  };

  const menuPlacement = placement === "top" ? "bottom-full mb-2 left-0" : "top-full mt-2 right-0";
  const providerOverride = hasProviderReasoningOverride(model?.providerOptions);

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const options = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]'),
    ].filter((option) => !option.disabled);
    if (!options.length) return;
    const current = options.indexOf(document.activeElement as HTMLButtonElement);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    options[(current + direction + options.length) % options.length]?.focus();
  };

  return (
    <div ref={ref} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition motion-reduce:transition-none hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
        onClick={() => setOpen((next) => !next)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("reasoning.selector.label")}
        title={t("reasoning.selector.label")}
      >
        <IconBrain className="size-4" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("reasoning.selector.label")}
          onKeyDown={handleListKeyDown}
          className={`absolute z-50 w-56 select-none overflow-hidden rounded-lg border border-border bg-popover shadow-lg ${menuPlacement}`}
        >
          <div className="border-b border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground">
            {t("reasoning.selector.title")}
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {CHAT_REASONING_LEVELS.map((level) => {
              const selected = level === value;
              const supported = supportsReasoningLevel(model, level);
              return (
                <button
                  key={level}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={!supported}
                  disabled={!supported}
                  className={[
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
                    selected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    !supported ? "cursor-not-allowed opacity-40" : "",
                  ].join(" ")}
                  onClick={() => handleChange(level)}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{t(REASONING_LABEL_KEYS[level])}</span>
                    <span className="truncate text-[10.5px] text-muted-foreground">
                      {supported
                        ? t(REASONING_DESCRIPTION_KEYS[level])
                        : t("reasoning.unsupported")}
                    </span>
                  </span>
                  {selected && <IconCheck className="size-3.5 shrink-0" />}
                </button>
              );
            })}
          </div>
          {providerOverride ? (
            <p className="border-t border-border px-3 py-2 text-[10.5px] leading-relaxed text-muted-foreground">
              {t("reasoning.providerOverride")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function supportsReasoningLevel(
  model: ModelOption | undefined,
  level: ChatReasoningLevel,
): boolean {
  if (!model) return true;
  const supported =
    model.reasoningLevels ??
    (model.capabilities.reasoning ? [...CHAT_REASONING_LEVELS] : ["provider-default", "none"]);
  return supported.includes(level);
}

export function getModelReasoningDefault(model: ModelOption | undefined): ChatReasoningLevel {
  if (!model) return "provider-default";
  const supported =
    model.reasoningLevels ??
    (model.capabilities.reasoning ? [...CHAT_REASONING_LEVELS] : ["provider-default", "none"]);
  return model.reasoningDefault && supported.includes(model.reasoningDefault)
    ? model.reasoningDefault
    : "provider-default";
}

export function hasProviderReasoningOverride(providerOptions: unknown): boolean {
  if (!providerOptions || typeof providerOptions !== "object" || Array.isArray(providerOptions)) {
    return false;
  }
  for (const [key, value] of Object.entries(providerOptions)) {
    const normalized = key.replace(/[_-]/g, "").toLowerCase();
    if (
      normalized === "reasoningeffort" ||
      normalized === "thinkingbudget" ||
      normalized === "budgettokens"
    ) {
      return value !== undefined && value !== null;
    }
    if (normalized === "thinking" && value && typeof value === "object") {
      const type = (value as Record<string, unknown>).type;
      if (type === "enabled" || type === "adaptive") return true;
    }
    if (hasProviderReasoningOverride(value)) return true;
  }
  return false;
}
