import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { app, dialog, net, protocol } from "electron";
import { unzipSync } from "fflate";
import { DESKTOP_PET_STORE_ERROR_PREFIX } from "../../shared/types";
import type {
  DesktopPetAnimationSpec,
  DesktopPetFormatVersion,
  DesktopPetKind,
  DesktopPetManifest,
  DesktopPetSelector,
  InstalledPet,
  PetImportCandidate,
  DesktopPetStoreErrorCode,
  StorePet,
  StorePetPage,
  StorePetQuery,
} from "../../shared/types";

const PET_SCHEME = "void-pet";
const PET_HOST = "asset";
const STORE_ORIGIN = "https://codex-pets.net";
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_SPRITESHEET_BYTES = 4 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
const IMPORT_TOKEN_TTL_MS = 5 * 60_000;
const PET_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type StoreFetcher = (url: string, init: RequestInit) => Promise<Response>;

interface BuiltinPetDefinition {
  id: string;
  displayName: string;
  description: string;
  formatVersion: DesktopPetFormatVersion;
  kind: DesktopPetKind;
}

interface PetMetadata {
  source: "store" | "local";
  installedAt: number;
  author: string | null;
  remoteVersion: string | null;
  contentHash: string;
}

interface PendingImport {
  expiresAt: number;
  manifest: DesktopPetManifest;
  spritesheet: Uint8Array;
  metadata: PetMetadata;
}

interface RawStorePet {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
  spriteVersionNumber?: unknown;
  kind?: unknown;
  ownerHandle?: unknown;
  ownerName?: unknown;
  tags?: unknown;
  posterUrl?: unknown;
  downloadUrl?: unknown;
  validationReport?: { spriteVersionNumber?: unknown; atlasSize?: unknown } | null;
}

const BUILTIN_PETS: readonly BuiltinPetDefinition[] = [
  {
    id: "paimon",
    displayName: "Paimon",
    description:
      "A tiny floating guide with Teyvat-inspired fantasy charm, always ready to cheer on your coding adventure.",
    formatVersion: 1,
    kind: "object",
  },
];
const BUILTIN_PET_IDS = new Set(BUILTIN_PETS.map((pet) => pet.id));

const pendingImports = new Map<string, PendingImport>();
let protocolRegistered = false;

export function registerDesktopPetProtocol(): void {
  if (protocolRegistered) return;
  protocol.registerFileProtocol(PET_SCHEME, (request, callback) => {
    const path = resolveDesktopPetAssetPath(request.url);
    callback(path ? { path } : { error: -6 });
  });
  protocolRegistered = true;
}

export function listDesktopPets(): InstalledPet[] {
  const builtins = BUILTIN_PETS.map(toBuiltinPet);
  const installedRoot = getInstalledRoot();
  if (!existsSync(installedRoot)) return builtins;

  const installed = readdirSync(installedRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && PET_ID_PATTERN.test(entry.name) && !BUILTIN_PET_IDS.has(entry.name),
    )
    .flatMap((entry) => {
      try {
        return [readInstalledPet(entry.name)];
      } catch (error) {
        return [brokenInstalledPet(entry.name, error)];
      }
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  return [...builtins, ...installed];
}

export function resolveDesktopPet(selector: DesktopPetSelector): InstalledPet | null {
  if (selector.startsWith("builtin:")) {
    const definition = BUILTIN_PETS.find((pet) => pet.id === selector.slice("builtin:".length));
    return definition ? toBuiltinPet(definition) : null;
  }
  const id = selector.slice("installed:".length);
  if (!PET_ID_PATTERN.test(id)) return null;
  try {
    return readInstalledPet(id);
  } catch {
    return null;
  }
}

export async function ensureDesktopPetAsset(selector: DesktopPetSelector): Promise<InstalledPet> {
  if (selector.startsWith("installed:")) {
    const pet = resolveDesktopPet(selector);
    if (!pet?.available) throw new Error("Installed pet assets are unavailable.");
    return pet;
  }

  const id = selector.slice("builtin:".length);
  const definition = BUILTIN_PETS.find((pet) => pet.id === id);
  if (!definition) throw new Error("Unknown built-in pet.");
  const destination = builtinSpritesheetPath(definition);
  if (!existsSync(destination)) throw new Error("Bundled Paimon asset is unavailable.");
  validateSpritesheet(readFileSync(destination), definition.formatVersion);
  return toBuiltinPet(definition);
}

export async function listStorePets(query: StorePetQuery): Promise<StorePetPage> {
  const requestUrl = buildStorePetsUrl(query);
  const page = Number(requestUrl.searchParams.get("page"));
  const pageSize = Number(requestUrl.searchParams.get("pageSize"));
  const body = await fetchStoreJson<Record<string, unknown>>(requestUrl.toString());
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createStorePetError("invalid-response");
  }
  const installedById = new Map(
    listDesktopPets()
      .filter((pet) => pet.source !== "builtin")
      .map((pet) => [pet.id, pet]),
  );
  const pets = Array.isArray(body.pets)
    ? body.pets.map((value) => normalizeStorePet(value, installedById)).filter(Boolean)
    : [];
  return {
    pets: pets as StorePet[],
    page: numberOr(body.page, page),
    pageSize: numberOr(body.pageSize, pageSize),
    total: numberOr(body.total, pets.length),
    totalPages: numberOr(body.totalPages, 1),
  };
}

export function buildStorePetsUrl(query: StorePetQuery): URL {
  const page = clampInteger(query.page, 1, 10_000, 1);
  const pageSize = clampInteger(query.pageSize, 1, 60, 30);
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sort: query.sort === "popular" || query.sort === "views" ? query.sort : "new",
    kind: isPetKind(query.kind) ? query.kind : "all",
    format: query.format === "v1" || query.format === "v2" ? query.format : "all",
    content: "safe",
  });
  if (query.query?.trim()) params.set("q", query.query.trim().slice(0, 120));
  return new URL(`/api/pets?${params}`, STORE_ORIGIN);
}

