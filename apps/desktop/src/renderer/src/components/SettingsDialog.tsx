import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Description,
  Input,
  Label,
  Modal,
  SearchField,
  Slider,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TextArea,
  TextField,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  ToggleButton,
  ToggleButtonGroup,
} from "./ui";
import { api } from "../lib/api";
import { notify } from "../lib/toast";
import { useSettings, type SettingsResetScope } from "../lib/settings";
import { useT, LANGUAGE_OPTIONS } from "../lib/i18n";
import { cn } from "../lib/utils";

import { ConfirmDialog } from "./ConfirmDialog";
import { DesktopPetsSettings } from "./DesktopPetsSettings";
import { AboutSettings } from "./AboutSettings";
import {
  IconClose,
  IconKey,
  IconCheck,
  IconPalette,
  IconCpu,
  IconRotateCcw,
  IconRefresh,
  IconSliders,
  IconSparkles,
  IconZap,
  IconTrash,
  IconPlus,
  IconInfo,
} from "./icons";
import {
  type AgentProfile,
  FONT_PRESETS,
  MONO_FONT_PRESETS,
  STYLE_PRESETS,
  THEME_PRESETS,
  type Conversation,
  type CustomProviderInput,
  type FontPreset,
  type ManagedModelInfo,
  type ModelCapabilities,
  type ModelOption,
  type ProviderInfo,
  type RuntimeEvent,
  type ThemeMode,
  type ThemePresetId,
  type FontSizeLevel,
  type LayoutDensity,
  type LanguageMode,
  type ReduceMotion,
  type DiffMark,
  type ToolServer,
  type ToolSkill,
} from "@shared/types";

interface SettingsDialogProps {
  /** 鎺у埗鏄鹃殣 */
  open: boolean;
  /** 鍏抽棴鍥炶皟 */
  onClose: () => void;
  initialTab?: SettingsTabId;
}

/** Tab 瀹氫箟 */
export type SettingsTabId = "appearance" | "pets" | "model" | "diagnostics" | "trash" | "about";

/**
 * 璁剧疆寮圭獥锛堝垎 Tab 缁撴瀯锛?
 *
 * 甯冨眬绀烘剰锛?
 * 鈹屸攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
 * 鈹?璁剧疆                                     [鉁昡 鈹?
 * 鈹傗攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
 * 鈹?馃帹 澶栬    鈹?                                鈹?
 * 鈹?馃 妯″瀷    鈹?     <褰撳墠 Tab 鍐呭>            鈹?
 * 鈹?馃棏 鍥炴敹绔? 鈹?                                鈹?
 * 鈹斺攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹粹攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹?
 *
 * 鎵€鏈夊瑙?妯″瀷璁剧疆鍗虫椂搴旂敤骞舵寔涔呭寲锛堝疄鏃堕瑙堬級锛?
 * 鐮村潖鎬ф搷浣滐紙閲嶇疆銆佹竻缂撳瓨銆佸垹 Key锛夐€氳繃 ConfirmDialog 浜屾纭銆?
 */
