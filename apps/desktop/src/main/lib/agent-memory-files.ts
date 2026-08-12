import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";
import { getSetting, insertRuntimeEvent, listMemories, queueMemoryJob } from "./db";
import { resolveModel } from "./providers";
import {
  DEFAULT_AGENT_ID,
  SettingKey,
  type AgentMemoryFileSnapshot,
  type AgentProfile,
  type MemoryRecord,
} from "../../shared/types";
import {
  ensureAgentSoulDirectory,
  registerSoulCacheInvalidator,
  removeAgentSoulFiles,
  resolveAgentMemoriesRoot,
  resolveAgentSoulFilePaths,
} from "./agent-memory-file-storage";

export type MemoryFileKind = "soul" | "user" | "memory";
export type MemoryFileWriteSource = "system" | "user";

export const MEMORY_FILE_LIMITS: Record<MemoryFileKind, number> = {
  soul: 4_000,
  user: 2_000,
  memory: 4_000,
};

interface MemoryFileEnvelopeV2 {
  version: 2;
  payload: EncryptedPayload;
  updatedAt: number;
  manualBaseline?: EncryptedPayload;
  manualEditedAt?: number;
}

interface LegacyMemoryFileEnvelope {
  payload: EncryptedPayload;
  updatedAt?: number;
  userLocked?: boolean;
}

interface MemoryFileState {
  content: string;
  updatedAt: number;
  manualBaseline: string | null;
  manualEditedAt: number | null;
  signature: string;
  source: "primary" | "backup" | "default";
}

const FILE_NAMES: Record<MemoryFileKind, string> = {
  soul: "SOUL.md.enc",
  user: "USER.md.enc",
  memory: "MEMORY.md.enc",
};
const MEMORY_FILE_KINDS: MemoryFileKind[] = ["soul", "user", "memory"];

const cache = new Map<string, MemoryFileState>();
let consolidationTimer: NodeJS.Timeout | null = null;

function cacheKey(kind: MemoryFileKind, agentId?: string | null): string {
  return kind === "soul" ? `soul:${agentId ?? DEFAULT_AGENT_ID}` : kind;
}

function filePath(kind: MemoryFileKind, agentId?: string | null): string {
  if (kind === "soul") {
    ensureAgentSoulDirectory(agentId ?? DEFAULT_AGENT_ID);
    const target = resolveAgentSoulFilePaths(agentId ?? DEFAULT_AGENT_ID).primary;
    const legacy = join(resolveAgentMemoriesRoot(), FILE_NAMES[kind]);
    if (
      !existsSync(target) &&
      existsSync(legacy) &&
      (agentId ?? DEFAULT_AGENT_ID) === DEFAULT_AGENT_ID
    ) {
      copyFileSync(legacy, target);
    }
    return target;
  }

  const root = resolveAgentMemoriesRoot();
  const dir = join(root, "global");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = join(dir, FILE_NAMES[kind]);
  const legacy = join(root, FILE_NAMES[kind]);
  if (!existsSync(target) && existsSync(legacy)) {
    copyFileSync(legacy, target);
  }
  return target;
}

function backupPath(kind: MemoryFileKind, agentId?: string | null): string {
  return `${filePath(kind, agentId)}.bak`;
}

function defaultContent(kind: MemoryFileKind): string {
  if (kind === "soul") {
    return [
      "# SOUL",
      "",
      "You are Paimon, a capable local-first AI partner and orchestrator. Be warm, proactive, careful, and useful.",
    ].join("\n");
  }
  if (kind === "user") return "# USER\n\nNo stable user profile yet.";
  return "# MEMORY\n\nNo long-term working memories yet.";
}

function fileSignature(path: string): string | null {
  if (!existsSync(path)) return null;
  const stat = statSync(path);
  return `${stat.mtimeMs}:${stat.size}`;
}

function readStateFromPath(
  kind: MemoryFileKind,
  path: string,
): Omit<MemoryFileState, "signature" | "source"> {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!raw || typeof raw !== "object") throw new Error("Memory file envelope is invalid.");
  const envelope = raw as MemoryFileEnvelopeV2 & LegacyMemoryFileEnvelope;
  if (!isEncryptedPayload(envelope.payload)) throw new Error("Memory file payload is invalid.");

  const updatedAt =
    typeof envelope.updatedAt === "number" && Number.isFinite(envelope.updatedAt)
      ? envelope.updatedAt
      : Math.trunc(statSync(path).mtimeMs);
  const content = decrypt(envelope.payload).slice(0, MEMORY_FILE_LIMITS[kind]);
  let manualBaseline: string | null = null;
  let manualEditedAt: number | null = null;

  if (envelope.version === 2) {
    if (envelope.manualBaseline != null) {
      if (!isEncryptedPayload(envelope.manualBaseline)) {
        throw new Error("Memory file manual baseline is invalid.");
      }
      manualBaseline = decrypt(envelope.manualBaseline).slice(0, MEMORY_FILE_LIMITS[kind]);
    }
    manualEditedAt =
      typeof envelope.manualEditedAt === "number" && Number.isFinite(envelope.manualEditedAt)
        ? envelope.manualEditedAt
        : null;
  } else if (envelope.userLocked === true) {
    manualBaseline = content;
    manualEditedAt = updatedAt;
  }

  return { content, updatedAt, manualBaseline, manualEditedAt };
}