export async function installStorePet(id: string, replace = false): Promise<InstalledPet> {
  if (!PET_ID_PATTERN.test(id)) throw new Error("Invalid store pet id.");
  if (BUILTIN_PET_IDS.has(id)) throw new Error("This pet id is reserved by the built-in Paimon.");
  const body = await fetchStoreJson<{ pet?: RawStorePet }>(
    `${STORE_ORIGIN}/api/pets/${encodeURIComponent(id)}`,
  );
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw createStorePetError("invalid-response");
  }
  const raw = body.pet;
  if (!raw) throw createStorePetError("invalid-response");
  const downloadPath = requiredString(raw.downloadUrl, "downloadUrl");
  const downloadUrl = resolveStoreDownloadUrl(id, downloadPath);
  const archive = await fetchBytes(
    downloadUrl.toString(),
    MAX_ARCHIVE_BYTES,
    new Set([downloadUrl.hostname]),
  );
  const packageFiles = readPackageArchive(archive);
  const manifest = validateManifest(packageFiles.manifest);
  if (BUILTIN_PET_IDS.has(manifest.id)) {
    throw new Error("This pet id is reserved by the built-in Paimon.");
  }
  if (manifest.id !== id) throw new Error("Downloaded pet id does not match the store entry.");
  const formatVersion = validateSpritesheet(packageFiles.spritesheet, manifest.spriteVersionNumber);
  manifest.spriteVersionNumber = formatVersion;
  const installed = await installPackage(
    manifest,
    packageFiles.spritesheet,
    {
      source: "store",
      installedAt: Date.now(),
      author: optionalString(raw.ownerHandle) ?? optionalString(raw.ownerName),
      remoteVersion: remoteVersionFromUrl(downloadUrl),
      contentHash: contentHash(packageFiles.spritesheet),
    },
    replace,
  );
  return installed;
}

