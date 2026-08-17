import type { SkinDefinition } from "../types";

export const whiteSkin = {
  id: "white",
  labelKey: "skin.white",
  descKey: "skin.white.desc",
  colorScheme: "light",
  preview: {
    background: "#ffffff",
    surface: "#ffffff",
    accent: "#171717",
    foreground: "#262626",
  },
} satisfies SkinDefinition;
