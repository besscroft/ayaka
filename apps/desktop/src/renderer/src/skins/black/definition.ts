import type { SkinDefinition } from "../types";

export const blackSkin = {
  id: "black",
  labelKey: "skin.black",
  descKey: "skin.black.desc",
  colorScheme: "dark",
  preview: {
    background: "#171717",
    surface: "#262626",
    accent: "#fafafa",
    foreground: "#fafafa",
  },
} satisfies SkinDefinition;