export async function beginLocalPetImport(
  mode: "zip" | "folder",
): Promise<PetImportCandidate | null> {
  cleanupExpiredImports();
  const result = await dialog.showOpenDialog({
    title: mode === "zip" ? "Import Codex pet package" : "Import Codex pet folder",
    properties: mode === "zip" ? ["openFile"] : ["openDirectory"],
    filters: mode === "zip" ? [{ name: "Codex pet packages", extensions: ["zip"] }] : undefined,
  });
  const selectedPath = result.filePaths[0];
  if (result.canceled || !selectedPath) return null;

  const packageFiles =
    mode === "zip" ? readLocalArchive(selectedPath) : readLocalFolder(selectedPath);
  const manifest = validateManifest(packageFiles.manifest);
  if (BUILTIN_PET_IDS.has(manifest.id)) {
    throw new Error("This pet id is reserved by the built-in Paimon.");
  }
  const formatVersion = validateSpritesheet(packageFiles.spritesheet, manifest.spriteVersionNumber);
  manifest.spriteVersionNumber = formatVersion;
  const token = randomUUID();
  const expiresAt = Date.now() + IMPORT_TOKEN_TTL_MS;
  const metadata: PetMetadata = {
    source: "local",
    installedAt: Date.now(),
    author: null,
    remoteVersion: null,
    contentHash: contentHash(packageFiles.spritesheet),
  };
  pendingImports.set(token, {
    expiresAt,
    manifest,
    spritesheet: packageFiles.spritesheet,
    metadata,
  });
  const pet = packageToInstalledPet(manifest, metadata, false);
  return {
    token,
    pet,
    conflict: resolveDesktopPet(`installed:${manifest.id}`),
    expiresAt,
  };
}

export async function commitLocalPetImport(token: string, replace: boolean): Promise<InstalledPet> {
  cleanupExpiredImports();
  const pending = pendingImports.get(token);
  if (!pending) throw new Error("The import expired. Choose the package again.");
  pendingImports.delete(token);
  return installPackage(pending.manifest, pending.spritesheet, pending.metadata, replace);
}

export function deleteInstalledPet(selector: DesktopPetSelector): void {
  if (!selector.startsWith("installed:")) throw new Error("Built-in pets cannot be deleted.");
  const id = selector.slice("installed:".length);
  if (!PET_ID_PATTERN.test(id)) throw new Error("Invalid installed pet id.");
  const root = resolve(getInstalledRoot());
  const target = resolve(root, id);
  if (!target.startsWith(root + sep)) throw new Error("Invalid installed pet path.");
  rmSync(target, { recursive: true, force: true });
}

export function validateManifest(input: unknown): DesktopPetManifest {
  const raw = input instanceof Uint8Array ? new TextDecoder().decode(input) : input;
  const value = typeof raw === "string" ? parseJson(raw, "pet.json") : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pet.json must be a JSON object.");
  }
  const record = value as Record<string, unknown>;
  const id = requiredString(record.id, "id").trim();
  const displayName = requiredString(record.displayName, "displayName").trim();
  const description = requiredString(record.description, "description").trim();
  if (!PET_ID_PATTERN.test(id)) throw new Error("pet.json id must be a lowercase slug.");
  if (!displayName || displayName.length > 80) throw new Error("pet.json displayName is invalid.");
  if (!description || description.length > 280) throw new Error("pet.json description is invalid.");
  if (record.spritesheetPath !== "spritesheet.webp") {
    throw new Error("pet.json spritesheetPath must be spritesheet.webp.");
  }
  const version = record.spriteVersionNumber;
  if (version !== undefined && version !== 1 && version !== 2) {
    throw new Error("pet.json spriteVersionNumber must be 1 or 2.");
  }
  const kind = isPetKind(record.kind) ? record.kind : "object";
  const animations = validateAnimations(record.animations, version === 2 ? 88 : 72);
  return {
    id,
    displayName,
    description,
    spritesheetPath: "spritesheet.webp",
    ...(version ? { spriteVersionNumber: version } : {}),
    kind,
    ...(animations ? { animations } : {}),
  };
}

export function validateSpritesheet(
  bytes: Uint8Array,
  declaredVersion?: DesktopPetFormatVersion,
): DesktopPetFormatVersion {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SPRITESHEET_BYTES) {
    throw new Error("spritesheet.webp is empty or too large.");
  }
  const size = readWebpSize(bytes);
  const inferred = size.width === 1536 && size.height === 2288 ? 2 : 1;
  const expectedHeight = inferred === 2 ? 2288 : 1872;
  if (size.width !== 1536 || size.height !== expectedHeight) {
    throw new Error("spritesheet.webp must be 1536x1872 (V1) or 1536x2288 (V2).");
  }
  if (declaredVersion && declaredVersion !== inferred) {
    throw new Error("spritesheet dimensions do not match spriteVersionNumber.");
  }
  return inferred;
}

