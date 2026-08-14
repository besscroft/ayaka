import { app, dialog, shell } from "electron";
import { existsSync, realpathSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createConversationWorkspace,
  createConversation,
  getConversation,
  getConversationWorkspace,
  listMessages,
  listConversationWorkspaces,
  rollbackConversationPreparation,
} from "./db";
import type {
  WorkspaceFileContent,
  WorkspaceFileRef,
  WorkspaceInfo,
  WorkspaceMediaSaveInput,
  WorkspaceMediaSaveResult,
  WorkspaceOrphan,
} from "../../shared/types";
import type { UIMessage } from "ai";

const DEFAULT_WORKSPACE_DIR = "workspaces";
const ATTACHMENTS_DIR = "attachments";
const OUTPUTS_DIR = "outputs";
const orphanPaths = new Map<string, string>();
const preparations = new Map<string, Promise<WorkspaceInfo>>();

export function resolveDefaultWorkspaceParent(): string {
  return path.join(
    process.env.VOID_AI_USER_DATA_DIR || app.getPath("userData"),
    "data",
    DEFAULT_WORKSPACE_DIR,
  );
}

export function normalizeWorkspaceParent(value: string | null | undefined): string {
  return path.resolve(value?.trim() || resolveDefaultWorkspaceParent());
}

export async function getWorkspaceParent(): Promise<string> {
  const { getSetting } = await import("./db");
  return normalizeWorkspaceParent(getSetting("workspace_parent_directory"));
}

export function resolveWorkspacePath(rootPath: string, relativePath = "."): string {
  const raw = String(relativePath || ".").trim() || ".";
  if (path.isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith("\\\\")) {
    throw new Error("Workspace paths must be relative.");
  }
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, raw);
  const relative = path.relative(root, resolved);
  if (
    relative &&
    (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
  ) {
    throw new Error("Workspace path escapes the conversation workspace.");
  }
  assertWorkspaceRealPath(root, resolved);
  return resolved;
}

export async function prepareConversationWorkspace(
  conversationId: string,
  title = "New conversation",
): Promise<WorkspaceInfo> {
  const existing = getConversationWorkspace(conversationId);
  if (existing) return toWorkspaceInfo(existing);
  const pending = preparations.get(conversationId);
  if (pending) return pending;
  const preparation = prepareConversationWorkspaceInternal(conversationId, title);
  preparations.set(conversationId, preparation);
  try {
    return await preparation;
  } finally {
    if (preparations.get(conversationId) === preparation) preparations.delete(conversationId);
  }
}

async function prepareConversationWorkspaceInternal(
  conversationId: string,
  title: string,
): Promise<WorkspaceInfo> {
  const existing = getConversationWorkspace(conversationId);
  if (existing) return toWorkspaceInfo(existing);
  const existingConversation = getConversation(conversationId);

  const { getSetting } = await import("./db");
  const parent = normalizeWorkspaceParent(getSetting("workspace_parent_directory"));
  await mkdir(parent, { recursive: true });
  if (!(await stat(parent)).isDirectory()) throw new Error("Workspace parent is not a directory.");
  const shortId =
    conversationId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || randomUUID().slice(0, 8);
  const date = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const baseName = `${date}-conv-${shortId}`;
  let rootPath = "";
  let suffix = 0;
  try {
    while (!rootPath) {
      const name = suffix === 0 ? baseName : `${baseName}-${suffix}`;
      const candidate = path.join(parent, name);
      try {
        await mkdir(candidate);
        rootPath = candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        suffix += 1;
      }
    }
    await mkdir(path.join(rootPath, ATTACHMENTS_DIR), { recursive: true });
    await mkdir(path.join(rootPath, OUTPUTS_DIR), { recursive: true });
    const now = Date.now();
    const createdConversation = !existingConversation;
    if (createdConversation) await createConversation(conversationId, title);
    const row = await createConversationWorkspace({
      conversation_id: conversationId,
      parent_path: parent,
      root_path: rootPath,
      status: "active",
      created_at: now,
      updated_at: now,
    });
    if (path.resolve(row.root_path) !== path.resolve(rootPath)) {
      await rm(rootPath, { recursive: true, force: true });
    }
    return toWorkspaceInfo(row);
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true });
    if (!existingConversation && !getConversationWorkspace(conversationId)) {
      await rollbackConversationPreparation(conversationId);
    }
    throw error;
  }
}

