import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { resolveLanguage } from "./i18n";
import {
  SettingKey,
  DEFAULT_SETTINGS,
  CHAT_REASONING_LEVELS,
  type AppSettings,
  type SkinId,
  type FontSizeLevel,
  type LayoutDensity,
  type LanguageMode,
  type AppLanguage,
  type ReduceMotion,
  type DiffMark,
  type ChatReasoningLevel,
  type SettingEntry,
} from "@shared/types";
import { applyTheme } from "./theme";
import { SKIN_DEFINITIONS } from "../skins/registry";

const APP_SETTING_KEYS: string[] = [
  SettingKey.Skin,
  SettingKey.FontFamily,
  SettingKey.MonoFontFamily,
  SettingKey.UsePointerCursor,
  SettingKey.ReduceMotion,
  SettingKey.FontSize,
  SettingKey.CodeFontSizePx,
  SettingKey.DiffMark,
  SettingKey.LayoutDensity,
  SettingKey.Language,
  SettingKey.SelectedModel,
  SettingKey.ModelTemperature,
  SettingKey.ModelMaxTokens,
  SettingKey.ModelTopP,
  SettingKey.ChatReasoningLevel,
  SettingKey.MemoryLlmModel,
  SettingKey.MemoryEmbeddingModel,
];

const ALL_KEYS = [...APP_SETTING_KEYS, SettingKey.ActiveConversationId];

export type SettingsResetScope = "appearance";

const RESET_PATCHES: Record<SettingsResetScope, Partial<AppSettings>> = {
  appearance: {
    skin: DEFAULT_SETTINGS.skin,
    fontFamily: DEFAULT_SETTINGS.fontFamily,
    monoFontFamily: DEFAULT_SETTINGS.monoFontFamily,
    usePointerCursor: DEFAULT_SETTINGS.usePointerCursor,
    reduceMotion: DEFAULT_SETTINGS.reduceMotion,
    fontSize: DEFAULT_SETTINGS.fontSize,
    codeFontSizePx: DEFAULT_SETTINGS.codeFontSizePx,
    diffMark: DEFAULT_SETTINGS.diffMark,
    density: DEFAULT_SETTINGS.density,
    language: DEFAULT_SETTINGS.language,
  },
};

function parseEnum<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

const LEGACY_SKIN_IDS: Record<string, SkinId> = {
  "nova-light": "white",
  "nova-dark": "black",
};

function parseSkin(raw: string | null): SkinId {
  const migrated = raw ? (LEGACY_SKIN_IDS[raw] ?? raw) : null;
  return parseEnum<SkinId>(
    migrated,
    SKIN_DEFINITIONS.map((definition) => definition.id),
    DEFAULT_SETTINGS.skin,
  );
}