export function resolveDesktopPetAssetPath(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${PET_SCHEME}:` || parsed.hostname !== PET_HOST) return null;
  const parts = parsed.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length !== 3 || parts[2] !== "spritesheet.webp") return null;
  const [source, id] = parts;
  if (!PET_ID_PATTERN.test(id)) return null;
  if (source === "builtin") {
    const definition = BUILTIN_PETS.find((pet) => pet.id === id);
    const path = definition ? builtinSpritesheetPath(definition) : null;
    return path && existsSync(path) ? path : null;
  }
  if (source !== "installed") return null;
  const root = resolve(getInstalledRoot());
  const path = resolve(root, id, "spritesheet.webp");
  if (!path.startsWith(root + sep)) return null;
  return existsSync(path) ? path : null;
}

export function resolveStoreDownloadUrl(id: string, value: string): URL {
  if (!PET_ID_PATTERN.test(id)) throw new Error("Invalid store pet id.");
  const url = new URL(value, STORE_ORIGIN);
  if (url.protocol !== "https:" || url.origin !== STORE_ORIGIN) {
    throw new Error("Pet store returned an unsafe download URL.");
  }
  if (url.pathname !== `/api/pets/${id}/download`) {
    throw new Error("Pet store returned an unsafe download URL.");
  }
  return url;
}

function getPetsRoot(): string {
  const userData = process.env.VOID_AI_USER_DATA_DIR || app.getPath("userData");
  return join(userData, "data", "pets");
}

function getInstalledRoot(): string {
  return join(getPetsRoot(), "installed");
}

function builtinSpritesheetPath(definition: BuiltinPetDefinition): string {
  return join(app.getAppPath(), "resources", "pets", definition.id, "spritesheet.webp");
}

function toBuiltinPet(definition: BuiltinPetDefinition): InstalledPet {
  const path = builtinSpritesheetPath(definition);
  return {
    selector: `builtin:${definition.id}`,
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

function readInstalledPet(id: string): InstalledPet {
  const dir = join(getInstalledRoot(), id);
  const manifest = validateManifest(readFileSync(join(dir, "pet.json")));
  const formatVersion = validateSpritesheet(
    readFileSync(join(dir, "spritesheet.webp")),
    manifest.spriteVersionNumber,
  );
  const metadata = readMetadata(dir);
  return {
    selector: `installed:${id}`,
    id,
    displayName: manifest.displayName,
    description: manifest.description,
    source: metadata.source,
    formatVersion,
    kind: manifest.kind ?? "object",
    assetUrl: petAssetUrl("installed", id, join(dir, "spritesheet.webp"), metadata.contentHash),
    removable: true,
    available: true,
    installedAt: metadata.installedAt,
    author: metadata.author,
    remoteVersion: metadata.remoteVersion,
    animations: manifest.animations,
  };
}

function brokenInstalledPet(id: string, error: unknown): InstalledPet {
  return {
    selector: `installed:${id}`,
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

function readMetadata(dir: string): PetMetadata {
  const value = parseJson(
    readFileSync(join(dir, "metadata.json"), "utf8"),
    "metadata.json",
  ) as Partial<PetMetadata>;
  return {
    source: value.source === "store" ? "store" : "local",
    installedAt: typeof value.installedAt === "number" ? value.installedAt : 0,
    author: optionalString(value.author),
    remoteVersion: optionalString(value.remoteVersion),
    contentHash: optionalString(value.contentHash) ?? "local",
  };
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
  return `${PET_SCHEME}://${PET_HOST}/${source}/${encodeURIComponent(id)}/spritesheet.webp?v=${encodeURIComponent(version ?? "missing")}`;
}