export async function rollbackConversationWorkspacePreparation(
  conversationId: string,
): Promise<void> {
  const workspace = getConversationWorkspace(conversationId);
  const conversation = getConversation(conversationId);
  if (!workspace || !conversation || listMessages(conversationId).length > 0) return;
  await rollbackConversationPreparation(conversationId);
  await rm(workspace.root_path, { recursive: true, force: true });
}

export async function getConversationWorkspaceInfo(
  conversationId: string,
): Promise<WorkspaceInfo | null> {
  const row = getConversationWorkspace(conversationId);
  return row ? toWorkspaceInfo(row) : null;
}

export async function selectWorkspaceParent(): Promise<boolean> {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  if (result.canceled || !result.filePaths[0]) return false;
  const parent = path.resolve(result.filePaths[0]);
  const { setSetting } = await import("./db");
  await setSetting("workspace_parent_directory", parent);
  return true;
}

export async function openConversationWorkspace(conversationId: string): Promise<boolean> {
  const row = getConversationWorkspace(conversationId);
  if (!row) return false;
  await shell.openPath(row.root_path);
  return true;
}

export async function openWorkspaceParent(): Promise<boolean> {
  const parent = await getWorkspaceParent();
  await mkdir(parent, { recursive: true });
  await shell.openPath(parent);
  return true;
}

export async function getWorkspaceParentState(): Promise<{ configured: boolean; path: string }> {
  const { getSetting } = await import("./db");
  return {
    configured: Boolean(getSetting("workspace_parent_directory")?.trim()),
    path: await getWorkspaceParent(),
  };
}

export async function saveWorkspaceAttachment(
  conversationId: string,
  input: { filename?: string; mediaType?: string; data: ArrayBuffer | Uint8Array },
): Promise<WorkspaceFileRef> {
  await prepareConversationWorkspace(conversationId);
  const workspace = requireConversationWorkspace(conversationId);
  const original = sanitizeFilename(path.basename(input.filename?.trim() || "attachment"));
  const safeName = original || "attachment";
  const targetDir = resolveWorkspacePath(workspace.root_path, ATTACHMENTS_DIR);
  const ext = path.extname(safeName);
  const stem = path.basename(safeName, ext);
  let filename = safeName;
  let index = 1;
  while (existsSync(path.join(targetDir, filename))) filename = `${stem}-${index++}${ext}`;
  const target = resolveWorkspacePath(workspace.root_path, `${ATTACHMENTS_DIR}/${filename}`);
  const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
  await writeFile(target, bytes);
  return {
    path: `${ATTACHMENTS_DIR}/${filename}`,
    filename,
    mediaType: input.mediaType || "application/octet-stream",
    size: bytes.byteLength,
  };
}

export async function writeWorkspaceOutput(
  conversationId: string,
  input: { filename: string; mediaType: string; data: Uint8Array },
): Promise<WorkspaceFileRef> {
  await prepareConversationWorkspace(conversationId);
  const workspace = requireConversationWorkspace(conversationId);
  const requested = sanitizeFilename(path.basename(input.filename)) || "output";
  const filenameWithExtension = path.extname(requested)
    ? requested
    : requested + extensionForMediaType(input.mediaType);
  const targetDir = resolveWorkspacePath(workspace.root_path, OUTPUTS_DIR);
  await mkdir(targetDir, { recursive: true });
  const filename = uniqueFilename(targetDir, filenameWithExtension);
  const target = resolveWorkspacePath(workspace.root_path, `${OUTPUTS_DIR}/${filename}`);
  await writeFile(target, input.data);
  return {
    path: `${OUTPUTS_DIR}/${filename}`,
    filename,
    mediaType: input.mediaType,
    size: input.data.byteLength,
  };
}

