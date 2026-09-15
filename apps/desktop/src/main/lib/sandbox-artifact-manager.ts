import { createHash } from "node:crypto";
import { lstat, open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  getSandboxArtifact,
  getSandboxSession,
  insertSandboxArtifactAsync,
  listSandboxArtifactsForSession,
  listSandboxSessionsForConversation,
  updateSandboxArtifactAsync,
} from "./db";
import { resolveSandboxPath } from "./sandbox-agents";
import type {
  SandboxArtifact,
  SandboxArtifactReadResult,
  SandboxArtifactStatus,
  SandboxSession,
} from "../../shared/types";

export const MAX_HTML_EXECUTABLE_BYTES = 256 * 1024;
export const MAX_STATIC_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_STATIC_FILES = 1_000;
export const MAX_STATIC_RESOURCE_BYTES = 2 * 1024 * 1024;
export const MAX_HTML_READ_BYTES = 512 * 1024;

const SNAPSHOT_DIRNAME = ".snapshots";
const listeners = new Set<(artifact: SandboxArtifact) => void>();
const authorizedArtifactIds = new Set<string>();

export interface PublishArtifactInput {
  path: string;
  kind?: "html" | "svg" | "static";
  entryPath?: string;
}

interface ArtifactScan {
  kind: "html" | "svg" | "static";
  path: string;
  entryPath: string;
  sizeBytes: number;
  sha256: string;
  mimeType: "text/html" | "image/svg+xml";
}

