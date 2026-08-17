import type { SkinDefinition } from "../types";

export const yakaSkin = {
  id: "yaka",
  labelKey: "skin.yaka",
  descKey: "skin.yaka.desc",
  colorScheme: "light",
  preview: {
    background: "oklch(0.984 0.014 180.72)",
    surface: "oklch(0.977 0.013 236.62)",
    accent: "oklch(0.789 0.154 211.53)",
    foreground: "oklch(0.145 0 0)",
  },
} satisfies SkinDefinition;