function parseNumber(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

function getBrowserLocale(): string {
  return typeof navigator !== "undefined" && navigator.language ? navigator.language : "en";
}

export function parseSettings(map: Record<string, string | null>): AppSettings {
  const skin = parseSkin(map[SettingKey.Skin]);
  const fontFamily = (map[SettingKey.FontFamily] ?? "").slice(0, 500);
  const monoFontFamily = (map[SettingKey.MonoFontFamily] ?? "").slice(0, 500);
  const usePointerCursor = parseBool(
    map[SettingKey.UsePointerCursor],
    DEFAULT_SETTINGS.usePointerCursor,
  );
  const reduceMotion = parseEnum<ReduceMotion>(
    map[SettingKey.ReduceMotion],
    ["system", "on", "off"],
    DEFAULT_SETTINGS.reduceMotion,
  );
  const fontSize = parseEnum<FontSizeLevel>(
    map[SettingKey.FontSize],
    ["xs", "sm", "base", "lg", "xl"],
    DEFAULT_SETTINGS.fontSize,
  );
  const codeFontSizePx = parseNumber(
    map[SettingKey.CodeFontSizePx],
    DEFAULT_SETTINGS.codeFontSizePx,
    10,
    24,
  );
  const diffMark = parseEnum<DiffMark>(
    map[SettingKey.DiffMark],
    ["color", "symbol"],
    DEFAULT_SETTINGS.diffMark,
  );
  const density = parseEnum<LayoutDensity>(
    map[SettingKey.LayoutDensity],
    ["compact", "comfortable", "loose"],
    DEFAULT_SETTINGS.density,
  );
  const language = parseEnum<LanguageMode>(
    map[SettingKey.Language],
    ["system", "zh-CN", "en"],
    DEFAULT_SETTINGS.language,
  );
  const chatReasoningLevel = parseEnum<ChatReasoningLevel>(
    map[SettingKey.ChatReasoningLevel],
    CHAT_REASONING_LEVELS,
    DEFAULT_SETTINGS.chatReasoningLevel,
  );
  return {
    skin,
    fontFamily,
    monoFontFamily,
    usePointerCursor,
    reduceMotion,
    fontSize,
    codeFontSizePx,
    diffMark,
    density,
    language,
    selectedModel: map[SettingKey.SelectedModel] || null,
    modelTemperature: parseNumber(
      map[SettingKey.ModelTemperature],
      DEFAULT_SETTINGS.modelTemperature,
      0,
      2,
    ),
    modelMaxTokens: parseNumber(
      map[SettingKey.ModelMaxTokens],
      DEFAULT_SETTINGS.modelMaxTokens,
      1,
      32768,
    ),
    modelTopP: parseNumber(map[SettingKey.ModelTopP], DEFAULT_SETTINGS.modelTopP, 0, 1),
    chatReasoningLevel,
    memoryLlmModel: map[SettingKey.MemoryLlmModel] || null,
    memoryEmbeddingModel: map[SettingKey.MemoryEmbeddingModel] || null,
  };
}

interface SettingsContextValue {
  ready: boolean;
  settings: AppSettings;
  systemLocale: string;
  resolvedLanguage: AppLanguage;
  update: (patch: Partial<AppSettings>) => Promise<void>;
  reset: (scope: SettingsResetScope) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyAppearance(s: AppSettings): SkinId {
  return applyTheme(s);
}

export function SettingsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const initialLocale = getBrowserLocale();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [systemLocale, setSystemLocale] = useState(initialLocale);
  const [resolvedLanguage, setResolvedLanguage] = useState<AppLanguage>(() =>
    resolveLanguage(DEFAULT_SETTINGS.language, initialLocale),
  );
  useEffect(() => {
    void (async () => {
      const [map, locale] = await Promise.all([
        api.settings.getAll(ALL_KEYS),
        api.system.locale().catch(() => getBrowserLocale()),
      ]);
      const nextLocale = locale || getBrowserLocale();
      const parsed = parseSettings(map);
      setSystemLocale(nextLocale);
      setSettings(parsed);
      setResolvedLanguage(resolveLanguage(parsed.language, nextLocale));
      applyAppearance(parsed);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = api.providers.onCatalogUpdated(() => {
      void api.settings.getAll([SettingKey.SelectedModel]).then((map) => {
        setSettings((current) => ({
          ...current,
          selectedModel: map[SettingKey.SelectedModel] || null,
        }));
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    applyAppearance(settings);
  }, [settings]);

  useEffect(() => {
    setResolvedLanguage(resolveLanguage(settings.language, systemLocale));
  }, [settings.language, systemLocale]);

  const persist = useCallback(async (patch: Partial<AppSettings>): Promise<void> => {
    const writes: SettingEntry[] = [];
    if (patch.skin !== undefined) writes.push({ key: SettingKey.Skin, value: patch.skin });
    if (patch.fontFamily !== undefined)
      writes.push({ key: SettingKey.FontFamily, value: patch.fontFamily });
    if (patch.monoFontFamily !== undefined)
      writes.push({ key: SettingKey.MonoFontFamily, value: patch.monoFontFamily });
    if (patch.usePointerCursor !== undefined)
      writes.push({ key: SettingKey.UsePointerCursor, value: String(patch.usePointerCursor) });
    if (patch.reduceMotion !== undefined)
      writes.push({ key: SettingKey.ReduceMotion, value: patch.reduceMotion });
    if (patch.fontSize !== undefined)
      writes.push({ key: SettingKey.FontSize, value: patch.fontSize });
    if (patch.codeFontSizePx !== undefined)
      writes.push({ key: SettingKey.CodeFontSizePx, value: String(patch.codeFontSizePx) });
    if (patch.diffMark !== undefined)
      writes.push({ key: SettingKey.DiffMark, value: patch.diffMark });
    if (patch.density !== undefined)
      writes.push({ key: SettingKey.LayoutDensity, value: patch.density });
    if (patch.language !== undefined)
      writes.push({ key: SettingKey.Language, value: patch.language });
    if (patch.selectedModel !== undefined)
      writes.push({ key: SettingKey.SelectedModel, value: patch.selectedModel ?? "" });
    if (patch.modelTemperature !== undefined)
      writes.push({ key: SettingKey.ModelTemperature, value: String(patch.modelTemperature) });
    if (patch.modelMaxTokens !== undefined)
      writes.push({ key: SettingKey.ModelMaxTokens, value: String(patch.modelMaxTokens) });
    if (patch.modelTopP !== undefined)
      writes.push({ key: SettingKey.ModelTopP, value: String(patch.modelTopP) });
    if (patch.chatReasoningLevel !== undefined)
      writes.push({ key: SettingKey.ChatReasoningLevel, value: patch.chatReasoningLevel });
    if (patch.memoryLlmModel !== undefined)
      writes.push({ key: SettingKey.MemoryLlmModel, value: patch.memoryLlmModel ?? "" });
    if (patch.memoryEmbeddingModel !== undefined)
      writes.push({
        key: SettingKey.MemoryEmbeddingModel,
        value: patch.memoryEmbeddingModel ?? "",
      });
    await api.settings.setAll(writes);
  }, []);

  const update = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      setSettings((prev) => ({ ...prev, ...patch }));
      await persist(patch);
    },
    [persist],
  );

  const reset = useCallback(
    async (scope: SettingsResetScope): Promise<void> => {
      const patch = RESET_PATCHES[scope];
      setSettings((prev) => ({ ...prev, ...patch }));
      await persist(patch);
    },
    [persist],
  );

  const value = useMemo<SettingsContextValue>(
    () => ({
      ready,
      settings,
      systemLocale,
      resolvedLanguage,
      update,
      reset,
    }),
    [ready, settings, systemLocale, resolvedLanguage, update, reset],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
