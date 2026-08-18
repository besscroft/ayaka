import type { SkinId } from "@shared/types";
import { blackSkin } from "./black/definition";
import { whiteSkin } from "./white/definition";
import { zzzSkin } from "./zzz/definition";
import type { SkinDefinition } from "./types";

export const SKIN_DEFINITIONS = [
  whiteSkin,
  blackSkin,
  zzzSkin,
] as const satisfies readonly SkinDefinition[];

const SKIN_DEFINITION_BY_ID = new Map<SkinId, SkinDefinition>(
  SKIN_DEFINITIONS.map((definition) => [definition.id, definition] as const),
);

export function getSkinDefinition(skin: SkinId): SkinDefinition {
  return SKIN_DEFINITION_BY_ID.get(skin) ?? SKIN_DEFINITIONS[0];
}
