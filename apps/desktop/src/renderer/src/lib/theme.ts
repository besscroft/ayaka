import {
  FONT_SIZE_PX,
  type AppSettings,
  type DiffMark,
  type FontSizeLevel,
  type LayoutDensity,
  type ReduceMotion,
  type SkinId,
} from "@shared/types";
import type { SkinDefinition } from "../skins/types";
import { getSkinDefinition } from "../skins/registry";

export function getSkin(skin: SkinId): SkinDefinition {
  return getSkinDefinition(skin);
}

export function applySkin(skin: SkinId): SkinId {
  const root = document.documentElement;
  const definition = getSkin(skin);

  root.setAttribute("data-skin", definition.id);
  root.classList.toggle("light", definition.colorScheme === "light");
  root.classList.toggle("dark", definition.colorScheme === "dark");
  root.removeAttribute("data-theme");

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
  applyPointerCursor(settings.usePointerCursor);
  applyReduceMotion(settings.reduceMotion);
  applyDiffMark(settings.diffMark);
  applyFontSize(settings.fontSize);
  applyDensity(settings.density);
  return appliedSkin;
}
