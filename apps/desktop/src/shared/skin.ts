import { DEFAULT_SETTINGS, type SkinId } from "./types";

export const SKIN_IDS = ["white", "black"] as const satisfies readonly SkinId[];

const LEGACY_SKIN_IDS: Record<string, SkinId> = {
  "nova-light": "white",
  "nova-dark": "black",
};

const SKIN_ID_SET = new Set<string>(SKIN_IDS);

export function parseSkinId(raw: string | null): SkinId {
  const migrated = raw ? (LEGACY_SKIN_IDS[raw] ?? raw) : null;
  return migrated && SKIN_ID_SET.has(migrated) ? (migrated as SkinId) : DEFAULT_SETTINGS.skin;
}