function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<EncryptedPayload>;
  return [payload.ct, payload.iv, payload.tag, payload.salt].every(
    (part) => typeof part === "string" && part.length > 0,
  );
}

function readCached(kind: MemoryFileKind, agentId?: string | null): MemoryFileState {
  const key = cacheKey(kind, agentId);
  const primary = filePath(kind, agentId);
  const primarySignature = fileSignature(primary);
  const cached = cache.get(key);
  if (cached && cached.source === "primary" && cached.signature === primarySignature) return cached;

  let primaryError: unknown = null;
  if (primarySignature) {
    try {
      const state = {
        ...readStateFromPath(kind, primary),
        signature: primarySignature,
        source: "primary" as const,
      };
      cache.set(key, state);
      return state;
    } catch (error) {
      primaryError = error;
    }
  }

  const backup = backupPath(kind, agentId);
  const backupSignature = fileSignature(backup);
  if (backupSignature) {
    try {
      const recovered = readStateFromPath(kind, backup);
      copyFileSync(backup, primary);
      const state = {
        ...recovered,
        signature: fileSignature(primary) ?? backupSignature,
        source: "primary" as const,
      };
      cache.set(key, state);
      recordMemoryFileDiagnostic(kind, "recovered-backup", primaryError);
      return state;
    } catch (backupError) {
      recordMemoryFileDiagnostic(kind, "backup-invalid", backupError);
    }
  }

  if (primaryError) recordMemoryFileDiagnostic(kind, "primary-invalid", primaryError);
  const fallback: MemoryFileState = {
    content: defaultContent(kind),
    updatedAt: 0,
    manualBaseline: null,
    manualEditedAt: null,
    signature: `default:${primarySignature ?? "missing"}:${backupSignature ?? "missing"}`,
    source: "default",
  };
  cache.set(key, fallback);
  return fallback;
}

function writeEnvelope(
  kind: MemoryFileKind,
  content: string,
  options?: { source?: MemoryFileWriteSource; updatedAt?: number; agentId?: string | null },
): void {
  const source = options?.source ?? "system";
  const updatedAt = options?.updatedAt ?? Date.now();
  const current = readCached(kind, options?.agentId);
  const manualBaseline = source === "user" ? content : current.manualBaseline;
  const manualEditedAt = source === "user" ? updatedAt : current.manualEditedAt;
  const envelope: MemoryFileEnvelopeV2 = {
    version: 2,
    payload: encrypt(content),
    updatedAt,
    ...(manualBaseline ? { manualBaseline: encrypt(manualBaseline) } : {}),
    ...(manualEditedAt != null ? { manualEditedAt } : {}),
  };

  const path = filePath(kind, options?.agentId);
  const backup = backupPath(kind, options?.agentId);
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });

  let movedPrimary = false;
  try {
    if (existsSync(backup)) unlinkSync(backup);
    if (existsSync(path)) {
      renameSync(path, backup);
      movedPrimary = true;
    }
    renameSync(temporary, path);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    if (movedPrimary && !existsSync(path) && existsSync(backup)) renameSync(backup, path);
    throw error;
  }

  cache.set(cacheKey(kind, options?.agentId), {
    content,
    updatedAt,
    manualBaseline,
    manualEditedAt,
    signature: fileSignature(path) ?? `${updatedAt}:${content.length}`,
    source: "primary",
  });
}

export function readMemoryFile(kind: MemoryFileKind, agentId?: string | null): string {
  return readCached(kind, agentId).content;
}

export function writeMemoryFile(
  kind: MemoryFileKind,
  content: string,
  options?: { source?: MemoryFileWriteSource; agentId?: string | null },
): void {
  const clipped = content.slice(0, MEMORY_FILE_LIMITS[kind]);
  writeEnvelope(kind, clipped, { source: options?.source, agentId: options?.agentId });
}

export function reloadMemoryFile(
  kind: MemoryFileKind,
  agentId?: string | null,
): AgentMemoryFileSnapshot {
  cache.delete(cacheKey(kind, agentId));
  return getMemoryFileSnapshot(kind, agentId);
}