export async function saveWorkspaceAttachments(
  conversationId: string,
  inputs: Array<{ filename?: string; mediaType?: string; dataUrl: string }>,
): Promise<WorkspaceFileRef[]> {
  await prepareConversationWorkspace(conversationId);
  const workspace = requireConversationWorkspace(conversationId);
  const staging = resolveWorkspacePath(workspace.root_path, `.attachments-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  const committedPaths: string[] = [];
  try {
    const refs: WorkspaceFileRef[] = [];
    for (const input of inputs) {
      const match = /^data:[^;,]+(?:;[^,]*)?;base64,(.*)$/i.exec(input.dataUrl.trim());
      if (!match) throw new Error("Attachment data must be a base64 data URL.");
      const original = sanitizeFilename(path.basename(input.filename?.trim() || "attachment"));
      const safeName = original || "attachment";
      const ext = path.extname(safeName);
      const stem = path.basename(safeName, ext);
      let filename = safeName;
      let index = 1;
      const targetDir = resolveWorkspacePath(workspace.root_path, ATTACHMENTS_DIR);
      while (
        existsSync(path.join(targetDir, filename)) ||
        refs.some((ref) => ref.filename === filename)
      ) {
        filename = `${stem}-${index++}${ext}`;
      }
      const stagedPath = path.join(staging, filename);
      const data = Buffer.from(match[1] ?? "", "base64");
      await writeFile(stagedPath, data);
      refs.push({
        path: `${ATTACHMENTS_DIR}/${filename}`,
        filename,
        mediaType: input.mediaType || "application/octet-stream",
        size: data.byteLength,
      });
    }
    const targetDir = resolveWorkspacePath(workspace.root_path, ATTACHMENTS_DIR);
    for (const ref of refs) {
      const targetPath = path.join(targetDir, ref.filename);
      await rename(path.join(staging, ref.filename), targetPath);
      committedPaths.push(targetPath);
    }
    await rm(staging, { recursive: true, force: true });
    return refs;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    await Promise.all(
      committedPaths.map((committedPath) =>
        rm(committedPath, { force: true }).catch(() => undefined),
      ),
    );
    throw error;
  }
}

export async function readWorkspaceFile(
  conversationId: string,
  relativePath: string,
): Promise<Uint8Array> {
  const row = getConversationWorkspace(conversationId);
  if (!row) throw new Error("Conversation workspace does not exist.");
  return readFile(resolveWorkspacePath(row.root_path, relativePath));
}

export async function readWorkspaceFileContent(
  conversationId: string,
  relativePath: string,
): Promise<WorkspaceFileContent> {
  const workspace = getConversationWorkspace(conversationId);
  if (!workspace) throw new Error("Conversation workspace does not exist.");
  const safePath = resolveWorkspacePath(workspace.root_path, relativePath);
  const info = await stat(safePath);
  if (!info.isFile()) throw new Error("Workspace path is not a file.");
  const data = await readFile(safePath);
  const filename = path.basename(safePath);
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return {
    path: path.relative(workspace.root_path, safePath).split(path.sep).join("/"),
    filename,
    mediaType: guessMediaType(filename),
    size: data.byteLength,
    data: bytes.buffer,
  };
}

export async function saveWorkspaceMediaAs(
  input: WorkspaceMediaSaveInput,
): Promise<WorkspaceMediaSaveResult> {
  const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array(input.data);
  if (bytes.byteLength === 0) throw new Error("Media data is empty.");

  const requested = sanitizeFilename(path.basename(input.filename?.trim() || "image"));
  const safeRequested = requested || "image";
  const filename = path.extname(safeRequested)
    ? safeRequested
    : safeRequested + extensionForMediaType(input.mediaType || "application/octet-stream");
  const result = await dialog.showSaveDialog({
    defaultPath: filename,
    filters: input.mediaType
      ? [{ name: input.mediaType, extensions: [path.extname(filename).slice(1) || "bin"] }]
      : undefined,
  });
  if (result.canceled || !result.filePath) return { saved: false };

  await writeFile(result.filePath, bytes);
  return { saved: true, path: result.filePath };
}

export async function revealWorkspaceFile(
  conversationId: string,
  relativePath: string,
): Promise<boolean> {
  const workspace = getConversationWorkspace(conversationId);
  if (!workspace) throw new Error("Conversation workspace does not exist.");
  const filePath = resolveWorkspacePath(workspace.root_path, relativePath);
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("Workspace path is not a file.");
  shell.showItemInFolder(filePath);
  return true;
}

export async function materializeWorkspaceFileReferences(
  conversationId: string,
  messages: UIMessage[],
): Promise<UIMessage[]> {
  const workspace = getConversationWorkspace(conversationId);
  if (!workspace) return messages;
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        (message.parts ?? []).map(async (part) => {
          if (
            part.type !== "file" ||
            typeof part.url !== "string" ||
            !part.url.startsWith("workspace://")
          ) {
            return part;
          }
          const relativePath = part.url.slice("workspace://".length);
          const data = await readWorkspaceFile(conversationId, relativePath);
          const mediaType = part.mediaType || "application/octet-stream";
          return {
            ...part,
            url: `data:${mediaType};base64,${Buffer.from(data).toString("base64")}`,
          };
        }),
      ),
    })),
  );
}

export async function listWorkspaceOrphans(): Promise<WorkspaceOrphan[]> {
  const rows = listConversationWorkspaces();
  const known = new Set(rows.map((row) => workspacePathKey(row.root_path)));
  const parents = await getWorkspaceOrphanParents(rows);
  const result: WorkspaceOrphan[] = [];
  orphanPaths.clear();
  for (const parent of parents) {
    if (!existsSync(parent)) continue;
    for (const entry of await readdir(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.includes("-conv-")) continue;
      const rootPath = path.join(parent, entry.name);
      if (known.has(workspacePathKey(rootPath))) continue;
      const info = await stat(rootPath);
      const id = randomUUID();
      orphanPaths.set(id, rootPath);
      result.push({ id, name: entry.name, modifiedAt: info.mtimeMs });
    }
  }
  return result;
}

export async function openWorkspaceOrphan(id: string): Promise<boolean> {
  const rootPath = orphanPaths.get(id);
  if (!rootPath || !(await isCurrentOrphan(rootPath))) {
    throw new Error("Workspace orphan was not found.");
  }
  await shell.openPath(rootPath);
  return true;
}

export async function removeWorkspaceOrphan(id: string): Promise<boolean> {
  const rootPath = orphanPaths.get(id);
  if (!rootPath || !(await isCurrentOrphan(rootPath))) {
    throw new Error("Workspace orphan was not found.");
  }
  await rm(rootPath, { recursive: true, force: true });
  orphanPaths.delete(id);
  return true;
}

async function isCurrentOrphan(rootPath: string): Promise<boolean> {
  const resolvedRoot = path.resolve(rootPath);
  const rows = listConversationWorkspaces();
  const known = new Set(rows.map((row) => workspacePathKey(row.root_path)));
  const parents = await getWorkspaceOrphanParents(rows);
  if (
    !new Set([...parents].map(workspacePathKey)).has(workspacePathKey(path.dirname(resolvedRoot)))
  ) {
    return false;
  }
  if (!path.basename(resolvedRoot).includes("-conv-")) return false;
  if (known.has(workspacePathKey(resolvedRoot))) return false;
  try {
    return (await stat(resolvedRoot)).isDirectory();
  } catch {
    return false;
  }
}

async function getWorkspaceOrphanParents(
  rows: ReturnType<typeof listConversationWorkspaces>,
): Promise<Set<string>> {
  const parents = new Set(rows.map((row) => path.resolve(row.parent_path)));
  parents.add(resolveDefaultWorkspaceParent());
  const { getSetting } = await import("./db");
  parents.add(normalizeWorkspaceParent(getSetting("workspace_parent_directory")));
  return parents;
}

function workspacePathKey(value: string): string {
  const resolved = path.normalize(path.resolve(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function toWorkspaceInfo(row: {
  conversation_id: string;
  parent_path: string;
  root_path: string;
  status: "active" | "orphaned";
  created_at: number;
  updated_at: number;
}): WorkspaceInfo {
  return {
    conversationId: row.conversation_id,
    relativePath: path.basename(row.root_path),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireConversationWorkspace(conversationId: string): {
  root_path: string;
} {
  const row = getConversationWorkspace(conversationId);
  if (!row) throw new Error("Conversation workspace does not exist.");
  return row;
}

function sanitizeFilename(value: string): string {
  return value
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || '<>:"/\\|?*'.includes(character) ? "_" : character;
    })
    .join("");
}

function assertWorkspaceRealPath(rootPath: string, resolvedPath: string): void {
  const rootRealPath = existingRealPath(rootPath);
  let cursor = resolvedPath;
  const suffix: string[] = [];
  while (!existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const candidateRealPath = path.resolve(existingRealPath(cursor), ...suffix);
  const relative = path.relative(rootRealPath, candidateRealPath);
  if (
    relative &&
    (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
  ) {
    throw new Error("Workspace path escapes the conversation workspace.");
  }
}

function existingRealPath(value: string): string {
  return existsSync(value) ? realpathSync.native(value) : path.resolve(value);
}

function uniqueFilename(directory: string, original: string): string {
  if (!existsSync(path.join(directory, original))) return original;
  const extension = path.extname(original);
  const stem = path.basename(original, extension);
  let index = 1;
  let candidate = `${stem}-${index}${extension}`;
  while (existsSync(path.join(directory, candidate))) candidate = `${stem}-${index++}${extension}`;
  return candidate;
}

function extensionForMediaType(mediaType: string): string {
  const normalized = mediaType.toLowerCase().split(";")[0]?.trim();
  const extensions: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
  };
  return extensions[normalized] ?? ".bin";
}

function guessMediaType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".json": "application/json",
    ".txt": "text/plain",
    ".md": "text/markdown",
  };
  return types[extension] ?? "application/octet-stream";
}
