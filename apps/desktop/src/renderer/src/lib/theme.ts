import {
  FONT_SIZE_PX,
  SKIN_DEFINITIONS,
  type AppSettings,
  type DiffMark,
  type FontSizeLevel,
  type LayoutDensity,
  type ReduceMotion,
  type SkinId,
  type SkinTokenValues,
} from "@shared/types";

const SKIN_TOKEN_CSS_VARS: Record<keyof SkinTokenValues, string> = {
  background: "--skin-background",
  foreground: "--skin-foreground",
  surface: "--skin-surface",
  surfaceForeground: "--skin-surface-foreground",
  overlay: "--skin-overlay",
  overlayForeground: "--skin-overlay-foreground",
  fieldBackground: "--skin-field-background",
  fieldForeground: "--skin-field-foreground",
  border: "--skin-border",
  separator: "--skin-separator",
  accent: "--skin-accent",
  accentForeground: "--skin-accent-foreground",
  focus: "--skin-focus",
  link: "--skin-link",
  success: "--skin-success",
  successForeground: "--skin-success-foreground",
  warning: "--skin-warning",
  warningForeground: "--skin-warning-foreground",
  danger: "--skin-danger",
  dangerForeground: "--skin-danger-foreground",
};

export function getSkin(skin: SkinId) {
  return SKIN_DEFINITIONS.find((definition) => definition.id === skin) ?? SKIN_DEFINITIONS[0];
}

export function applySkin(skin: SkinId): SkinId {
  const root = document.documentElement;
  const definition = getSkin(skin);

  root.setAttribute("data-skin", definition.id);
  root.style.setProperty("color-scheme", definition.colorScheme);
  root.classList.toggle("light", definition.colorScheme === "light");
  root.classList.toggle("dark", definition.colorScheme === "dark");
  root.removeAttribute("data-theme");

  for (const key of Object.keys(SKIN_TOKEN_CSS_VARS) as Array<keyof SkinTokenValues>) {
    root.style.setProperty(SKIN_TOKEN_CSS_VARS[key], definition.tokens[key]);
  }
  root.style.setProperty("--skin-radius", `${definition.radius}px`);
  root.style.setProperty("--skin-font-stack", definition.fontStack);
  root.style.setProperty("--skin-mono-font-stack", definition.monoFontStack);
  for (const [name, value] of Object.entries(definition.extensions ?? {})) {
    root.style.setProperty(name, value);
  }

  return definition.id;
}

/** 应用 UI 字体与等宽字体；空字符串清除自定义并回退到当前皮肤。 */
export function applyFonts(family: string, mono: string): void {
  const root = document.documentElement;
  if (family) {
    root.style.setProperty("--app-font-sans", family);
    root.style.setProperty("--font-sans", family);
  } else {
    root.style.removeProperty("--app-font-sans");
    root.style.removeProperty("--font-sans");
  }
  if (mono) {
    root.style.setProperty("--app-font-mono", mono);
    root.style.setProperty("--font-mono", mono);
  } else {
    root.style.removeProperty("--app-font-mono");
    root.style.removeProperty("--font-mono");
  }
}

export function applyCodeFontSize(px: number): void {
  const safe = Number.isFinite(px) ? Math.min(24, Math.max(10, Math.round(px))) : 13;
  document.documentElement.style.setProperty("--code-font-size", safe + "px");
}

export function applyTranslucentSidebar(enabled: boolean): void {
  document.documentElement.setAttribute("data-translucent-sidebar", enabled ? "true" : "false");
}

export function applyPointerCursor(enabled: boolean): void {
  document.documentElement.setAttribute("data-pointer-cursor", enabled ? "true" : "false");
}

export function applyReduceMotion(value: ReduceMotion): void {
  document.documentElement.setAttribute("data-reduce-motion", value);
}

export function applyDiffMark(value: DiffMark): void {
  document.documentElement.setAttribute("data-diff-mark", value);
}

export function applyFontSize(level: FontSizeLevel): void {
  const px = FONT_SIZE_PX[level] ?? FONT_SIZE_PX.base;
  document.documentElement.style.fontSize = String(px) + "px";
}

export function applyDensity(density: LayoutDensity): void {
  const root = document.documentElement;
  root.setAttribute("data-density", density);
  const spacing = density === "compact" ? "0.22rem" : density === "loose" ? "0.3rem" : "0.25rem";
  root.style.setProperty("--spacing", spacing);
}

export function applyTheme(
  settings: Pick<
    AppSettings,
    | "skin"
    | "fontFamily"
    | "monoFontFamily"
    | "translucentSidebar"
    | "usePointerCursor"
    | "reduceMotion"
    | "codeFontSizePx"
    | "diffMark"
    | "fontSize"
    | "density"
  >,
): SkinId {
  const appliedSkin = applySkin(settings.skin);
  applyFonts(settings.fontFamily, settings.monoFontFamily);
  applyCodeFontSize(settings.codeFontSizePx);
  applyTranslucentSidebar(settings.translucentSidebar);
  applyPointerCursor(settings.usePointerCursor);
  applyReduceMotion(settings.reduceMotion);
  applyDiffMark(settings.diffMark);
  applyFontSize(settings.fontSize);
  applyDensity(settings.density);
  return appliedSkin;
}