export function SettingsDialog({
  open,
  onClose,
  initialTab = "appearance",
}: SettingsDialogProps): React.JSX.Element | null {
  const { t, locale } = useT();
  const { settings, update, reset } = useSettings();
  const [tab, setTab] = useState<SettingsTabId>("appearance");
  const [confirmResetScope, setConfirmResetScope] = useState<SettingsResetScope | null>(null);
  const [resetDoneScope, setResetDoneScope] = useState<SettingsResetScope | null>(null);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [initialTab, open]);

  // ESC 鍏抽棴
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const resetScopeLabel = (scope: SettingsResetScope): string =>
    scope === "appearance" ? t("settings.reset.appearance") : t("settings.reset.title");

  const handleReset = (scope: SettingsResetScope): void => {
    const scopeLabel = resetScopeLabel(scope);
    void notify
      .promise(
        reset(scope),
        {
          loading: t("toast.settings.resettingScope", { scope: scopeLabel }),
          success: t("toast.settings.resetScope", { scope: scopeLabel }),
          error: t("toast.settings.resetScopeFailed", { scope: scopeLabel }),
        },
        locale,
      )
      .then(() => {
        setResetDoneScope(scope);
        window.setTimeout(() => {
          setResetDoneScope((current) => (current === scope ? null : current));
        }, 2000);
      })
      .catch(() => undefined);
  };

  const tabs: {
    id: SettingsTabId;
    label: string;
    Icon: typeof IconPalette;
    pinned?: boolean;
  }[] = [
    { id: "appearance", label: t("settings.tab.appearance"), Icon: IconPalette },
    { id: "pets", label: t("settings.tab.pets"), Icon: IconSparkles },
    { id: "model", label: t("settings.tab.model"), Icon: IconCpu },
    { id: "diagnostics", label: t("settings.tab.diagnostics"), Icon: IconSliders },
    { id: "trash", label: t("settings.tab.trash"), Icon: IconTrash },
    { id: "about", label: t("settings.tab.about"), Icon: IconInfo, pinned: true },
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
    >
      <div
        className="flex h-[calc(100vh-32px)] max-h-[860px] w-[calc(100vw-32px)] max-w-[1280px] flex-col overflow-hidden rounded-xl border border-foreground/15 bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 澶撮儴 */}
        <div className="flex items-center justify-between border-b border-foreground/10 px-6 py-3.5">
          <div>
            <h2 id="settings-title" className="text-base font-semibold select-none">
              {t("settings.title")}
            </h2>
          </div>
          <button
            type="button"
            className="rounded p-1 text-foreground/50 hover:bg-foreground/10 hover:text-foreground"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <IconClose className="size-5" />
          </button>
        </div>

        {/* 涓讳綋锛氬鑸?+ 鍐呭锛岀獎灞忕旱鍚戝竷灞€ */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* 瀵艰埅 */}
          <nav
            aria-label={t("settings.nav")}
            className="flex w-full shrink-0 flex-col gap-1 border-r border-foreground/10 bg-foreground/[0.02] p-2 md:w-48 select-none"
          >
            {tabs.map(({ id, label, Icon, pinned }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition",
                    pinned && "mt-auto",
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>

          {/* 鍐呭 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 flex flex-col">
            {tab === "appearance" && (
              <AppearanceTab
                settings={settings}
                update={update}
                onResetDefaults={() => setConfirmResetScope("appearance")}
                resetDone={resetDoneScope === "appearance"}
              />
            )}
            {tab === "pets" && <DesktopPetSection />}
            {tab === "model" && <ModelTab settings={settings} update={update} />}
            {tab === "diagnostics" && <DiagnosticsTab />}
            {tab === "trash" && <TrashTab />}
            {tab === "about" && <AboutSettings />}
          </div>
        </div>

        {/* 搴曢儴 */}
        <div className="flex items-center justify-between border-t border-foreground/10 px-6 py-2.5">
          <span aria-hidden="true" />
          <Button variant="secondary" onPress={onClose}>
            {t("common.done")}
          </Button>
        </div>
      </div>

      {/* 鎭㈠榛樿纭 */}
      <ConfirmDialog
        open={!!confirmResetScope}
        title={
          confirmResetScope
            ? t("settings.reset.scopeTitle", { scope: resetScopeLabel(confirmResetScope) })
            : t("settings.reset.title")
        }
        message={
          confirmResetScope
            ? t("settings.reset.scopeConfirm", { scope: resetScopeLabel(confirmResetScope) })
            : ""
        }
        danger
        confirmLabel={t("common.reset")}
        onConfirm={() => {
          const scope = confirmResetScope;
          if (!scope) return;
          setConfirmResetScope(null);
          handleReset(scope);
        }}
        onClose={() => setConfirmResetScope(null)}
      />
    </div>
  );
}

// ============================================================
// 閫氱敤灏忕粍浠?
// ============================================================

/**
 * 璁剧疆鍖哄潡
 *
 * 瑙嗚涓婂憟鐜颁负涓€寮?鍒嗙粍鍗?锛氬乏渚у甫娓愬彉鑹茬粏鏉＄殑鏍囬鍖?+ 鍙充晶鐨勫唴瀹瑰尯銆?
 * 璁╁涓缃」鎸変富棰樿仛鍚堝湪涓€璧凤紝閬垮厤鍗曡璁剧疆鏄惧緱闆舵暎銆?
 */
function SettingSection({
  title,
  desc,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  desc?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section
      className={cn(
        "rounded-xl border border-foreground/10 bg-foreground/[0.018] p-3.5",
        className,
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon && (
            <span className="flex size-6 shrink-0 select-none items-center justify-center rounded-md bg-accent/10 text-accent">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-medium leading-tight">{title}</h3>
            {desc && <p className="mt-0.5 text-xs text-foreground/50">{desc}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className={cn("space-y-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/** 鍗曡璁剧疆椤癸細宸︿晶鏍囬/鎻忚堪锛屽彸渚ф帶浠?*/
function SettingItem({
  title,
  desc,
  control,
}: {
  title: string;
  desc?: string;
  control: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2 transition hover:border-foreground/15">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {desc && <p className="mt-0.5 text-xs text-foreground/50">{desc}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}

function ResettableTabHeader({
  title,
  onResetDefaults,
  resetDone,
}: {
  title: string;
  onResetDefaults: () => void;
  resetDone: boolean;
}): React.JSX.Element {
  const { t } = useT();

  return (
    <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <h3 className="text-base font-semibold">{title}</h3>
      <div className="flex items-center gap-2">
        <Button variant="tertiary" size="sm" onPress={onResetDefaults}>
          <IconRotateCcw className="mr-1 size-3.5" />
          {t("settings.reset.title")}
        </Button>
        {resetDone && <span className="text-xs text-success">{t("settings.reset.done")}</span>}
      </div>
    </header>
  );
}

// ============================================================
// 澶栬 Tab
// ============================================================

/**
 * 涓婚妯″紡棰勮鍗★細涓庡浘涓竴鑷寸殑涓夊紶鍗＄墖锛屾í鍚戝苟鍒?
 *  - 涓婂崐閮ㄥ垎浣跨敤 50/50 宸﹀彸鍒嗗睆鐨?绐楀彛"棰勮
 *  - 杈规棰滆壊闅忛€変腑鐘舵€佸彉鍖栵紙accent / 榛樿锛?
 */
function ThemeModePreviewCard({
  value,
  label,
  active,
  onSelect,
  swatchLight,
  swatchDark,
}: {
  value: ThemeMode;
  label: string;
  active: boolean;
  onSelect: (value: ThemeMode) => void;
  swatchLight: string;
  swatchDark: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={[
        "group flex w-full flex-col items-stretch gap-2 rounded-xl border-2 p-2 text-left transition",
        active
          ? "border-accent shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_18%,transparent)]"
          : "border-foreground/10 hover:border-foreground/25",
      ].join(" ")}
    >
      <div className="flex h-20 w-full overflow-hidden rounded-md border border-foreground/10">
        <div className="flex-1 p-2" style={{ backgroundColor: swatchLight }} aria-hidden="true">
          <PreviewSkeleton tone="light" />
        </div>
        <div className="flex-1 p-2" style={{ backgroundColor: swatchDark }} aria-hidden="true">
          <PreviewSkeleton tone="dark" />
        </div>
      </div>
      <div className="flex items-center justify-between px-1 pb-1">
        <span
          className={["text-sm font-medium", active ? "text-accent" : "text-foreground/80"].join(
            " ",
          )}
        >
          {label}
        </span>
        {active && <IconCheck className="size-4 text-accent" />}
      </div>
    </button>
  );
}

/** 涓婚妯″紡棰勮楠ㄦ灦鍥撅紙涓庡浘涓被浼肩殑鍑犳潯鍐呭绀烘剰绾匡級 */
function PreviewSkeleton({ tone }: { tone: "light" | "dark" }): React.JSX.Element {
  const base = tone === "light" ? "rgba(15,23,42,0.18)" : "rgba(255,255,255,0.22)";
  const accent = tone === "light" ? "rgba(15,23,42,0.3)" : "rgba(255,255,255,0.45)";
  return (
    <div className="flex h-full flex-col gap-1.5">
      <span className="block h-1.5 w-3/5 rounded-full" style={{ backgroundColor: accent }} />
      <span className="block h-1 w-full rounded-full" style={{ backgroundColor: base }} />
      <span className="block h-1 w-4/5 rounded-full" style={{ backgroundColor: base }} />
      <span className="block h-1 w-2/3 rounded-full" style={{ backgroundColor: base }} />
      <span className="mt-auto flex gap-1">
        <span className="block h-2 w-8 rounded" style={{ backgroundColor: accent }} />
        <span className="block h-2 w-8 rounded" style={{ backgroundColor: base }} />
      </span>
    </div>
  );
}

function AppearanceTab({
  settings,
  update,
  onResetDefaults,
  resetDone,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
  onResetDefaults: () => void;
  resetDone: boolean;
}): React.JSX.Element {
  const { t } = useT();
  const presetBundle = THEME_PRESETS.find((p) => p.id === settings.themePreset);

  // 涓婚妯″紡棰勮鍗＄墖锛氬乏鍙充袱鑹茬敱"褰撳墠涓婚鍖?+ 娴?娣?鍐冲畾
  const systemSwatchLight = presetBundle?.swatches.light ?? "#f7f7f8";
  const systemSwatchDark = presetBundle?.swatches.dark ?? "#1f1f23";

  const handleThemeMode = (value: ThemeMode): void => {
    void update({ theme: value });
  };

  return (
    <section className="select-none flex flex-col min-h-0 flex-1 -mx-5 -my-4">
      <div className="shrink-0 px-5 py-4">
        <ResettableTabHeader
          title={t("appearance.title")}
          onResetDefaults={onResetDefaults}
          resetDone={resetDone}
        />
      </div>

      <div className="space-y-5 overflow-y-auto min-h-0 flex-1 px-5 pb-4">
        {/* 鈥斺€?涓婚妯″紡棰勮鍗?鈥斺€?*/}
        <SettingSection
          title={t("appearance.mode")}
          desc={t("appearance.mode.desc")}
          icon={<IconPalette className="size-3.5" />}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ThemeModePreviewCard
              value="system"
              label={t("shell.theme.system")}
              active={settings.theme === "system"}
              onSelect={handleThemeMode}
              swatchLight={systemSwatchLight}
              swatchDark={systemSwatchDark}
            />
            <ThemeModePreviewCard
              value="light"
              label={t("shell.theme.light")}
              active={settings.theme === "light"}
              onSelect={handleThemeMode}
              swatchLight={systemSwatchLight}
              swatchDark={systemSwatchLight}
            />
            <ThemeModePreviewCard
              value="dark"
              label={t("shell.theme.dark")}
              active={settings.theme === "dark"}
              onSelect={handleThemeMode}
              swatchLight={systemSwatchDark}
              swatchDark={systemSwatchDark}
            />
          </div>
        </SettingSection>

        {/* 鈥斺€?涓婚鍖?+ 寮鸿皟鑹?骞跺垪 鈥斺€?*/}
        <div className="space-y-4">
          <SettingSection title={t("appearance.bundle")} desc={t("appearance.bundle.desc")}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {THEME_PRESETS.map((p) => {
                const active = settings.themePreset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void update({ themePreset: p.id as ThemePresetId })}
                    aria-pressed={active}
                    className={[
                      "flex min-h-20 flex-col justify-between rounded-md border p-2.5 text-left text-sm transition",
                      active
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-foreground/15 text-foreground/75 hover:bg-foreground/5",
                    ].join(" ")}
                  >
                    <span className="font-medium">{t(p.labelKey)}</span>
                    <span className="mt-2 flex gap-1">
                      <span
                        className="h-4 flex-1 rounded border border-foreground/10"
                        style={{ backgroundColor: p.swatches.light }}
                      />
                      <span
                        className="h-4 flex-1 rounded border border-foreground/10"
                        style={{ backgroundColor: p.swatches.dark }}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </SettingSection>

          <SettingSection title={t("appearance.style")} desc={t("appearance.style.desc")}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {STYLE_PRESETS.map((p) => {
                const selected = settings.style === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void update({ style: p.id })}
                    aria-pressed={selected}
                    className={[
                      "group flex flex-col items-start gap-2 rounded-md border bg-background p-3 text-left transition",
                      selected
                        ? "border-foreground/40 ring-1 ring-foreground/15"
                        : "border-foreground/10 hover:border-foreground/25",
                    ].join(" ")}
                  >
                    <div className="flex w-full items-center justify-between">
                      <span className="text-sm font-medium">{t(p.labelKey)}</span>
                      <span
                        className="size-4 shrink-0 border border-foreground/15"
                        style={{ borderRadius: Math.min(p.radius, 8) }}
                      />
                    </div>
                    <div
                      className="flex w-full items-center justify-center bg-foreground/[0.03] py-3 text-2xl text-foreground/70"
                      style={{ fontFamily: p.fontStack, borderRadius: p.radius }}
                    >
                      Aa
                    </div>
                    <span className="text-xs leading-relaxed text-foreground/55">
                      {t(p.descKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          </SettingSection>
        </div>

        {/* 鈥斺€?瀛椾綋 鈥斺€?*/}
        {/* 字体与排版（合并卡片）：一行四列，字号 tabs 横向 */}
        <SettingSection
          title={t("appearance.fonts")}
          desc={t("appearance.fonts.desc")}
          bodyClassName="grid grid-cols-4 gap-3"
        >
          {/* UI 字体：下拉框选择 */}
          <FontSelectRow
            label={t("appearance.font.ui")}
            value={settings.fontFamily}
            presets={FONT_PRESETS}
            onChange={(v) => void update({ fontFamily: v })}
          />
          {/* 等宽字体：下拉框选择 */}
          <FontSelectRow
            label={t("appearance.font.mono")}
            value={settings.monoFontFamily}
            presets={MONO_FONT_PRESETS}
            onChange={(v) => void update({ monoFontFamily: v })}
          />
          {/* 字号：Slider 选择（5 档） */}
          <div className="flex h-full flex-col gap-2 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("appearance.fontSize")}</p>
              <p className="mt-0.5 text-xs text-foreground/50">{t("appearance.fontSize.desc")}</p>
            </div>
            <Slider
              value={FONT_SIZE_LEVELS.indexOf(settings.fontSize)}
              min={0}
              max={FONT_SIZE_LEVELS.length - 1}
              step={1}
              onValueChange={(v) => {
                const idx = Array.isArray(v) ? v[0] : v;
                if (FONT_SIZE_LEVELS[idx]) {
                  void update({ fontSize: FONT_SIZE_LEVELS[idx] });
                }
              }}
            />
          </div>
          {/* 代码字号：Slider 选择（5 档） */}
          <div className="flex h-full flex-col gap-2 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("appearance.codeFontSize")}</p>
              <p className="mt-0.5 text-xs text-foreground/50">
                {t("appearance.codeFontSize.desc")}
              </p>
            </div>
            <Slider
              value={CODE_FONT_SIZE_PRESETS.indexOf(
                settings.codeFontSizePx as (typeof CODE_FONT_SIZE_PRESETS)[number],
              )}
              min={0}
              max={CODE_FONT_SIZE_PRESETS.length - 1}
              step={1}
              onValueChange={(v) => {
                const idx = Array.isArray(v) ? v[0] : v;
                if (CODE_FONT_SIZE_PRESETS[idx] !== undefined) {
                  void update({ codeFontSizePx: CODE_FONT_SIZE_PRESETS[idx] });
                }
              }}
            />
          </div>
        </SettingSection>

        {/* 鈥斺€?鎺掔増 鈥斺€?*/}

        {/* 鈥斺€?浜や簰 鈥斺€?*/}
        <SettingSection title={t("appearance.interaction")}>
          <SettingItem
            title={t("appearance.translucent")}
            desc={t("appearance.translucent.desc")}
            control={
              <Switch
                size="sm"
                isSelected={settings.translucentSidebar}
                onChange={(v) => void update({ translucentSidebar: v })}
                aria-label={t("appearance.translucent")}
              />
            }
          />
          <SettingItem
            title={t("appearance.pointer")}
            desc={t("appearance.pointer.desc")}
            control={
              <Switch
                size="sm"
                isSelected={settings.usePointerCursor}
                onChange={(v) => void update({ usePointerCursor: v })}
                aria-label={t("appearance.pointer")}
              />
            }
          />
          <SettingItem
            title={t("appearance.motion")}
            desc={t("appearance.motion.desc")}
            control={
              <Tabs
                value={settings.reduceMotion}
                onValueChange={(key) => {
                  if (key === "system" || key === "on" || key === "off") {
                    void update({ reduceMotion: key as ReduceMotion });
                  }
                }}
              >
                <TabsList aria-label={t("appearance.motion")}>
                  <TabsTrigger value="system">{t("appearance.motion.system")}</TabsTrigger>
                  <TabsTrigger value="on">{t("appearance.motion.on")}</TabsTrigger>
                  <TabsTrigger value="off">{t("appearance.motion.off")}</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />
          <SettingItem
            title={t("appearance.density")}
            desc={t("appearance.density.desc")}
            control={
              <Tabs
                value={settings.density}
                onValueChange={(key) => {
                  if (key === "compact" || key === "comfortable" || key === "loose") {
                    void update({ density: key as LayoutDensity });
                  }
                }}
              >
                <TabsList aria-label={t("appearance.density")}>
                  <TabsTrigger value="compact">{t("appearance.density.compact")}</TabsTrigger>
                  <TabsTrigger value="comfortable">
                    {t("appearance.density.comfortable")}
                  </TabsTrigger>
                  <TabsTrigger value="loose">{t("appearance.density.loose")}</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />
        </SettingSection>

        {/* 鈥斺€?楂樼骇/宸紓鍖?鈥斺€?*/}
        <SettingSection title={t("appearance.advanced")}>
          <SettingItem
            title={t("appearance.diff")}
            desc={t("appearance.diff.desc")}
            control={
              <Tabs
                value={settings.diffMark}
                onValueChange={(key) => {
                  if (key === "color" || key === "symbol") {
                    void update({ diffMark: key as DiffMark });
                  }
                }}
              >
                <TabsList aria-label={t("appearance.diff")}>
                  <TabsTrigger value="color">{t("appearance.diff.color")}</TabsTrigger>
                  <TabsTrigger value="symbol">{t("appearance.diff.symbol")}</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />
          <SettingItem
            title={t("appearance.language")}
            desc={t("appearance.language.desc")}
            control={
              <Tabs
                value={settings.language}
                onValueChange={(key) => {
                  if (key === "system" || key === "zh-CN" || key === "en") {
                    void update({ language: key as LanguageMode });
                  }
                }}
              >
                <TabsList aria-label={t("appearance.language")}>
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <TabsTrigger key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            }
          />
        </SettingSection>
      </div>
    </section>
  );
}

function DesktopPetSection(): React.JSX.Element {
  return <DesktopPetsSettings />;
}

// ============================================================
// 瀛楁瀛愮粍浠?
// ============================================================

/** 瀛椾綋杈撳叆琛岋細鏍囩 + 棰勮涓嬫媺 + 鑷畾涔夎緭鍏?*/
/** 字号档位（按从小到大排列，供 Slider 索引映射） */
const FONT_SIZE_LEVELS: FontSizeLevel[] = ["xs", "sm", "base", "lg", "xl"];

/** 代码字号离散档位（在 10-24px 范围内取 5 档供 Slider 选择） */
const CODE_FONT_SIZE_PRESETS = [11, 13, 15, 18, 22] as const;

/** 字体选择行：标签 + 下拉框 + 预览（已移除自定义输入框） */
function FontSelectRow({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: string;
  presets: FontPreset[];
  onChange: (v: string) => void;
}): React.JSX.Element {
  const { t } = useT();
  // 褰撳墠 value 鍛戒腑鏌愪釜棰勮鏃堕珮浜畠
  const matchedPreset = presets.find((p) => p.value === value);
  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2.5">
      <label className="block min-w-0 select-none">
        <span className="text-sm font-medium">{label}</span>
      </label>
      <select
        value={matchedPreset ? matchedPreset.id : ""}
        onChange={(e) => {
          const next = presets.find((p) => p.id === e.target.value);
          // 选"无"时清空，否则用预设值
          onChange(next ? next.value : "");
        }}
        className="w-full select-none rounded-md border border-foreground/15 bg-background px-2 py-1 text-xs outline-none focus:border-accent/50"
      >
        <option value="">{t("common.none")}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      {value && (
        <span
          className="block truncate text-xs text-foreground/50"
          style={{ fontFamily: value, fontSize: "14px" }}
        >
          {t("appearance.font.preview")}
        </span>
      )}
    </div>
  );
}

// ============================================================
// 妯″瀷 Tab
// ============================================================
function ModelTab({
  settings,
  update,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
}): React.JSX.Element {
  return <ProviderModelWorkbench settings={settings} update={update} />;
}

void LegacyModelTab;

function LegacyModelTab({
  settings,
  update,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
}): React.JSX.Element {
  const { t, f, locale } = useT();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ManagedModelInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [editorState, setEditorState] = useState<
    { mode: "add" } | { mode: "edit"; model: ManagedModelInfo } | null
  >(null);
  const [modelToDelete, setModelToDelete] = useState<ManagedModelInfo | null>(null);

  const providerModelRef = (providerId: string, modelId: string): string =>
    providerId + "/" + modelId;

  const refreshModels = useCallback((): void => {
    void Promise.all([api.providers.list(), api.providers.listManagedModels()]).then(
      ([providerList, modelList]) => {
        setProviders(providerList);
        setModels(modelList);
        setModelsLoaded(true);
      },
    );
  }, []);

  useEffect(() => {
    refreshModels();
  }, [refreshModels]);

  useEffect(() => {
    if (!modelsLoaded || !settings.selectedModel) return;
    const selected = models.find((model) => model.ref === settings.selectedModel);
    if (!selected || !selected.enabled) void update({ selectedModel: null });
  }, [models, modelsLoaded, settings.selectedModel, update]);

  const enabledProviders = providers
    .map((provider) => ({
      ...provider,
      models: provider.models.filter(
        (model) => model.enabled && model.capabilities.textGeneration !== false,
      ),
    }))
    .filter((provider) => provider.models.length > 0);

  const formatParams = (model: ManagedModelInfo): string =>
    t("model.params.summary", {
      temperatureLabel: t("model.temperature"),
      temperature: f.fixed(model.temperature, 1),
      topPLabel: t("model.topP"),
      topP: f.fixed(model.topP, 2),
      maxTokensLabel: t("model.maxTokens"),
      maxTokens: f.number(model.maxOutputTokens),
    });

  const handleToggleModel = (model: ManagedModelInfo, enabled: boolean): void => {
    void notify
      .promise(
        api.providers.updateModelEnabled(model.providerId, model.modelId, enabled),
        {
          loading: t("toast.model.modelSaving"),
          success: t("toast.model.modelSaved"),
          error: t("toast.model.modelSaveFailed"),
        },
        locale,
      )
      .then(() => {
        if (!enabled && settings.selectedModel === model.ref) void update({ selectedModel: null });
        refreshModels();
      })
      .catch(() => undefined);
  };

  const handleDeleteModel = (): void => {
    if (!modelToDelete) return;
    const model = modelToDelete;
    void notify
      .promise(
        api.providers.deleteCustomModel(model.providerId, model.modelId),
        {
          loading: t("toast.model.modelDeleting"),
          success: t("toast.model.modelDeleted"),
          error: t("toast.model.modelDeleteFailed"),
        },
        locale,
      )
      .then(() => {
        if (settings.selectedModel === model.ref) void update({ selectedModel: null });
        if (editorState?.mode === "edit" && editorState.model.ref === model.ref)
          setEditorState(null);
        setModelToDelete(null);
        refreshModels();
      })
      .catch(() => undefined);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="shrink-0 space-y-3">
        <h3 className="text-sm font-medium text-foreground/70">{t("settings.tab.model")}</h3>

        <SettingItem
          title={t("model.default")}
          desc={t("model.default.desc")}
          control={
            <select
              className="min-w-56 select-none rounded-md border border-foreground/15 bg-background px-3 py-1.5 text-sm outline-none focus:border-accent/50"
              value={settings.selectedModel ?? ""}
              onChange={(e) => void update({ selectedModel: e.target.value || null })}
            >
              <option value="">{t("chat.selectModel")}</option>
              {enabledProviders.map((provider) => (
                <optgroup key={provider.id} label={provider.label}>
                  {provider.models.map((model) => (
                    <option key={model.id} value={providerModelRef(provider.id, model.id)}>
                      {model.label ?? model.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          }
        />
      </div>

      <SettingSection
        title={t("model.catalog")}
        desc={t("model.catalog.desc")}
        className="flex min-h-0 flex-1 flex-col"
        bodyClassName="min-h-0 flex-1 overflow-y-auto pt-2"
        action={
          <Button variant="primary" size="sm" onPress={() => setEditorState({ mode: "add" })}>
            <IconPlus className="mr-1 size-3.5" />
            {t("model.addModel")}
          </Button>
        }
      >
        {models.length === 0 ? (
          <div className="rounded-md border border-dashed border-foreground/15 px-4 py-6 text-center text-sm text-foreground/50">
            {t("model.empty")}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-foreground/10">
            {models.map((model, index) => {
              const selected = settings.selectedModel === model.ref;
              return (
                <div
                  key={model.ref}
                  className={[
                    "grid gap-3 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto]",
                    index > 0 ? "border-t border-foreground/10" : "",
                    selected ? "bg-accent/10" : "",
                    model.enabled ? "" : "opacity-65",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">
                        {model.modelLabel ?? model.modelId}
                      </span>
                      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] text-foreground/55">
                        {t("model.custom")}
                      </span>
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[11px]",
                          model.hasApiKey
                            ? "bg-success/10 text-success"
                            : "bg-warning/10 text-warning",
                        ].join(" ")}
                      >
                        {model.hasApiKey ? t("apikey.configured") : t("apikey.notConfigured")}
                      </span>
                      {selected && (
                        <span className="inline-flex items-center gap-1 text-xs text-accent">
                          <IconCheck className="size-3" /> {t("model.selected")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 break-all text-xs text-foreground/45">
                      {model.providerLabel} / {model.modelId}
                    </p>
                    <p className="mt-1 text-xs text-foreground/40">{formatParams(model)}</p>
                    {model.providerBaseUrl && (
                      <p className="mt-1 break-all text-xs text-foreground/35">
                        {t("model.provider.baseUrl")}: {model.providerBaseUrl}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <Switch
                      size="sm"
                      isSelected={model.enabled}
                      onChange={(enabled) => handleToggleModel(model, enabled)}
                      aria-label={t("model.enabled")}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={() => setEditorState({ mode: "edit", model })}
                    >
                      <IconKey className="mr-1 size-3.5" />
                      {t("common.edit")}
                    </Button>
                    <Button variant="tertiary" size="sm" onPress={() => setModelToDelete(model)}>
                      <IconTrash className="size-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SettingSection>

      <ModelEditorDialog
        open={!!editorState}
        mode={editorState?.mode ?? "add"}
        providers={providers}
        model={editorState?.mode === "edit" ? editorState.model : null}
        selectedModel={settings.selectedModel}
        onClearSelectedModel={() => update({ selectedModel: null })}
        onSaved={refreshModels}
        onClose={() => setEditorState(null)}
      />

      <ConfirmDialog
        open={!!modelToDelete}
        title={t("common.delete")}
        message={t("model.deleteModel.confirm", {
          label: modelToDelete?.modelLabel ?? modelToDelete?.modelId ?? "",
        })}
        danger
        confirmLabel={t("common.delete")}
        onConfirm={handleDeleteModel}
        onClose={() => setModelToDelete(null)}
      />
    </section>
  );
}

type ModelEditorMode = "add" | "edit";

interface ModelFormState {
  providerId: string;
  id: string;
  label: string;
  enabled: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
}

function createEmptyModelForm(providerId = ""): ModelFormState {
  return {
    providerId,
    id: "",
    label: "",
    enabled: true,
    temperature: 0.7,
    topP: 1,
    maxOutputTokens: 4096,
  };
}

function ModelEditorDialog({
  open,
  mode,
  providers,
  model,
  selectedModel,
  onClearSelectedModel,
  onSaved,
  onClose,
}: {
  open: boolean;
  mode: ModelEditorMode;
  providers: ProviderInfo[];
  model: ManagedModelInfo | null;
  selectedModel: string | null;
  onClearSelectedModel: () => Promise<void>;
  onSaved: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t, f, locale } = useT();
  const [addMode, setAddMode] = useState<"existing" | "custom">("existing");
  const [providerForm, setProviderForm] = useState<CustomProviderInput>({
    id: "",
    label: "",
    baseUrl: "",
    helpUrl: "",
  });
  const [modelForm, setModelForm] = useState<ModelFormState>(() =>
    createEmptyModelForm(providers[0]?.id ?? ""),
  );
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && model) {
      setAddMode("existing");
      setProviderForm({
        id: model.providerId,
        label: model.providerLabel,
        baseUrl: model.providerBaseUrl ?? "",
        helpUrl: model.providerHelpUrl,
      });
      setModelForm({
        providerId: model.providerId,
        id: model.modelId,
        label: model.modelLabel ?? "",
        enabled: model.enabled,
        temperature: model.temperature,
        topP: model.topP,
        maxOutputTokens: model.maxOutputTokens,
      });
      setApiKey("");
      setHasApiKey(model.hasApiKey);
      return;
    }

    setAddMode("existing");
    setProviderForm({ id: "", label: "", baseUrl: "", helpUrl: "" });
    setModelForm(createEmptyModelForm(providers[0]?.id ?? ""));
    setApiKey("");
    setHasApiKey(false);
  }, [mode, model, open, providers]);

  useEffect(() => {
    if (!open || mode !== "add" || modelForm.providerId || providers.length === 0) return;
    setModelForm((prev) => ({ ...prev, providerId: providers[0].id }));
  }, [mode, modelForm.providerId, open, providers]);

  const isEditing = mode === "edit";
  const canEditProvider = isEditing && model?.providerSource === "custom";
  const providerHelpUrl = isEditing
    ? providerForm.helpUrl || model?.providerHelpUrl
    : addMode === "custom"
      ? providerForm.helpUrl
      : providers.find((provider) => provider.id === modelForm.providerId)?.helpUrl;

  const canSave =
    modelForm.id.trim().length > 0 &&
    modelForm.maxOutputTokens > 0 &&
    (isEditing
      ? !canEditProvider ||
        (providerForm.label.trim().length > 0 && providerForm.baseUrl.trim().length > 0)
      : addMode === "existing"
        ? modelForm.providerId.length > 0
        : providerForm.label.trim().length > 0 && providerForm.baseUrl.trim().length > 0);

  const updateModelNumber = (patch: Partial<ModelFormState>): void => {
    setModelForm((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = (): void => {
    if (!canSave) return;
    const task = (async (): Promise<void> => {
      let providerId = modelForm.providerId;
      if (!isEditing && addMode === "custom") {
        providerId = (await api.providers.upsertCustomProvider(providerForm)).id;
      } else if (canEditProvider) {
        await api.providers.upsertCustomProvider(providerForm);
      }

      const modelId = modelForm.id.trim();
      await api.providers.upsertCustomModel({
        providerId,
        id: modelId,
        label: modelForm.label.trim(),
        enabled: modelForm.enabled,
        temperature: modelForm.temperature,
        topP: modelForm.topP,
        maxOutputTokens: Math.floor(modelForm.maxOutputTokens),
      });

      if (apiKey.trim()) {
        await api.providers.setModelApiKey(providerId, modelId, apiKey.trim());
      }
      if (!modelForm.enabled && selectedModel === providerId + "/" + modelId) {
        await onClearSelectedModel();
      }
    })();

    void notify
      .promise(
        task,
        {
          loading: t("toast.model.modelSaving"),
          success: t("toast.model.modelSaved"),
          error: t("toast.model.modelSaveFailed"),
        },
        locale,
      )
      .then(() => {
        onSaved();
        onClose();
      })
      .catch(() => undefined);
  };

  const handleClearKey = (): void => {
    if (!model) return;
    void notify
      .promise(
        api.providers.deleteModelApiKey(model.providerId, model.modelId),
        {
          loading: t("toast.apikey.clearing"),
          success: t("toast.apikey.cleared"),
          error: t("toast.apikey.clearFailed"),
        },
        locale,
      )
      .then(() => {
        setHasApiKey(false);
        onSaved();
      })
      .catch(() => undefined);
  };

  return (
    <Modal isOpen={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <div className="flex w-full items-center justify-between gap-3">
                <Modal.Heading className="text-base font-semibold">
                  {isEditing ? t("model.editModel") : t("model.addModel")}
                </Modal.Heading>
                <Button
                  type="button"
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={onClose}
                  aria-label={t("common.close")}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
            </Modal.Header>

            <Modal.Body>
              <div className="grid gap-3 md:grid-cols-2">
                {!isEditing && (
                  <label className="select-none text-sm md:col-span-2">
                    <span className="mb-1 block text-xs text-foreground/60">
                      {t("model.provider")}
                    </span>
                    <select
                      className="w-full select-none rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                      value={addMode}
                      onChange={(e) =>
                        setAddMode(e.target.value === "custom" ? "custom" : "existing")
                      }
                    >
                      <option value="existing">{t("model.addToProvider")}</option>
                      <option value="custom">{t("model.addWithProvider")}</option>
                    </select>
                  </label>
                )}

                {!isEditing && addMode === "existing" && (
                  <label className="select-none text-sm md:col-span-2">
                    <span className="mb-1 block text-xs text-foreground/60">
                      {t("model.provider")}
                    </span>
                    <select
                      className="w-full select-none rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                      value={modelForm.providerId}
                      onChange={(e) =>
                        setModelForm((prev) => ({ ...prev, providerId: e.target.value }))
                      }
                    >
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {((!isEditing && addMode === "custom") || canEditProvider) && (
                  <>
                    <TextField>
                      <Label>{t("model.providerName")}</Label>
                      <Input
                        value={providerForm.label}
                        placeholder={t("model.placeholder.providerName")}
                        onChange={(e) =>
                          setProviderForm((prev) => ({
                            ...prev,
                            label: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                    </TextField>
                    {!isEditing && (
                      <TextField>
                        <Label>{t("model.providerId")}</Label>
                        <Input
                          value={providerForm.id ?? ""}
                          placeholder={t("model.placeholder.providerId")}
                          onChange={(e) =>
                            setProviderForm((prev) => ({
                              ...prev,
                              id: (e.target as HTMLInputElement).value,
                            }))
                          }
                        />
                      </TextField>
                    )}
                    <TextField>
                      <Label>{t("model.baseUrl")}</Label>
                      <Input
                        value={providerForm.baseUrl}
                        placeholder={t("model.placeholder.baseUrl")}
                        onChange={(e) =>
                          setProviderForm((prev) => ({
                            ...prev,
                            baseUrl: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                    </TextField>
                    <TextField>
                      <Label>{t("model.helpUrl")}</Label>
                      <Input
                        value={providerForm.helpUrl ?? ""}
                        placeholder={t("model.placeholder.helpUrl")}
                        onChange={(e) =>
                          setProviderForm((prev) => ({
                            ...prev,
                            helpUrl: (e.target as HTMLInputElement).value,
                          }))
                        }
                      />
                    </TextField>
                  </>
                )}

                {isEditing && (
                  <TextField>
                    <Label>{t("model.provider")}</Label>
                    <Input value={model?.providerId ?? ""} disabled />
                  </TextField>
                )}
                <TextField>
                  <Label>{t("model.modelId")}</Label>
                  <Input
                    value={modelForm.id}
                    placeholder={t("model.placeholder.modelId")}
                    disabled={isEditing}
                    onChange={(e) =>
                      setModelForm((prev) => ({
                        ...prev,
                        id: (e.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.modelName")}</Label>
                  <Input
                    value={modelForm.label}
                    placeholder={t("model.placeholder.modelName")}
                    onChange={(e) =>
                      setModelForm((prev) => ({
                        ...prev,
                        label: (e.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField className="md:col-span-2">
                  <Label>{t("model.apiKey")}</Label>
                  <Input
                    type="password"
                    value={apiKey}
                    placeholder={
                      hasApiKey ? t("apikey.placeholder.replace") : t("model.placeholder.apiKey")
                    }
                    onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
                  />
                  {providerHelpUrl && (
                    <Description className="mt-1">
                      <a
                        href={providerHelpUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-accent hover:underline"
                      >
                        {t("apikey.getKey")}
                      </a>
                    </Description>
                  )}
                </TextField>

                <div className="md:col-span-2">
                  <Switch
                    size="sm"
                    isSelected={modelForm.enabled}
                    onChange={(enabled) => setModelForm((prev) => ({ ...prev, enabled }))}
                  >
                    {t("model.enabled")}
                  </Switch>
                </div>

                <div className="space-y-4 md:col-span-2">
                  <p className="text-xs font-medium text-foreground/60">{t("model.params")}</p>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-foreground/60">
                      <span>{t("model.temperature")}</span>
                      <span>{f.fixed(modelForm.temperature, 1)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={modelForm.temperature}
                      onChange={(e) => updateModelNumber({ temperature: Number(e.target.value) })}
                      className="w-full accent-[var(--color-accent)]"
                      aria-label={t("model.temperature")}
                    />
                    <p className="mt-0.5 text-xs text-foreground/40">
                      {t("model.temperature.hint")}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-foreground/60">
                      <span>{t("model.topP")}</span>
                      <span>{f.fixed(modelForm.topP, 2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={modelForm.topP}
                      onChange={(e) => updateModelNumber({ topP: Number(e.target.value) })}
                      className="w-full accent-[var(--color-accent)]"
                      aria-label={t("model.topP")}
                    />
                    <p className="mt-0.5 text-xs text-foreground/40">{t("model.topP.hint")}</p>
                  </div>
                  <TextField>
                    <Label>{t("model.maxTokens")}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={32768}
                      step={256}
                      value={String(modelForm.maxOutputTokens)}
                      onChange={(e) =>
                        updateModelNumber({
                          maxOutputTokens: Math.max(
                            1,
                            Number((e.target as HTMLInputElement).value) || 1,
                          ),
                        })
                      }
                    />
                    <Description className="mt-1">{t("model.maxTokens.hint")}</Description>
                  </TextField>
                </div>
              </div>
            </Modal.Body>

            <Modal.Footer>
              <div className="flex w-full flex-wrap justify-end gap-2">
                {isEditing && hasApiKey && (
                  <Button variant="tertiary" onPress={handleClearKey}>
                    {t("common.clear")}
                  </Button>
                )}
                <Button variant="secondary" onPress={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onPress={handleSave} isDisabled={!canSave}>
                  {t("common.save")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

// ============================================================
// 鍥炴敹绔?Tab
// ============================================================
const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = {
  textGeneration: true,
  vision: false,
  imageOutput: false,
  speechOutput: false,
  transcription: false,
  videoOutput: false,
  toolCalling: true,
  reasoning: false,
  embedding: false,
};

interface ModelOptionsFormState {
  providerId: string;
  id: string;
  label: string;
  enabled: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  capabilities: ModelCapabilities;
  providerOptionsJson: string;
}

type ModelOptionsEditorState =
  | { mode: "add"; providerId: string }
  | { mode: "edit"; providerId: string; model: ModelOption };

function providerModelRef(providerId: string, modelId: string): string {
  return providerId + "/" + modelId;
}

function stringifyJsonObject(value: Record<string, unknown> | undefined): string {
  if (!value || Object.keys(value).length === 0) return "{}";
  return JSON.stringify(value, null, 2);
}

function validateJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "Provider options must be a JSON object";
    }
    return null;
  } catch {
    return "Provider options must be valid JSON";
  }
}

function createModelOptionsForm(providerId: string, model?: ModelOption): ModelOptionsFormState {
  return {
    providerId,
    id: model?.id ?? "",
    label: model?.label ?? "",
    enabled: model?.enabled ?? true,
    temperature: model?.temperature ?? 0.7,
    topP: model?.topP ?? 1,
    maxOutputTokens: model?.maxOutputTokens ?? 4096,
    contextWindow: model?.contextWindow ?? 32_000,
    capabilities: model?.capabilities ?? DEFAULT_MODEL_CAPABILITIES,
    providerOptionsJson: stringifyJsonObject(model?.providerOptions),
  };
}

function ProviderModelWorkbench({
  settings,
  update,
}: {
  settings: import("@shared/types").AppSettings;
  update: (patch: Partial<import("@shared/types").AppSettings>) => Promise<void>;
}): React.JSX.Element {
  const { t, f, locale } = useT();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [providerForm, setProviderForm] = useState<CustomProviderInput>({
    id: "",
    label: "",
    baseUrl: "",
    helpUrl: "",
  });
  const [providerApiKey, setProviderApiKey] = useState("");
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [modelEditorState, setModelEditorState] = useState<ModelOptionsEditorState | null>(null);
  const [providerToDelete, setProviderToDelete] = useState<ProviderInfo | null>(null);
  const [modelToDelete, setModelToDelete] = useState<{
    provider: ProviderInfo;
    model: ModelOption;
  } | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [syncingProviderId, setSyncingProviderId] = useState<string | null>(null);

  const refreshCatalog = useCallback((): void => {
    void api.providers.list().then((providerList) => {
      setProviders(providerList);
      setModelsLoaded(true);
      setSelectedProviderId((current) => {
        if (current && providerList.some((provider) => provider.id === current)) return current;
        return providerList[0]?.id ?? null;
      });
    });
  }, []);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  const enabledModelRefs = useMemo(
    () =>
      new Set(
        providers.flatMap((provider) =>
          provider.models
            .filter((model) => model.enabled)
            .map((model) => providerModelRef(provider.id, model.id)),
        ),
      ),
    [providers],
  );

  useEffect(() => {
    if (!modelsLoaded || !settings.selectedModel) return;
    if (!enabledModelRefs.has(settings.selectedModel)) void update({ selectedModel: null });
  }, [enabledModelRefs, modelsLoaded, settings.selectedModel, update]);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId) ?? null,
    [providers, selectedProviderId],
  );

  useEffect(() => {
    if (!selectedProvider) return;
    setProviderForm({
      id: selectedProvider.id,
      label: selectedProvider.label,
      baseUrl: selectedProvider.baseUrl ?? "",
      helpUrl: selectedProvider.helpUrl,
    });
    setProviderApiKey("");
  }, [
    selectedProvider?.baseUrl,
    selectedProvider?.helpUrl,
    selectedProvider?.id,
    selectedProvider?.label,
  ]);

  const filteredProviders = useMemo(() => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return providers;
    return providers.filter((provider) =>
      [provider.id, provider.label, provider.baseUrl ?? "", provider.kind]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [providerQuery, providers]);

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

  const canEditProvider = selectedProvider?.source === "custom";
  const selectedModels = selectedProvider?.models ?? [];
  const enabledCount = selectedModels.filter((model) => model.enabled).length;
  const canSaveProvider =
    !!selectedProvider &&
    canEditProvider &&
    providerForm.label.trim().length > 0 &&
    providerForm.baseUrl.trim().length > 0;

  const formatParams = (model: ModelOption): string =>
    t("model.params.workbenchSummary", {
      temperature: f.fixed(model.temperature, 1),
      topP: f.fixed(model.topP, 2),
      context: f.compactNumber(model.contextWindow),
      maxTokens: f.number(model.maxOutputTokens),
    });

  const formatCapabilities = (model: ModelOption): string => {
    const caps = [
      model.capabilities.textGeneration ? t("model.capability.textGeneration") : "",
      model.capabilities.vision ? t("model.capability.vision") : "",
      model.capabilities.imageOutput ? t("model.capability.imageOutput") : "",
      model.capabilities.speechOutput ? t("model.capability.speechOutput") : "",
      model.capabilities.transcription ? t("model.capability.transcription") : "",
      model.capabilities.videoOutput ? t("model.capability.videoOutput") : "",
      model.capabilities.toolCalling ? t("model.capability.toolCalling") : "",
      model.capabilities.reasoning ? t("model.capability.reasoning") : "",
      model.capabilities.embedding ? t("model.capability.embedding") : "",
    ].filter(Boolean);
    return caps.length > 0 ? caps.join(" / ") : t("common.none");
  };

  const handleToggleModel = (model: ModelOption, enabled: boolean): void => {
    if (!selectedProvider) return;
    void notify
      .promise(
        api.providers.updateModelEnabled(selectedProvider.id, model.id, enabled),
        {
          loading: t("toast.model.modelSaving"),
          success: t("toast.model.modelSaved"),
          error: t("toast.model.modelSaveFailed"),
        },
        locale,
      )
      .then(() => {
        if (
          !enabled &&
          settings.selectedModel === providerModelRef(selectedProvider.id, model.id)
        ) {
          void update({ selectedModel: null });
        }
        refreshCatalog();
      })
      .catch(() => undefined);
  };

  const handleSaveProvider = (): void => {
    if (!selectedProvider || !canSaveProvider) return;

    const saveProviderAndApiKey = async (): Promise<void> => {
      await api.providers.upsertCustomProvider({
        id: selectedProvider.id,
        label: providerForm.label,
        baseUrl: providerForm.baseUrl,
        helpUrl: providerForm.helpUrl,
      });

      if (providerApiKey.trim()) {
        await api.providers.setProviderApiKey(selectedProvider.id, providerApiKey.trim());
        setProviderApiKey("");
      }
    };

    void notify
      .promise(
        saveProviderAndApiKey(),
        {
          loading: t("toast.model.providerSaving"),
          success: t("toast.model.providerSaved"),
          error: t("toast.model.providerSaveFailed"),
        },
        locale,
      )
      .then(refreshCatalog)
      .catch(() => undefined);
  };

  const handleSaveProviderApiKey = (): void => {
    if (!selectedProvider || !providerApiKey.trim()) return;
    void notify
      .promise(
        api.providers.setProviderApiKey(selectedProvider.id, providerApiKey.trim()),
        {
          loading: t("toast.apikey.saving"),
          success: t("toast.apikey.saved"),
          error: t("toast.apikey.saveFailed"),
        },
        locale,
      )
      .then(() => {
        setProviderApiKey("");
        refreshCatalog();
      })
      .catch(() => undefined);
  };

  const handleTestProvider = (): void => {
    if (!selectedProvider) return;
    const providerId = selectedProvider.id;
    setTestingProviderId(providerId);
    void api.providers
      .testProvider(providerId)
      .then((result) => {
        if (result.ok) {
          notify.success(t("toast.model.providerTestOk", { count: result.checkedModels }));
        } else {
          notify.error(t("toast.model.providerTestFailed"), result.message, locale);
        }
      })
      .catch((error) => notify.error(t("toast.model.providerTestFailed"), error, locale))
      .finally(() => setTestingProviderId(null));
  };

  const handleSyncModels = (): void => {
    if (!selectedProvider) return;
    const providerId = selectedProvider.id;
    setSyncingProviderId(providerId);
    const task = api.providers.syncAvailableModels(providerId);
    void notify
      .promise(
        task,
        {
          loading: t("toast.model.syncing"),
          success: t("toast.model.synced"),
          error: t("toast.model.syncFailed"),
        },
        locale,
      )
      .then((result) => {
        notify.success(
          t("toast.model.syncSummary", {
            discovered: result.discovered,
            added: result.added,
            updated: result.updated,
          }),
        );
        setSelectedProviderId(result.provider.id);
        refreshCatalog();
      })
      .catch(() => undefined)
      .finally(() => setSyncingProviderId(null));
  };

  const handleDeleteProvider = (): void => {
    if (!providerToDelete) return;
    const provider = providerToDelete;
    void notify
      .promise(
        api.providers.deleteCustomProvider(provider.id),
        {
          loading: t("toast.model.providerDeleting"),
          success: t("toast.model.providerDeleted"),
          error: t("toast.model.providerDeleteFailed"),
        },
        locale,
      )
      .then(() => {
        if (settings.selectedModel?.startsWith(provider.id + "/")) {
          void update({ selectedModel: null });
        }
        setProviderToDelete(null);
        setSelectedProviderId(null);
        refreshCatalog();
      })
      .catch(() => undefined);
  };

  const handleDeleteModel = (): void => {
    if (!modelToDelete) return;
    const { provider, model } = modelToDelete;
    void notify
      .promise(
        api.providers.deleteCustomModel(provider.id, model.id),
        {
          loading: t("toast.model.modelDeleting"),
          success: t("toast.model.modelDeleted"),
          error: t("toast.model.modelDeleteFailed"),
        },
        locale,
      )
      .then(() => {
        if (settings.selectedModel === providerModelRef(provider.id, model.id)) {
          void update({ selectedModel: null });
        }
        setModelToDelete(null);
        refreshCatalog();
      })
      .catch(() => undefined);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 select-none">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="text-base font-semibold">{t("settings.tab.model")}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 min-w-64 select-none select-text rounded-md border border-foreground/15 bg-background px-3 text-sm outline-none focus:border-accent/50"
            value={settings.selectedModel ?? ""}
            onChange={(event) => void update({ selectedModel: event.target.value || null })}
          >
            <option value="">{t("chat.selectModel")}</option>
            {enabledProviders.map((provider) => (
              <optgroup key={provider.id} label={provider.label}>
                {provider.models.map((model) => (
                  <option key={model.id} value={providerModelRef(provider.id, model.id)}>
                    {model.label ?? model.id}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button variant="primary" size="sm" onPress={() => setAddProviderOpen(true)}>
            <IconPlus className="mr-1 size-3.5" />
            {t("model.addProvider")}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 overflow-hidden rounded-xl border border-foreground/10 bg-foreground/[0.018] lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <aside className="min-h-0 flex flex-col border-b border-foreground/10 p-3 lg:border-b-0 lg:border-r">
          <SearchField
            aria-label={t("model.provider.search")}
            value={providerQuery}
            onChange={setProviderQuery}
            fullWidth
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input className="select-text" placeholder={t("model.provider.search")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>

          <div className="mt-3 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
            {filteredProviders.length === 0 ? (
              <div className="rounded-md border border-dashed border-foreground/15 px-3 py-8 text-center text-xs text-foreground/50">
                {t("model.provider.noMatches")}
              </div>
            ) : (
              filteredProviders.map((provider) => {
                const active = provider.id === selectedProviderId;
                const count = provider.models.length;
                const providerEnabledCount = provider.models.filter(
                  (model) => model.enabled,
                ).length;
                return (
                  <button
                    key={provider.id}
                    type="button"
                    className={[
                      "w-full select-none rounded-lg border px-3 py-2.5 text-left transition",
                      active
                        ? "border-accent/50 bg-accent/10 shadow-sm"
                        : "border-transparent hover:border-foreground/10 hover:bg-foreground/[0.04]",
                    ].join(" ")}
                    onClick={() => setSelectedProviderId(provider.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "size-2 shrink-0 rounded-full",
                          provider.hasApiKey ? "bg-success" : "bg-warning",
                        ].join(" ")}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {provider.label}
                      </span>
                      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] text-foreground/55">
                        {provider.source === "builtin"
                          ? t("model.provider.builtin")
                          : t("model.provider.custom")}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground/45">
                      <span>{provider.id}</span>
                      <span>
                        {t("model.provider.modelsCount", {
                          count,
                          enabled: providerEnabledCount,
                        })}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div className="min-h-0 min-w-0 flex flex-col overflow-hidden p-4">
          {!selectedProvider ? (
            <div className="flex flex-1 min-h-0 items-center justify-center rounded-lg border border-dashed border-foreground/15 text-sm text-foreground/50">
              {t("model.provider.empty")}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="shrink-0 flex flex-col gap-3 border-b border-foreground/10 pb-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-base font-semibold">{selectedProvider.label}</h4>
                    <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] text-foreground/55">
                      {selectedProvider.kind}
                    </span>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-[11px]",
                        selectedProvider.hasApiKey
                          ? "bg-success/10 text-success"
                          : "bg-warning/10 text-warning",
                      ].join(" ")}
                    >
                      {selectedProvider.hasApiKey
                        ? t("apikey.configured")
                        : t("apikey.notConfigured")}
                    </span>
                  </div>
                  <p className="mt-1 break-all text-xs text-foreground/45">{selectedProvider.id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger>
                      <Button
                        type="button"
                        isIconOnly
                        size="sm"
                        variant="secondary"
                        isPending={testingProviderId === selectedProvider.id}
                        onPress={handleTestProvider}
                        aria-label={t("model.provider.test")}
                      >
                        <IconZap className="size-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("model.provider.test")}</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="secondary"
                    size="sm"
                    isPending={syncingProviderId === selectedProvider.id}
                    onPress={handleSyncModels}
                  >
                    <IconRefresh className="mr-1 size-3.5" />
                    {t("model.provider.sync")}
                  </Button>
                  {canEditProvider ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onPress={handleSaveProvider}
                        isDisabled={!canSaveProvider && !providerApiKey.trim()}
                      >
                        {t("common.save")}
                      </Button>
                      <Button
                        variant="tertiary"
                        size="sm"
                        onPress={() => setProviderToDelete(selectedProvider)}
                      >
                        <IconTrash className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    providerApiKey.trim() && (
                      <Button variant="secondary" size="sm" onPress={handleSaveProviderApiKey}>
                        {t("common.save")}
                      </Button>
                    )
                  )}
                </div>
              </div>

              <div className="shrink-0 grid gap-3 md:grid-cols-2">
                <TextField>
                  <Label>{t("model.providerName")}</Label>
                  <Input
                    className="select-text"
                    value={providerForm.label}
                    disabled={!canEditProvider}
                    onChange={(event) =>
                      setProviderForm((prev) => ({
                        ...prev,
                        label: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.providerId")}</Label>
                  <Input className="select-text" value={selectedProvider.id} disabled />
                </TextField>
                <TextField>
                  <Label>{t("model.baseUrl")}</Label>
                  <Input
                    className="select-text"
                    value={providerForm.baseUrl}
                    placeholder={t("model.provider.builtinEndpoint")}
                    disabled={!canEditProvider}
                    onChange={(event) =>
                      setProviderForm((prev) => ({
                        ...prev,
                        baseUrl: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.helpUrl")}</Label>
                  <Input
                    className="select-text"
                    value={providerForm.helpUrl ?? ""}
                    disabled={!canEditProvider}
                    onChange={(event) =>
                      setProviderForm((prev) => ({
                        ...prev,
                        helpUrl: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField className="md:col-span-2">
                  <Label>{t("model.apiKey")}</Label>
                  <Input
                    type="password"
                    className="select-text"
                    value={providerApiKey}
                    placeholder={
                      selectedProvider.hasProviderApiKey
                        ? t("apikey.placeholder.replace")
                        : t("apikey.placeholder.set", { label: selectedProvider.label })
                    }
                    onChange={(event) =>
                      setProviderApiKey((event.target as HTMLInputElement).value)
                    }
                  />
                  <Description className="mt-1 flex flex-wrap items-center gap-3">
                    <span>{t("model.provider.keyHelp")}</span>
                    {selectedProvider.helpUrl && (
                      <a
                        href={selectedProvider.helpUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {t("apikey.getKey")}
                      </a>
                    )}
                  </Description>
                </TextField>
              </div>

              <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-lg border border-foreground/10">
                <div className="flex flex-col gap-2 border-b border-foreground/10 bg-foreground/[0.025] px-3 py-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h5 className="text-sm font-medium">{t("model.models.available")}</h5>
                    <p className="mt-0.5 text-xs text-foreground/45">
                      {t("model.provider.modelsCount", {
                        count: selectedModels.length,
                        enabled: enabledCount,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      isPending={syncingProviderId === selectedProvider.id}
                      onPress={handleSyncModels}
                    >
                      <IconRefresh className="mr-1 size-3.5" />
                      {t("model.models.fetch")}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onPress={() =>
                        setModelEditorState({ mode: "add", providerId: selectedProvider.id })
                      }
                    >
                      <IconPlus className="mr-1 size-3.5" />
                      {t("model.models.addManual")}
                    </Button>
                  </div>
                </div>

                {selectedModels.length === 0 ? (
                  <div className="flex flex-1 min-h-0 items-center justify-center px-4 py-10 text-center text-sm text-foreground/50">
                    {t("model.provider.emptyModels")}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 divide-y divide-foreground/10 overflow-y-auto">
                    {selectedModels.map((model) => {
                      const ref = providerModelRef(selectedProvider.id, model.id);
                      const selected = settings.selectedModel === ref;
                      const optionCount = Object.keys(model.providerOptions ?? {}).length;
                      return (
                        <div
                          key={model.id}
                          className={[
                            "grid gap-3 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto]",
                            selected ? "bg-accent/10" : "",
                            model.enabled ? "" : "opacity-70",
                          ].join(" ")}
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">
                                {model.label ?? model.id}
                              </span>
                              <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] text-foreground/55">
                                {model.source === "builtin"
                                  ? t("model.provider.builtin")
                                  : t("model.custom")}
                              </span>
                              {selected && (
                                <span className="inline-flex items-center gap-1 text-xs text-accent">
                                  <IconCheck className="size-3" /> {t("model.selected")}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 break-all text-xs text-foreground/45">{model.id}</p>
                            <p className="mt-1 text-xs text-foreground/45">{formatParams(model)}</p>
                            <p className="mt-1 text-xs text-foreground/40">
                              {formatCapabilities(model)}
                              {optionCount > 0
                                ? " / " +
                                  t("model.options.count", {
                                    count: optionCount,
                                  })
                                : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 md:justify-end">
                            <Switch
                              size="sm"
                              isSelected={model.enabled}
                              onChange={(enabled) => handleToggleModel(model, enabled)}
                            >
                              <Switch.Content>
                                <Switch.Control>
                                  <Switch.Thumb />
                                </Switch.Control>
                                {t("model.enabled")}
                              </Switch.Content>
                            </Switch>
                            <Tooltip>
                              <TooltipTrigger>
                                <Button
                                  type="button"
                                  isIconOnly
                                  size="sm"
                                  variant="secondary"
                                  onPress={() =>
                                    setModelEditorState({
                                      mode: "edit",
                                      providerId: selectedProvider.id,
                                      model,
                                    })
                                  }
                                  aria-label={t("model.options.title")}
                                >
                                  <IconSliders className="size-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t("model.options.title")}</TooltipContent>
                            </Tooltip>
                            <Button
                              type="button"
                              isIconOnly
                              variant="tertiary"
                              size="sm"
                              onPress={() =>
                                setModelToDelete({ provider: selectedProvider, model })
                              }
                              aria-label={t("common.delete")}
                            >
                              <IconTrash className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <AddProviderDialog
        open={addProviderOpen}
        onClose={() => setAddProviderOpen(false)}
        onSaved={(provider) => {
          setSelectedProviderId(provider.id);
          refreshCatalog();
        }}
      />

      <ModelOptionsDialog
        state={modelEditorState}
        provider={selectedProvider}
        selectedModel={settings.selectedModel}
        onClearSelectedModel={() => update({ selectedModel: null })}
        onSaved={refreshCatalog}
        onClose={() => setModelEditorState(null)}
      />

      <ConfirmDialog
        open={!!providerToDelete}
        title={t("model.provider.delete")}
        message={t("model.provider.delete.confirm", {
          label: providerToDelete?.label ?? "",
        })}
        danger
        confirmLabel={t("common.delete")}
        onConfirm={handleDeleteProvider}
        onClose={() => setProviderToDelete(null)}
      />
      <ConfirmDialog
        open={!!modelToDelete}
        title={t("common.delete")}
        message={t("model.deleteModel.confirm", {
          label: modelToDelete?.model.label ?? modelToDelete?.model.id ?? "",
        })}
        danger
        confirmLabel={t("common.delete")}
        onConfirm={handleDeleteModel}
        onClose={() => setModelToDelete(null)}
      />
    </section>
  );
}

function AddProviderDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (provider: ProviderInfo) => void;
}): React.JSX.Element {
  const { t, locale } = useT();
  const [form, setForm] = useState<CustomProviderInput>({
    id: "",
    label: "",
    baseUrl: "",
    helpUrl: "",
  });

  useEffect(() => {
    if (open) setForm({ id: "", label: "", baseUrl: "", helpUrl: "" });
  }, [open]);

  const canSave = form.label.trim().length > 0 && form.baseUrl.trim().length > 0;

  const handleSave = (): void => {
    if (!canSave) return;
    void notify
      .promise(
        api.providers.upsertCustomProvider(form),
        {
          loading: t("toast.model.providerSaving"),
          success: t("toast.model.providerSaved"),
          error: t("toast.model.providerSaveFailed"),
        },
        locale,
      )
      .then((provider) => {
        onSaved(provider);
        onClose();
      })
      .catch(() => undefined);
  };

  return (
    <Modal isOpen={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <div className="flex w-full items-center justify-between gap-3">
                <Modal.Heading className="text-base font-semibold">
                  {t("model.addProvider")}
                </Modal.Heading>
                <Button
                  type="button"
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={onClose}
                  aria-label={t("common.close")}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField>
                  <Label>{t("model.providerName")}</Label>
                  <Input
                    className="select-text"
                    value={form.label}
                    placeholder={t("model.placeholder.providerName")}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        label: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.providerId")}</Label>
                  <Input
                    className="select-text"
                    value={form.id ?? ""}
                    placeholder={t("model.placeholder.providerId")}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        id: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.baseUrl")}</Label>
                  <Input
                    className="select-text"
                    value={form.baseUrl}
                    placeholder={t("model.placeholder.baseUrl")}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        baseUrl: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.helpUrl")}</Label>
                  <Input
                    className="select-text"
                    value={form.helpUrl ?? ""}
                    placeholder={t("model.placeholder.helpUrl")}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        helpUrl: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <div className="flex w-full justify-end gap-2">
                <Button variant="secondary" onPress={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onPress={handleSave} isDisabled={!canSave}>
                  {t("common.save")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ModelOptionsDialog({
  state,
  provider,
  selectedModel,
  onClearSelectedModel,
  onSaved,
  onClose,
}: {
  state: ModelOptionsEditorState | null;
  provider: ProviderInfo | null;
  selectedModel: string | null;
  onClearSelectedModel: () => Promise<void>;
  onSaved: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t, f, locale } = useT();
  const [form, setForm] = useState<ModelOptionsFormState>(() => createModelOptionsForm(""));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!state) return;
    setForm(
      createModelOptionsForm(state.providerId, state.mode === "edit" ? state.model : undefined),
    );
    setJsonError(null);
  }, [state]);

  if (!state || !provider) return <></>;

  const isEditing = state.mode === "edit";
  const canSave =
    form.id.trim().length > 0 && form.maxOutputTokens > 0 && form.contextWindow > 0 && !jsonError;

  const updateCapabilities = (patch: Partial<ModelCapabilities>): void => {
    setForm((prev) => ({ ...prev, capabilities: { ...prev.capabilities, ...patch } }));
  };

  const handleJsonChange = (value: string): void => {
    setForm((prev) => ({ ...prev, providerOptionsJson: value }));
    setJsonError(validateJsonObject(value));
  };

  const handleSave = (): void => {
    const error = validateJsonObject(form.providerOptionsJson);
    setJsonError(error);
    if (error || !canSave) return;
    const modelId = form.id.trim();
    const task = (async (): Promise<void> => {
      await api.providers.upsertCustomModel({
        providerId: form.providerId,
        id: modelId,
        label: form.label.trim(),
        enabled: form.enabled,
        temperature: form.temperature,
        topP: form.topP,
        maxOutputTokens: Math.floor(form.maxOutputTokens),
        contextWindow: Math.floor(form.contextWindow),
        capabilities: form.capabilities,
        providerOptionsJson: form.providerOptionsJson,
      });
      if (!form.enabled && selectedModel === providerModelRef(form.providerId, modelId)) {
        await onClearSelectedModel();
      }
    })();

    void notify
      .promise(
        task,
        {
          loading: t("toast.model.modelSaving"),
          success: t("toast.model.modelSaved"),
          error: t("toast.model.modelSaveFailed"),
        },
        locale,
      )
      .then(() => {
        onSaved();
        onClose();
      })
      .catch(() => undefined);
  };

  return (
    <Modal isOpen={!!state} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <div className="flex w-full items-center justify-between gap-3">
                <div>
                  <Modal.Heading className="text-base font-semibold">
                    {isEditing ? t("model.options.title") : t("model.addModel")}
                  </Modal.Heading>
                  <p className="mt-0.5 text-xs text-foreground/50">{provider.label}</p>
                </div>
                <Button
                  type="button"
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  onPress={onClose}
                  aria-label={t("common.close")}
                >
                  <IconClose className="size-4" />
                </Button>
              </div>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-3 md:grid-cols-2">
                <TextField>
                  <Label>{t("model.modelId")}</Label>
                  <Input
                    className="select-text"
                    value={form.id}
                    disabled={isEditing}
                    placeholder={t("model.placeholder.modelId")}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        id: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <TextField>
                  <Label>{t("model.modelName")}</Label>
                  <Input
                    className="select-text"
                    value={form.label}
                    placeholder={t("model.placeholder.modelName")}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        label: (event.target as HTMLInputElement).value,
                      }))
                    }
                  />
                </TextField>
                <div className="md:col-span-2">
                  <Switch
                    size="sm"
                    isSelected={form.enabled}
                    onChange={(enabled) => setForm((prev) => ({ ...prev, enabled }))}
                  >
                    {t("model.enabled")}
                  </Switch>
                </div>

                <div className="space-y-4 md:col-span-2">
                  <p className="text-xs font-medium text-foreground/60">{t("model.params")}</p>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-foreground/60">
                      <span>{t("model.temperature")}</span>
                      <span>{f.fixed(form.temperature, 1)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={form.temperature}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, temperature: Number(event.target.value) }))
                      }
                      className="w-full accent-[var(--color-accent)]"
                      aria-label={t("model.temperature")}
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-foreground/60">
                      <span>{t("model.topP")}</span>
                      <span>{f.fixed(form.topP, 2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={form.topP}
                      onChange={(event) =>
                        setForm((prev) => ({ ...prev, topP: Number(event.target.value) }))
                      }
                      className="w-full accent-[var(--color-accent)]"
                      aria-label={t("model.topP")}
                    />
                  </div>
                </div>

                <TextField>
                  <Label>{t("model.contextWindow")}</Label>
                  <Input
                    type="number"
                    className="select-text"
                    min={1}
                    step={1024}
                    value={String(form.contextWindow)}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        contextWindow: Math.max(
                          1,
                          Number((event.target as HTMLInputElement).value) || 1,
                        ),
                      }))
                    }
                  />
                  <Description className="mt-1">{t("model.contextWindow.hint")}</Description>
                </TextField>
                <TextField>
                  <Label>{t("model.maxTokens")}</Label>
                  <Input
                    type="number"
                    className="select-text"
                    min={1}
                    max={32768}
                    step={256}
                    value={String(form.maxOutputTokens)}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        maxOutputTokens: Math.max(
                          1,
                          Number((event.target as HTMLInputElement).value) || 1,
                        ),
                      }))
                    }
                  />
                  <Description className="mt-1">{t("model.maxTokens.hint")}</Description>
                </TextField>

                <div className="md:col-span-2">
                  <p className="mb-2 text-xs font-medium text-foreground/60">
                    {t("model.options.capabilities")}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {(
                      [
                        ["textGeneration", "model.capability.textGeneration"],
                        ["vision", "model.capability.vision"],
                        ["imageOutput", "model.capability.imageOutput"],
                        ["speechOutput", "model.capability.speechOutput"],
                        ["transcription", "model.capability.transcription"],
                        ["videoOutput", "model.capability.videoOutput"],
                        ["toolCalling", "model.capability.toolCalling"],
                        ["reasoning", "model.capability.reasoning"],
                        ["embedding", "model.capability.embedding"],
                      ] as const
                    ).map(([key, labelKey]) => (
                      <Switch
                        key={key}
                        size="sm"
                        isSelected={form.capabilities[key]}
                        onChange={(enabled) => updateCapabilities({ [key]: enabled })}
                      >
                        {t(labelKey)}
                      </Switch>
                    ))}
                  </div>
                </div>

                <TextField className="md:col-span-2" isInvalid={!!jsonError}>
                  <Label>{t("model.options.providerOptions")}</Label>
                  <TextArea
                    rows={8}
                    value={form.providerOptionsJson}
                    onChange={(event) => handleJsonChange(event.target.value)}
                    className="select-text font-mono text-xs"
                    spellCheck={false}
                  />
                  <Description className="mt-1">
                    {jsonError
                      ? t("error.providerOptions.json")
                      : t("model.options.providerOptions.desc")}
                  </Description>
                </TextField>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <div className="flex w-full flex-wrap justify-end gap-2">
                <Button variant="secondary" onPress={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button variant="primary" onPress={handleSave} isDisabled={!canSave}>
                  {t("common.save")}
                </Button>
              </div>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

type TrashKind = "conversations" | "agents" | "mcp" | "skills";
type DeletableTrashKind = Exclude<TrashKind, "agents">;

interface TrashRow {
  kind: DeletableTrashKind;
  id: string;
  title: string;
  description: string;
  meta: string[];
  detail?: string;
  error?: string | null;
  deletedAt: number | null;
  purgeAfter: number | null;
}

interface PendingTrashDelete {
  kind: DeletableTrashKind;
  id: string;
  title: string;
}

interface PendingTrashBatchDelete {
  kind: DeletableTrashKind;
  count: number;
}

function TrashTab(): React.JSX.Element {
  const { t, f, locale } = useT();
  const [trashKind, setTrashKind] = useState<TrashKind>("conversations");
  const [conversationItems, setConversationItems] = useState<Conversation[]>([]);
  const [agentItems, setAgentItems] = useState<AgentProfile[]>([]);
  const [mcpItems, setMcpItems] = useState<ToolServer[]>([]);
  const [skillItems, setSkillItems] = useState<ToolSkill[]>([]);
  const [loading, setLoading] = useState<Record<TrashKind, boolean>>({
    conversations: false,
    agents: false,
    mcp: false,
    skills: false,
  });
  const [pendingPermanentDelete, setPendingPermanentDelete] = useState<PendingTrashDelete | null>(
    null,
  );
  const [pendingBatchDelete, setPendingBatchDelete] = useState<PendingTrashBatchDelete | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const setKindLoading = (kind: TrashKind, value: boolean): void => {
    setLoading((current) => ({ ...current, [kind]: value }));
  };

  const refreshConversations = (): void => {
    setKindLoading("conversations", true);
    void api.conversations
      .purgeExpired()
      .then(() => api.conversations.listDeleted())
      .then(setConversationItems)
      .catch((error) => notify.error(t("toast.trash.loadFailed"), error, locale))
      .finally(() => setKindLoading("conversations", false))
      .catch(() => undefined);
  };

  const refreshAgents = (): void => {
    setKindLoading("agents", true);
    void api.agents
      .list()
      .then((agents) =>
        setAgentItems(
          agents
            .filter((agent) => agent.kind === "child" && agent.status === "archived")
            .sort((a, b) => b.updated_at - a.updated_at),
        ),
      )
      .catch((error) => notify.error(t("toast.trash.loadAgentsFailed"), error, locale))
      .finally(() => setKindLoading("agents", false))
      .catch(() => undefined);
  };

  const refreshMcp = (): void => {
    setKindLoading("mcp", true);
    void api.mcp
      .purgeExpired()
      .then(() => api.mcp.listDeleted())
      .then(setMcpItems)
      .catch((error) => notify.error(t("toast.trash.loadMcpFailed"), error, locale))
      .finally(() => setKindLoading("mcp", false))
      .catch(() => undefined);
  };

  const refreshSkills = (): void => {
    setKindLoading("skills", true);
    void api.tools.skills
      .purgeExpired()
      .then(() => api.tools.skills.listDeleted())
      .then(setSkillItems)
      .catch((error) => notify.error(t("toast.trash.loadSkillsFailed"), error, locale))
      .finally(() => setKindLoading("skills", false))
      .catch(() => undefined);
  };

  const refresh = (): void => {
    refreshConversations();
    refreshAgents();
    refreshMcp();
    refreshSkills();
  };

  useEffect(() => {
    refresh();
  }, []);

  const activeRows = useMemo<TrashRow[]>(() => {
    if (trashKind === "mcp") {
      return mcpItems.map((server) => ({
        kind: "mcp",
        id: server.id,
        title: server.name,
        description: server.description || t("tools.mcp.noDescription"),
        detail: mcpEndpointSummary(server),
        error: server.last_error,
        meta: [
          `${t("trash.transport")}: ${server.transport}`,
          `${t("trash.status")}: ${server.status}`,
          `${t("trash.timeout")}: ${server.timeout_seconds}s`,
        ],
        deletedAt: server.deleted_at,
        purgeAfter: server.purge_after_at,
      }));
    }
    if (trashKind === "skills") {
      return skillItems.map((skill) => ({
        kind: "skills",
        id: skill.id,
        title: skill.name,
        description: skill.description || t("tools.skill.noDescription"),
        detail: skillSourceSummary(skill),
        meta: [`${t("trash.category")}: ${skill.category}`],
        deletedAt: skill.deleted_at,
        purgeAfter: skill.purge_after_at,
      }));
    }
    if (trashKind === "conversations") {
      return conversationItems.map((conversation) => ({
        kind: "conversations",
        id: conversation.id,
        title: conversation.title,
        description: "",
        meta: [],
        deletedAt: conversation.deleted_at,
        purgeAfter: conversation.purge_after_at,
      }));
    }
    return [];
  }, [conversationItems, mcpItems, skillItems, t, trashKind]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [trashKind]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const alive = new Set(activeRows.map((row) => row.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [activeRows]);

  const selectionState = useMemo<{ allSelected: boolean; indeterminate: boolean }>(() => {
    if (activeRows.length === 0) return { allSelected: false, indeterminate: false };
    const allSelected = selectedIds.size === activeRows.length;
    const indeterminate = selectedIds.size > 0 && !allSelected;
    return { allSelected, indeterminate };
  }, [activeRows.length, selectedIds.size]);

  const toggleAll = (next: boolean): void => {
    setSelectedIds(next ? new Set(activeRows.map((row) => row.id)) : new Set());
  };

  const toggleOne = (id: string, next: boolean): void => {
    setSelectedIds((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(id);
      else updated.delete(id);
      return updated;
    });
  };

  const refreshKind = (kind: TrashKind): void => {
    if (kind === "conversations") refreshConversations();
    else if (kind === "agents") refreshAgents();
    else if (kind === "mcp") refreshMcp();
    else refreshSkills();
  };

  const trashItemLabel = (kind: TrashKind): string => {
    if (kind === "conversations") return t("trash.item.conversation");
    if (kind === "agents") return t("trash.item.agent");
    if (kind === "mcp") return t("trash.item.mcp");
    return t("trash.item.skill");
  };

  const emptyMessage = (): string => {
    if (trashKind === "conversations") return t("trash.empty");
    if (trashKind === "agents") return t("trash.agents.empty");
    if (trashKind === "mcp") return t("trash.mcp.empty");
    return t("trash.skills.empty");
  };

  const restoreTrashItem = (row: TrashRow): void => {
    const promise: Promise<unknown> =
      row.kind === "conversations"
        ? api.conversations.restore(row.id)
        : row.kind === "mcp"
          ? api.mcp.restore(row.id)
          : api.tools.skills.restore(row.id);

    void notify
      .promise(
        promise,
        {
          loading: t("toast.trash.restoring", { item: trashItemLabel(row.kind) }),
          success: t("toast.trash.restored", { item: trashItemLabel(row.kind) }),
          error: t("toast.trash.restoreFailed", { item: trashItemLabel(row.kind) }),
        },
        locale,
      )
      .then(() => refreshKind(row.kind))
      .catch(() => undefined);
  };

  const handleAgentRestore = (agent: AgentProfile): void => {
    void notify
      .promise(
        api.agents.restore(agent.id),
        {
          loading: t("toast.agent.restoring"),
          success: t("toast.agent.restored"),
          error: t("toast.agent.restoreFailed"),
        },
        locale,
      )
      .then(refreshAgents)
      .catch(() => undefined);
  };

  const [pendingAgentDelete, setPendingAgentDelete] = useState<AgentProfile | null>(null);

  const handleAgentPermanentDelete = (): void => {
    const agent = pendingAgentDelete;
    setPendingAgentDelete(null);
    if (!agent) return;
    void notify
      .promise(
        api.agents.delete(agent.id),
        {
          loading: t("toast.agent.deleting"),
          success: t("toast.agent.deleted"),
          error: t("toast.agent.deleteFailed"),
        },
        locale,
      )
      .then(refreshAgents)
      .catch(() => undefined);
  };

  const handlePermanentDelete = (): void => {
    if (!pendingPermanentDelete) return;
    const item = pendingPermanentDelete;
    const promise: Promise<unknown> =
      item.kind === "conversations"
        ? api.conversations.permanentDelete(item.id)
        : item.kind === "mcp"
          ? api.mcp.permanentDelete(item.id)
          : api.tools.skills.permanentDelete(item.id);

    void notify
      .promise(
        promise,
        {
          loading: t("toast.trash.permanentDeleting", { item: trashItemLabel(item.kind) }),
          success: t("toast.trash.permanentDeleted", { item: trashItemLabel(item.kind) }),
          error: t("toast.trash.permanentDeleteFailed", { item: trashItemLabel(item.kind) }),
        },
        locale,
      )
      .then(() => refreshKind(item.kind))
      .catch(() => undefined);
    setPendingPermanentDelete(null);
  };

  const handleBatchDelete = (): void => {
    if (!pendingBatchDelete) return;
    const ids = Array.from(selectedIds);
    const kind = pendingBatchDelete.kind;
    if (ids.length === 0) {
      setPendingBatchDelete(null);
      return;
    }

    const promise =
      kind === "conversations"
        ? api.conversations.permanentDeleteBatch(ids)
        : kind === "mcp"
          ? api.mcp.permanentDeleteBatch(ids)
          : api.tools.skills.permanentDeleteBatch(ids);

    void notify
      .promise(
        promise,
        {
          loading: t("toast.trash.permanentDeleting", { item: trashItemLabel(kind) }),
          success: t("toast.trash.permanentDeletedBatch", { count: ids.length }),
          error: t("toast.trash.permanentDeleteFailed", { item: trashItemLabel(kind) }),
        },
        locale,
      )
      .then(() => {
        setSelectedIds(new Set());
        refreshKind(kind);
      })
      .catch(() => undefined);
    setPendingBatchDelete(null);
  };

  return (
    <section className="space-y-4 select-none">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h3 className="text-base font-semibold">{t("trash.title")}</h3>
        <ToggleButtonGroup
          selectionMode="single"
          disallowEmptySelection
          size="sm"
          selectedKeys={[trashKind]}
          onSelectionChange={(keys) => {
            const next = Array.from(keys)[0];
            if (
              next === "conversations" ||
              next === "agents" ||
              next === "mcp" ||
              next === "skills"
            ) {
              setTrashKind(next);
            }
          }}
          className="max-w-full flex-wrap"
        >
          <ToggleButton id="conversations">{t("trash.tab.conversations")}</ToggleButton>
          <ToggleButton id="agents">{t("trash.tab.agents")}</ToggleButton>
          <ToggleButton id="mcp">{t("trash.tab.mcp")}</ToggleButton>
          <ToggleButton id="skills">{t("trash.tab.skills")}</ToggleButton>
        </ToggleButtonGroup>
      </header>

      {trashKind === "agents" ? (
        agentItems.length === 0 ? (
          <div className="rounded-md border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/45">
            {loading.agents ? t("chat.loadingHistory") : emptyMessage()}
          </div>
        ) : (
          <div className="space-y-2">
            {agentItems.map((agent) => (
              <div key={agent.id} className="rounded-md border border-foreground/10 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-foreground/10 bg-foreground/[0.03] text-lg">
                      {agent.avatar || "A"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{agent.name}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-foreground/55">
                        {agent.role || agent.description || t("trash.agents.noRole")}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/45">
                        <span>
                          {t("trash.agentUpdated")}: {f.dateTime(agent.updated_at)}
                        </span>
                        <span>
                          {t("trash.agentStatus")}: {t("trash.agentArchived")}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                    <Button
                      className="w-full sm:w-auto"
                      variant="secondary"
                      size="sm"
                      onPress={() => handleAgentRestore(agent)}
                    >
                      {t("common.restore")}
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      variant="danger"
                      size="sm"
                      onPress={() => setPendingAgentDelete(agent)}
                    >
                      <IconTrash className="size-3.5" />
                      {t("trash.agents.delete.confirm")}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : activeRows.length === 0 ? (
        <div className="rounded-md border border-foreground/10 px-4 py-8 text-center text-sm text-foreground/45">
          {loading[trashKind] ? t("chat.loadingHistory") : emptyMessage()}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-foreground/10 bg-foreground/[0.02] px-3 py-2">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <Checkbox
                id="trash-select-all"
                isSelected={selectionState.allSelected}
                isIndeterminate={selectionState.indeterminate}
                onChange={toggleAll}
              >
                <Checkbox.Content>
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <span className="truncate">
                    {selectionState.allSelected ? t("trash.deselectAll") : t("trash.selectAll")}
                  </span>
                </Checkbox.Content>
              </Checkbox>
              {selectedIds.size > 0 && (
                <span className="text-xs text-foreground/55">
                  {t("trash.selectedCount", { count: selectedIds.size })}
                </span>
              )}
            </div>
            <Button
              className="max-w-full"
              variant="danger"
              size="sm"
              isDisabled={selectedIds.size === 0}
              onPress={() =>
                setPendingBatchDelete({
                  kind: activeRows[0]?.kind ?? "conversations",
                  count: selectedIds.size,
                })
              }
            >
              <span className="truncate">
                {t("trash.batchPermanent.button", { count: selectedIds.size })}
              </span>
            </Button>
          </div>

          <div className="space-y-2">
            {activeRows.map((row) => {
              const checked = selectedIds.has(row.id);
              return (
                <div key={row.id} className="rounded-md border border-foreground/10 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <Checkbox
                        id={`trash-item-${row.id}`}
                        isSelected={checked}
                        onChange={(next: boolean) => toggleOne(row.id, next)}
                        className="pt-0.5"
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="sr-only">{row.title}</span>
                        </Checkbox.Content>
                      </Checkbox>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.title}</p>
                        {row.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-foreground/55">
                            {row.description}
                          </p>
                        )}
                        {row.detail && (
                          <p className="mt-1 line-clamp-2 break-all font-mono text-[11px] text-foreground/45">
                            {row.detail}
                          </p>
                        )}
                        {row.error && (
                          <p className="mt-1 line-clamp-2 break-all text-xs text-danger">
                            {t("trash.error")}: {row.error}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/50">
                          {row.meta.map((item) => (
                            <span key={item} className="max-w-full truncate">
                              {item}
                            </span>
                          ))}
                          <span>
                            {t("trash.deletedAt")}:{" "}
                            {row.deletedAt ? f.dateTime(row.deletedAt) : "-"}
                          </span>
                          <span>
                            {t("trash.purgeIn")}:{" "}
                            {row.purgeAfter
                              ? f.relativeDuration(row.purgeAfter, t("trash.expired"))
                              : "-"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
                      <Button
                        className="min-w-24 flex-1 sm:flex-none"
                        variant="secondary"
                        size="sm"
                        onPress={() => restoreTrashItem(row)}
                      >
                        {t("common.restore")}
                      </Button>
                      <Button
                        className="min-w-24 flex-1 sm:flex-none"
                        variant="danger"
                        size="sm"
                        onPress={() =>
                          setPendingPermanentDelete({
                            kind: row.kind,
                            id: row.id,
                            title: row.title,
                          })
                        }
                      >
                        {t("common.permanentDelete")}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!pendingPermanentDelete}
        title={t("trash.permanent.title")}
        message={t("trash.permanent.confirm", { title: pendingPermanentDelete?.title ?? "" })}
        danger
        confirmLabel={t("common.permanentDelete")}
        onConfirm={handlePermanentDelete}
        onClose={() => setPendingPermanentDelete(null)}
      />

      <ConfirmDialog
        open={pendingAgentDelete !== null}
        title={t("trash.agents.delete.title")}
        message={t("trash.agents.delete.message", { name: pendingAgentDelete?.name ?? "" })}
        danger
        confirmLabel={t("trash.agents.delete.confirm")}
        onConfirm={handleAgentPermanentDelete}
        onClose={() => setPendingAgentDelete(null)}
      />

      <ConfirmDialog
        open={pendingBatchDelete !== null}
        title={t("trash.batchPermanent.title")}
        message={t("trash.batchPermanent.confirm", { count: pendingBatchDelete?.count ?? 0 })}
        danger
        confirmLabel={t("common.permanentDelete")}
        onConfirm={handleBatchDelete}
        onClose={() => setPendingBatchDelete(null)}
      />
    </section>
  );
}

function mcpEndpointSummary(server: ToolServer): string {
  if (server.transport !== "stdio") return server.url || "";
  const args = safeJsonArray(server.args_json).join(" ");
  return [server.command, args].filter(Boolean).join(" ").trim();
}

function skillSourceSummary(skill: ToolSkill): string {
  const config = safeJsonRecord(skill.config_json);
  const source = typeof config.source === "string" ? config.source : "skill";
  return `source=${source}`;
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed config for trash previews.
  }
  return {};
}

function DiagnosticsTab(): React.JSX.Element {
  const { t, f } = useT();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = (): void => {
    setRefreshing(true);
    void api.runtime.events
      .list()
      .then(setEvents)
      .finally(() => setRefreshing(false));
  };

  useEffect(refresh, []);

  return (
    <section className="flex flex-col min-h-0 flex-1 -mx-5 -my-4">
      <div className="shrink-0 flex items-center justify-between gap-3 select-none px-5 py-4">
        <div>
          <h3 className="text-base font-semibold">{t("settings.diagnostics.title")}</h3>
          <p className="mt-1 text-sm text-foreground/50">{t("settings.diagnostics.subtitle")}</p>
        </div>
        <Button variant="secondary" size="sm" onPress={refresh} isDisabled={refreshing}>
          <IconRotateCcw className={cn("size-4", refreshing && "animate-spin")} />
          {t("main.refresh")}
        </Button>
      </div>

      <div className="space-y-2 overflow-y-auto min-h-0 flex-1 px-5 pb-4">
        {events.length === 0 ? (
          <p className="rounded-md border border-foreground/10 p-6 text-center text-sm text-foreground/45">
            {t("tools.audit.empty")}
          </p>
        ) : (
          events.slice(0, 80).map((event) => (
            <div
              key={event.id}
              className="grid gap-2 rounded-md border border-foreground/10 p-3 text-sm md:grid-cols-[160px_1fr_auto]"
            >
              <div className="text-xs text-foreground/45">{f.dateTime(event.created_at)}</div>
              <div className="min-w-0">
                <p className="truncate font-medium">{event.title}</p>
                <p className="mt-1 truncate text-xs text-foreground/45">
                  {event.kind} / {event.status}
                </p>
              </div>
              <span className="text-xs text-foreground/45">{event.severity}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