export function getMemoryFileSnapshot(
  kind: MemoryFileKind,
  agentId?: string | null,
): AgentMemoryFileSnapshot {
  const state = readCached(kind, agentId);
  return {
    kind,
    content: state.content,
    charLimit: MEMORY_FILE_LIMITS[kind],
    charCount: state.content.length,
    updatedAt: state.updatedAt,
  };
}

export function buildMemoryFilePromptBlock(agentId?: string | null): string {
  return MEMORY_FILE_KINDS.map((kind) => readMemoryFile(kind, agentId).trim())
    .filter(Boolean)
    .join("\n\n");
}

export async function incorporateNewMemories(records: MemoryRecord[]): Promise<void> {
  if (records.length === 0) return;
  const userLines: string[] = [];
  const memoryLines: string[] = [];
  const now = Date.now();

  for (const record of records) {
    const line = `- ${record.title}: ${record.content}`;
    if (record.kind === "profile" || record.kind === "preference") userLines.push(line);
    else memoryLines.push(line);
  }

  if (userLines.length > 0) appendToFile("user", userLines, now);
  if (memoryLines.length > 0) appendToFile("memory", memoryLines, now);

  const shouldDream = (["user", "memory"] as MemoryFileKind[]).some(
    (kind) => readCached(kind).content.length >= MEMORY_FILE_LIMITS[kind] * 0.9,
  );
  if (shouldDream) {
    void queueMemoryJob({
      kind: "consolidate",
      agentId: null,
      payload: { reason: "memory-file-near-limit" },
      scheduledAt: Date.now() + 2_000,
    });
  }
}

function appendToFile(kind: MemoryFileKind, lines: string[], now: number): void {
  const state = readCached(kind);
  const header = kind === "user" ? "# USER" : "# MEMORY";
  const body = state.content.startsWith(header)
    ? state.content.slice(header.length).trim()
    : state.content.trim();
  const appendedBody = body ? `${body}\n${lines.join("\n")}` : lines.join("\n");
  const next = `${header}\n\n${appendedBody}`;
  writeEnvelope(kind, truncateWithEllipsis(next, MEMORY_FILE_LIMITS[kind]), {
    source: "system",
    updatedAt: now,
  });
}

function truncateWithEllipsis(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, Math.max(0, limit - 3)) + "...";
}

export async function consolidateMemoryFiles(
  agentId = DEFAULT_AGENT_ID,
  options?: { allowSoulEvolution?: boolean },
): Promise<void> {
  const model = tryResolveSelectedModel();
  const current = {
    soul: readCached("soul", agentId),
    user: readCached("user"),
    memory: readCached("memory"),
  };

  if (!model) return;

  const records = listMemories({ includeInactive: false, limit: 80 })
    .map(
      (record) =>
        `- [${record.kind}; confidence=${record.confidence ?? 70}] ${record.title}: ${record.content}`,
    )
    .join("\n");
  const prompt = buildConsolidationPrompt({
    soul: current.soul.content,
    user: current.user.content,
    memory: current.memory.content,
    manualBaselines: {
      soul: current.soul.manualBaseline,
      user: current.user.manualBaseline,
      memory: current.memory.manualBaseline,
    },
    records,
  });

  try {
    const result = await generateText({
      model: model.model,
      system:
        "You curate bounded memory files for an AI agent. Output ONLY the three files separated by exact headers ===SOUL===, ===USER===, ===MEMORY===. Keep stable identity in SOUL, user preferences/profile in USER, and project facts/lessons in MEMORY. Preserve every user-authored baseline statement, remove only automatic duplicates, and keep each file under its limit.",
      prompt,
      temperature: 0.3,
      maxOutputTokens: Math.min(model.maxOutputTokens, 4_000),
      providerOptions: model.providerOptions,
    });
    const parsed = parseConsolidationOutput(result.text);
    if (!parsed || !manualBaselinesArePreserved(parsed, current)) {
      recordMemoryFileDiagnostic(null, "consolidation-rejected", "Invalid or lossy model output.");
      return;
    }

    for (const kind of MEMORY_FILE_KINDS) {
      const content =
        kind === "soul" && options?.allowSoulEvolution === false
          ? current.soul.content
          : parsed[kind];
      writeMemoryFile(kind, content, { source: "system", agentId });
    }
  } catch (error) {
    recordMemoryFileDiagnostic(null, "consolidation-failed", error);
  }
}

export async function dreamMemoryFiles(
  _reason = "scheduled",
  agentId = DEFAULT_AGENT_ID,
  allowSoulEvolution = false,
): Promise<void> {
  await consolidateMemoryFiles(agentId, { allowSoulEvolution });
}

