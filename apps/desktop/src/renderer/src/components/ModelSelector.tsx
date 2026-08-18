import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { useT } from "../lib/i18n";
import { IconChevronDown, IconCheck } from "./icons";
import type { ProviderInfo } from "@shared/types";
import { SettingKey } from "@shared/types";

interface ModelSelectorProps {
  value: string | null;
  onChange: (modelRef: string | null) => void;
  placement?: "top" | "bottom";
  disabled?: boolean;
}

export function ModelSelector({
  value,
  onChange,
  placement = "bottom",
  disabled = false,
}: ModelSelectorProps): React.JSX.Element {
  const { t } = useT();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api.providers.list().then(setProviders);
  }, []);

  useEffect(() => {
    if (open) void api.providers.list().then(setProviders);
  }, [open]);

  const enabledProviders = useMemo(
    () =>
      providers
        .map((provider) => ({
          ...provider,
          models: provider.models.filter(
            (model) => model.enabled && model.capabilities.textGeneration !== false,
          ),
        }))
        .filter((provider) => provider.models.length > 0),
    [providers],
  );

  const enabledRefs = useMemo(
    () =>
      new Set(
        enabledProviders.flatMap((provider) =>
          provider.models.map((model) => `${provider.id}/${model.id}`),
        ),
      ),
    [enabledProviders],
  );

  useEffect(() => {
    if (value && providers.length > 0 && !enabledRefs.has(value)) {
      onChange(null);
      void api.settings.set(SettingKey.SelectedModel, "");
    }
  }, [enabledRefs, onChange, providers.length, value]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = (modelRef: string): void => {
    onChange(modelRef);
    void api.settings.set(SettingKey.SelectedModel, modelRef);
    setOpen(false);
  };

  const selectedLabel = (): string => {
    if (!value || !enabledRefs.has(value)) return t("chat.selectModel");
    const slashIdx = value.indexOf("/");
    const pid = slashIdx >= 0 ? value.slice(0, slashIdx) : value;
    const mid = slashIdx >= 0 ? value.slice(slashIdx + 1) : "";
    const p = enabledProviders.find((x) => x.id === pid);
    const m = p?.models.find((x) => x.id === mid);
    return `${p?.label ?? pid} / ${m?.label ?? mid}`;
  };

  const menuPlacement = placement === "top" ? "bottom-full mb-2 left-0" : "top-full mt-2 right-0";

  return (
    <div ref={ref} data-slot="model-selector" className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        data-slot="model-selector-trigger"
        data-open={open}
        className="flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-[13px] shadow-xs transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("model.selector.label")}
      >
        <span className="size-2 shrink-0 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]" />
        <span className="max-w-[160px] truncate font-medium">{selectedLabel()}</span>
        <IconChevronDown className={`size-3 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t("model.selector.label")}
          data-slot="model-selector-content"
          className={`absolute z-50 max-h-80 w-72 select-none overflow-y-auto rounded-lg border border-border bg-popover shadow-lg ${menuPlacement}`}
        >
          {enabledProviders.map((p) => (
            <div key={p.id} data-slot="model-selector-group">
              <div
                data-slot="model-selector-label"
                className="border-b border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground"
              >
                {p.label}
              </div>
              {p.models.map((m) => {
                const ref = `${p.id}/${m.id}`;
                const selected = ref === value;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-slot="model-selector-item"
                    data-selected={selected}
                    className={[
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition",
                      selected ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    ].join(" ")}
                    onClick={() => handleChange(ref)}
                  >
                    <span className="min-w-0 flex-1 truncate">{m.label ?? m.id}</span>
                    {selected && <IconCheck className="size-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
