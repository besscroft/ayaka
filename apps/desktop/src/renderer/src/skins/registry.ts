import type { SkinId } from "@shared/types";
import { arkSkin } from "./ark/definition";
import { blackSkin } from "./black/definition";
import { whiteSkin } from "./white/definition";
import { yakaSkin } from "./yaka/definition";
import { zzzSkin } from "./zzz/definition";
import type { SkinDefinition } from "./types";

export const SKIN_DEFINITIONS = [
  whiteSkin,
  blackSkin,
  yakaSkin,
  arkSkin,
  zzzSkin,
] as const satisfies readonly SkinDefinition[];

const SKIN_DEFINITION_BY_ID = new Map<SkinId, SkinDefinition>(
  SKIN_DEFINITIONS.map((definition) => [definition.id, definition] as const),
);

export function getSkinDefinition(skin: SkinId): SkinDefinition {
  return SKIN_DEFINITION_BY_ID.get(skin) ?? SKIN_DEFINITIONS[0];
}