export function onSandboxArtifactUpdated(
  listener: (artifact: SandboxArtifact) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isSandboxArtifactAuthorized(id: string): boolean {
  const artifact = getSandboxArtifact(id);
  if (artifact?.kind === "html" || artifact?.kind === "svg" || artifact?.kind === "static") {
    return true;
  }
  return authorizedArtifactIds.has(id);
}

export function authorizeSandboxArtifact(
  conversationId: string,
  artifactId: string,
): SandboxArtifact {
  const artifact = getOwnedArtifact(conversationId, artifactId);
  authorizedArtifactIds.add(artifactId);
  emitArtifact(artifact);
  return projectArtifact(artifact);
}

export function revokeSandboxArtifactAuthorization(
  conversationId: string,
  artifactId: string,
): SandboxArtifact {
  const artifact = getOwnedArtifact(conversationId, artifactId);
  authorizedArtifactIds.delete(artifactId);
  emitArtifact(artifact);
  return projectArtifact(artifact);
}

export function listSandboxArtifactsForConversation(conversationId: string): SandboxArtifact[] {
  const sessions = listSandboxSessionsForConversation(conversationId);
  const artifacts = sessions.flatMap((session) => listSandboxArtifactsForSession(session.id));
  return artifacts.map(projectArtifact);
}

export function getOwnedArtifact(conversationId: string, artifactId: string): SandboxArtifact {
  const artifact = getSandboxArtifact(artifactId);
  if (!artifact) throw new Error("Sandbox artifact not found.");
  const session = getSandboxSession(artifact.session_id);
  if (!session || session.conversation_id !== conversationId) {
    throw new Error("Sandbox artifact does not belong to this conversation.");
  }
  return artifact;
}

export async function publishSandboxArtifact(
  session: SandboxSession,
  input: PublishArtifactInput,
): Promise<SandboxArtifact> {
  const scan = await scanArtifact(session, input);
  const existing = listSandboxArtifactsForSession(session.id).find(
    (artifact) => artifact.path === scan.path && artifact.kind !== "preview",
  );
  const row = existing
    ? await updateSandboxArtifactAsync(existing.id, {
        kind: scan.kind,
        path: scan.path,
        entry_path: scan.entryPath,
        mime_type: scan.mimeType,
        sha256: scan.sha256,
        size_bytes: scan.sizeBytes,
        status: "ready",
        url: null,
        updated_at: Date.now(),
      })
    : await insertSandboxArtifactAsync({
        session_id: session.id,
        kind: scan.kind,
        path: scan.path,
        entry_path: scan.entryPath,
        mime_type: scan.mimeType,
        sha256: scan.sha256,
        size_bytes: scan.sizeBytes,
        status: "ready",
        url: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
  emitArtifact(row);
  return projectArtifact(row);
}

export async function readSandboxArtifactHtml(
  conversationId: string,
  artifactId: string,
): Promise<SandboxArtifactReadResult> {
  const artifact = getOwnedArtifact(conversationId, artifactId);
  if (artifact.kind !== "html") throw new Error("Only HTML artifacts can be read as source.");
  const session = getSandboxSession(artifact.session_id);
  if (!session) throw new Error("Sandbox session not found.");
  const filePath = resolveSandboxPath(session.root_path, artifact.path);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("HTML artifact file is missing.");
  const bytesToRead = Math.min(fileStat.size, MAX_HTML_READ_BYTES);
  const sha256 = artifact.sha256 ?? hashBytes(await readFile(filePath));
  const handle = await open(filePath, "r");
  const content = Buffer.alloc(bytesToRead);
  try {
    const result = await handle.read(content, 0, bytesToRead, 0);
    const text = content.subarray(0, result.bytesRead).toString("utf8");
    return {
      artifactId: artifact.id,
      kind: "html",
      path: artifact.path,
      mimeType: "text/html",
      sizeBytes: fileStat.size,
      sha256,
      text,
      truncated: fileStat.size > MAX_HTML_READ_BYTES,
    };
  } finally {
    await handle.close();
  }
}

export function getSandboxArtifactResourceUrl(conversationId: string, artifactId: string): string {
  const artifact = getOwnedArtifact(conversationId, artifactId);
  if (artifact.kind !== "static" && artifact.kind !== "svg") {
    throw new Error("Only static or SVG artifacts have resource URLs.");
  }
  if (!artifact.entry_path) throw new Error("Artifact entry is missing.");
  const entryPath = normalizeRelativePath(artifact.entry_path);
  const encodedPath = entryPath.split("/").map(encodeURIComponent).join("/");
  return `ayaka-artifact://${encodeURIComponent(artifact.id)}/${encodedPath}`;
}

export async function readSandboxArtifactResource(
  artifactId: string,
  relativePath: string,
): Promise<{ body: Buffer; mimeType: string; sizeBytes: number }> {
  const artifact = getSandboxArtifact(artifactId);
  if (!artifact || (artifact.kind !== "static" && artifact.kind !== "svg")) {
    throw new Error("Static or SVG artifact not found.");
  }
  const session = getSandboxSession(artifact.session_id);
  if (!session) throw new Error("Sandbox session not found.");
  const normalized = normalizeRelativePath(relativePath);
  const filePath =
    artifact.kind === "svg"
      ? resolveSandboxPath(session.root_path, artifact.path)
      : resolveSandboxPath(session.root_path, path.posix.join(artifact.path, normalized));
  if (artifact.kind === "svg" && normalized !== normalizeRelativePath(artifact.entry_path ?? "")) {
    throw new Error("SVG resource path does not match the artifact entry.");
  }
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile()) throw new Error("Static resource is not a file.");
  if (fileStat.size > MAX_STATIC_RESOURCE_BYTES) {
    throw new Error("Static resource exceeds the 2 MB limit.");
  }
  const body = await readFile(filePath);
  const mimeType = mimeTypeForPath(filePath);
  return {
    body,
    sizeBytes: body.byteLength,
    mimeType,
  };
}

export async function createSandboxPreviewArtifact(
  session: SandboxSession,
  input: { port: number; previewId: string; conversationId: string },
): Promise<SandboxArtifact> {
  const existing = listSandboxArtifactsForSession(session.id).find(
    (artifact) => artifact.kind === "preview" && artifact.url === `http://127.0.0.1:${input.port}`,
  );
  const row = existing
    ? await updateSandboxArtifactAsync(existing.id, {
        status: "running",
        url: `http://127.0.0.1:${input.port}`,
        updated_at: Date.now(),
      })
    : await insertSandboxArtifactAsync({
        id: input.previewId,
        session_id: session.id,
        kind: "preview",
        path: `preview-${input.port}`,
        url: `http://127.0.0.1:${input.port}`,
        size_bytes: null,
        entry_path: null,
        mime_type: "text/html",
        sha256: null,
        status: "running",
        created_at: Date.now(),
        updated_at: Date.now(),
      });
  emitArtifact(row);
  return projectArtifact(row);
}

export async function setSandboxArtifactStatus(
  artifactId: string,
  status: SandboxArtifactStatus,
): Promise<SandboxArtifact> {
  const row = await updateSandboxArtifactAsync(artifactId, { status, updated_at: Date.now() });
  emitArtifact(row);
  return projectArtifact(row);
}

export function normalizeRelativePath(value: string): string {
  const raw = decodeURIComponent(String(value || ""));
  if (!raw || raw.includes("\0") || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) {
    throw new Error("Artifact resource paths must be relative.");
  }
  const normalized = path.posix.normalize(raw.replace(/\\/g, "/"));
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Artifact resource path escapes the artifact root.");
  }
  if (normalized.split("/").includes(SNAPSHOT_DIRNAME)) {
    throw new Error("Snapshot internals are not accessible.");
  }
  return normalized;
}

async function scanArtifact(
  session: SandboxSession,
  input: PublishArtifactInput,
): Promise<ArtifactScan> {
  const filePath = resolveSandboxPath(session.root_path, input.path);
  const fileStat = await lstat(filePath);
  if (fileStat.isSymbolicLink()) throw new Error("Symlinks cannot be published as artifacts.");
  const relativePath = toRelative(session.root_path, filePath);
  const requestedKind = input.kind;
  if (fileStat.isFile()) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === ".svg") {
      if (requestedKind && requestedKind !== "svg") {
        throw new Error("An SVG file artifact must use the svg kind.");
      }
      const content = await readFile(filePath);
      if (content.byteLength > MAX_STATIC_RESOURCE_BYTES) {
        throw new Error("SVG artifact exceeds the 2 MB limit.");
      }
      return {
        kind: "svg",
        path: relativePath,
        entryPath: relativePath,
        sizeBytes: content.byteLength,
        sha256: hashBytes(content),
        mimeType: "image/svg+xml",
      };
    }
    if (!/\.html?$/i.test(filePath)) throw new Error("Only HTML or SVG files can be published.");
    if (requestedKind && requestedKind !== "html") {
      throw new Error("An HTML file artifact must use the html kind.");
    }
    const content = await readFile(filePath);
    return {
      kind: "html",
      path: relativePath,
      entryPath: relativePath,
      sizeBytes: content.byteLength,
      sha256: hashBytes(content),
      mimeType: "text/html",
    };
  }
  if (!fileStat.isDirectory()) throw new Error("Artifact path must be a file or directory.");
  if (relativePath.split("/").includes(SNAPSHOT_DIRNAME)) {
    throw new Error("Snapshot internals cannot be published.");
  }
  const scan = await scanDirectory(filePath);
  const entryPath = normalizeRelativePath(input.entryPath ?? "index.html");
  if (!scan.files.has(entryPath)) throw new Error("Static artifact entry file was not found.");
  if (requestedKind === "html") throw new Error("The html kind requires a single HTML file.");
  return {
    kind: "static",
    path: relativePath,
    entryPath,
    sizeBytes: scan.sizeBytes,
    sha256: scan.sha256,
    mimeType: "text/html",
  };
}