async function installPackage(
  manifest: DesktopPetManifest,
  spritesheet: Uint8Array,
  metadata: PetMetadata,
  replace: boolean,
): Promise<InstalledPet> {
  const root = getInstalledRoot();
  mkdirSync(root, { recursive: true });
  const target = join(root, manifest.id);
  if (existsSync(target) && !replace) throw new Error("PET_CONFLICT");
  const staging = join(root, `.staging-${manifest.id}-${randomUUID()}`);
  const backup = join(root, `.backup-${manifest.id}-${randomUUID()}`);
  mkdirSync(staging, { recursive: false });
  try {
    writeFileSync(join(staging, "pet.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    writeFileSync(join(staging, "spritesheet.webp"), spritesheet);
    writeFileSync(join(staging, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    readInstalledPetFromDir(staging);
    if (existsSync(target)) renameSync(target, backup);
    try {
      renameSync(staging, target);
    } catch (error) {
      if (existsSync(backup)) renameSync(backup, target);
      throw error;
    }
    if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  }
  return readInstalledPet(manifest.id);
}

function readInstalledPetFromDir(dir: string): void {
  const manifest = validateManifest(readFileSync(join(dir, "pet.json")));
  validateSpritesheet(readFileSync(join(dir, "spritesheet.webp")), manifest.spriteVersionNumber);
  readMetadata(dir);
}

function packageToInstalledPet(
  manifest: DesktopPetManifest,
  metadata: PetMetadata,
  available: boolean,
): InstalledPet {
  return {
    selector: `installed:${manifest.id}`,
    id: manifest.id,
    displayName: manifest.displayName,
    description: manifest.description,
    source: metadata.source,
    formatVersion: manifest.spriteVersionNumber ?? 1,
    kind: manifest.kind ?? "object",
    assetUrl: "",
    removable: true,
    available,
    installedAt: metadata.installedAt,
    author: metadata.author,
    remoteVersion: metadata.remoteVersion,
    animations: manifest.animations,
  };
}

function readLocalArchive(path: string): { manifest: Uint8Array; spritesheet: Uint8Array } {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES)
    throw new Error("The pet archive is too large.");
  return readPackageArchive(readFileSync(path));
}

export function readPackageArchive(bytes: Uint8Array): {
  manifest: Uint8Array;
  spritesheet: Uint8Array;
} {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error("The pet archive is too large.");
  const requestedEntries = new Set<string>();
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      const normalized = validateArchiveEntryName(entry.name);
      if (!normalized || normalized.endsWith("/")) return false;
      const file = normalized.split("/").at(-1);
      if (file !== "pet.json" && file !== "spritesheet.webp") return false;
      if (requestedEntries.has(normalized)) {
        throw new Error("The pet archive contains duplicate required files.");
      }
      requestedEntries.add(normalized);
      const limit = file === "pet.json" ? MAX_MANIFEST_BYTES : MAX_SPRITESHEET_BYTES;
      if (entry.originalSize > limit) throw new Error(`${file} is too large.`);
      return true;
    },
  });
  const candidates = new Map<string, { manifest?: Uint8Array; spritesheet?: Uint8Array }>();
  for (const [rawName, data] of Object.entries(entries)) {
    const name = validateArchiveEntryName(rawName);
    if (!name) continue;
    const parts = name.split("/");
    const file = parts.at(-1);
    if (file !== "pet.json" && file !== "spritesheet.webp") continue;
    const root = parts.length === 2 ? parts[0] : "";
    const candidate = candidates.get(root) ?? {};
    if (file === "pet.json") candidate.manifest = data;
    else candidate.spritesheet = data;
    candidates.set(root, candidate);
  }
  const complete = [...candidates.values()].filter((entry) => entry.manifest && entry.spritesheet);
  if (complete.length !== 1)
    throw new Error("The archive must contain one pet.json and spritesheet.webp pair.");
  const selected = complete[0];
  if (selected.manifest!.byteLength > MAX_MANIFEST_BYTES) throw new Error("pet.json is too large.");
  if (selected.spritesheet!.byteLength > MAX_SPRITESHEET_BYTES)
    throw new Error("spritesheet.webp is too large.");
  return { manifest: selected.manifest!, spritesheet: selected.spritesheet! };
}

function readLocalFolder(selectedPath: string): { manifest: Uint8Array; spritesheet: Uint8Array } {
  if (!lstatSync(selectedPath).isDirectory()) throw new Error("Choose a pet folder.");
  const roots = [selectedPath];
  for (const entry of readdirSync(selectedPath, { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(join(selectedPath, entry.name));
  }
  const complete = roots.filter(
    (root) => existsSync(join(root, "pet.json")) && existsSync(join(root, "spritesheet.webp")),
  );
  if (complete.length !== 1)
    throw new Error("Choose a folder containing one pet.json and spritesheet.webp pair.");
  const manifestPath = join(complete[0], "pet.json");
  const spritesheetPath = join(complete[0], "spritesheet.webp");
  const manifestStat = lstatSync(manifestPath);
  const spritesheetStat = lstatSync(spritesheetPath);
  if (!manifestStat.isFile() || !spritesheetStat.isFile()) {
    throw new Error("Pet package files must be regular files.");
  }
  if (manifestStat.size > MAX_MANIFEST_BYTES) throw new Error("pet.json is too large.");
  if (spritesheetStat.size > MAX_SPRITESHEET_BYTES)
    throw new Error("spritesheet.webp is too large.");
  const manifest = readFileSync(manifestPath);
  const spritesheet = readFileSync(spritesheetPath);
  return { manifest, spritesheet };
}

function validateArchiveEntryName(rawName: string): string | null {
  const name = rawName.replaceAll("\\", "/");
  if (!name || name.startsWith("/") || /^[a-zA-Z]:\//.test(name) || name.includes("\0")) {
    throw new Error("The pet archive contains an unsafe path.");
  }
  const isDirectory = name.endsWith("/");
  const trimmed = isDirectory ? name.slice(0, -1) : name;
  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === ".." || part === ".") || parts.length > 2) {
    throw new Error("Pet files must be at the archive root or inside one folder.");
  }
  return `${trimmed}${isDirectory ? "/" : ""}`;
}