function buildConsolidationPrompt(input: {
  soul: string;
  user: string;
  memory: string;
  manualBaselines: Record<MemoryFileKind, string | null>;
  records: string;
}): string {
  return [
    "Consolidate the bounded memory files.",
    "Character limits: SOUL 4000, USER 2000, MEMORY 4000.",
    "Update SOUL only for stable identity/tone/value changes with repeated evidence.",
    "Current user instructions and the user-authored baselines have higher priority than automatic memory.",
    "Preserve every non-heading line from a user-authored baseline verbatim in its matching output file.",
    "",
    "Format:",
    "===SOUL===",
    "# SOUL",
    "...",
    "===USER===",
    "# USER",
    "...",
    "===MEMORY===",
    "# MEMORY",
    "...",
    "",
    "Current SOUL:",
    input.soul,
    "",
    "Current USER:",
    input.user,
    "",
    "Current MEMORY:",
    input.memory,
    "",
    "User-authored SOUL baseline:",
    input.manualBaselines.soul ?? "(none)",
    "",
    "User-authored USER baseline:",
    input.manualBaselines.user ?? "(none)",
    "",
    "User-authored MEMORY baseline:",
    input.manualBaselines.memory ?? "(none)",
    "",
    "Structured memory records:",
    input.records,
  ].join("\n");
}

export function parseConsolidationOutput(text: string): Record<MemoryFileKind, string> | null {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const match = normalized.match(
    /^===SOUL===\n([\s\S]+?)\n===USER===\n([\s\S]+?)\n===MEMORY===\n([\s\S]+)$/,
  );
  if (!match) return null;
  const parsed: Record<MemoryFileKind, string> = {
    soul: match[1].trim(),
    user: match[2].trim(),
    memory: match[3].trim(),
  };
  for (const kind of MEMORY_FILE_KINDS) {
    if (!parsed[kind] || parsed[kind].length > MEMORY_FILE_LIMITS[kind]) return null;
  }
  return parsed;
}

function manualBaselinesArePreserved(
  parsed: Record<MemoryFileKind, string>,
  current: Record<MemoryFileKind, MemoryFileState>,
): boolean {
  return MEMORY_FILE_KINDS.every((kind) => {
    const statements = manualBaselineStatements(current[kind].manualBaseline);
    const output = normalizeStatement(parsed[kind]);
    return statements.every((statement) => output.includes(statement));
  });
}

function manualBaselineStatements(baseline: string | null): string[] {
  if (!baseline) return [];
  return baseline
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map(normalizeStatement);
}

function normalizeStatement(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function ensureMemoryFiles(agent: AgentProfile): void {
  for (const kind of MEMORY_FILE_KINDS) {
    const state = readCached(kind, agent.id);
    if (state.source !== "default") continue;
    const initial =
      kind === "soul" && agent.instructions?.trim()
        ? `# SOUL\n\n${agent.instructions.trim()}`
        : defaultContent(kind);
    writeMemoryFile(kind, initial, { source: "system", agentId: agent.id });
  }
}

export function scheduleMemoryFileConsolidation(): void {
  if (consolidationTimer) return;
  consolidationTimer = setInterval(
    () => {
      for (const kind of MEMORY_FILE_KINDS) {
        if (readCached(kind).content.length >= MEMORY_FILE_LIMITS[kind] * 0.8) {
          void queueMemoryJob({
            kind: "consolidate",
            agentId: null,
            payload: { reason: "scheduled-file-pressure" },
            scheduledAt: Date.now(),
          });
          break;
        }
      }
    },
    30 * 60 * 1000,
  );
}

export function clearMemoryFileConsolidation(): void {
  if (!consolidationTimer) return;
  clearInterval(consolidationTimer);
  consolidationTimer = null;
}

registerSoulCacheInvalidator((agentId) => {
  cache.delete(cacheKey("soul", agentId));
});

export { removeAgentSoulFiles };

function recordMemoryFileDiagnostic(
  kind: MemoryFileKind | null,
  action: string,
  error: unknown,
): void {
  const message = formatDiagnosticError(error);
  console.warn(`[agent-memory-files] ${action}${kind ? ` (${kind})` : ""}:`, message ?? "");
  try {
    insertRuntimeEvent({
      kind: "memory",
      title: `Memory file ${action}`,
      status: action.includes("recovered") ? "succeeded" : "failed",
      detail: { action, fileKind: kind, error: message },
    });
  } catch {
    // Diagnostics must never block memory recovery or chat startup.
  }
}

function formatDiagnosticError(error: unknown): string | null {
  if (error == null) return null;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown memory file error.";
  }
}

function tryResolveSelectedModel(): ReturnType<typeof resolveModel> | null {
  try {
    const modelRef = getSetting(SettingKey.SelectedModel);
    return modelRef ? resolveModel(modelRef) : null;
  } catch {
    return null;
  }
}