async function scanDirectory(root: string): Promise<{
  files: Set<string>;
  sizeBytes: number;
  sha256: string;
}> {
  const files = new Set<string>();
  let sizeBytes = 0;
  const hash = createHash("sha256");
  async function visit(current: string, relative = ""): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === SNAPSHOT_DIRNAME)
        throw new Error("Snapshot internals cannot be published.");
      const next = path.join(current, entry.name);
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const item = await lstat(next);
      if (item.isSymbolicLink()) throw new Error("Symlinks cannot be published as artifacts.");
      if (item.isDirectory()) {
        await visit(next, nextRelative);
        continue;
      }
      if (!item.isFile()) throw new Error("Special files cannot be published as artifacts.");
      if (item.size > MAX_STATIC_RESOURCE_BYTES) {
        throw new Error("A static resource exceeds the 2 MB limit.");
      }
      sizeBytes += item.size;
      if (sizeBytes > MAX_STATIC_TOTAL_BYTES) throw new Error("Static artifact exceeds 20 MB.");
      if (files.size >= MAX_STATIC_FILES) throw new Error("Static artifact exceeds 1,000 files.");
      const content = await readFile(next);
      files.add(nextRelative);
      hash.update(nextRelative);
      hash.update("\0");
      hash.update(content);
    }
  }
  await visit(root);
  return { files, sizeBytes, sha256: hash.digest("hex") };
}

function projectArtifact(artifact: SandboxArtifact): SandboxArtifact {
  return { ...artifact, authorized: isSandboxArtifactAuthorized(artifact.id) };
}

function emitArtifact(artifact: SandboxArtifact): void {
  const projected = projectArtifact(artifact);
  for (const listener of listeners) listener(projected);
}

function toRelative(root: string, value: string): string {
  const relative = path.relative(root, value);
  return relative.split(path.sep).join("/") || ".";
}

function hashBytes(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function mimeTypeForPath(value: string): string {
  const ext = path.extname(value).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
  };
  const mimeType = types[ext];
  if (!mimeType) throw new Error("Static resource type is not supported.");
  return mimeType;
}