function normalizeStorePet(
  value: unknown,
  installedById: Map<string, InstalledPet>,
): StorePet | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawStorePet;
  try {
    const id = requiredString(raw.id, "id");
    if (!PET_ID_PATTERN.test(id)) return null;
    if (BUILTIN_PET_IDS.has(id)) return null;
    const downloadUrl = resolveStoreDownloadUrl(id, requiredString(raw.downloadUrl, "downloadUrl"));
    const posterUrl = new URL(requiredString(raw.posterUrl, "posterUrl"), STORE_ORIGIN);
    if (downloadUrl.origin !== STORE_ORIGIN || posterUrl.origin !== STORE_ORIGIN) return null;
    const formatVersion = storeFormatVersion(raw);
    const installed = installedById.get(id);
    const remoteVersion = remoteVersionFromUrl(downloadUrl);
    return {
      id,
      displayName: requiredString(raw.displayName, "displayName"),
      description: optionalString(raw.description) ?? "",
      formatVersion,
      kind: isPetKind(raw.kind) ? raw.kind : "object",
      author: optionalString(raw.ownerHandle) ?? optionalString(raw.ownerName) ?? "Anonymous",
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 12)
        : [],
      posterUrl: posterUrl.toString(),
      downloadUrl: downloadUrl.toString(),
      remoteVersion,
      installed: Boolean(installed),
      updateAvailable: Boolean(installed && installed.remoteVersion !== remoteVersion),
    };
  } catch {
    return null;
  }
}

function storeFormatVersion(raw: RawStorePet): DesktopPetFormatVersion {
  if (raw.spriteVersionNumber === 2 || raw.validationReport?.spriteVersionNumber === 2) return 2;
  if (raw.validationReport?.atlasSize === "1536x2288") return 2;
  return 1;
}

