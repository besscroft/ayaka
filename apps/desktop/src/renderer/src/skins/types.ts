import type { SkinId } from "@shared/types";

export interface SkinPreview {
  background: string;
  surface: string;
  accent: string;
  foreground: string;
}

export interface SkinDefinition {
  id: SkinId;
  labelKey: string;
  descKey: string;
  colorScheme: "light" | "dark";
  preview: SkinPreview;
}
