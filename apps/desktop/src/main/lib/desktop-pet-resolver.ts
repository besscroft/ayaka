import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type {
  DesktopPetKind,
  DesktopPetSelector,
  InstalledPet,
  DesktopPetManifest,
} from "../../shared/types";
import { resolveAppPath, resolveUserDataDir } from "./runtime-paths";

type BuiltinPetDefinition = {
  id: string;
  displayName: string;
  description: string;
  formatVersion: 1 | 2;
  kind: DesktopPetKind;
};

type PetMetadata = {
  source?: "store" | "local";
  installedAt?: number;
  author?: string | null;
  remoteVersion?: string | null;
  contentHash?: string;
};

const BUILTIN_PETS: readonly BuiltinPetDefinition[] = [
  {
    id: "paimon",
    displayName: "Paimon",
    description: "A tiny floating guide with Teyvat-inspired fantasy charm.",
    formatVersion: 1,
    kind: "object",
  },
];
const PET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function resolveDesktopPet(selector: DesktopPetSelector): InstalledPet | null {
  if (selector.startsWith("builtin:")) {
    const definition = BUILTIN_PETS.find((pet) => pet.id === selector.slice("builtin:".length));
    if (!definition) return null;
    const path = join(resolveAppPath(), "resources", "pets", definition.id, "spritesheet.webp");
    return {
      selector,
      id: definition.id,
      displayName: definition.displayName,
      description: definition.description,
      source: "builtin",
      formatVersion: definition.formatVersion,
      kind: definition.kind,
      assetUrl: petAssetUrl("builtin", definition.id, path),
      removable: false,
      available: existsSync(path),
    };
  }

  const id = selector.slice("installed:".length);
  if (!PET_ID_PATTERN.test(id)) return null;
  const dir = join(resolveUserDataDir(), "data", "pets", "installed", id);
  try {
    const manifest = JSON.parse(readFileSync(join(dir, "pet.json"), "utf8")) as DesktopPetManifest;
    const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as PetMetadata;
    const assetPath = join(dir, "spritesheet.webp");
    if (!existsSync(assetPath)) throw new Error("Pet spritesheet is missing.");
    return {
      selector,
      id,
      displayName: manifest.displayName,
      description: manifest.description,
      source: metadata.source === "store" ? "store" : "local",
      formatVersion: manifest.spriteVersionNumber === 2 ? 2 : 1,
      kind: manifest.kind ?? "object",
      assetUrl: petAssetUrl("installed", id, assetPath, metadata.contentHash),
      removable: true,
      available: true,
      installedAt: metadata.installedAt ?? 0,
      author: metadata.author ?? null,
      remoteVersion: metadata.remoteVersion ?? null,
      animations: manifest.animations,
    };
  } catch (error) {
    return {
      selector,
      id,
      displayName: id,
      description: "This pet package could not be loaded.",
      source: "local",
      formatVersion: 1,
      kind: "object",
      assetUrl: "",
      removable: true,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listInstalledPetIds(): string[] {
  const root = join(resolveUserDataDir(), "data", "pets", "installed");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && PET_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name);
}

function petAssetUrl(
  source: "builtin" | "installed",
  id: string,
  path: string,
  revision?: string,
): string {
  let version = revision;
  if (!version && existsSync(path)) {
    const stat = statSync(path);
    version = `${stat.size}-${Math.round(stat.mtimeMs)}`;
  }
  return `void-pet://asset/${source}/${encodeURIComponent(id)}/spritesheet.webp?v=${encodeURIComponent(version ?? "missing")}`;
}