function validateAnimations(
  value: unknown,
  frameCount: number,
): Record<string, DesktopPetAnimationSpec> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("pet.json animations must be an object.");
  }
  const animations: Record<string, DesktopPetAnimationSpec> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,40}$/.test(name) || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Invalid animation ${name}.`);
    }
    const record = raw as Record<string, unknown>;
    if (!Array.isArray(record.frames) || record.frames.length === 0 || record.frames.length > 256) {
      throw new Error(`Animation ${name} must contain 1-256 frames.`);
    }
    const frames = record.frames.map((frame) => {
      if (!Number.isInteger(frame) || (frame as number) < 0 || (frame as number) >= frameCount) {
        throw new Error(`Animation ${name} references an invalid frame.`);
      }
      return frame as number;
    });
    const fps = record.fps;
    if (
      fps !== undefined &&
      (typeof fps !== "number" || !Number.isFinite(fps) || fps < 0 || fps > 60)
    ) {
      throw new Error(`Animation ${name} fps must be between 0 and 60.`);
    }
    animations[name] = {
      frames,
      ...(typeof fps === "number" ? { fps } : {}),
      ...(typeof record.loop === "boolean" ? { loop: record.loop } : {}),
      ...(typeof record.fallback === "string" && record.fallback
        ? { fallback: record.fallback }
        : {}),
    };
  }
  for (const [name, animation] of Object.entries(animations)) {
    if (animation.fallback && !animations[animation.fallback] && animation.fallback !== "idle") {
      throw new Error(`Animation ${name} has an unknown fallback.`);
    }
  }
  return animations;
}

function readWebpSize(bytes: Uint8Array): { width: number; height: number } {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") {
    throw new Error("spritesheet.webp must be a WebP image.");
  }
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunk = ascii(bytes, offset, offset + 4);
    const length = readU32(bytes, offset + 4);
    const data = offset + 8;
    if (chunk === "VP8X" && length >= 10) {
      return { width: 1 + readU24(bytes, data + 4), height: 1 + readU24(bytes, data + 7) };
    }
    if (chunk === "VP8 " && length >= 10) {
      return {
        width: readU16(bytes, data + 6) & 0x3fff,
        height: readU16(bytes, data + 8) & 0x3fff,
      };
    }
    if (chunk === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      return {
        width: 1 + (((bytes[data + 2] & 0x3f) << 8) | bytes[data + 1]),
        height:
          1 +
          (((bytes[data + 4] & 0x0f) << 10) |
            (bytes[data + 3] << 2) |
            ((bytes[data + 2] & 0xc0) >> 6)),
      };
    }
    offset = data + length + (length % 2);
  }
  throw new Error("Could not read spritesheet.webp dimensions.");
}

async function fetchBytes(
  url: string,
  maxBytes: number,
  allowedHosts: Set<string>,
): Promise<Uint8Array> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
    throw new Error("Pet download URL is not allowed.");
  }
  const response = await fetchStoreResource(parsed.toString());
  if (!response.ok) throw createStorePetError("http", response.status);
  const finalUrl = new URL(response.url);
  if (finalUrl.protocol !== "https:" || !allowedHosts.has(finalUrl.hostname)) {
    throw new Error("Pet download redirected to an untrusted host.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes)
    throw new Error("Pet download is too large.");
  if (!response.body) throw new Error("Pet download returned no data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) throw new Error("Pet download is too large.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchStoreResource(
  url: string,
  fetcher: StoreFetcher = fetchWithChromiumStack,
): Promise<Response> {
  try {
    return await fetcher(url, {
      headers: { Accept: "application/json, application/zip, image/webp" },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
  } catch (error) {
    const code = isStoreRequestTimeout(error) ? "timeout" : "network";
    throw createStorePetError(code, undefined, error);
  }
}

export async function fetchStoreJson<T>(
  url: string,
  fetcher: StoreFetcher = fetchWithChromiumStack,
): Promise<T> {
  const response = await fetchStoreResource(url, fetcher);
  if (!response.ok) throw createStorePetError("http", response.status);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw createStorePetError("invalid-response", undefined, error);
  }
}

function fetchWithChromiumStack(url: string, init: RequestInit): Promise<Response> {
  if (typeof net?.fetch !== "function") {
    throw new Error("Electron Chromium network stack is unavailable.");
  }
  return net.fetch(url, init) as Promise<Response>;
}

export class DesktopPetStoreError extends Error {
  readonly code: DesktopPetStoreErrorCode;
  readonly status: number | undefined;

  constructor(code: DesktopPetStoreErrorCode, status?: number) {
    super(`${DESKTOP_PET_STORE_ERROR_PREFIX}:${code}${status === undefined ? "" : `:${status}`}`);
    this.name = "DesktopPetStoreError";
    this.code = code;
    this.status = status;
  }
}

function createStorePetError(
  code: DesktopPetStoreErrorCode,
  status?: number,
  cause?: unknown,
): DesktopPetStoreError {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : cause;
  console.warn(
    `[desktop-pet] store request ${code}${status === undefined ? "" : ` (${status})`}`,
    detail ?? "",
  );
  return new DesktopPetStoreError(code, status);
}

function isStoreRequestTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeText =
    typeof cause === "string" || typeof cause === "number" || typeof cause === "boolean"
      ? String(cause)
      : cause && typeof cause === "object"
        ? (JSON.stringify(cause) ?? "")
        : "";
  return /timeout|timed out|timed_out|ERR_TIMED_OUT|UND_ERR_CONNECT_TIMEOUT/i.test(
    `${error.name} ${error.message} ${causeText}`,
  );
}

function remoteVersionFromUrl(url: URL): string {
  return url.searchParams.get("v") || "current";
}

function contentHash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 24);
}

function cleanupExpiredImports(): void {
  const now = Date.now();
  for (const [token, pending] of pendingImports) {
    if (pending.expiresAt <= now) pendingImports.delete(token);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing ${name}.`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}

function isPetKind(value: unknown): value is DesktopPetKind {
  return value === "object" || value === "animal" || value === "person" || value === "creature";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}
