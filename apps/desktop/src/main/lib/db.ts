import Database from "better-sqlite3";
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, lt, or } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  DEFAULT_AGENT_AVATAR_ID,
  isAgentAvatarId,
  normalizeAgentAvatarId,
} from "../../shared/agent-avatar";
import { decrypt, encrypt, type EncryptedPayload } from "./crypto";
import {
  DEFAULT_BUILTIN_TOOL_SEEDS,
  DEFAULT_CHILD_AGENT_SEEDS,
  DEFAULT_ROOT_AGENT_SEED,
} from "./runtime-defaults";
import {
  agentRunInputs,
  agentPolicies,
  agentInstances,
  agents,
  apiKeys,
  conversations,
  conversationWorkspaces,
  collaborationMessages,
  contextCheckpoints,
  interactionProfiles,
  memories,
  memoryObservations,
  memoryJobs,
  messages,
  realtimeSessions,
  modelApiKeys,
  runtimeEvents,
  runtimeRuns,
  runtimeSteps,
  sandboxArtifacts,
  sandboxSessions,
  sandboxSnapshots,
  browserTabs,
  schema,
  settings,
  syncProfiles,
  toolSecrets,
  toolServers,
  tools,
  artifactInstallations,
  catalogItems,
  catalogSources,
  managedRuntimes,
  runtimePreferences,
  mcpRuntimeStates,
  mcpDependencyInstallations,
  skillPackages,
  skillEntries,
  skillRuns,
  type AgentRunInput as DbAgentRunInput,
  type AgentPolicy as DbAgentPolicy,
  type AgentInstance as DbAgentInstance,
  type CollaborationMessage as DbCollaborationMessage,
  type ContextCheckpoint as DbContextCheckpoint,
  type AgentProfile as DbAgentProfile,
  type NewMemoryJob,
  type NewMemoryObservation,
  type NewAgentRunInput,
  type NewRuntimeEvent,
  type NewRuntimeRun,
  type NewRuntimeStep,
  type NewSandboxArtifact,
  type NewSandboxSession,
  type NewSandboxSnapshot,
  type NewToolRecord,
  type NewToolSecret,
  type NewToolServer,
  type ConversationWorkspace,
  type RealtimeSessionRow,
  type NewConversationWorkspace,
  type RuntimeEvent as DbRuntimeEvent,
  type RuntimeRun as DbRuntimeRun,
  type RuntimeStep as DbRuntimeStep,
  type SandboxArtifact,
  type SandboxSession,
  type SandboxSnapshot,
  type BrowserTab as DbBrowserTab,
  type NewBrowserTab,
  type ToolRecord as DbToolRecord,
  type ToolSecret as DbToolSecret,
  type ToolServer as DbToolServer,
  type ManagedRuntime as DbManagedRuntime,
  type RuntimePreference as DbRuntimePreference,
  type McpRuntimeState as DbMcpRuntimeState,
  type McpDependencyInstallation as DbMcpDependencyInstallation,
  type SkillPackage as DbSkillPackage,
  type SkillEntry as DbSkillEntry,
  type SkillRun as DbSkillRun,
} from "./schema";
import {
  DEFAULT_AGENT_HANDOFF_CONFIG,
  DEFAULT_AGENT_ID as SHARED_DEFAULT_AGENT_ID,
  DEFAULT_AGENT_RUNTIME_CONFIG,
  DEFAULT_AGENT_TOOL_POLICY,
  isAgentRuntimeBusy,
  normalizeAgentHandoffConfig,
  normalizeAgentRuntimeConfig,
  normalizeAgentToolPolicy,
  type AgentInput,
  type AgentRunInput,
  type AgentRunInputKind,
  type AgentRunInputSource,
  type AgentCollaborationMessage,
  type AgentContextCheckpoint,
  type AgentInstanceRecord,
  type AgentProfile,
  type AgentRuntimeState,
  type AgentRuntimeStatus,
  type Conversation,
  type ConversationAgentState,
  type InteractionProfile,
  type MemoryKind,
  type MemoryJob,
  type MemoryJobKind,
  type MemoryJobStatus,
  type MemoryObservation,
  type MemoryObservationStatus,
  type MemoryOrigin,
  type MemoryRecord,
  type MemoryScope,
  type MemoryStatus,
  type MessagePatch,
  type MessagePatchResult,
  type MessageRow,
  type MessageSnapshot,
  type RunStatus,
  type RuntimeEvent,
  type RuntimeSnapshot,
  type RuntimeStep,
  type RuntimeRun,
  type SyncState,
  type ToolRecord,
  type ToolSecretInput,
  type ToolSecretOwnerType,
  type ToolSecretPublic,
  type ToolServer,
  type ToolServerInput,
  type ToolSkill,
  type ToolSkillInput,
  type ToolsSnapshot,
  type SkillExecutionMode,
  type SkillPackageStatus,
  type SkillEntry as SkillEntryView,
  type SkillDependencyStatus,
  type SkillRunRecord,
  type SkillRunStatus,
  type ManagedRuntime,
  type RuntimePreference,
  type McpServerRuntimeState,
  type McpDependencyInstallation,
  type RuntimeKind,
  type RuntimeExecutableCommand,
  type RuntimePlatform,
  type SettingEntry,
  type RuntimeArchitecture,
  type McpLifecycleDesiredState,
  type McpLifecycleState,
  type McpDependencyStatus,
  type SandboxSessionView,
  type RealtimeSessionRecord,
  type RealtimeSessionMessage,
} from "../../shared/types";
import { removeAgentSoulFiles } from "./agent-memory-file-storage";
import { resolveUserDataDir } from "./runtime-paths";
import {
  enqueueLowPriorityRuntimeEvent,
  flushDbWriter,
  isDbWriterWorker,
  shutdownDbWriter,
  startDbWriter,
  writeDb,
} from "./db-writer";
import {
  applyMessagesPatch as applyMessagesPatchStore,
  dbMessageToShared,
  getMessagesSnapshot as getMessagesSnapshotStore,
  listMessages as listMessagesStore,
  saveMessage as saveMessageStore,
  saveMessagesBatch as saveMessagesBatchStore,
} from "./message-store";
import {
  buildAgentRuntimeSnapshot,
  buildRuntimeSnapshot,
  buildRuntimeStatusSnapshot,
  type RuntimeSnapshotReaders,
  type RuntimeStatusOptions,
  type RuntimeStatusReaders,
} from "./runtime-snapshot";
export type {
  AgentRunInput,
  AgentProfile,
  AgentRuntimeState,
  Conversation,
  ConversationAgentState,
  InteractionProfile,
  MemoryJob,
  MemoryRecord,
  MessageRow,
  RuntimeEvent,
  RuntimeRun,
  RuntimeStep,
  SandboxArtifact,
  SandboxSession,
  SandboxSnapshot,
  SyncState,
  ToolRecord,
  ToolServer,
  ToolSkill,
  ConversationWorkspace,
};

// 重新导出 schema 供其他模块直接引用（统一来源）。
export { schema };

const DB_FILENAME = "ayaka.db";
const DATA_DIRNAME = "data";
const DEFAULT_AGENT_ID = SHARED_DEFAULT_AGENT_ID;
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_SYNC_PROFILE_ID = "sync-local";
const DEFAULT_MEMORY_CONFIDENCE = 70;
const DEFAULT_MEMORY_ORIGIN: MemoryOrigin = "manual";
const DEFAULT_MEMORY_STATUS: MemoryStatus = "active";
const MEMORY_JOB_MAX_ATTEMPTS = 5;

export type DbInstance = BetterSQLite3Database<typeof schema>;
type RuntimeStatus = RunStatus;

let rawDb: Database.Database | null = null;
let dbInstance: DbInstance | null = null;
let writesThroughWorker = false;
type DecryptedSecretCacheEntry = { ciphertext: string; value: string | null };
const apiKeyCache = new Map<string, DecryptedSecretCacheEntry>();
const modelApiKeyCache = new Map<string, DecryptedSecretCacheEntry>();

const agentRuntimeStates = new Map<string, AgentRuntimeState>();
const conversationAgentStates = new Map<string, ConversationAgentState>();

function resolveDataDir(): string {
  const userDataDir = resolveUserDataDir();
  const dir = join(userDataDir, DATA_DIRNAME);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveMigrationsFolder(): string {
  const sourceCandidates = [
    join(__dirname, "..", "..", "drizzle"),
    join(__dirname, "..", "..", "..", "drizzle"),
  ];
  if (process.env.AYAKA_DEV === "1") {
    return sourceCandidates.find((candidate) => existsSync(candidate)) ?? sourceCandidates[0]!;
  }
  const packaged = join(process.resourcesPath ?? "", "drizzle");
  return existsSync(packaged)
    ? packaged
    : (sourceCandidates.find((candidate) => existsSync(candidate)) ?? packaged);
}

export interface DbInitOptions {
  readOnly?: boolean;
  migrate?: boolean;
  seed?: boolean;
  dbPath?: string;
  migrationsFolder?: string;
}

export function initDb(options: DbInitOptions = {}): DbInstance {
  if (dbInstance) return dbInstance;

  const dbPath = options.dbPath ?? join(resolveDataDir(), DB_FILENAME);
  return openAndMigrateDb(dbPath, options);
}

export function resolveDbPath(): string {
  return join(resolveDataDir(), DB_FILENAME);
}

export function resolveMigrationsPath(): string {
  return resolveMigrationsFolder();
}

function openAndMigrateDb(dbPath: string, options: DbInitOptions): DbInstance {
  const parentDir = dirname(dbPath);
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
  rawDb = new Database(
    dbPath,
    options.readOnly ? { readonly: true, fileMustExist: true } : undefined,
  );
  if (!options.readOnly) rawDb.pragma("journal_mode = WAL");
  rawDb.pragma("foreign_keys = ON");
  rawDb.pragma("busy_timeout = 5000");
  if (options.readOnly) rawDb.pragma("query_only = ON");

  dbInstance = drizzle(rawDb, { schema });
  try {
    if (!options.readOnly && options.migrate !== false) {
      migrate(dbInstance, {
        migrationsFolder: options.migrationsFolder ?? resolveMigrationsFolder(),
      });
    }
    if (!options.readOnly && options.seed !== false) {
      cancelStaleRuntimeRuns();
      void purgeExpiredDeletedConversations();
      seedDefaults();
    }
  } catch (error) {
    rawDb.close();
    rawDb = null;
    dbInstance = null;
    throw error;
  }
  return dbInstance;
}

function cancelStaleRuntimeRuns(): void {
  const now = Date.now();
  getDb().transaction((tx) => {
    const staleRunIds = tx
      .select({ id: runtimeRuns.id })
      .from(runtimeRuns)
      .where(inArray(runtimeRuns.status, ["queued", "running", "waiting_handoff"]))
      .all()
      .map((run) => run.id);

    tx.update(runtimeRuns)
      .set({
        status: "interrupted",
        finish_reason: "interrupted",
        finished_at: now,
        updated_at: now,
      })
      .where(inArray(runtimeRuns.status, ["queued", "running", "waiting_handoff"]))
      .run();
    if (staleRunIds.length > 0) {
      tx.update(runtimeSteps)
        .set({
          status: "interrupted",
          finished_at: now,
          error: "application_interrupted",
        })
        .where(
          and(
            inArray(runtimeSteps.run_id, staleRunIds),
            inArray(runtimeSteps.status, [
              "queued",
              "running",
              "waiting_approval",
              "waiting_handoff",
            ]),
          ),
        )
        .run();
    }
    tx.update(agentRunInputs)
      .set({
        status: "discarded",
        consumed_at: now,
        discarded_reason: "application_interrupted",
      })
      .where(eq(agentRunInputs.status, "queued"))
      .run();
  });
}

export function getDb(): DbInstance {
  if (!dbInstance) return initDb();
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (!isDbWriterWorker) {
    await flushDbWriter();
    await shutdownDbWriter();
  }
  rawDb?.close();
  rawDb = null;
  dbInstance = null;
  agentRuntimeStates.clear();
  conversationAgentStates.clear();
  apiKeyCache.clear();
  modelApiKeyCache.clear();
  writesThroughWorker = false;
}

export async function initDbWriter(options: DbInitOptions = {}): Promise<void> {
  if (isDbWriterWorker) return;
  const dbPath = options.dbPath ?? resolveDbPath();
  await startDbWriter({
    dbPath,
    migrationsFolder: options.migrationsFolder ?? resolveMigrationsPath(),
  });
  writesThroughWorker = true;
  initDb({ dbPath, readOnly: true, migrate: false, seed: false });
}

function shouldRouteWrites(): boolean {
  return writesThroughWorker && !isDbWriterWorker;
}

export function isDbWriterEnabled(): boolean {
  return writesThroughWorker;
}

export async function createConversation(
  id: string,
  title = "New conversation",
): Promise<Conversation> {
  if (shouldRouteWrites()) return writeDb<Conversation>("createConversation", [id, title]);
  const now = Date.now();
  const row: Conversation = {
    id,
    title,
    created_at: now,
    updated_at: now,
    message_revision: 0,
    deleted_at: null,
    purge_after_at: null,
  };
  getDb().insert(conversations).values(row).run();
  return row;
}

export async function createRealtimeSession(input: {
  id: string;
  providerId: string;
  modelId: string;
  title?: string;
}): Promise<RealtimeSessionRow> {
  if (shouldRouteWrites()) return writeDb<RealtimeSessionRow>("createRealtimeSession", [input]);
  const now = Date.now();
  const row: RealtimeSessionRow = {
    id: input.id,
    title: input.title?.trim() || "New chat",
    provider_id: input.providerId,
    model_id: input.modelId,
    transcript_json: "[]",
    created_at: now,
    updated_at: now,
  };
  getDb().insert(realtimeSessions).values(row).run();
  return row;
}

export function listRealtimeSessions(): RealtimeSessionRecord[] {
  return getDb()
    .select()
    .from(realtimeSessions)
    .orderBy(desc(realtimeSessions.updated_at))
    .all()
    .map(dbRealtimeSessionToShared);
}

export function getRealtimeSession(id: string): RealtimeSessionRecord | null {
  const row = getDb().select().from(realtimeSessions).where(eq(realtimeSessions.id, id)).get();
  return row ? dbRealtimeSessionToShared(row) : null;
}

export async function saveRealtimeSessionTranscript(
  id: string,
  messages: RealtimeSessionMessage[],
  title?: string,
): Promise<RealtimeSessionRow | null> {
  if (shouldRouteWrites())
    return writeDb<RealtimeSessionRow | null>("saveRealtimeSessionTranscript", [
      id,
      messages,
      title,
    ]);
  const existing = getDb().select().from(realtimeSessions).where(eq(realtimeSessions.id, id)).get();
  if (!existing) return null;
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && message.text.trim(),
  );
  const nextTitle = title?.trim() || firstUserMessage?.text.trim().slice(0, 72) || existing.title;
  const updatedAt = Date.now();
  getDb()
    .update(realtimeSessions)
    .set({
      title: nextTitle,
      transcript_json: JSON.stringify(messages),
      updated_at: updatedAt,
    })
    .where(eq(realtimeSessions.id, id))
    .run();
  return getDb().select().from(realtimeSessions).where(eq(realtimeSessions.id, id)).get() ?? null;
}

export async function deleteRealtimeSession(id: string): Promise<boolean> {
  if (shouldRouteWrites()) return writeDb<boolean>("deleteRealtimeSession", [id]);
  return getDb().delete(realtimeSessions).where(eq(realtimeSessions.id, id)).run().changes > 0;
}

function dbRealtimeSessionToShared(row: RealtimeSessionRow): RealtimeSessionRecord {
  let messages: RealtimeSessionMessage[] = [];
  try {
    const parsed = JSON.parse(row.transcript_json) as unknown;
    if (Array.isArray(parsed)) {
      messages = parsed.filter(
        (message): message is RealtimeSessionMessage =>
          message !== null &&
          typeof message === "object" &&
          typeof (message as RealtimeSessionMessage).id === "string" &&
          ((message as RealtimeSessionMessage).role === "user" ||
            (message as RealtimeSessionMessage).role === "assistant") &&
          typeof (message as RealtimeSessionMessage).text === "string" &&
          typeof (message as RealtimeSessionMessage).createdAt === "number",
      );
    }
  } catch {
    messages = [];
  }
  return {
    id: row.id,
    title: row.title,
    providerId: row.provider_id,
    modelId: row.model_id,
    messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listConversations(): Conversation[] {
  return getDb()
    .select()
    .from(conversations)
    .where(isNull(conversations.deleted_at))
    .orderBy(desc(conversations.updated_at))
    .all();
}

export function listDeletedConversations(): Conversation[] {
  return getDb()
    .select()
    .from(conversations)
    .where(isNotNull(conversations.deleted_at))
    .orderBy(desc(conversations.deleted_at))
    .all();
}

export function getConversation(id: string): Conversation | null {
  return getDb().select().from(conversations).where(eq(conversations.id, id)).get() ?? null;
}

export function getConversationHydrationSnapshot(id: string): {
  conversation: Conversation;
  messages: MessageSnapshot;
  workspace: ConversationWorkspace | null;
} | null {
  return getDb().transaction((tx) => {
    const conversation = tx.select().from(conversations).where(eq(conversations.id, id)).get();
    if (!conversation) return null;

    const messageRows = tx
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, id))
      .orderBy(messages.created_at)
      .all()
      .map(dbMessageToShared);
    const workspace =
      tx
        .select()
        .from(conversationWorkspaces)
        .where(eq(conversationWorkspaces.conversation_id, id))
        .get() ?? null;

    return {
      conversation,
      messages: { messages: messageRows, revision: conversation.message_revision },
      workspace,
    };
  });
}

export function listBrowserTabs(conversationId: string): DbBrowserTab[] {
  return getDb()
    .select()
    .from(browserTabs)
    .where(eq(browserTabs.conversation_id, conversationId))
    .orderBy(asc(browserTabs.position), asc(browserTabs.updated_at))
    .all();
}

export async function createBrowserTab(input: NewBrowserTab): Promise<DbBrowserTab> {
  if (shouldRouteWrites()) return writeDb<DbBrowserTab>("createBrowserTab", [input]);
  getDb().insert(browserTabs).values(input).run();
  const row = getDb().select().from(browserTabs).where(eq(browserTabs.id, input.id)).get();
  if (!row) throw new Error("Browser tab could not be created.");
  return row;
}

export async function updateBrowserTab(
  id: string,
  patch: Partial<Omit<DbBrowserTab, "id" | "conversation_id">>,
): Promise<DbBrowserTab> {
  if (shouldRouteWrites()) return writeDb<DbBrowserTab>("updateBrowserTab", [id, patch]);
  getDb()
    .update(browserTabs)
    .set({ ...patch, updated_at: patch.updated_at ?? Date.now() })
    .where(eq(browserTabs.id, id))
    .run();
  const row = getDb().select().from(browserTabs).where(eq(browserTabs.id, id)).get();
  if (!row) throw new Error("Browser tab was not found.");
  return row;
}

export async function setBrowserActiveTab(
  conversationId: string,
  tabId: string,
): Promise<DbBrowserTab> {
  if (shouldRouteWrites())
    return writeDb<DbBrowserTab>("setBrowserActiveTab", [conversationId, tabId]);
  const row = getDb()
    .select()
    .from(browserTabs)
    .where(and(eq(browserTabs.id, tabId), eq(browserTabs.conversation_id, conversationId)))
    .get();
  if (!row) throw new Error("Browser tab does not belong to this conversation.");
  getDb().transaction((tx) => {
    tx.update(browserTabs)
      .set({ active: 0, updated_at: Date.now() })
      .where(eq(browserTabs.conversation_id, conversationId))
      .run();
    tx.update(browserTabs)
      .set({ active: 1, updated_at: Date.now() })
      .where(eq(browserTabs.id, tabId))
      .run();
  });
  const updated = getDb().select().from(browserTabs).where(eq(browserTabs.id, tabId)).get();
  if (!updated) throw new Error("Browser tab was not found.");
  return updated;
}

export async function deleteBrowserTab(id: string, conversationId?: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteBrowserTab", [id, conversationId]);
  getDb()
    .delete(browserTabs)
    .where(
      conversationId
        ? and(eq(browserTabs.id, id), eq(browserTabs.conversation_id, conversationId))
        : eq(browserTabs.id, id),
    )
    .run();
}

export async function deleteBrowserTabsForConversation(conversationId: string): Promise<void> {
  if (shouldRouteWrites())
    return writeDb<void>("deleteBrowserTabsForConversation", [conversationId]);
  getDb().delete(browserTabs).where(eq(browserTabs.conversation_id, conversationId)).run();
}

export function getConversationWorkspace(conversationId: string): ConversationWorkspace | null {
  return (
    getDb()
      .select()
      .from(conversationWorkspaces)
      .where(eq(conversationWorkspaces.conversation_id, conversationId))
      .get() ?? null
  );
}

export async function createConversationWorkspace(
  input: NewConversationWorkspace,
): Promise<ConversationWorkspace> {
  if (shouldRouteWrites()) {
    return writeDb<ConversationWorkspace>("createConversationWorkspace", [input]);
  }
  getDb().insert(conversationWorkspaces).values(input).onConflictDoNothing().run();
  const row = getConversationWorkspace(input.conversation_id);
  if (!row) throw new Error("Conversation workspace could not be created.");
  return row;
}

export async function deleteConversationWorkspace(conversationId: string): Promise<void> {
  if (shouldRouteWrites()) {
    return writeDb<void>("deleteConversationWorkspace", [conversationId]);
  }
  getDb()
    .delete(conversationWorkspaces)
    .where(eq(conversationWorkspaces.conversation_id, conversationId))
    .run();
}

export async function setConversationWorkspaceStatus(
  conversationId: string,
  status: "active" | "orphaned",
): Promise<void> {
  if (shouldRouteWrites()) {
    return writeDb<void>("setConversationWorkspaceStatus", [conversationId, status]);
  }
  getDb()
    .update(conversationWorkspaces)
    .set({ status, updated_at: Date.now() })
    .where(eq(conversationWorkspaces.conversation_id, conversationId))
    .run();
}

export async function rollbackConversationPreparation(conversationId: string): Promise<void> {
  if (shouldRouteWrites()) {
    return writeDb<void>("rollbackConversationPreparation", [conversationId]);
  }
  getDb()
    .delete(conversationWorkspaces)
    .where(eq(conversationWorkspaces.conversation_id, conversationId))
    .run();
  getDb().delete(conversations).where(eq(conversations.id, conversationId)).run();
}

export function listConversationWorkspaces(): ConversationWorkspace[] {
  return getDb().select().from(conversationWorkspaces).all();
}

export async function touchConversation(id: string, title?: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("touchConversation", [id, title]);
  const patch: Partial<Conversation> = { updated_at: Date.now() };
  if (typeof title === "string" && title.trim()) patch.title = title.trim().slice(0, 160);
  getDb().update(conversations).set(patch).where(eq(conversations.id, id)).run();
}

export async function deleteConversation(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteConversation", [id]);
  const now = Date.now();
  getDb().transaction((tx) => {
    tx.update(conversations)
      .set({ deleted_at: now, purge_after_at: now + TRASH_RETENTION_MS, updated_at: now })
      .where(eq(conversations.id, id))
      .run();
    tx.update(conversationWorkspaces)
      .set({ status: "active", updated_at: now })
      .where(eq(conversationWorkspaces.conversation_id, id))
      .run();
  });
}

export async function restoreConversation(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("restoreConversation", [id]);
  const now = Date.now();
  getDb().transaction((tx) => {
    tx.update(conversations)
      .set({ deleted_at: null, purge_after_at: null, updated_at: now })
      .where(eq(conversations.id, id))
      .run();
    tx.update(conversationWorkspaces)
      .set({ status: "active", updated_at: now })
      .where(eq(conversationWorkspaces.conversation_id, id))
      .run();
  });
}

export async function permanentlyDeleteConversation(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("permanentlyDeleteConversation", [id]);
  getDb().transaction((tx) => {
    tx.delete(conversationWorkspaces).where(eq(conversationWorkspaces.conversation_id, id)).run();
    tx.delete(conversations).where(eq(conversations.id, id)).run();
  });
}

export async function permanentlyDeleteConversations(ids: string[]): Promise<number> {
  if (shouldRouteWrites()) return writeDb<number>("permanentlyDeleteConversations", [ids]);
  let deleted = 0;
  for (const id of ids) {
    const result = getDb().transaction((tx) => {
      tx.delete(conversationWorkspaces).where(eq(conversationWorkspaces.conversation_id, id)).run();
      return tx.delete(conversations).where(eq(conversations.id, id)).run();
    });
    deleted += result.changes;
  }
  return deleted;
}

export async function purgeExpiredDeletedConversations(now = Date.now()): Promise<number> {
  if (shouldRouteWrites()) return writeDb<number>("purgeExpiredDeletedConversations", [now]);
  const expired = getDb()
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(isNotNull(conversations.purge_after_at), lt(conversations.purge_after_at, now)))
    .all();
  if (expired.length === 0) return 0;
  const ids = expired.map((conversation) => conversation.id);
  return getDb().transaction((tx) => {
    tx.delete(conversationWorkspaces)
      .where(inArray(conversationWorkspaces.conversation_id, ids))
      .run();
    return tx.delete(conversations).where(inArray(conversations.id, ids)).run().changes;
  });
}

export async function saveMessage(msg: MessageRow): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("saveMessage", [msg]);
  saveMessageStore(getDb(), msg);
}

export async function saveMessagesBatch(rows: MessageRow[]): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("saveMessagesBatch", [rows]);
  saveMessagesBatchStore(getDb(), rows);
}

export async function applyMessagesPatch(patch: MessagePatch): Promise<MessagePatchResult> {
  if (shouldRouteWrites()) return writeDb<MessagePatchResult>("applyMessagesPatch", [patch]);
  return applyMessagesPatchStore(getDb(), patch);
}

export function listMessages(conversationId: string): MessageRow[] {
  return listMessagesStore(getDb(), conversationId);
}

export function getMessagesSnapshot(conversationId: string): MessageSnapshot {
  return getMessagesSnapshotStore(getDb(), conversationId);
}

export function getSetting(key: string): string | null {
  return getDb().select().from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function getSettings(keys: string[]): Record<string, string | null> {
  if (keys.length === 0) return {};
  const rows = getDb()
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...new Set(keys)]))
    .all();
  const values = new Map(rows.map((row) => [row.key, row.value] as const));
  return Object.fromEntries(keys.map((key) => [key, values.get(key) ?? null]));
}

export async function setSetting(key: string, value: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("setSetting", [key, value]);
  getDb()
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

export async function setSettings(entries: SettingEntry[]): Promise<void> {
  if (entries.length === 0) return;
  if (shouldRouteWrites()) return writeDb<void>("setSettings", [entries]);

  getDb().transaction((tx) => {
    for (const entry of entries) {
      if (!entry || typeof entry.key !== "string" || typeof entry.value !== "string") {
        throw new Error("Invalid settings batch.");
      }
      tx.insert(settings)
        .values(entry)
        .onConflictDoUpdate({ target: settings.key, set: { value: entry.value } })
        .run();
    }
  });
}

export async function setApiKey(provider: string, apiKey: string): Promise<void> {
  apiKeyCache.delete(provider);
  if (shouldRouteWrites()) return writeDb<void>("setApiKey", [provider, apiKey]);
  const payload = encrypt(apiKey);
  getDb()
    .insert(apiKeys)
    .values({ provider, ciphertext: JSON.stringify(payload), updated_at: Date.now() })
    .onConflictDoUpdate({
      target: apiKeys.provider,
      set: { ciphertext: JSON.stringify(payload), updated_at: Date.now() },
    })
    .run();
}

export function getApiKey(provider: string): string | null {
  const row = getDb().select().from(apiKeys).where(eq(apiKeys.provider, provider)).get();
  if (!row) {
    apiKeyCache.delete(provider);
    return null;
  }
  const cached = apiKeyCache.get(provider);
  if (cached?.ciphertext === row.ciphertext) return cached.value;

  let value: string | null = null;
  try {
    value = decrypt(JSON.parse(row.ciphertext) as EncryptedPayload);
  } catch {
    value = null;
  }
  apiKeyCache.set(provider, { ciphertext: row.ciphertext, value });
  return value;
}

export async function deleteApiKey(provider: string): Promise<void> {
  apiKeyCache.delete(provider);
  if (shouldRouteWrites()) return writeDb<void>("deleteApiKey", [provider]);
  getDb().delete(apiKeys).where(eq(apiKeys.provider, provider)).run();
}

export function listApiKeyProviders(): string[] {
  return getDb()
    .select()
    .from(apiKeys)
    .all()
    .map((row) => row.provider);
}

export async function setModelApiKey(
  providerId: string,
  modelId: string,
  apiKey: string,
): Promise<void> {
  const cacheKey = providerId + "\u0000" + modelId;
  modelApiKeyCache.delete(cacheKey);
  if (shouldRouteWrites()) return writeDb<void>("setModelApiKey", [providerId, modelId, apiKey]);
  const payload = encrypt(apiKey);
  const row = {
    provider_id: providerId,
    model_id: modelId,
    ciphertext: JSON.stringify(payload),
    updated_at: Date.now(),
  };
  getDb()
    .insert(modelApiKeys)
    .values(row)
    .onConflictDoUpdate({
      target: [modelApiKeys.provider_id, modelApiKeys.model_id],
      set: { ciphertext: row.ciphertext, updated_at: row.updated_at },
    })
    .run();
}

export function getModelApiKey(providerId: string, modelId: string): string | null {
  const cacheKey = providerId + "\u0000" + modelId;
  const row = getDb()
    .select()
    .from(modelApiKeys)
    .where(and(eq(modelApiKeys.provider_id, providerId), eq(modelApiKeys.model_id, modelId)))
    .get();
  if (!row) {
    modelApiKeyCache.delete(cacheKey);
    return null;
  }
  const cached = modelApiKeyCache.get(cacheKey);
  if (cached?.ciphertext === row.ciphertext) return cached.value;

  let value: string | null = null;
  try {
    value = decrypt(JSON.parse(row.ciphertext) as EncryptedPayload);
  } catch {
    value = null;
  }
  modelApiKeyCache.set(cacheKey, { ciphertext: row.ciphertext, value });
  return value;
}

export async function deleteModelApiKey(providerId: string, modelId: string): Promise<void> {
  modelApiKeyCache.delete(providerId + "\u0000" + modelId);
  if (shouldRouteWrites()) return writeDb<void>("deleteModelApiKey", [providerId, modelId]);
  getDb()
    .delete(modelApiKeys)
    .where(and(eq(modelApiKeys.provider_id, providerId), eq(modelApiKeys.model_id, modelId)))
    .run();
}

export async function deleteModelApiKeysForProvider(providerId: string): Promise<void> {
  const prefix = providerId + "\u0000";
  for (const key of modelApiKeyCache.keys()) {
    if (key.startsWith(prefix)) modelApiKeyCache.delete(key);
  }
  if (shouldRouteWrites()) return writeDb<void>("deleteModelApiKeysForProvider", [providerId]);
  getDb().delete(modelApiKeys).where(eq(modelApiKeys.provider_id, providerId)).run();
}

export function listModelApiKeyRefs(): string[] {
  return getDb()
    .select()
    .from(modelApiKeys)
    .all()
    .map((row) => `${row.provider_id}/${row.model_id}`);
}

export function listAgents(): AgentProfile[] {
  return getDb().select().from(agents).orderBy(agents.kind, agents.name).all().map(toAgentProfile);
}

export function getAgent(id: string): AgentProfile | null {
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get();
  return row ? toAgentProfile(row) : null;
}

export async function createAgent(input: AgentInput): Promise<AgentProfile> {
  if (shouldRouteWrites()) return writeDb<AgentProfile>("createAgent", [input]);
  const now = Date.now();
  const normalized = normalizeAgentInput(randomUUID(), input, null, now);
  getDb().insert(agents).values(normalized.agent).run();
  getDb().insert(agentPolicies).values(normalized.policy).run();
  upsertAgentRuntimeState({ agent_id: normalized.agent.id, status: "idle" });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent created",
    status: "succeeded",
    agent_id: normalized.agent.id,
    detail: { agentId: normalized.agent.id, role: normalized.agent.role },
  });
  return toAgentProfile(normalized.agent);
}

export async function updateAgent(id: string, input: Partial<AgentInput>): Promise<AgentProfile> {
  if (shouldRouteWrites()) return writeDb<AgentProfile>("updateAgent", [id, input]);
  const existing = getRequiredAgentRow(id);
  assertAgentEditable(existing);
  const now = Date.now();
  const normalized = normalizeAgentInput(id, input, existing, now);
  getDb().update(agents).set(normalized.agent).where(eq(agents.id, id)).run();
  getDb()
    .insert(agentPolicies)
    .values(normalized.policy)
    .onConflictDoUpdate({
      target: agentPolicies.agent_id,
      set: {
        tool_policy_json: normalized.policy.tool_policy_json,
        review_policy_json: normalized.policy.review_policy_json,
        sandbox_policy_json: normalized.policy.sandbox_policy_json,
        routing_policy_json: normalized.policy.routing_policy_json,
        updated_at: normalized.policy.updated_at,
      },
    })
    .run();
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent updated",
    status: "succeeded",
    agent_id: id,
    detail: { agentId: id },
  });
  return getAgent(id)!;
}

export async function saveAgent(agent: AgentProfile): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("saveAgent", [agent]);
  const existing = getDb().select().from(agents).where(eq(agents.id, agent.id)).get() ?? null;
  if (existing) assertAgentEditable(existing);
  const now = Date.now();
  const normalized = normalizeAgentInput(agent.id, agent, existing, now);
  getDb()
    .insert(agents)
    .values(normalized.agent)
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        name: normalized.agent.name,
        role: normalized.agent.role,
        instructions: normalized.agent.instructions,
        persona: normalized.agent.persona,
        description: normalized.agent.description,
        avatar: normalized.agent.avatar,
        status: normalized.agent.status,
        kind: normalized.agent.kind,
        parent_agent_id: normalized.agent.parent_agent_id,
        locked: normalized.agent.locked,
        enabled: normalized.agent.enabled,
        model_ref: normalized.agent.model_ref,
        voice: normalized.agent.voice,
        updated_at: normalized.agent.updated_at,
      },
    })
    .run();
  getDb()
    .insert(agentPolicies)
    .values(normalized.policy)
    .onConflictDoUpdate({
      target: agentPolicies.agent_id,
      set: {
        tool_policy_json: normalized.policy.tool_policy_json,
        review_policy_json: normalized.policy.review_policy_json,
        sandbox_policy_json: normalized.policy.sandbox_policy_json,
        routing_policy_json: normalized.policy.routing_policy_json,
        updated_at: normalized.policy.updated_at,
      },
    })
    .run();
  upsertAgentRuntimeState({ agent_id: agent.id, status: "idle" });
}

export async function archiveAgent(id: string): Promise<AgentProfile> {
  if (shouldRouteWrites()) return writeDb<AgentProfile>("archiveAgent", [id]);
  const existing = getRequiredAgentRow(id);
  assertAgentEditable(existing);
  assertAgentNotBusy(id);
  getDb()
    .update(agents)
    .set({ status: "archived", enabled: 0, updated_at: Date.now() })
    .where(eq(agents.id, id))
    .run();
  upsertAgentRuntimeState({ agent_id: id, status: "idle", current_run_id: null });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent archived",
    status: "succeeded",
    agent_id: id,
  });
  return getAgent(id)!;
}

export async function restoreAgent(id: string): Promise<AgentProfile> {
  if (shouldRouteWrites()) return writeDb<AgentProfile>("restoreAgent", [id]);
  const existing = getRequiredAgentRow(id);
  assertAgentEditable(existing);
  if (existing.status !== "archived") {
    throw new Error("Only archived agents can be restored.");
  }
  getDb()
    .update(agents)
    .set({ status: "draft", enabled: 0, updated_at: Date.now() })
    .where(eq(agents.id, id))
    .run();
  upsertAgentRuntimeState({ agent_id: id, status: "idle", current_run_id: null });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent restored",
    status: "succeeded",
    agent_id: id,
  });
  return getAgent(id)!;
}

/** 永久删除智能体：硬删除 agents 表行；不允许删除 root/locked agent。 */
export async function deleteAgent(id: string): Promise<void> {
  if (shouldRouteWrites()) {
    await writeDb<void>("deleteAgentRecord", [id]);
  } else {
    deleteAgentRecord(id);
  }
  agentRuntimeStates.delete(id);

  try {
    removeAgentSoulFiles(id);
  } catch (error) {
    try {
      insertRuntimeEvent({
        kind: "diagnostic",
        title: "Agent soul file cleanup failed",
        status: "failed",
        detail: { agentId: id, error: formatAgentDeletionError(error) },
      });
    } catch {
      // Preserve the filesystem error when diagnostic persistence is unavailable.
    }
    throw error;
  }
}

/** Delete only the database-owned records for an agent; the caller owns file cleanup. */
export function deleteAgentRecord(id: string): void {
  const existing = getRequiredAgentRow(id);
  assertAgentEditable(existing);
  if (existing.kind === "main") throw new Error("Root agent cannot be deleted.");
  assertAgentNotBusy(id);
  const deletionEvent: NewRuntimeEvent = {
    id: randomUUID(),
    run_id: null,
    step_id: null,
    conversation_id: null,
    agent_id: id,
    tool_id: null,
    owner_type: null,
    owner_id: null,
    kind: "diagnostic",
    title: "Agent permanently deleted",
    status: "succeeded",
    severity: "info",
    detail_json: JSON.stringify(redactDetail({ agentId: id, name: existing.name })),
    duration_ms: null,
    event_type: null,
    agent_path: null,
    parent_agent_path: null,
    sequence: null,
    created_at: Date.now(),
  };

  getDb().transaction((tx) => {
    tx.insert(runtimeEvents).values(deletionEvent).run();
    tx.delete(agentPolicies).where(eq(agentPolicies.agent_id, id)).run();
    tx.delete(agents).where(eq(agents.id, id)).run();
  });
}

function formatAgentDeletionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown agent soul file cleanup error.";
  }
}

export async function duplicateAgent(id: string): Promise<AgentProfile> {
  if (shouldRouteWrites()) return writeDb<AgentProfile>("duplicateAgent", [id]);
  const existing = getAgent(id);
  if (!existing) throw new Error("Agent not found.");
  const copy = await createAgent({
    ...existing,
    name: existing.name + " Copy",
    status: "draft",
    enabled: 0,
  });
  insertRuntimeEvent({
    kind: "diagnostic",
    title: "Agent duplicated",
    status: "succeeded",
    agent_id: copy.id,
    detail: { sourceAgentId: id, agentId: copy.id },
  });
  return copy;
}

export function listRuntimeRuns(limit = 50): RuntimeRun[] {
  return getDb()
    .select()
    .from(runtimeRuns)
    .orderBy(desc(runtimeRuns.started_at))
    .limit(limit)
    .all()
    .map(toRuntimeRun);
}

export function listRuntimeRunsForConversation(conversationId: string, limit = 20): RuntimeRun[] {
  return getDb()
    .select()
    .from(runtimeRuns)
    .where(eq(runtimeRuns.conversation_id, conversationId))
    .orderBy(desc(runtimeRuns.started_at))
    .limit(Math.max(1, Math.min(50, limit)))
    .all()
    .map(toRuntimeRun);
}

export function getRuntimeRunForConversation(
  conversationId: string,
  runId: string,
): RuntimeRun | null {
  const row = getDb()
    .select()
    .from(runtimeRuns)
    .where(and(eq(runtimeRuns.id, runId), eq(runtimeRuns.conversation_id, conversationId)))
    .get();
  return row ? toRuntimeRun(row) : null;
}

export function listRunningConversationIds(): string[] {
  return getDb()
    .select({ conversationId: runtimeRuns.conversation_id })
    .from(runtimeRuns)
    .where(
      and(
        inArray(runtimeRuns.status, ["queued", "running", "waiting_approval", "waiting_handoff"]),
        isNotNull(runtimeRuns.conversation_id),
      ),
    )
    .all()
    .flatMap(({ conversationId }) => (conversationId ? [conversationId] : []));
}

export function getRuntimeRun(id: string): RuntimeRun | null {
  const row = getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).get();
  return row ? toRuntimeRun(row) : null;
}

export async function createRuntimeRun(input: {
  id?: string;
  conversation_id?: string | null;
  root_agent_id?: string | null;
  final_agent_id?: string | null;
  origin?: RuntimeRun["origin"];
  finish_reason?: RuntimeRun["finish_reason"];
  status: RuntimeStatus;
  model_ref?: string | null;
  trace_id?: string | null;
  input_summary?: string | null;
  output_summary?: string | null;
  error?: string | null;
  usage_json?: string | null;
  metadata_json?: string;
  started_at?: number;
  finished_at?: number | null;
}): Promise<RuntimeRun> {
  if (shouldRouteWrites()) return writeDb<RuntimeRun>("createRuntimeRun", [input]);
  const now = Date.now();
  const row: NewRuntimeRun = {
    id: input.id ?? randomUUID(),
    conversation_id: input.conversation_id ?? null,
    root_agent_id: input.root_agent_id ?? null,
    final_agent_id: input.final_agent_id ?? null,
    origin: input.origin ?? "chat",
    finish_reason: input.finish_reason ?? null,
    status: input.status,
    model_ref: input.model_ref ?? null,
    trace_id: input.trace_id ?? null,
    input_summary: input.input_summary ?? null,
    output_summary: input.output_summary ?? null,
    error: input.error ?? null,
    usage_json: input.usage_json ?? null,
    metadata_json: input.metadata_json ?? "{}",
    started_at: input.started_at ?? now,
    finished_at: input.finished_at ?? null,
    updated_at: now,
  };
  getDb().insert(runtimeRuns).values(row).run();
  return toRuntimeRun(row as DbRuntimeRun);
}

export async function cancelActiveRuntimeRunsForConversation(
  conversationId: string,
): Promise<number> {
  if (shouldRouteWrites())
    return writeDb<number>("cancelActiveRuntimeRunsForConversation", [conversationId]);
  const now = Date.now();
  const result = getDb()
    .update(runtimeRuns)
    .set({
      status: "cancelled",
      finish_reason: "cancelled",
      finished_at: now,
      updated_at: now,
    })
    .where(
      and(
        eq(runtimeRuns.conversation_id, conversationId),
        inArray(runtimeRuns.status, ["queued", "running", "waiting_approval", "waiting_handoff"]),
      ),
    )
    .run();
  return result.changes;
}

export async function updateRuntimeRun(
  id: string,
  patch: Partial<Omit<RuntimeRun, "id" | "started_at">>,
): Promise<RuntimeRun | null> {
  if (shouldRouteWrites()) return writeDb<RuntimeRun | null>("updateRuntimeRun", [id, patch]);
  const existing = getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).get();
  if (!existing) return null;
  getDb()
    .update(runtimeRuns)
    .set({
      final_agent_id: patch.final_agent_id ?? existing.final_agent_id,
      origin: patch.origin ?? existing.origin,
      finish_reason:
        patch.finish_reason === undefined ? existing.finish_reason : patch.finish_reason,
      status: (patch.status as RuntimeStatus | undefined) ?? existing.status,
      model_ref: patch.model_ref ?? existing.model_ref,
      finished_at: patch.finished_at === undefined ? existing.finished_at : patch.finished_at,
      trace_id: patch.trace_id === undefined ? existing.trace_id : patch.trace_id,
      input_summary:
        patch.input_summary === undefined ? existing.input_summary : patch.input_summary,
      output_summary:
        patch.output_summary === undefined ? existing.output_summary : patch.output_summary,
      error: patch.error === undefined ? existing.error : patch.error,
      usage_json: patch.usage_json === undefined ? existing.usage_json : patch.usage_json,
      metadata_json:
        patch.metadata_json === undefined ? existing.metadata_json : patch.metadata_json,
      updated_at: Date.now(),
    })
    .where(eq(runtimeRuns.id, id))
    .run();
  const row = getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).get();
  return row ? toRuntimeRun(row) : null;
}

export async function patchRuntimeRunMetadata(
  id: string,
  patch: Record<string, unknown>,
): Promise<RuntimeRun | null> {
  if (shouldRouteWrites())
    return writeDb<RuntimeRun | null>("patchRuntimeRunMetadata", [id, patch]);
  const existing = getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).get();
  if (!existing) return null;
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(existing.metadata_json) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    metadata = {};
  }
  getDb()
    .update(runtimeRuns)
    .set({
      metadata_json: JSON.stringify({ ...metadata, ...patch }),
      updated_at: Date.now(),
    })
    .where(eq(runtimeRuns.id, id))
    .run();
  const row = getDb().select().from(runtimeRuns).where(eq(runtimeRuns.id, id)).get();
  return row ? toRuntimeRun(row) : null;
}

export function listAgentRunInputs(runId?: string, limit = 500): AgentRunInput[] {
  const query = getDb()
    .select()
    .from(agentRunInputs)
    .where(runId ? eq(agentRunInputs.run_id, runId) : undefined)
    .orderBy(asc(agentRunInputs.sequence))
    .limit(Math.max(1, Math.min(2_000, limit)));
  return query.all().map(toAgentRunInput);
}

export async function enqueueAgentRunInput(input: {
  runId: string;
  kind: AgentRunInputKind;
  source: AgentRunInputSource;
  message: unknown;
  id?: string;
  createdAt?: number;
}): Promise<AgentRunInput> {
  if (shouldRouteWrites()) return writeDb<AgentRunInput>("enqueueAgentRunInput", [input]);
  return getDb().transaction((tx) => {
    const latest = tx
      .select({ sequence: agentRunInputs.sequence })
      .from(agentRunInputs)
      .where(eq(agentRunInputs.run_id, input.runId))
      .orderBy(desc(agentRunInputs.sequence))
      .limit(1)
      .get();
    const row: NewAgentRunInput = {
      id: input.id ?? randomUUID(),
      run_id: input.runId,
      kind: input.kind,
      source: input.source,
      status: "queued",
      message_json: JSON.stringify(input.message),
      sequence: (latest?.sequence ?? 0) + 1,
      created_at: input.createdAt ?? Date.now(),
      consumed_at: null,
      discarded_reason: null,
    };
    tx.insert(agentRunInputs).values(row).run();
    return toAgentRunInput(row as DbAgentRunInput);
  });
}

export async function consumeAgentRunInputs(
  runId: string,
  kind: AgentRunInputKind,
  now = Date.now(),
): Promise<AgentRunInput[]> {
  if (shouldRouteWrites())
    return writeDb<AgentRunInput[]>("consumeAgentRunInputs", [runId, kind, now]);
  return getDb().transaction((tx) => {
    const rows = tx
      .select()
      .from(agentRunInputs)
      .where(and(eq(agentRunInputs.run_id, runId), eq(agentRunInputs.status, "queued")))
      .orderBy(asc(agentRunInputs.sequence))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row || row.kind !== kind) return [];
    tx.update(agentRunInputs)
      .set({ status: "consumed", consumed_at: now })
      .where(and(eq(agentRunInputs.id, row.id), eq(agentRunInputs.status, "queued")))
      .run();
    return [toAgentRunInput({ ...row, status: "consumed", consumed_at: now })];
  });
}

/** Atomically consume the next queued input for a run, regardless of its kind. */
export async function consumeNextAgentRunInput(
  runId: string,
  expectedKind?: AgentRunInputKind,
  now = Date.now(),
): Promise<AgentRunInput | null> {
  if (shouldRouteWrites())
    return writeDb<AgentRunInput | null>("consumeNextAgentRunInput", [runId, expectedKind, now]);
  return getDb().transaction((tx) => {
    const rows = tx
      .select()
      .from(agentRunInputs)
      .where(and(eq(agentRunInputs.run_id, runId), eq(agentRunInputs.status, "queued")))
      .orderBy(asc(agentRunInputs.sequence))
      .limit(1)
      .all();
    const row = rows[0];
    if (!row || (expectedKind && row.kind !== expectedKind)) return null;
    tx.update(agentRunInputs)
      .set({ status: "consumed", consumed_at: now })
      .where(and(eq(agentRunInputs.id, row.id), eq(agentRunInputs.status, "queued")))
      .run();
    return toAgentRunInput({ ...row, status: "consumed", consumed_at: now });
  });
}

export async function discardQueuedAgentRunInput(
  runId: string,
  inputId: string,
  reason = "user_removed_from_queue",
  now = Date.now(),
): Promise<boolean> {
  if (shouldRouteWrites())
    return writeDb<boolean>("discardQueuedAgentRunInput", [runId, inputId, reason, now]);
  const result = getDb()
    .update(agentRunInputs)
    .set({ status: "discarded", consumed_at: now, discarded_reason: reason.slice(0, 240) })
    .where(
      and(
        eq(agentRunInputs.run_id, runId),
        eq(agentRunInputs.id, inputId),
        eq(agentRunInputs.status, "queued"),
      ),
    )
    .run();
  return result.changes > 0;
}

export async function discardAgentRunInputs(
  runId: string,
  reason: string,
  now = Date.now(),
): Promise<number> {
  if (shouldRouteWrites()) return writeDb<number>("discardAgentRunInputs", [runId, reason, now]);
  return getDb()
    .update(agentRunInputs)
    .set({ status: "discarded", consumed_at: now, discarded_reason: reason.slice(0, 240) })
    .where(and(eq(agentRunInputs.run_id, runId), eq(agentRunInputs.status, "queued")))
    .run().changes;
}

export function listRuntimeSteps(limit = 200): RuntimeStep[] {
  return getDb()
    .select()
    .from(runtimeSteps)
    .orderBy(desc(runtimeSteps.started_at))
    .limit(limit)
    .all()
    .map(toRuntimeStep);
}

export function listRuntimeStepsForRun(runId: string, limit = 100): RuntimeStep[] {
  return getDb()
    .select()
    .from(runtimeSteps)
    .where(eq(runtimeSteps.run_id, runId))
    .orderBy(desc(runtimeSteps.started_at))
    .limit(Math.max(1, Math.min(300, limit)))
    .all()
    .map(toRuntimeStep);
}

export async function createRuntimeStep(input: {
  id?: string;
  run_id: string;
  agent_id?: string | null;
  tool_id?: string | null;
  kind: string;
  status: RuntimeStatus;
  title: string;
  detail?: unknown;
  detail_json?: string;
  started_at?: number;
  finished_at?: number | null;
  error?: string | null;
}): Promise<RuntimeStep> {
  if (shouldRouteWrites()) return writeDb<RuntimeStep>("createRuntimeStep", [input]);
  const row: NewRuntimeStep = {
    id: input.id ?? randomUUID(),
    run_id: input.run_id,
    agent_id: input.agent_id ?? null,
    tool_id: input.tool_id ?? null,
    kind: normalizeRuntimeKind(input.kind),
    status: input.status,
    title: input.title,
    detail_json: input.detail_json ?? JSON.stringify(redactDetail(input.detail ?? {})),
    started_at: input.started_at ?? Date.now(),
    finished_at: input.finished_at ?? null,
    error: input.error ?? null,
  };
  getDb().insert(runtimeSteps).values(row).run();
  return toRuntimeStep(row as DbRuntimeStep);
}

export async function updateRuntimeStep(
  id: string,
  patch: Partial<Omit<RuntimeStep, "id" | "run_id" | "started_at">> & { detail?: unknown },
): Promise<RuntimeStep | null> {
  if (shouldRouteWrites()) return writeDb<RuntimeStep | null>("updateRuntimeStep", [id, patch]);
  const existing = getDb().select().from(runtimeSteps).where(eq(runtimeSteps.id, id)).get();
  if (!existing) return null;
  getDb()
    .update(runtimeSteps)
    .set({
      agent_id: patch.agent_id === undefined ? existing.agent_id : patch.agent_id,
      kind: patch.kind ? normalizeRuntimeKind(patch.kind) : existing.kind,
      status: (patch.status as RuntimeStatus | undefined) ?? existing.status,
      title: patch.title ?? existing.title,
      detail_json:
        patch.detail !== undefined
          ? JSON.stringify(redactDetail(patch.detail))
          : (patch.detail_json ?? existing.detail_json),
      finished_at: patch.finished_at === undefined ? existing.finished_at : patch.finished_at,
      error: patch.error === undefined ? existing.error : patch.error,
    })
    .where(eq(runtimeSteps.id, id))
    .run();
  const row = getDb().select().from(runtimeSteps).where(eq(runtimeSteps.id, id)).get();
  return row ? toRuntimeStep(row) : null;
}

export function listRuntimeEvents(limit = 500): RuntimeEvent[] {
  return getDb()
    .select()
    .from(runtimeEvents)
    .orderBy(desc(runtimeEvents.created_at))
    .limit(limit)
    .all()
    .map(toRuntimeEvent);
}

export function listRuntimeEventsForRun(runId: string, limit = 100): RuntimeEvent[] {
  return getDb()
    .select()
    .from(runtimeEvents)
    .where(eq(runtimeEvents.run_id, runId))
    .orderBy(desc(runtimeEvents.created_at))
    .limit(Math.max(1, Math.min(300, limit)))
    .all()
    .map(toRuntimeEvent);
}

export function insertRuntimeEvent(input: {
  id?: string;
  run_id?: string | null;
  runId?: string | null;
  step_id?: string | null;
  stepId?: string | null;
  conversation_id?: string | null;
  conversationId?: string | null;
  agent_id?: string | null;
  agentId?: string | null;
  tool_id?: string | null;
  toolId?: string | null;
  owner_type?: string | null;
  ownerType?: string | null;
  owner_id?: string | null;
  ownerId?: string | null;
  kind: string;
  status?: RuntimeStatus;
  severity?: RuntimeEvent["severity"];
  title: string;
  detail?: unknown;
  detail_json?: string;
  duration_ms?: number | null;
  durationMs?: number | null;
  event_type?: RuntimeEvent["event_type"];
  eventType?: RuntimeEvent["event_type"];
  agent_path?: string | null;
  agentPath?: string | null;
  parent_agent_path?: string | null;
  parentAgentPath?: string | null;
  sequence?: number | null;
  created_at?: number;
}): RuntimeEvent {
  const row: NewRuntimeEvent = {
    id: input.id ?? randomUUID(),
    run_id: input.run_id ?? input.runId ?? null,
    step_id: input.step_id ?? input.stepId ?? null,
    conversation_id: input.conversation_id ?? input.conversationId ?? null,
    agent_id: input.agent_id ?? input.agentId ?? null,
    tool_id: input.tool_id ?? input.toolId ?? null,
    owner_type: input.owner_type ?? input.ownerType ?? null,
    owner_id: input.owner_id ?? input.ownerId ?? null,
    kind: normalizeRuntimeKind(input.kind),
    status: input.status ?? "succeeded",
    severity: input.severity ?? (input.kind === "error" ? "error" : "info"),
    title: input.title,
    detail_json: input.detail_json ?? JSON.stringify(redactDetail(input.detail ?? {})),
    duration_ms: input.duration_ms ?? input.durationMs ?? null,
    event_type: input.event_type ?? input.eventType ?? null,
    agent_path: input.agent_path ?? input.agentPath ?? null,
    parent_agent_path: input.parent_agent_path ?? input.parentAgentPath ?? null,
    sequence: input.sequence ?? null,
    created_at: input.created_at ?? Date.now(),
  };
  if (row.status === "running" && row.severity !== "error") {
    if (isDbWriterWorker || !writesThroughWorker) getDb().insert(runtimeEvents).values(row).run();
    else enqueueLowPriorityRuntimeEvent(row);
  } else {
    if (isDbWriterWorker || !writesThroughWorker) getDb().insert(runtimeEvents).values(row).run();
    else void writeDb("insertRuntimeEvent", [input]);
  }
  return toRuntimeEvent(row as DbRuntimeEvent);
}

export async function flushDb(): Promise<void> {
  await flushDbWriter();
}

export async function saveAgentInstance(record: AgentInstanceRecord): Promise<AgentInstanceRecord> {
  if (shouldRouteWrites()) return writeDb<AgentInstanceRecord>("saveAgentInstance", [record]);
  getDb()
    .insert(agentInstances)
    .values(record)
    .onConflictDoUpdate({
      target: agentInstances.id,
      set: {
        status: record.status,
        task_summary: record.task_summary,
        turn_count: record.turn_count,
        last_message: record.last_message,
        error: record.error,
        started_at: record.started_at,
        finished_at: record.finished_at,
        updated_at: record.updated_at,
      },
    })
    .run();
  return record;
}

export function listAgentInstances(limit = 300): AgentInstanceRecord[] {
  return getDb()
    .select()
    .from(agentInstances)
    .orderBy(desc(agentInstances.updated_at))
    .limit(limit)
    .all()
    .map((row: DbAgentInstance) => row as AgentInstanceRecord);
}

export function listAgentInstancesForRun(runId: string, limit = 100): AgentInstanceRecord[] {
  return getDb()
    .select()
    .from(agentInstances)
    .where(eq(agentInstances.run_id, runId))
    .orderBy(desc(agentInstances.updated_at))
    .limit(Math.max(1, Math.min(300, limit)))
    .all()
    .map((row: DbAgentInstance) => row as AgentInstanceRecord);
}

export async function saveCollaborationMessage(
  message: AgentCollaborationMessage,
): Promise<AgentCollaborationMessage> {
  if (shouldRouteWrites())
    return writeDb<AgentCollaborationMessage>("saveCollaborationMessage", [message]);
  getDb()
    .insert(collaborationMessages)
    .values(message)
    .onConflictDoUpdate({
      target: collaborationMessages.id,
      set: { delivered_at: message.delivered_at, content: message.content },
    })
    .run();
  return message;
}

export function listCollaborationMessages(limit = 500): AgentCollaborationMessage[] {
  return getDb()
    .select()
    .from(collaborationMessages)
    .orderBy(desc(collaborationMessages.created_at))
    .limit(limit)
    .all()
    .map((row: DbCollaborationMessage) => row as AgentCollaborationMessage);
}

export async function createContextCheckpoint(
  checkpoint: AgentContextCheckpoint,
): Promise<AgentContextCheckpoint> {
  if (shouldRouteWrites())
    return writeDb<AgentContextCheckpoint>("createContextCheckpoint", [checkpoint]);
  getDb().insert(contextCheckpoints).values(checkpoint).run();
  return checkpoint;
}

export function listContextCheckpoints(limit = 200): AgentContextCheckpoint[] {
  return getDb()
    .select()
    .from(contextCheckpoints)
    .orderBy(desc(contextCheckpoints.created_at))
    .limit(limit)
    .all()
    .map((row: DbContextCheckpoint) => row as AgentContextCheckpoint);
}

export function listagentRuntimeStates(): AgentRuntimeState[] {
  ensureAllagentRuntimeStates();
  return [...agentRuntimeStates.values()].sort((a, b) => b.updated_at - a.updated_at);
}

export function upsertAgentRuntimeState(
  patch: Partial<AgentRuntimeState> & { agent_id: string; status?: AgentRuntimeStatus },
): AgentRuntimeState {
  const previous = agentRuntimeStates.get(patch.agent_id);
  const row: AgentRuntimeState = {
    agent_id: patch.agent_id,
    status: patch.status ?? previous?.status ?? "idle",
    current_run_id:
      patch.current_run_id === undefined
        ? (previous?.current_run_id ?? null)
        : patch.current_run_id,
    last_handoff_at:
      patch.last_handoff_at === undefined
        ? (previous?.last_handoff_at ?? null)
        : patch.last_handoff_at,
    last_tool_at:
      patch.last_tool_at === undefined ? (previous?.last_tool_at ?? null) : patch.last_tool_at,
    last_learning_at:
      patch.last_learning_at === undefined
        ? (previous?.last_learning_at ?? null)
        : patch.last_learning_at,
    last_error: patch.last_error === undefined ? (previous?.last_error ?? null) : patch.last_error,
    updated_at: Date.now(),
  };
  agentRuntimeStates.set(row.agent_id, row);
  return row;
}

export function listConversationAgentStates(): ConversationAgentState[] {
  return [...conversationAgentStates.values()].sort((a, b) => b.updated_at - a.updated_at);
}

export function getConversationAgentState(conversationId: string): ConversationAgentState | null {
  return conversationAgentStates.get(conversationId) ?? null;
}

export function upsertConversationAgentState(
  patch: Partial<ConversationAgentState> & { conversation_id: string },
): ConversationAgentState {
  const previous = conversationAgentStates.get(patch.conversation_id);
  const row: ConversationAgentState = {
    conversation_id: patch.conversation_id,
    active_agent_id:
      patch.active_agent_id === undefined
        ? (previous?.active_agent_id ?? null)
        : patch.active_agent_id,
    current_run_id:
      patch.current_run_id === undefined
        ? (previous?.current_run_id ?? null)
        : patch.current_run_id,
    current_step_id:
      patch.current_step_id === undefined
        ? (previous?.current_step_id ?? null)
        : patch.current_step_id,
    status: patch.status ?? previous?.status ?? "idle",
    summary: patch.summary === undefined ? (previous?.summary ?? null) : patch.summary,
    updated_at: Date.now(),
  };
  conversationAgentStates.set(row.conversation_id, row);
  return row;
}

export function runtimeSnapshot(): Pick<
  RuntimeSnapshot,
  | "runtimeRuns"
  | "agentRunInputs"
  | "runtimeSteps"
  | "agentRuntimeStates"
  | "conversationAgentStates"
  | "sandboxSessions"
  | "sandboxSnapshots"
  | "sandboxArtifacts"
  | "runtimeEvents"
  | "agentInstances"
  | "collaborationMessages"
  | "contextCheckpoints"
> {
  return buildAgentRuntimeSnapshot(createRuntimeSnapshotReaders());
}

export function getConversationRuntimeStatus(
  conversationId: string,
  options: RuntimeStatusOptions = {},
) {
  return buildRuntimeStatusSnapshot(createRuntimeStatusReaders(), conversationId, options);
}

function createRuntimeSnapshotReaders(): RuntimeSnapshotReaders {
  return {
    listRuntimeRuns,
    listRuntimeSteps,
    listAgentRuntimeStates: listagentRuntimeStates,
    listConversationAgentStates,
    listSandboxSessions: () => listSandboxSessions().map(toSandboxSessionView),
    listSandboxSnapshots,
    listSandboxArtifacts,
    listAgentRunInputs,
    listRuntimeEvents,
    listAgentInstances,
    listCollaborationMessages,
    listContextCheckpoints,
    listAgents,
    listMemories,
    listInteractionProfiles,
    getSyncState,
  };
}

function createRuntimeStatusReaders(): RuntimeStatusReaders {
  return {
    listRuntimeRunsForConversation,
    getRuntimeRunForConversation,
    listRuntimeStepsForRun,
    listAgentRunInputsForRun: (runId, limit) => listAgentRunInputs(runId, limit),
    listRuntimeEventsForRun,
    listAgentInstancesForRun,
    getConversationAgentState,
  };
}

export function listMemories(options?: {
  includeInactive?: boolean;
  limit?: number;
}): MemoryRecord[] {
  const query = getDb()
    .select()
    .from(memories)
    .where(options?.includeInactive ? undefined : eq(memories.status, "active"))
    .orderBy(desc(memories.pinned), desc(memories.salience), desc(memories.updated_at));
  return options?.limit && options.limit > 0 ? query.limit(options.limit).all() : query.all();
}

export async function saveMemory(
  memory: MemoryRecord,
  options?: { queueSync?: boolean },
): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("saveMemory", [memory, options]);
  const row = normalizeMemoryRecord(memory);
  if (options?.queueSync !== false) row.sync_status = "pending";
  getDb()
    .insert(memories)
    .values(row)
    .onConflictDoUpdate({
      target: memories.id,
      set: {
        scope: row.scope,
        kind: row.kind,
        title: row.title,
        content: row.content,
        agent_id: row.agent_id,
        conversation_id: row.conversation_id,
        source_run_id: row.source_run_id,
        salience: row.salience,
        pinned: row.pinned,
        confidence: row.confidence,
        origin: row.origin,
        status: row.status,
        evidence_json: row.evidence_json,
        last_used_at: row.last_used_at,
        expires_at: row.expires_at,
        supersedes_id: row.supersedes_id,
        mem0_id: row.mem0_id,
        sync_status: row.sync_status,
        strength: row.strength,
        last_reinforced_at: row.last_reinforced_at,
        updated_at: row.updated_at,
      },
    })
    .run();

  // 同步更新 Mem0 向量索引；失败不阻断主流程
  if (options?.queueSync !== false) {
    void queueMemoryJob({
      kind: "sync",
      agentId: row.agent_id,
      idempotencyKey: `memory:${row.id}:upsert`,
      payload: { action: "upsert", memoryId: row.id },
    });
  }
}

export async function deleteMemory(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteMemory", [id]);
  const existing = getMemoryById(id);
  getDb().delete(memories).where(eq(memories.id, id)).run();

  // 同步删除 Mem0 向量索引；失败不阻断主流程
  if (existing) {
    void queueMemoryJob({
      kind: "sync",
      agentId: existing.agent_id,
      idempotencyKey: `memory:${id}:delete`,
      payload: { action: "delete", memoryId: id, mem0Id: existing.mem0_id ?? null },
    });
  }
}

export function getMemoryById(id: string): MemoryRecord | null {
  return getDb().select().from(memories).where(eq(memories.id, id)).get() ?? null;
}

export function getMemoryByMem0Id(mem0Id: string): MemoryRecord | null {
  return getDb().select().from(memories).where(eq(memories.mem0_id, mem0Id)).get() ?? null;
}

export async function updateMemorySyncState(
  id: string,
  patch: { mem0Id?: string | null; status: "pending" | "synced" | "failed" },
): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("updateMemorySyncState", [id, patch]);
  getDb()
    .update(memories)
    .set({
      mem0_id: patch.mem0Id,
      sync_status: patch.status,
      updated_at: Date.now(),
    })
    .where(eq(memories.id, id))
    .run();
}

export function listMemoryObservations(options?: {
  status?: MemoryObservationStatus;
  limit?: number;
}): MemoryObservation[] {
  const query = getDb()
    .select()
    .from(memoryObservations)
    .where(options?.status ? eq(memoryObservations.status, options.status) : undefined)
    .orderBy(desc(memoryObservations.updated_at));
  return options?.limit && options.limit > 0 ? query.limit(options.limit).all() : query.all();
}

export async function saveMemoryObservation(input: {
  id?: string;
  dedupeKey: string;
  title: string;
  content: string;
  kind: MemoryKind;
  sourceConversationId?: string | null;
  sourceRunId?: string | null;
  sourceAgentId?: string | null;
  confidence: number;
  evidence?: unknown;
  expiresAt: number;
}): Promise<MemoryObservation> {
  if (shouldRouteWrites()) return writeDb<MemoryObservation>("saveMemoryObservation", [input]);
  const now = Date.now();
  const existing = getDb()
    .select()
    .from(memoryObservations)
    .where(
      and(
        eq(memoryObservations.dedupe_key, input.dedupeKey),
        eq(memoryObservations.status, "pending"),
      ),
    )
    .get();
  const evidence = normalizeJsonArrayText(JSON.stringify(input.evidence ?? []));
  if (existing) {
    const existingEvidence = parseJsonArray(existing.evidence_json);
    const incomingEvidence = parseJsonArray(evidence);
    const combinedEvidence = [...existingEvidence, ...incomingEvidence].slice(-20);
    const evidenceIds = new Set(
      combinedEvidence.map((item) => {
        if (!item || typeof item !== "object") return JSON.stringify(item);
        const value = item as Record<string, unknown>;
        if (typeof value.turnId === "string") return value.turnId;
        if (typeof value.conversationId === "string") return value.conversationId;
        return JSON.stringify(item);
      }),
    );
    const row = {
      confidence: Math.max(existing.confidence, clampNumber(input.confidence, 1, 100)),
      evidence_count: Math.max(existing.evidence_count, evidenceIds.size),
      evidence_json: JSON.stringify(combinedEvidence),
      expires_at: Math.max(existing.expires_at, input.expiresAt),
      updated_at: now,
    };
    getDb().update(memoryObservations).set(row).where(eq(memoryObservations.id, existing.id)).run();
    return getDb()
      .select()
      .from(memoryObservations)
      .where(eq(memoryObservations.id, existing.id))
      .get() as MemoryObservation;
  }

  const row: NewMemoryObservation = {
    id: input.id ?? randomUUID(),
    dedupe_key: input.dedupeKey,
    title: input.title.trim().slice(0, 120),
    content: input.content.trim().slice(0, 4_000),
    kind: input.kind,
    source_conversation_id: input.sourceConversationId ?? null,
    source_run_id: input.sourceRunId ?? null,
    source_agent_id: input.sourceAgentId ?? null,
    confidence: clampNumber(input.confidence, 1, 100),
    evidence_count: Math.max(
      1,
      new Set(parseJsonArray(evidence).map((item) => JSON.stringify(item))).size,
    ),
    evidence_json: evidence,
    status: "pending",
    expires_at: input.expiresAt,
    promoted_memory_id: null,
    created_at: now,
    updated_at: now,
  };
  getDb().insert(memoryObservations).values(row).run();
  return row as MemoryObservation;
}

export async function updateMemoryObservation(
  id: string,
  patch: Partial<
    Pick<MemoryObservation, "status" | "promoted_memory_id" | "confidence" | "expires_at">
  >,
): Promise<MemoryObservation | null> {
  if (shouldRouteWrites())
    return writeDb<MemoryObservation | null>("updateMemoryObservation", [id, patch]);
  getDb()
    .update(memoryObservations)
    .set({ ...patch, updated_at: Date.now() })
    .where(eq(memoryObservations.id, id))
    .run();
  return (
    getDb().select().from(memoryObservations).where(eq(memoryObservations.id, id)).get() ?? null
  );
}

export async function expireMemoryObservations(now = Date.now()): Promise<number> {
  if (shouldRouteWrites()) return writeDb<number>("expireMemoryObservations", [now]);
  return getDb()
    .update(memoryObservations)
    .set({ status: "expired", updated_at: now })
    .where(and(eq(memoryObservations.status, "pending"), lt(memoryObservations.expires_at, now)))
    .run().changes;
}

function parseJsonArray(raw: string): unknown[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function normalizeMemoryRecord(memory: MemoryRecord): MemoryRecord {
  const now = Date.now();
  return {
    id: memory.id || randomUUID(),
    scope: (memory.scope as string) === "agent" ? "agent" : "global",
    kind: memory.kind,
    title: memory.title,
    content: memory.content,
    agent_id: memory.agent_id ?? null,
    conversation_id: memory.conversation_id ?? null,
    source_run_id: memory.source_run_id ?? null,
    salience: clampNumber(memory.salience ?? 50, 1, 100),
    pinned: memory.pinned ? 1 : 0,
    confidence: clampNumber(memory.confidence ?? DEFAULT_MEMORY_CONFIDENCE, 1, 100),
    origin: memory.origin ?? DEFAULT_MEMORY_ORIGIN,
    status: memory.status ?? DEFAULT_MEMORY_STATUS,
    evidence_json: normalizeJsonArrayText(memory.evidence_json),
    last_used_at: memory.last_used_at ?? null,
    expires_at: memory.expires_at ?? null,
    supersedes_id: memory.supersedes_id ?? null,
    mem0_id: memory.mem0_id ?? null,
    sync_status: memory.sync_status ?? "pending",
    strength: clampNumber(memory.strength ?? memory.salience ?? 70, 1, 100),
    last_reinforced_at: memory.last_reinforced_at ?? null,
    created_at: memory.created_at ?? now,
    updated_at: now,
  };
}

function clampNumber(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.max(min, Math.min(max, Math.round(raw)));
}

function normalizeJsonArrayText(raw: string | undefined): string {
  if (!raw) return "[]";
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? JSON.stringify(parsed.slice(-20)) : "[]";
  } catch {
    return "[]";
  }
}

export async function markMemoriesUsed(ids: string[]): Promise<number> {
  if (shouldRouteWrites()) return writeDb<number>("markMemoriesUsed", [ids]);
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (uniqueIds.length === 0) return 0;
  const now = Date.now();
  let updated = 0;
  const db = getDb();
  db.transaction((tx) => {
    for (const id of uniqueIds) {
      const current = tx
        .select({ strength: memories.strength })
        .from(memories)
        .where(eq(memories.id, id))
        .get();
      const result = tx
        .update(memories)
        .set({
          last_used_at: now,
          strength: Math.min(100, (current?.strength ?? 70) + 1),
          last_reinforced_at: now,
          updated_at: now,
        })
        .where(eq(memories.id, id))
        .run();
      updated += result.changes;
    }
  });
  return updated;
}

export async function ensureBuiltinCatalogSources(
  sources: Array<typeof catalogSources.$inferInsert>,
  now: number,
): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("ensureBuiltinCatalogSources", [sources, now]);
  getDb().transaction((tx) => {
    for (const source of sources) {
      tx.insert(catalogSources)
        .values({ ...source, created_at: now, updated_at: now })
        .onConflictDoUpdate({
          target: catalogSources.id,
          set: {
            name: source.name,
            kind: source.kind,
            url: source.url,
            enabled: 1,
            builtin: 1,
            updated_at: now,
          },
        })
        .run();
    }
  });
}

export async function cacheCatalogItems(
  rows: Array<typeof catalogItems.$inferInsert>,
): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("cacheCatalogItems", [rows]);
  getDb().transaction((tx) => {
    for (const row of rows) {
      tx.insert(catalogItems)
        .values(row)
        .onConflictDoUpdate({
          target: catalogItems.id,
          set: { ...row, id: undefined, source_id: undefined, external_id: undefined },
        })
        .run();
    }
  });
}

export async function deleteCatalogItemsExcept(
  sourceId: string,
  externalIds: string[],
): Promise<void> {
  if (shouldRouteWrites())
    return writeDb<void>("deleteCatalogItemsExcept", [sourceId, externalIds]);
  const rows = getDb()
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(eq(catalogItems.source_id, sourceId))
    .all();
  const keep = new Set(externalIds);
  for (const row of rows) {
    const item = getDb()
      .select({ externalId: catalogItems.external_id })
      .from(catalogItems)
      .where(eq(catalogItems.id, row.id))
      .get();
    if (item && !keep.has(item.externalId)) {
      getDb().delete(catalogItems).where(eq(catalogItems.id, row.id)).run();
    }
  }
}

export async function updateCatalogSource(
  id: string,
  patch: Partial<typeof catalogSources.$inferInsert>,
): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("updateCatalogSource", [id, patch]);
  getDb().update(catalogSources).set(patch).where(eq(catalogSources.id, id)).run();
}

export async function deleteCatalogSource(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteCatalogSource", [id]);
  getDb().delete(catalogSources).where(eq(catalogSources.id, id)).run();
}

export async function upsertArtifactInstallation(
  row: typeof artifactInstallations.$inferInsert,
): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("upsertArtifactInstallation", [row]);
  getDb()
    .insert(artifactInstallations)
    .values(row)
    .onConflictDoUpdate({ target: artifactInstallations.id, set: { ...row, id: undefined } })
    .run();
}

export async function updateArtifactInstallation(
  id: string,
  patch: Partial<typeof artifactInstallations.$inferInsert>,
): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("updateArtifactInstallation", [id, patch]);
  getDb().update(artifactInstallations).set(patch).where(eq(artifactInstallations.id, id)).run();
}

export async function deleteArtifactInstallation(id: string): Promise<boolean> {
  if (shouldRouteWrites()) return writeDb<boolean>("deleteArtifactInstallation", [id]);
  return (
    getDb().delete(artifactInstallations).where(eq(artifactInstallations.id, id)).run().changes > 0
  );
}

export async function queueMemoryJob(input: {
  kind: MemoryJobKind;
  idempotencyKey?: string | null;
  conversationId?: string | null;
  agentId?: string | null;
  runId?: string | null;
  payload?: unknown;
  scheduledAt?: number;
}): Promise<MemoryJob> {
  if (shouldRouteWrites()) return writeDb<MemoryJob>("queueMemoryJob", [input]);
  const now = Date.now();
  const scheduledAt = input.scheduledAt ?? now;
  const payloadJson = JSON.stringify(input.payload ?? {});
  const existing = getDb()
    .select()
    .from(memoryJobs)
    .where(
      and(
        eq(memoryJobs.kind, input.kind),
        eq(memoryJobs.status, "queued"),
        input.idempotencyKey
          ? eq(memoryJobs.idempotency_key, input.idempotencyKey)
          : isNull(memoryJobs.idempotency_key),
        input.conversationId === undefined || input.conversationId === null
          ? isNull(memoryJobs.conversation_id)
          : eq(memoryJobs.conversation_id, input.conversationId),
        input.agentId === undefined || input.agentId === null
          ? isNull(memoryJobs.agent_id)
          : eq(memoryJobs.agent_id, input.agentId),
      ),
    )
    .orderBy(asc(memoryJobs.scheduled_at))
    .get();

  if (existing) {
    getDb()
      .update(memoryJobs)
      .set({
        run_id: input.runId ?? existing.run_id,
        payload_json: payloadJson,
        scheduled_at: Math.min(existing.scheduled_at, scheduledAt),
        updated_at: now,
      })
      .where(eq(memoryJobs.id, existing.id))
      .run();
    return getMemoryJobById(existing.id)!;
  }

  const row: NewMemoryJob = {
    id: randomUUID(),
    idempotency_key: input.idempotencyKey ?? null,
    kind: input.kind,
    status: "queued",
    conversation_id: input.conversationId ?? null,
    agent_id: input.agentId ?? DEFAULT_AGENT_ID,
    run_id: input.runId ?? null,
    payload_json: payloadJson,
    attempts: 0,
    last_error: null,
    scheduled_at: scheduledAt,
    started_at: null,
    finished_at: null,
    created_at: now,
    updated_at: now,
  };
  getDb().insert(memoryJobs).values(row).run();
  return row as MemoryJob;
}

export async function claimNextMemoryJob(now = Date.now()): Promise<MemoryJob | null> {
  if (shouldRouteWrites()) return writeDb<MemoryJob | null>("claimNextMemoryJob", [now]);
  const row = getDb()
    .select()
    .from(memoryJobs)
    .where(eq(memoryJobs.status, "queued"))
    .orderBy(asc(memoryJobs.scheduled_at), asc(memoryJobs.created_at))
    .all()
    .find((job) => job.scheduled_at <= now);
  if (!row) return null;
  const startedAt = Date.now();
  getDb()
    .update(memoryJobs)
    .set({
      status: "running",
      attempts: row.attempts + 1,
      started_at: startedAt,
      updated_at: startedAt,
    })
    .where(eq(memoryJobs.id, row.id))
    .run();
  return getMemoryJobById(row.id);
}

export async function finishMemoryJob(
  id: string,
  status: Extract<MemoryJobStatus, "succeeded" | "failed" | "cancelled">,
  error?: string | null,
): Promise<MemoryJob | null> {
  if (shouldRouteWrites()) return writeDb<MemoryJob | null>("finishMemoryJob", [id, status, error]);
  const existing = getMemoryJobById(id);
  if (!existing) return null;
  const now = Date.now();
  const shouldRetry =
    status === "failed" && existing.attempts < MEMORY_JOB_MAX_ATTEMPTS && error != null;
  getDb()
    .update(memoryJobs)
    .set({
      status: shouldRetry ? "queued" : status,
      last_error: error ?? null,
      scheduled_at: shouldRetry
        ? now + Math.min(existing.attempts + 1, 5) * 15_000
        : existing.scheduled_at,
      finished_at: shouldRetry ? null : now,
      updated_at: now,
    })
    .where(eq(memoryJobs.id, id))
    .run();
  return getMemoryJobById(id);
}

export function getMemoryJobById(id: string): MemoryJob | null {
  return getDb().select().from(memoryJobs).where(eq(memoryJobs.id, id)).get() ?? null;
}

export function listMemoryJobs(limit = 100): MemoryJob[] {
  return getDb().select().from(memoryJobs).orderBy(desc(memoryJobs.updated_at)).limit(limit).all();
}

export async function deleteMemoriesBatch(ids: string[]): Promise<number> {
  if (shouldRouteWrites()) return writeDb<number>("deleteMemoriesBatch", [ids]);
  if (ids.length === 0) return 0;
  const uniqueIds = [...new Set(ids)];
  const existing = uniqueIds
    .map((id) => getMemoryById(id))
    .filter((memory): memory is MemoryRecord => memory != null);
  const db = getDb();
  let deleted = 0;
  db.transaction((tx) => {
    for (const id of uniqueIds) {
      const result = tx.delete(memories).where(eq(memories.id, id)).run();
      deleted += result.changes;
    }
  });

  // 事务提交后同步删除向量索引
  for (const memory of existing) {
    void queueMemoryJob({
      kind: "sync",
      agentId: memory.agent_id,
      idempotencyKey: `memory:${memory.id}:delete`,
      payload: {
        action: "delete",
        memoryId: memory.id,
        mem0Id: memory.mem0_id ?? null,
      },
    });
  }

  return deleted;
}

export async function updateMemoriesBatch(
  ids: string[],
  patch: Partial<Pick<MemoryRecord, "pinned" | "salience" | "kind" | "scope">>,
): Promise<number> {
  if (shouldRouteWrites()) return writeDb<number>("updateMemoriesBatch", [ids, patch]);
  if (ids.length === 0) return 0;
  const setPatch: Partial<Record<string, unknown>> = {};
  if (patch.pinned !== undefined) setPatch.pinned = patch.pinned;
  if (patch.salience !== undefined) setPatch.salience = patch.salience;
  if (patch.kind !== undefined) setPatch.kind = patch.kind;
  if (patch.scope !== undefined) setPatch.scope = patch.scope;
  if (Object.keys(setPatch).length === 0) return 0;
  setPatch.sync_status = "pending";
  setPatch.updated_at = Date.now();

  const uniqueIds = [...new Set(ids)];
  const db = getDb();
  let updated = 0;
  db.transaction((tx) => {
    for (const id of uniqueIds) {
      const result = tx.update(memories).set(setPatch).where(eq(memories.id, id)).run();
      updated += result.changes;
    }
  });

  // 事务提交后同步更新向量索引（仅 title/content 变更时才需要，但批量 patch 不含这两个字段，
  // 仍调用 update 以刷新元数据/嵌入；实际内容未变时 Mem0 内部效果有限）
  for (const id of uniqueIds) {
    const memory = getMemoryById(id);
    if (!memory) continue;
    void queueMemoryJob({
      kind: "sync",
      agentId: memory.agent_id,
      idempotencyKey: `memory:${id}:upsert`,
      payload: { action: "upsert", memoryId: id },
    });
  }

  return updated;
}

export async function searchMemories(filters: {
  query?: string;
  scope?: MemoryScope | null;
  kind?: MemoryKind | null;
  status?: MemoryStatus | null;
  agentId?: string | null;
  conversationId?: string | null;
  pinned?: boolean | null;
  sortBy?: "salience" | "updated" | "created";
  sortOrder?: "asc" | "desc";
  limit?: number;
}): Promise<MemoryRecord[]> {
  const {
    query,
    scope,
    kind,
    status = "active",
    agentId,
    pinned,
    sortBy = "salience",
    sortOrder = "desc",
    limit,
  } = filters;

  return searchMemoriesSqlite({
    query: query?.trim().toLowerCase(),
    scope,
    kind,
    status,
    agentId,
    conversationId: null,
    pinned,
    sortBy,
    sortOrder,
    limit,
  });
}

function searchMemoriesSqlite(filters: {
  query?: string;
  scope?: MemoryScope | null;
  kind?: MemoryKind | null;
  status?: MemoryStatus | null;
  agentId?: string | null;
  conversationId?: string | null;
  pinned?: boolean | null;
  sortBy?: "salience" | "updated" | "created";
  sortOrder?: "asc" | "desc";
  limit?: number;
}): MemoryRecord[] {
  const {
    query,
    scope,
    kind,
    status = "active",
    agentId,
    pinned,
    sortBy = "salience",
    sortOrder = "desc",
    limit,
  } = filters;

  const conditions: (ReturnType<typeof eq> | ReturnType<typeof and>)[] = [];
  if (scope) conditions.push(eq(memories.scope, scope));
  if (kind) conditions.push(eq(memories.kind, kind));
  if (status) conditions.push(eq(memories.status, status));
  if (agentId !== undefined && agentId !== null) {
    conditions.push(or(isNull(memories.agent_id), eq(memories.agent_id, agentId))!);
  }
  if (pinned !== undefined && pinned !== null) conditions.push(eq(memories.pinned, pinned ? 1 : 0));
  if (query) {
    const pattern = `%${query}%`;
    conditions.push(or(like(memories.title, pattern), like(memories.content, pattern)));
  }

  const sortColumn =
    sortBy === "updated"
      ? memories.updated_at
      : sortBy === "created"
        ? memories.created_at
        : memories.salience;
  const orderFn = sortOrder === "asc" ? asc : desc;

  const queryBuilder = getDb()
    .select()
    .from(memories)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(memories.pinned), orderFn(sortColumn));

  return limit !== undefined && limit > 0 ? queryBuilder.limit(limit).all() : queryBuilder.all();
}

export function listToolServers(kind?: "mcp" | "local" | "sandbox"): ToolServer[] {
  const where = kind
    ? and(eq(toolServers.kind, kind), isNull(toolServers.deleted_at))
    : isNull(toolServers.deleted_at);
  const rows = getDb().select().from(toolServers).where(where).all();
  return rows.map(toToolServer);
}

export function listMcpServers(): ToolServer[] {
  return listToolServers("mcp");
}

export function listManagedRuntimes(): ManagedRuntime[] {
  return getDb().select().from(managedRuntimes).all().map(toManagedRuntime);
}

export function listAvailableManagedRuntimes(): ManagedRuntime[] {
  return getDb()
    .select()
    .from(managedRuntimes)
    .where(eq(managedRuntimes.status, "available"))
    .all()
    .map(toManagedRuntime);
}

export function listRuntimePreferences(): RuntimePreference[] {
  return getDb().select().from(runtimePreferences).all().map(toRuntimePreference);
}

export function getRuntimePreference(kind: RuntimeKind): RuntimePreference | null {
  const row = getDb()
    .select()
    .from(runtimePreferences)
    .where(eq(runtimePreferences.kind, kind))
    .get();
  return row ? toRuntimePreference(row) : null;
}

export function upsertRuntimePreference(input: {
  kind: RuntimeKind;
  manifestUrl: string;
  channel?: "stable";
}): RuntimePreference {
  const row: DbRuntimePreference = {
    kind: input.kind,
    manifest_url: input.manifestUrl,
    channel: input.channel ?? "stable",
    updated_at: Date.now(),
  };
  getDb()
    .insert(runtimePreferences)
    .values(row)
    .onConflictDoUpdate({
      target: runtimePreferences.kind,
      set: { manifest_url: row.manifest_url, channel: row.channel, updated_at: row.updated_at },
    })
    .run();
  return toRuntimePreference(row);
}

export function upsertManagedRuntime(input: {
  id: string;
  kind: RuntimeKind;
  version: string;
  platform: RuntimePlatform;
  architecture: RuntimeArchitecture;
  libc?: ManagedRuntime["libc"];
  rootPath: string;
  executablePath: string;
  sourceUrl: string;
  sha256: string;
  verifiedCommands?: RuntimeExecutableCommand[];
  status?: ManagedRuntime["status"];
  installedAt?: number | null;
  lastError?: string | null;
}): ManagedRuntime {
  const now = Date.now();
  const row: DbManagedRuntime = {
    id: input.id,
    kind: input.kind,
    version: input.version,
    platform: input.platform,
    architecture: input.architecture,
    libc: input.libc ?? null,
    root_path: input.rootPath,
    executable_path: input.executablePath,
    source_url: input.sourceUrl,
    sha256: input.sha256,
    verified_commands_json: JSON.stringify(input.verifiedCommands ?? []),
    channel: "stable",
    status: input.status ?? "available",
    installed_at: input.installedAt ?? now,
    updated_at: now,
    last_error: input.lastError ?? null,
  };
  getDb()
    .insert(managedRuntimes)
    .values(row)
    .onConflictDoUpdate({
      target: managedRuntimes.id,
      set: {
        kind: row.kind,
        version: row.version,
        platform: row.platform,
        architecture: row.architecture,
        libc: row.libc,
        root_path: row.root_path,
        executable_path: row.executable_path,
        source_url: row.source_url,
        sha256: row.sha256,
        verified_commands_json: row.verified_commands_json,
        channel: row.channel,
        status: row.status,
        installed_at: row.installed_at,
        updated_at: row.updated_at,
        last_error: row.last_error,
      },
    })
    .run();
  return toManagedRuntime(row);
}

export function markManagedRuntimeStatus(
  id: string,
  patch: Pick<Partial<ManagedRuntime>, "status" | "lastError"> & { last_error?: string | null },
): ManagedRuntime | null {
  const existing = getDb().select().from(managedRuntimes).where(eq(managedRuntimes.id, id)).get();
  if (!existing) return null;
  const lastError = "lastError" in patch ? patch.lastError : patch.last_error;
  getDb()
    .update(managedRuntimes)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(lastError !== undefined ? { last_error: lastError } : {}),
      updated_at: Date.now(),
    })
    .where(eq(managedRuntimes.id, id))
    .run();
  return toManagedRuntime(
    getDb().select().from(managedRuntimes).where(eq(managedRuntimes.id, id)).get()!,
  );
}

export function listMcpRuntimeStates(): McpServerRuntimeState[] {
  return getDb().select().from(mcpRuntimeStates).all().map(toMcpRuntimeState);
}

export function getMcpRuntimeState(serverId: string): McpServerRuntimeState | null {
  const row = getDb()
    .select()
    .from(mcpRuntimeStates)
    .where(eq(mcpRuntimeStates.server_id, serverId))
    .get();
  return row ? toMcpRuntimeState(row) : null;
}

export function upsertMcpRuntimeState(input: {
  serverId: string;
  desiredState?: McpLifecycleDesiredState;
  state?: McpLifecycleState;
  pid?: number | null;
  resolvedCommand?: string | null;
  runtimeInstallationId?: string | null;
  startedAt?: number | null;
  lastExitAt?: number | null;
  restartAttempts?: number;
  nextRetryAt?: number | null;
  lastError?: string | null;
}): McpServerRuntimeState {
  const existing = getMcpRuntimeState(input.serverId);
  const row: DbMcpRuntimeState = {
    server_id: input.serverId,
    desired_state: input.desiredState ?? existing?.desiredState ?? "stopped",
    state: input.state ?? existing?.state ?? "stopped",
    pid: input.pid !== undefined ? input.pid : (existing?.pid ?? null),
    resolved_command:
      input.resolvedCommand !== undefined
        ? input.resolvedCommand
        : (existing?.resolvedCommand ?? null),
    runtime_installation_id:
      input.runtimeInstallationId !== undefined
        ? input.runtimeInstallationId
        : (existing?.runtimeInstallationId ?? null),
    started_at: input.startedAt !== undefined ? input.startedAt : (existing?.startedAt ?? null),
    last_exit_at:
      input.lastExitAt !== undefined ? input.lastExitAt : (existing?.lastExitAt ?? null),
    restart_attempts: input.restartAttempts ?? existing?.restartAttempts ?? 0,
    next_retry_at:
      input.nextRetryAt !== undefined ? input.nextRetryAt : (existing?.nextRetryAt ?? null),
    last_error: input.lastError !== undefined ? input.lastError : (existing?.lastError ?? null),
    updated_at: Date.now(),
  };
  getDb()
    .insert(mcpRuntimeStates)
    .values(row)
    .onConflictDoUpdate({
      target: mcpRuntimeStates.server_id,
      set: {
        desired_state: row.desired_state,
        state: row.state,
        pid: row.pid,
        resolved_command: row.resolved_command,
        runtime_installation_id: row.runtime_installation_id,
        started_at: row.started_at,
        last_exit_at: row.last_exit_at,
        restart_attempts: row.restart_attempts,
        next_retry_at: row.next_retry_at,
        last_error: row.last_error,
        updated_at: row.updated_at,
      },
    })
    .run();
  return toMcpRuntimeState(row);
}

export function listMcpDependencyInstallations(): McpDependencyInstallation[] {
  return getDb().select().from(mcpDependencyInstallations).all().map(toMcpDependencyInstallation);
}

export function getMcpDependencyInstallation(serverId: string): McpDependencyInstallation | null {
  const row = getDb()
    .select()
    .from(mcpDependencyInstallations)
    .where(eq(mcpDependencyInstallations.server_id, serverId))
    .get();
  return row ? toMcpDependencyInstallation(row) : null;
}

export function upsertMcpDependencyInstallation(input: {
  serverId: string;
  manager: "npx" | "uvx" | "none";
  packageSpecs?: string[];
  installRoot?: string | null;
  status?: McpDependencyStatus;
  scriptsAllowed?: boolean | number;
  runtimeInstallationId?: string | null;
  installedAt?: number | null;
  lastError?: string | null;
}): McpDependencyInstallation {
  const existing = getMcpDependencyInstallation(input.serverId);
  const row: DbMcpDependencyInstallation = {
    id: existing?.id ?? randomUUID(),
    server_id: input.serverId,
    manager: input.manager,
    package_specs_json: JSON.stringify(input.packageSpecs ?? existing?.packageSpecs ?? []),
    install_root:
      input.installRoot !== undefined ? input.installRoot : (existing?.installRoot ?? null),
    status: input.status ?? existing?.status ?? "not_installed",
    scripts_allowed:
      input.scriptsAllowed !== undefined
        ? normalizeBooleanNumber(input.scriptsAllowed)
        : (existing?.scriptsAllowed ?? 0),
    runtime_installation_id:
      input.runtimeInstallationId !== undefined
        ? input.runtimeInstallationId
        : (existing?.runtimeInstallationId ?? null),
    installed_at:
      input.installedAt !== undefined ? input.installedAt : (existing?.installedAt ?? null),
    updated_at: Date.now(),
    last_error: input.lastError !== undefined ? input.lastError : (existing?.lastError ?? null),
  };
  getDb()
    .insert(mcpDependencyInstallations)
    .values(row)
    .onConflictDoUpdate({
      target: mcpDependencyInstallations.server_id,
      set: {
        manager: row.manager,
        package_specs_json: row.package_specs_json,
        install_root: row.install_root,
        status: row.status,
        scripts_allowed: row.scripts_allowed,
        runtime_installation_id: row.runtime_installation_id,
        installed_at: row.installed_at,
        updated_at: row.updated_at,
        last_error: row.last_error,
      },
    })
    .run();
  return toMcpDependencyInstallation(row);
}

export function getToolServer(id: string): ToolServer | null {
  const row = getDb()
    .select()
    .from(toolServers)
    .where(and(eq(toolServers.id, id), isNull(toolServers.deleted_at)))
    .get();
  return row ? toToolServer(row) : null;
}

export const getMcpServer = getToolServer;

export function createToolServer(input: ToolServerInput): ToolServer {
  const now = Date.now();
  const row = normalizeToolServerInput(randomUUID(), input, null, now);
  getDb().insert(toolServers).values(row).run();
  insertRuntimeEvent({
    kind: "tool",
    title: "Tool server created",
    status: "succeeded",
    owner_type: "server",
    owner_id: row.id,
    detail: { serverId: row.id, transport: row.transport },
  });
  return toToolServer(row as DbToolServer);
}

export const createMcpServer = createToolServer;

export function updateToolServer(id: string, input: Partial<ToolServerInput>): ToolServer {
  const existing = getRequiredToolServer(id);
  const now = Date.now();
  const row = normalizeToolServerInput(id, input, existing, now);
  getDb().update(toolServers).set(row).where(eq(toolServers.id, id)).run();
  return getToolServer(id)!;
}

export const updateMcpServer = updateToolServer;

export function deleteToolServer(id: string): void {
  const now = Date.now();
  getDb()
    .update(toolServers)
    .set({
      enabled: 0,
      status: "disabled",
      deleted_at: now,
      purge_after_at: now + TRASH_RETENTION_MS,
      updated_at: now,
    })
    .where(eq(toolServers.id, id))
    .run();
}

export const deleteMcpServer = deleteToolServer;

export function listDeletedToolServers(kind?: "mcp" | "local" | "sandbox"): ToolServer[] {
  const where = kind
    ? and(eq(toolServers.kind, kind), isNotNull(toolServers.deleted_at))
    : isNotNull(toolServers.deleted_at);
  return getDb()
    .select()
    .from(toolServers)
    .where(where)
    .orderBy(desc(toolServers.deleted_at))
    .all()
    .map(toToolServer);
}

export function restoreToolServer(id: string): ToolServer {
  getDb()
    .update(toolServers)
    .set({
      deleted_at: null,
      purge_after_at: null,
      updated_at: Date.now(),
    })
    .where(eq(toolServers.id, id))
    .run();
  return getRequiredToolServer(id);
}

export function permanentlyDeleteToolServer(id: string): void {
  getDb().delete(toolServers).where(eq(toolServers.id, id)).run();
  deleteToolSecretsForOwner("server", id);
}

export function permanentlyDeleteToolServers(ids: string[]): number {
  let deleted = 0;
  for (const id of ids) {
    const result = getDb().delete(toolServers).where(eq(toolServers.id, id)).run();
    deleteToolSecretsForOwner("server", id);
    deleted += result.changes;
  }
  return deleted;
}

export function purgeExpiredDeletedToolServers(now = Date.now()): number {
  const expired = getDb()
    .select()
    .from(toolServers)
    .where(and(isNotNull(toolServers.deleted_at), lt(toolServers.purge_after_at, now)))
    .all();
  return permanentlyDeleteToolServers(expired.map((server) => server.id));
}

export function setToolServerEnabled(id: string, enabled: boolean): ToolServer {
  getDb()
    .update(toolServers)
    .set({
      enabled: enabled ? 1 : 0,
      status: enabled ? "unknown" : "disabled",
      updated_at: Date.now(),
    })
    .where(eq(toolServers.id, id))
    .run();
  return getToolServer(id)!;
}

export const setMcpServerEnabled = setToolServerEnabled;

export function updateToolServerStatus(
  id: string,
  patch: Pick<Partial<ToolServer>, "status" | "last_error" | "last_connected_at">,
): ToolServer | null {
  const existing = getToolServer(id);
  if (!existing) return null;
  getDb()
    .update(toolServers)
    .set({
      status: patch.status ?? existing.status,
      last_error: patch.last_error === undefined ? existing.last_error : patch.last_error,
      last_connected_at:
        patch.last_connected_at === undefined
          ? existing.last_connected_at
          : patch.last_connected_at,
    })
    .where(eq(toolServers.id, id))
    .run();
  return getToolServer(id);
}

export const updateMcpServerStatus = updateToolServerStatus;

export function listToolRecords(kind?: "builtin" | "mcp" | "skill" | "sandbox"): ToolRecord[] {
  const where = kind
    ? and(eq(tools.kind, kind), isNull(tools.deleted_at))
    : isNull(tools.deleted_at);
  const rows = getDb().select().from(tools).where(where).all();
  const activeServerIds = new Set(listToolServers().map((server) => server.id));
  return rows
    .filter(
      (row) => row.kind !== "mcp" || (row.server_id ? activeServerIds.has(row.server_id) : false),
    )
    .map(toToolRecord);
}

export function getToolRecord(id: string): ToolRecord | null {
  const row = getDb().select().from(tools).where(eq(tools.id, id)).get();
  return row ? toToolRecord(row) : null;
}

export function listMcpTools(serverId?: string): ToolRecord[] {
  if (serverId && !getToolServer(serverId)) return [];
  const rows = serverId
    ? getDb()
        .select()
        .from(tools)
        .where(and(eq(tools.kind, "mcp"), eq(tools.server_id, serverId), isNull(tools.deleted_at)))
        .all()
    : getDb()
        .select()
        .from(tools)
        .where(and(eq(tools.kind, "mcp"), isNull(tools.deleted_at)))
        .all();
  const activeServerIds = new Set(listMcpServers().map((server) => server.id));
  return rows
    .filter((row) => row.server_id && activeServerIds.has(row.server_id))
    .map(toToolRecord);
}

export function getMcpToolByReference(serverId: string, toolName: string): ToolRecord | null {
  if (!getToolServer(serverId)) return null;
  const reference = `mcp:${serverId}:${toolName}`;
  const row = getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.reference, reference), isNull(tools.deleted_at)))
    .get();
  return row ? toToolRecord(row) : null;
}

export function upsertMcpToolDefinitions(
  serverId: string,
  definitions: Array<{
    name: string;
    title?: string | null;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
  }>,
): ToolRecord[] {
  const now = Date.now();
  for (const definition of definitions) {
    const name = normalizeRequiredText(definition.name, "tool name", 120);
    const id = toolRowId(serverId, name);
    const reference = `mcp:${serverId}:${name}`;
    const existing = getDb().select().from(tools).where(eq(tools.id, id)).get();
    const row: NewToolRecord = {
      id,
      server_id: serverId,
      name,
      title: definition.title ?? null,
      description: definition.description ?? "",
      kind: "mcp",
      category: "mcp",
      reference,
      enabled: existing?.enabled ?? 1,
      auto_use: existing?.auto_use ?? 0,
      requires_approval: existing?.requires_approval ?? 1,
      input_schema_json: JSON.stringify(definition.inputSchema ?? {}),
      output_schema_json: JSON.stringify(definition.outputSchema ?? {}),
      config_json: existing?.config_json ?? "{}",
      trigger_keywords_json: "[]",
      tags_json: "[]",
      discovered_at: existing?.discovered_at ?? now,
      last_run_at: existing?.last_run_at ?? null,
      updated_at: now,
      deleted_at: null,
      purge_after_at: null,
    };
    getDb()
      .insert(tools)
      .values(row)
      .onConflictDoUpdate({
        target: tools.id,
        set: {
          title: row.title,
          description: row.description,
          input_schema_json: row.input_schema_json,
          output_schema_json: row.output_schema_json,
          updated_at: row.updated_at,
        },
      })
      .run();
  }
  return listMcpTools(serverId);
}

export function updateToolRecord(
  id: string,
  patch: Partial<Record<"enabled" | "auto_use" | "requires_approval", boolean | number>>,
): ToolRecord {
  const existing = getRequiredToolRecord(id);
  getDb()
    .update(tools)
    .set({
      enabled: normalizeBooleanNumber(patch.enabled ?? existing.enabled),
      auto_use: normalizeBooleanNumber(patch.auto_use ?? existing.auto_use),
      requires_approval: normalizeBooleanNumber(
        patch.requires_approval ?? existing.requires_approval,
      ),
      updated_at: Date.now(),
    })
    .where(eq(tools.id, id))
    .run();
  return toToolRecord(getRequiredToolRecord(id));
}

export const updateMcpTool = updateToolRecord;

export function listSkillTools(): ToolSkill[] {
  return getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.kind, "skill"), isNull(tools.deleted_at)))
    .orderBy(desc(tools.discovered_at), asc(tools.id))
    .all()
    .map(toToolSkill);
}

export function getSkillTool(id: string): ToolSkill | null {
  const row = getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.id, id), eq(tools.kind, "skill"), isNull(tools.deleted_at)))
    .get();
  return row ? toToolSkill(row) : null;
}

export function createSkillTool(input: ToolSkillInput): ToolSkill {
  assertSkillInputKeys(input);
  const now = Date.now();
  const row = normalizeSkillToolInput(randomUUID(), input, null, now);
  getDb().insert(tools).values(row).run();
  insertRuntimeEvent({
    kind: "tool",
    title: "Skill tool created",
    status: "succeeded",
    tool_id: row.id,
    owner_type: "tool",
    owner_id: row.id,
  });
  return toToolSkill(getRequiredToolRecord(row.id));
}

export function updateSkillTool(id: string, input: Partial<ToolSkillInput>): ToolSkill {
  assertSkillInputKeys(input);
  const existing = getRequiredToolRecord(id);
  const now = Date.now();
  const row = normalizeSkillToolInput(id, input, existing, now);
  getDb().update(tools).set(row).where(eq(tools.id, id)).run();
  return toToolSkill(getRequiredToolRecord(id));
}

const SKILL_INPUT_KEYS = new Set<keyof ToolSkillInput>([
  "name",
  "description",
  "instructions",
  "category",
  "enabled",
  "auto_use",
  "requires_approval",
  "triggerKeywords",
  "tags",
  "configSchema",
  "config",
]);

function assertSkillInputKeys(input: Partial<ToolSkillInput>): void {
  for (const key of Object.keys(input)) {
    if (!SKILL_INPUT_KEYS.has(key as keyof ToolSkillInput)) {
      throw new Error(`Unsupported Skill field: ${key}`);
    }
  }
}

export function deleteSkillTool(id: string): void {
  const now = Date.now();
  getDb()
    .update(tools)
    .set({
      enabled: 0,
      deleted_at: now,
      purge_after_at: now + TRASH_RETENTION_MS,
      updated_at: now,
    })
    .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
    .run();
}

export function listDeletedSkillTools(): ToolSkill[] {
  return getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.kind, "skill"), isNotNull(tools.deleted_at)))
    .orderBy(desc(tools.deleted_at))
    .all()
    .map(toToolSkill);
}

export function restoreSkillTool(id: string): ToolSkill {
  getDb()
    .update(tools)
    .set({ deleted_at: null, purge_after_at: null, updated_at: Date.now() })
    .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
    .run();
  return toToolSkill(getRequiredToolRecord(id));
}

export function permanentlyDeleteSkillTool(id: string): void {
  getDb()
    .delete(tools)
    .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
    .run();
  deleteToolSecretsForOwner("tool", id);
}

export function permanentlyDeleteSkillTools(ids: string[]): number {
  let deleted = 0;
  for (const id of ids) {
    const result = getDb()
      .delete(tools)
      .where(and(eq(tools.id, id), eq(tools.kind, "skill")))
      .run();
    deleteToolSecretsForOwner("tool", id);
    deleted += result.changes;
  }
  return deleted;
}

export function purgeExpiredDeletedSkillTools(now = Date.now()): number {
  const expired = getDb()
    .select()
    .from(tools)
    .where(and(eq(tools.kind, "skill"), isNotNull(tools.deleted_at), lt(tools.purge_after_at, now)))
    .all();
  return permanentlyDeleteSkillTools(expired.map((skill) => skill.id));
}

export function setSkillToolEnabled(id: string, enabled: boolean): ToolSkill {
  getDb()
    .update(tools)
    .set({ enabled: enabled ? 1 : 0, updated_at: Date.now() })
    .where(eq(tools.id, id))
    .run();
  return toToolSkill(getRequiredToolRecord(id));
}

export function markSkillToolRun(id: string, at = Date.now()): void {
  getDb().update(tools).set({ last_run_at: at, updated_at: at }).where(eq(tools.id, id)).run();
}

export function listSkillPackages(skillId?: string): import("../../shared/types").SkillPackage[] {
  const rows = getDb()
    .select()
    .from(skillPackages)
    .where(skillId ? eq(skillPackages.skill_id, skillId) : undefined)
    .orderBy(desc(skillPackages.updated_at))
    .all();
  return rows.map(toSkillPackage);
}

export function getSkillPackage(skillId: string): import("../../shared/types").SkillPackage | null {
  const row = getDb()
    .select()
    .from(skillPackages)
    .where(eq(skillPackages.skill_id, skillId))
    .orderBy(desc(skillPackages.updated_at))
    .limit(1)
    .get();
  return row ? toSkillPackage(row) : null;
}

export function listSkillEntries(skillId?: string): SkillEntryView[] {
  const rows = getDb()
    .select()
    .from(skillEntries)
    .where(skillId ? eq(skillEntries.skill_id, skillId) : undefined)
    .orderBy(asc(skillEntries.name), asc(skillEntries.relative_path))
    .all();
  return rows.map(toSkillEntry);
}

export function listSkillRuns(skillId?: string, limit = 200): SkillRunRecord[] {
  const rows = getDb()
    .select()
    .from(skillRuns)
    .where(skillId ? eq(skillRuns.skill_id, skillId) : undefined)
    .orderBy(desc(skillRuns.created_at))
    .limit(Math.max(1, Math.min(500, limit)))
    .all();
  return rows.map(toSkillRun);
}

export function getSkillInspection(skillId: string): import("../../shared/types").SkillInspection {
  const skill = getSkillTool(skillId);
  if (!skill) throw new Error("Skill not found.");
  const pkg = getSkillPackage(skillId);
  return {
    skill,
    package: pkg,
    files: pkg ? listSkillPackageFiles(pkg.rootPath) : [],
    entries: listSkillEntries(skillId),
    dependencies: skillDependencies(pkg),
    runs: listSkillRuns(skillId),
  };
}

function listSkillPackageFiles(rootPath: string): Array<{ path: string; size: number }> {
  const root = join(rootPath);
  const files: Array<{ path: string; size: number }> = [];
  try {
    const visit = (current: string): void => {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const fullPath = join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          visit(fullPath);
        } else if (entry.isFile()) {
          files.push({
            path: relative(root, fullPath).split("\\").join("/"),
            size: statSync(fullPath).size,
          });
        }
      }
    };
    visit(root);
  } catch {
    return [];
  }
  return files.sort((left, right) => left.path.localeCompare(right.path)).slice(0, 500);
}

export function upsertSkillPackage(input: {
  id?: string;
  skillId: string;
  source: "manual" | "upload" | "catalog" | "system";
  rootPath: string;
  contentHash: string;
  executionMode: SkillExecutionMode;
  status?: SkillPackageStatus;
  manifest?: Record<string, unknown>;
  safety?: Record<string, unknown>;
  lastError?: string | null;
}): import("../../shared/types").SkillPackage {
  const now = Date.now();
  const existing = input.id
    ? getDb().select().from(skillPackages).where(eq(skillPackages.id, input.id)).get()
    : getDb()
        .select()
        .from(skillPackages)
        .where(eq(skillPackages.skill_id, input.skillId))
        .orderBy(desc(skillPackages.updated_at))
        .limit(1)
        .get();
  const row: typeof skillPackages.$inferInsert = {
    id: input.id ?? existing?.id ?? randomUUID(),
    skill_id: input.skillId,
    source: input.source,
    root_path: normalizeRequiredText(input.rootPath, "Skill package root", 2_000),
    content_hash: normalizeRequiredText(input.contentHash, "Skill package hash", 128),
    execution_mode: input.executionMode,
    status: input.status ?? existing?.status ?? "disabled",
    manifest_json: normalizeJsonObjectString(input.manifest ?? {}),
    safety_json: normalizeJsonObjectString(input.safety ?? {}),
    last_error: normalizeNullableText(input.lastError ?? null, 2_000),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  getDb()
    .insert(skillPackages)
    .values(row)
    .onConflictDoUpdate({
      target: skillPackages.id,
      set: {
        skill_id: row.skill_id,
        source: row.source,
        root_path: row.root_path,
        content_hash: row.content_hash,
        execution_mode: row.execution_mode,
        status: row.status,
        manifest_json: row.manifest_json,
        safety_json: row.safety_json,
        last_error: row.last_error,
        updated_at: row.updated_at,
      },
    })
    .run();
  return toSkillPackage(
    getDb().select().from(skillPackages).where(eq(skillPackages.id, row.id)).get()!,
  );
}

export function replaceSkillEntries(
  skillId: string,
  packageId: string,
  entries: Array<{
    id?: string;
    relativePath: string;
    name: string;
    runtime: SkillEntryView["runtime"];
    enabled?: boolean;
    available?: boolean;
    unavailableReason?: string;
    timeoutMs?: number;
  }>,
): SkillEntryView[] {
  const now = Date.now();
  getDb().delete(skillEntries).where(eq(skillEntries.package_id, packageId)).run();
  for (const entry of entries) {
    const row: typeof skillEntries.$inferInsert = {
      id: entry.id ?? randomUUID(),
      skill_id: skillId,
      package_id: packageId,
      relative_path: normalizeSkillRelativePath(entry.relativePath),
      name: normalizeRequiredText(entry.name, "Skill entry name", 240),
      runtime: entry.runtime,
      enabled: entry.enabled === false ? 0 : 1,
      available: entry.available === false ? 0 : 1,
      unavailable_reason: normalizeNullableText(entry.unavailableReason ?? null, 500),
      timeout_ms: clampNumber(entry.timeoutMs ?? 60_000, 1_000, 60_000),
      created_at: now,
      updated_at: now,
    };
    getDb().insert(skillEntries).values(row).run();
  }
  return listSkillEntries(skillId);
}

export function setSkillPackageStatus(
  skillId: string,
  status: SkillPackageStatus,
  lastError?: string | null,
): import("../../shared/types").SkillPackage | null {
  const existing = getDb()
    .select()
    .from(skillPackages)
    .where(eq(skillPackages.skill_id, skillId))
    .orderBy(desc(skillPackages.updated_at))
    .limit(1)
    .get();
  if (!existing) return null;
  getDb()
    .update(skillPackages)
    .set({
      status,
      last_error: normalizeNullableText(lastError ?? null, 2_000),
      updated_at: Date.now(),
    })
    .where(eq(skillPackages.id, existing.id))
    .run();
  return getSkillPackage(skillId);
}

export function createSkillRun(input: {
  id?: string;
  skillId: string;
  entryId: string;
  conversationId?: string | null;
  agentId?: string | null;
  cwd: string;
  argsJson: string;
}): SkillRunRecord {
  const now = Date.now();
  const row: typeof skillRuns.$inferInsert = {
    id: input.id ?? randomUUID(),
    skill_id: input.skillId,
    entry_id: input.entryId,
    conversation_id: input.conversationId ?? null,
    agent_id: input.agentId ?? null,
    status: "queued",
    cwd: normalizeRequiredText(input.cwd, "Skill run cwd", 2_000),
    args_json: input.argsJson,
    stdout: "",
    stderr: "",
    exit_code: null,
    signal: null,
    duration_ms: 0,
    truncated: 0,
    error: null,
    started_at: null,
    finished_at: null,
    created_at: now,
    updated_at: now,
  };
  getDb().insert(skillRuns).values(row).run();
  return toSkillRun(row as DbSkillRun);
}

export function updateSkillRun(
  id: string,
  patch: Partial<{
    status: SkillRunStatus;
    cwd: string;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: string | null;
    durationMs: number;
    truncated: boolean;
    error: string | null;
    startedAt: number | null;
    finishedAt: number | null;
  }>,
): SkillRunRecord | null {
  const existing = getDb().select().from(skillRuns).where(eq(skillRuns.id, id)).get();
  if (!existing) return null;
  getDb()
    .update(skillRuns)
    .set({
      status: patch.status ?? existing.status,
      cwd: patch.cwd ?? existing.cwd,
      stdout: patch.stdout ?? existing.stdout,
      stderr: patch.stderr ?? existing.stderr,
      exit_code: patch.exitCode === undefined ? existing.exit_code : patch.exitCode,
      signal: patch.signal === undefined ? existing.signal : patch.signal,
      duration_ms: patch.durationMs ?? existing.duration_ms,
      truncated: patch.truncated === undefined ? existing.truncated : patch.truncated ? 1 : 0,
      error: patch.error === undefined ? existing.error : normalizeNullableText(patch.error, 2_000),
      started_at: patch.startedAt === undefined ? existing.started_at : patch.startedAt,
      finished_at: patch.finishedAt === undefined ? existing.finished_at : patch.finishedAt,
      updated_at: Date.now(),
    })
    .where(eq(skillRuns.id, id))
    .run();
  const row = getDb().select().from(skillRuns).where(eq(skillRuns.id, id)).get();
  return row ? toSkillRun(row) : null;
}

export function deleteSkillPackage(skillId: string): void {
  getDb().delete(skillPackages).where(eq(skillPackages.skill_id, skillId)).run();
}

export function setToolSecret(input: ToolSecretInput): ToolSecretPublic {
  const ownerType = normalizeSecretOwnerType(input.ownerType);
  const key = normalizeSecretKey(input.key);
  const ownerId = normalizeRequiredText(input.ownerId, "owner id", 160);
  const id = toolSecretId(ownerType, ownerId, key);
  const row: NewToolSecret = {
    id,
    owner_type: ownerType,
    owner_id: ownerId,
    key,
    label: input.label?.trim() || key,
    ciphertext: JSON.stringify(encrypt(input.value)),
    updated_at: Date.now(),
  };
  getDb()
    .insert(toolSecrets)
    .values(row)
    .onConflictDoUpdate({
      target: toolSecrets.id,
      set: { label: row.label, ciphertext: row.ciphertext, updated_at: row.updated_at },
    })
    .run();
  return publicToolSecret(row as DbToolSecret);
}

// Async write facades keep privileged callers off the main-process SQLite connection.
export async function createToolServerAsync(input: ToolServerInput): Promise<ToolServer> {
  return shouldRouteWrites()
    ? writeDb<ToolServer>("createToolServer", [input])
    : createToolServer(input);
}
export async function updateToolServerAsync(
  id: string,
  input: Partial<ToolServerInput>,
): Promise<ToolServer> {
  return shouldRouteWrites()
    ? writeDb<ToolServer>("updateToolServer", [id, input])
    : updateToolServer(id, input);
}
export async function deleteToolServerAsync(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteToolServer", [id]);
  deleteToolServer(id);
}
export async function restoreToolServerAsync(id: string): Promise<ToolServer> {
  return shouldRouteWrites()
    ? writeDb<ToolServer>("restoreToolServer", [id])
    : restoreToolServer(id);
}
export async function permanentlyDeleteToolServerAsync(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("permanentlyDeleteToolServer", [id]);
  permanentlyDeleteToolServer(id);
}
export async function permanentlyDeleteToolServersAsync(ids: string[]): Promise<number> {
  return shouldRouteWrites()
    ? writeDb<number>("permanentlyDeleteToolServers", [ids])
    : permanentlyDeleteToolServers(ids);
}
export async function purgeExpiredDeletedToolServersAsync(now = Date.now()): Promise<number> {
  return shouldRouteWrites()
    ? writeDb<number>("purgeExpiredDeletedToolServers", [now])
    : purgeExpiredDeletedToolServers(now);
}
export async function setToolServerEnabledAsync(id: string, enabled: boolean): Promise<ToolServer> {
  return shouldRouteWrites()
    ? writeDb<ToolServer>("setToolServerEnabled", [id, enabled])
    : setToolServerEnabled(id, enabled);
}
export async function updateToolServerStatusAsync(
  id: string,
  patch: Pick<Partial<ToolServer>, "status" | "last_error" | "last_connected_at">,
): Promise<ToolServer | null> {
  return shouldRouteWrites()
    ? writeDb<ToolServer | null>("updateToolServerStatus", [id, patch])
    : updateToolServerStatus(id, patch);
}
export const updateMcpServerStatusAsync = updateToolServerStatusAsync;

export async function upsertRuntimePreferenceAsync(input: {
  kind: RuntimeKind;
  manifestUrl: string;
  channel?: "stable";
}): Promise<RuntimePreference> {
  return shouldRouteWrites()
    ? writeDb<RuntimePreference>("upsertRuntimePreference", [input])
    : upsertRuntimePreference(input);
}

export async function upsertManagedRuntimeAsync(
  input: Parameters<typeof upsertManagedRuntime>[0],
): Promise<ManagedRuntime> {
  return shouldRouteWrites()
    ? writeDb<ManagedRuntime>("upsertManagedRuntime", [input])
    : upsertManagedRuntime(input);
}

export async function markManagedRuntimeStatusAsync(
  id: string,
  patch: Parameters<typeof markManagedRuntimeStatus>[1],
): Promise<ManagedRuntime | null> {
  return shouldRouteWrites()
    ? writeDb<ManagedRuntime | null>("markManagedRuntimeStatus", [id, patch])
    : markManagedRuntimeStatus(id, patch);
}

export async function upsertMcpRuntimeStateAsync(
  input: Parameters<typeof upsertMcpRuntimeState>[0],
): Promise<McpServerRuntimeState> {
  return shouldRouteWrites()
    ? writeDb<McpServerRuntimeState>("upsertMcpRuntimeState", [input])
    : upsertMcpRuntimeState(input);
}

export async function upsertMcpDependencyInstallationAsync(
  input: Parameters<typeof upsertMcpDependencyInstallation>[0],
): Promise<McpDependencyInstallation> {
  return shouldRouteWrites()
    ? writeDb<McpDependencyInstallation>("upsertMcpDependencyInstallation", [input])
    : upsertMcpDependencyInstallation(input);
}
export async function upsertMcpToolDefinitionsAsync(
  serverId: string,
  definitions: Parameters<typeof upsertMcpToolDefinitions>[1],
): Promise<ToolRecord[]> {
  return shouldRouteWrites()
    ? writeDb<ToolRecord[]>("upsertMcpToolDefinitions", [serverId, definitions])
    : upsertMcpToolDefinitions(serverId, definitions);
}
export async function updateToolRecordAsync(
  id: string,
  patch: Parameters<typeof updateToolRecord>[1],
): Promise<ToolRecord> {
  return shouldRouteWrites()
    ? writeDb<ToolRecord>("updateToolRecord", [id, patch])
    : updateToolRecord(id, patch);
}
export async function createSkillToolAsync(input: ToolSkillInput): Promise<ToolSkill> {
  return shouldRouteWrites()
    ? writeDb<ToolSkill>("createSkillTool", [input])
    : createSkillTool(input);
}
export async function updateSkillToolAsync(
  id: string,
  input: Partial<ToolSkillInput>,
): Promise<ToolSkill> {
  return shouldRouteWrites()
    ? writeDb<ToolSkill>("updateSkillTool", [id, input])
    : updateSkillTool(id, input);
}
export async function deleteSkillToolAsync(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteSkillTool", [id]);
  deleteSkillTool(id);
}
export async function restoreSkillToolAsync(id: string): Promise<ToolSkill> {
  return shouldRouteWrites() ? writeDb<ToolSkill>("restoreSkillTool", [id]) : restoreSkillTool(id);
}
export async function permanentlyDeleteSkillToolAsync(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("permanentlyDeleteSkillTool", [id]);
  permanentlyDeleteSkillTool(id);
}
export async function permanentlyDeleteSkillToolsAsync(ids: string[]): Promise<number> {
  return shouldRouteWrites()
    ? writeDb<number>("permanentlyDeleteSkillTools", [ids])
    : permanentlyDeleteSkillTools(ids);
}
export async function purgeExpiredDeletedSkillToolsAsync(now = Date.now()): Promise<number> {
  return shouldRouteWrites()
    ? writeDb<number>("purgeExpiredDeletedSkillTools", [now])
    : purgeExpiredDeletedSkillTools(now);
}
export async function setSkillToolEnabledAsync(id: string, enabled: boolean): Promise<ToolSkill> {
  return shouldRouteWrites()
    ? writeDb<ToolSkill>("setSkillToolEnabled", [id, enabled])
    : setSkillToolEnabled(id, enabled);
}
export async function markSkillToolRunAsync(id: string, at = Date.now()): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("markSkillToolRun", [id, at]);
  markSkillToolRun(id, at);
}
export async function upsertSkillPackageAsync(
  input: Parameters<typeof upsertSkillPackage>[0],
): Promise<import("../../shared/types").SkillPackage> {
  return shouldRouteWrites()
    ? writeDb<import("../../shared/types").SkillPackage>("upsertSkillPackage", [input])
    : upsertSkillPackage(input);
}
export async function replaceSkillEntriesAsync(
  skillId: string,
  packageId: string,
  entries: Parameters<typeof replaceSkillEntries>[2],
): Promise<SkillEntryView[]> {
  return shouldRouteWrites()
    ? writeDb<SkillEntryView[]>("replaceSkillEntries", [skillId, packageId, entries])
    : replaceSkillEntries(skillId, packageId, entries);
}
export async function setSkillPackageStatusAsync(
  skillId: string,
  status: SkillPackageStatus,
  lastError?: string | null,
): Promise<import("../../shared/types").SkillPackage | null> {
  return shouldRouteWrites()
    ? writeDb<import("../../shared/types").SkillPackage | null>("setSkillPackageStatus", [
        skillId,
        status,
        lastError,
      ])
    : setSkillPackageStatus(skillId, status, lastError);
}
export async function createSkillRunAsync(
  input: Parameters<typeof createSkillRun>[0],
): Promise<SkillRunRecord> {
  return shouldRouteWrites()
    ? writeDb<SkillRunRecord>("createSkillRun", [input])
    : createSkillRun(input);
}
export async function updateSkillRunAsync(
  id: string,
  patch: Parameters<typeof updateSkillRun>[1],
): Promise<SkillRunRecord | null> {
  return shouldRouteWrites()
    ? writeDb<SkillRunRecord | null>("updateSkillRun", [id, patch])
    : updateSkillRun(id, patch);
}
export async function deleteSkillPackageAsync(skillId: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteSkillPackage", [skillId]);
  deleteSkillPackage(skillId);
}
export async function setToolSecretAsync(input: ToolSecretInput): Promise<ToolSecretPublic> {
  return shouldRouteWrites()
    ? writeDb<ToolSecretPublic>("setToolSecret", [input])
    : setToolSecret(input);
}

export async function deleteToolSecretAsync(id: string): Promise<void> {
  if (shouldRouteWrites()) return writeDb<void>("deleteToolSecret", [id]);
  deleteToolSecret(id);
}

export function listToolSecretsPublic(
  ownerType?: ToolSecretOwnerType,
  ownerId?: string,
): ToolSecretPublic[] {
  const normalizedOwnerType = ownerType ? normalizeSecretOwnerType(ownerType) : null;
  const rows =
    normalizedOwnerType && ownerId
      ? getDb()
          .select()
          .from(toolSecrets)
          .where(
            and(eq(toolSecrets.owner_type, normalizedOwnerType), eq(toolSecrets.owner_id, ownerId)),
          )
          .all()
      : getDb().select().from(toolSecrets).all();
  return rows.map(publicToolSecret);
}

export function deleteToolSecret(id: string): void {
  getDb().delete(toolSecrets).where(eq(toolSecrets.id, id)).run();
}

export function deleteToolSecretsForOwner(ownerType: ToolSecretOwnerType, ownerId: string): void {
  const normalizedOwnerType = normalizeSecretOwnerType(ownerType);
  getDb()
    .delete(toolSecrets)
    .where(and(eq(toolSecrets.owner_type, normalizedOwnerType), eq(toolSecrets.owner_id, ownerId)))
    .run();
}

export function getToolSecretValue(
  ownerType: ToolSecretOwnerType,
  ownerId: string,
  key: string,
): string | null {
  const normalizedOwnerType = normalizeSecretOwnerType(ownerType);
  const row = getDb()
    .select()
    .from(toolSecrets)
    .where(
      and(
        eq(toolSecrets.owner_type, normalizedOwnerType),
        eq(toolSecrets.owner_id, ownerId),
        eq(toolSecrets.key, normalizeSecretKey(key)),
      ),
    )
    .get();
  if (!row) return null;
  try {
    return decrypt(JSON.parse(row.ciphertext) as EncryptedPayload);
  } catch {
    return null;
  }
}

export function resolveToolSecretReferences(
  ownerType: ToolSecretOwnerType,
  ownerId: string,
  values: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const secretKey = parseSecretReference(value);
      return [key, secretKey ? (getToolSecretValue(ownerType, ownerId, secretKey) ?? "") : value];
    }),
  );
}

export function getToolsSnapshot(): ToolsSnapshot {
  return {
    toolServers: listToolServers(),
    toolRecords: listToolRecords(),
    skills: listSkillTools(),
    skillPackages: listSkillPackages(),
    skillEntries: listSkillEntries(),
    skillRuns: listSkillRuns(),
    secrets: listToolSecretsPublic(),
    runtimeEvents: listRuntimeEvents(),
  };
}

export function listInteractionProfiles(): InteractionProfile[] {
  return getDb().select().from(interactionProfiles).orderBy(interactionProfiles.kind).all();
}

export function getSyncState(): SyncState {
  return ensureSyncProfile();
}

function toSandboxSessionView(session: SandboxSession): SandboxSessionView {
  const { root_path: _rootPath, ...view } = session;
  return view;
}

export function getRuntimeSnapshot(): RuntimeSnapshot {
  return buildRuntimeSnapshot(createRuntimeSnapshotReaders());
}

export function updateAyakaLearningState(input: {
  status: AgentRuntimeStatus;
  lastLearningAt?: number;
  lastError?: string | null;
}): void {
  upsertAgentRuntimeState({
    agent_id: DEFAULT_AGENT_ID,
    status: input.status,
    last_learning_at: input.lastLearningAt,
    last_error: input.lastError,
  });
}

export async function buildAgentSystemPrompt(
  agentId?: string | null,
  conversationId?: string,
  options?: { includeMemory?: boolean },
): Promise<string> {
  const agent = getAgent(agentId || DEFAULT_AGENT_ID) ?? getAgent(DEFAULT_AGENT_ID);
  if (!agent) return "You are Ayaka, a capable local AI assistant and orchestrator.";

  // 从文件层加载有界冻结快照；首次启动时从 agent.instructions 初始化
  let fileBlock = "";
  if (options?.includeMemory !== false) {
    const { prepareInnerContext } = await import("./agent-inner-context");
    const innerContext = await prepareInnerContext({
      agent,
      conversationId: conversationId ?? null,
    });
    fileBlock = innerContext.promptBlock;
  }
  // 可选：语义搜索补充最近 3 条相关记忆
  return [
    `You are ${agent.name}.`,
    `Role: ${agent.role}`,
    agent.personality ? `Personality seed: ${agent.personality}` : "",
    agent.soul_prompt ? `SOUL seed: ${agent.soul_prompt}` : "",
    fileBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** 从消息 content JSON 中提取纯文本（内联以避免与 agent-learning.ts 的循环依赖） */
export function listSandboxSessions(limit = 50): SandboxSession[] {
  return getDb()
    .select()
    .from(sandboxSessions)
    .orderBy(desc(sandboxSessions.updated_at))
    .limit(limit)
    .all();
}

export function getSandboxSession(id: string): SandboxSession | null {
  return getDb().select().from(sandboxSessions).where(eq(sandboxSessions.id, id)).get() ?? null;
}

export function listSandboxSessionsForConversation(
  conversationId: string,
  limit = 50,
): SandboxSession[] {
  return getDb()
    .select()
    .from(sandboxSessions)
    .where(eq(sandboxSessions.conversation_id, conversationId))
    .orderBy(desc(sandboxSessions.updated_at))
    .limit(limit)
    .all();
}

export function upsertSandboxSession(input: NewSandboxSession): SandboxSession {
  getDb()
    .insert(sandboxSessions)
    .values(input)
    .onConflictDoUpdate({
      target: sandboxSessions.id,
      set: {
        conversation_id: input.conversation_id,
        run_id: input.run_id,
        agent_id: input.agent_id,
        root_path: input.root_path,
        isolation_mode: input.isolation_mode,
        status: input.status,
        docker_available: input.docker_available,
        updated_at: input.updated_at,
      },
    })
    .run();
  return getDb().select().from(sandboxSessions).where(eq(sandboxSessions.id, input.id)).get()!;
}

export async function upsertSandboxSessionAsync(input: NewSandboxSession): Promise<SandboxSession> {
  return shouldRouteWrites()
    ? writeDb<SandboxSession>("upsertSandboxSession", [input])
    : upsertSandboxSession(input);
}

export function listSandboxSnapshots(limit = 100): SandboxSnapshot[] {
  return getDb()
    .select()
    .from(sandboxSnapshots)
    .orderBy(desc(sandboxSnapshots.created_at))
    .limit(limit)
    .all();
}

export function insertSandboxSnapshot(
  input: Omit<NewSandboxSnapshot, "id" | "created_at"> & { id?: string; created_at?: number },
): SandboxSnapshot {
  const row: NewSandboxSnapshot = {
    id: input.id ?? randomUUID(),
    session_id: input.session_id,
    label: input.label,
    manifest_json: input.manifest_json,
    created_at: input.created_at ?? Date.now(),
  };
  getDb().insert(sandboxSnapshots).values(row).run();
  return row as SandboxSnapshot;
}

export async function insertSandboxSnapshotAsync(
  input: Parameters<typeof insertSandboxSnapshot>[0],
): Promise<SandboxSnapshot> {
  return shouldRouteWrites()
    ? writeDb<SandboxSnapshot>("insertSandboxSnapshot", [input])
    : insertSandboxSnapshot(input);
}

export function getSandboxSnapshot(id: string): SandboxSnapshot | null {
  return getDb().select().from(sandboxSnapshots).where(eq(sandboxSnapshots.id, id)).get() ?? null;
}

export function listSandboxArtifacts(limit = 100): SandboxArtifact[] {
  return getDb()
    .select()
    .from(sandboxArtifacts)
    .orderBy(desc(sandboxArtifacts.created_at))
    .limit(limit)
    .all();
}

export function getSandboxArtifact(id: string): SandboxArtifact | null {
  return getDb().select().from(sandboxArtifacts).where(eq(sandboxArtifacts.id, id)).get() ?? null;
}

export function listSandboxArtifactsForSession(sessionId: string, limit = 100): SandboxArtifact[] {
  return getDb()
    .select()
    .from(sandboxArtifacts)
    .where(eq(sandboxArtifacts.session_id, sessionId))
    .orderBy(desc(sandboxArtifacts.updated_at))
    .limit(limit)
    .all();
}

export function updateSandboxArtifact(
  id: string,
  patch: Partial<
    Pick<
      SandboxArtifact,
      | "kind"
      | "path"
      | "url"
      | "size_bytes"
      | "entry_path"
      | "mime_type"
      | "sha256"
      | "status"
      | "updated_at"
    >
  >,
): SandboxArtifact {
  const now = patch.updated_at ?? Date.now();
  getDb()
    .update(sandboxArtifacts)
    .set({ ...patch, updated_at: now })
    .where(eq(sandboxArtifacts.id, id))
    .run();
  const row = getSandboxArtifact(id);
  if (!row) throw new Error("Sandbox artifact not found.");
  return row;
}

export async function updateSandboxArtifactAsync(
  id: string,
  patch: Parameters<typeof updateSandboxArtifact>[1],
): Promise<SandboxArtifact> {
  return shouldRouteWrites()
    ? writeDb<SandboxArtifact>("updateSandboxArtifact", [id, patch])
    : updateSandboxArtifact(id, patch);
}

export function insertSandboxArtifact(
  input: Omit<NewSandboxArtifact, "id" | "created_at"> & { id?: string; created_at?: number },
): SandboxArtifact {
  const row: NewSandboxArtifact = {
    id: input.id ?? randomUUID(),
    session_id: input.session_id,
    kind: input.kind,
    path: input.path,
    url: input.url ?? null,
    size_bytes: input.size_bytes ?? null,
    entry_path: input.entry_path ?? null,
    mime_type: input.mime_type ?? null,
    sha256: input.sha256 ?? null,
    status: input.status ?? "ready",
    created_at: input.created_at ?? Date.now(),
    updated_at: input.updated_at ?? input.created_at ?? Date.now(),
  };
  getDb().insert(sandboxArtifacts).values(row).run();
  return row as SandboxArtifact;
}

export async function insertSandboxArtifactAsync(
  input: Parameters<typeof insertSandboxArtifact>[0],
): Promise<SandboxArtifact> {
  return shouldRouteWrites()
    ? writeDb<SandboxArtifact>("insertSandboxArtifact", [input])
    : insertSandboxArtifact(input);
}

function seedDefaults(): void {
  const now = Date.now();
  if (!getAgent(DEFAULT_AGENT_ID)) {
    const agent: DbAgentProfile = {
      id: DEFAULT_AGENT_ID,
      name: DEFAULT_ROOT_AGENT_SEED.name,
      role: DEFAULT_ROOT_AGENT_SEED.role,
      instructions: DEFAULT_ROOT_AGENT_SEED.soul_prompt,
      persona: DEFAULT_ROOT_AGENT_SEED.personality,
      description: DEFAULT_ROOT_AGENT_SEED.description,
      avatar: DEFAULT_ROOT_AGENT_SEED.avatar,
      status: "active",
      kind: "main",
      parent_agent_id: null,
      locked: 1,
      enabled: 1,
      model_ref: null,
      voice: null,
      created_at: now,
      updated_at: now,
    };
    getDb().insert(agents).values(agent).run();
    getDb().insert(agentPolicies).values(defaultAgentPolicy(DEFAULT_AGENT_ID, now)).run();
  }

  for (const seed of DEFAULT_CHILD_AGENT_SEEDS) {
    const id = seed.id;
    if (!getAgent(id)) {
      const normalized = normalizeAgentInput(id, seed, null, now);
      getDb().insert(agents).values(normalized.agent).run();
      getDb().insert(agentPolicies).values(normalized.policy).run();
    }
  }

  migrateLegacyAgentAvatars();

  seedBuiltinTools(now);
  ensureSyncProfile();
  ensureAllagentRuntimeStates();
}

function migrateLegacyAgentAvatars(): void {
  const legacyAgents = getDb()
    .select({ id: agents.id, avatar: agents.avatar })
    .from(agents)
    .where(eq(agents.kind, "child"))
    .all()
    .filter((agent) => !isAgentAvatarId(agent.avatar));
  if (legacyAgents.length === 0) return;

  const updatedAt = Date.now();
  getDb().transaction((tx) => {
    for (const agent of legacyAgents) {
      tx.update(agents)
        .set({ avatar: DEFAULT_AGENT_AVATAR_ID, updated_at: updatedAt })
        .where(eq(agents.id, agent.id))
        .run();
    }
  });
}

function seedBuiltinTools(now: number): void {
  for (const seed of DEFAULT_BUILTIN_TOOL_SEEDS) {
    const existing = getDb().select().from(tools).where(eq(tools.id, seed.id)).get();
    if (existing) continue;
    getDb()
      .insert(tools)
      .values({
        id: seed.id,
        server_id: null,
        name: seed.id,
        title: seed.title,
        description: seed.description,
        kind: seed.category === "sandbox" ? "sandbox" : "builtin",
        category: seed.category,
        reference: seed.id,
        enabled: 1,
        auto_use: seed.defaultAuto,
        requires_approval: seed.requiresApproval,
        input_schema_json: "{}",
        output_schema_json: "{}",
        config_json: "{}",
        trigger_keywords_json: "[]",
        tags_json: "[]",
        discovered_at: now,
        last_run_at: null,
        updated_at: now,
        deleted_at: null,
        purge_after_at: null,
      })
      .run();
  }
}

function toAgentProfile(row: DbAgentProfile): AgentProfile {
  const policy = ensureAgentPolicy(row.id);
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    instructions: row.instructions,
    personality: row.persona,
    soul_prompt: row.instructions,
    persona: row.persona,
    avatar: row.avatar,
    status: row.status,
    kind: row.kind,
    parent_agent_id: row.parent_agent_id,
    locked: row.locked,
    enabled: row.enabled,
    tool_policy_json: policy.tool_policy_json,
    handoff_config_json: policy.routing_policy_json,
    runtime_config_json: policy.review_policy_json,
    model_ref: row.model_ref,
    voice: row.voice,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function ensureAgentPolicy(agentId: string): DbAgentPolicy {
  const existing = getDb()
    .select()
    .from(agentPolicies)
    .where(eq(agentPolicies.agent_id, agentId))
    .get();
  if (existing) return existing;
  const row = defaultAgentPolicy(agentId, Date.now());
  getDb().insert(agentPolicies).values(row).run();
  return row as DbAgentPolicy;
}

function defaultAgentPolicy(agentId: string, now: number): DbAgentPolicy {
  return {
    agent_id: agentId,
    tool_policy_json: JSON.stringify(DEFAULT_AGENT_TOOL_POLICY),
    review_policy_json: JSON.stringify(DEFAULT_AGENT_RUNTIME_CONFIG),
    sandbox_policy_json: JSON.stringify({ mode: DEFAULT_AGENT_RUNTIME_CONFIG.sandboxPolicy }),
    routing_policy_json: JSON.stringify(DEFAULT_AGENT_HANDOFF_CONFIG),
    updated_at: now,
  };
}

function normalizeAgentInput(
  id: string,
  input: Partial<AgentInput | AgentProfile>,
  existing: DbAgentProfile | null,
  now: number,
): { agent: DbAgentProfile; policy: DbAgentPolicy } {
  const existingProfile = existing ? toAgentProfile(existing) : null;
  const name = normalizeRequiredText(input.name ?? existingProfile?.name ?? "", "name", 80);
  const role = normalizeRequiredText(input.role ?? existingProfile?.role ?? "", "role", 160);
  const description = normalizeText(input.description ?? existingProfile?.description ?? "", 500);
  const personaInput = "persona" in input ? input.persona : undefined;
  const instructionsInput = "instructions" in input ? input.instructions : undefined;
  const persona = normalizeText(
    input.personality ?? personaInput ?? existingProfile?.personality ?? "",
    2_000,
  );
  const instructions = normalizeText(
    input.soul_prompt ?? instructionsInput ?? existingProfile?.soul_prompt ?? "",
    8_000,
  );
  const toolPolicy = normalizeAgentToolPolicy(
    input.tool_policy_json ?? existingProfile?.tool_policy_json,
    DEFAULT_AGENT_TOOL_POLICY,
  );
  const handoffConfig = normalizeAgentHandoffConfig(
    input.handoff_config_json ?? existingProfile?.handoff_config_json,
    DEFAULT_AGENT_HANDOFF_CONFIG,
  );
  const runtimeConfig = normalizeAgentRuntimeConfig(
    input.runtime_config_json ?? existingProfile?.runtime_config_json,
    DEFAULT_AGENT_RUNTIME_CONFIG,
  );
  const kind = existing?.kind ?? (id === DEFAULT_AGENT_ID ? "main" : "child");
  return {
    agent: {
      id,
      name,
      role,
      instructions,
      persona,
      description,
      avatar:
        kind === "main"
          ? normalizeAvatar(input.avatar ?? existingProfile?.avatar ?? name)
          : normalizeAgentAvatarId(input.avatar ?? existingProfile?.avatar),
      status: input.status ?? existingProfile?.status ?? "draft",
      kind,
      parent_agent_id:
        existing?.parent_agent_id ?? (id === DEFAULT_AGENT_ID ? null : DEFAULT_AGENT_ID),
      locked: existing?.locked ?? (id === DEFAULT_AGENT_ID ? 1 : 0),
      enabled: normalizeBooleanNumber(input.enabled ?? existingProfile?.enabled ?? 1),
      model_ref: normalizeNullableText(input.model_ref ?? existingProfile?.model_ref ?? null, 200),
      voice: normalizeNullableText(input.voice ?? existingProfile?.voice ?? null, 80),
      created_at: existing?.created_at ?? now,
      updated_at: now,
    },
    policy: {
      agent_id: id,
      tool_policy_json: JSON.stringify(toolPolicy),
      review_policy_json: JSON.stringify(runtimeConfig),
      sandbox_policy_json: JSON.stringify({ mode: runtimeConfig.sandboxPolicy ?? "local" }),
      routing_policy_json: JSON.stringify(handoffConfig),
      updated_at: now,
    },
  };
}

function getRequiredAgentRow(id: string): DbAgentProfile {
  const row = getDb().select().from(agents).where(eq(agents.id, id)).get();
  if (!row) throw new Error("Agent not found.");
  return row;
}

function assertAgentEditable(agent: DbAgentProfile): void {
  if (agent.locked !== 0) throw new Error("This agent is locked.");
}

function assertAgentNotBusy(agentId: string): void {
  const status = agentRuntimeStates.get(agentId)?.status;
  if (isAgentRuntimeBusy(status)) {
    throw new Error(`Agent is busy (${status}) and cannot be archived or deleted.`);
  }
}

function toRuntimeRun(row: DbRuntimeRun): RuntimeRun {
  return row as RuntimeRun;
}

function toAgentRunInput(row: DbAgentRunInput): AgentRunInput {
  return row as AgentRunInput;
}

function toRuntimeStep(row: DbRuntimeStep): RuntimeStep {
  return row as RuntimeStep;
}

function toRuntimeEvent(row: DbRuntimeEvent): RuntimeEvent {
  return row as RuntimeEvent;
}

function toToolServer(row: DbToolServer): ToolServer {
  return row as ToolServer;
}

function toManagedRuntime(row: DbManagedRuntime): ManagedRuntime {
  let verifiedCommands: RuntimeExecutableCommand[] = [];
  try {
    const value = JSON.parse(row.verified_commands_json) as unknown;
    if (Array.isArray(value))
      verifiedCommands = value.filter(
        (item): item is RuntimeExecutableCommand =>
          item === "node" || item === "npx" || item === "npm" || item === "uv" || item === "uvx",
      );
  } catch {
    verifiedCommands = [];
  }
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    platform: row.platform,
    architecture: row.architecture,
    libc: row.libc ?? null,
    rootPath: row.root_path,
    executablePath: row.executable_path,
    sourceUrl: row.source_url,
    sha256: row.sha256,
    verifiedCommands,
    channel: row.channel,
    status: row.status,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

function toRuntimePreference(row: DbRuntimePreference): RuntimePreference {
  return {
    kind: row.kind,
    manifestUrl: row.manifest_url,
    channel: row.channel,
    updatedAt: row.updated_at,
  };
}

function toMcpRuntimeState(row: DbMcpRuntimeState): McpServerRuntimeState {
  return {
    serverId: row.server_id,
    desiredState: row.desired_state,
    state: row.state,
    pid: row.pid,
    resolvedCommand: row.resolved_command,
    runtimeInstallationId: row.runtime_installation_id,
    startedAt: row.started_at,
    lastExitAt: row.last_exit_at,
    restartAttempts: row.restart_attempts,
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

function toMcpDependencyInstallation(row: DbMcpDependencyInstallation): McpDependencyInstallation {
  let packageSpecs: string[] = [];
  try {
    const value = JSON.parse(row.package_specs_json) as unknown;
    packageSpecs = Array.isArray(value) ? value.map(String) : [];
  } catch {
    packageSpecs = [];
  }
  return {
    id: row.id,
    serverId: row.server_id,
    manager: row.manager,
    packageSpecs,
    installRoot: row.install_root,
    status: row.status,
    scriptsAllowed: row.scripts_allowed,
    runtimeInstallationId: row.runtime_installation_id,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    lastError: row.last_error,
  };
}

function toToolRecord(row: DbToolRecord): ToolRecord {
  return row as ToolRecord;
}

function toToolSkill(row: DbToolRecord): ToolSkill {
  return {
    id: row.id,
    name: row.title ?? row.name,
    description: row.description,
    instructions: row.instructions,
    category: row.category,
    enabled: row.enabled,
    auto_use: row.auto_use,
    requires_approval: row.requires_approval,
    trigger_keywords_json: row.trigger_keywords_json,
    tags_json: row.tags_json,
    config_schema_json: row.input_schema_json,
    config_json: row.config_json,
    last_run_at: row.last_run_at,
    created_at: row.discovered_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    purge_after_at: row.purge_after_at,
  };
}

function toSkillPackage(row: DbSkillPackage): import("../../shared/types").SkillPackage {
  return {
    id: row.id,
    skillId: row.skill_id,
    source: row.source,
    rootPath: row.root_path,
    contentHash: row.content_hash,
    executionMode: row.execution_mode,
    status: row.status,
    manifest: parseJsonObject(row.manifest_json),
    safety: parseJsonObject(row.safety_json),
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSkillEntry(row: DbSkillEntry): SkillEntryView {
  return {
    id: row.id,
    skillId: row.skill_id,
    relativePath: row.relative_path,
    name: row.name,
    runtime: row.runtime,
    enabled: row.enabled !== 0,
    available: row.available !== 0,
    unavailableReason: row.unavailable_reason ?? undefined,
    timeoutMs: row.timeout_ms,
  };
}

function toSkillRun(row: DbSkillRun): SkillRunRecord {
  return {
    runId: row.id,
    skillId: row.skill_id,
    entryId: row.entry_id,
    status: row.status as SkillRunStatus,
    exitCode: row.exit_code,
    signal: row.signal,
    stdout: row.stdout,
    stderr: row.stderr,
    durationMs: row.duration_ms,
    truncated: row.truncated !== 0,
    ...(row.error ? { error: row.error } : {}),
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    cwd: row.cwd,
    argsJson: row.args_json,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function skillDependencies(
  pkg: import("../../shared/types").SkillPackage | null,
): SkillDependencyStatus[] {
  if (!pkg) return [];
  const raw = pkg.manifest.dependencies;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const kind =
      value.kind === "browser" || value.type === "browser"
        ? "browser"
        : value.kind === "runtime" || value.type === "runtime"
          ? "runtime"
          : value.type === "mcp" || value.kind === "mcp"
            ? "mcp"
            : null;
    if (!kind) return [];
    const status = [
      "ready",
      "needs_confirmation",
      "needs_runtime",
      "needs_install",
      "failed",
    ].includes(String(value.status))
      ? (String(value.status) as SkillDependencyStatus["status"])
      : kind === "runtime"
        ? "needs_runtime"
        : "needs_confirmation";
    return [
      {
        id: typeof value.id === "string" ? value.id : `dependency-${index + 1}`,
        skillId: pkg.skillId,
        kind,
        name: (typeof value.name === "string"
          ? value.name
          : typeof value.value === "string"
            ? value.value
            : `${kind}-${index + 1}`
        ).slice(0, 200),
        status,
        source:
          typeof value.source === "string"
            ? value.source
            : typeof value.url === "string"
              ? value.url
              : undefined,
        detail: typeof value.description === "string" ? value.description : undefined,
        error: typeof value.error === "string" ? value.error : undefined,
      },
    ];
  });
}

function normalizeSkillRelativePath(raw: string): string {
  const value = String(raw)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "");
  if (!value.startsWith("scripts/") || value.includes("\0") || value.split("/").includes("..")) {
    throw new Error("Skill entry must remain inside scripts/.");
  }
  return value;
}

function normalizeToolServerInput(
  id: string,
  input: Partial<ToolServerInput>,
  existing: ToolServer | null,
  now: number,
): NewToolServer {
  const transport = normalizeMcpTransport(input.transport ?? existing?.transport ?? "stdio");
  return {
    id,
    name: normalizeRequiredText(input.name ?? existing?.name ?? "", "name", 120),
    description: normalizeText(input.description ?? existing?.description ?? "", 500),
    kind: "mcp",
    transport,
    enabled: normalizeBooleanNumber(input.enabled ?? existing?.enabled ?? 1),
    auto_use: normalizeBooleanNumber(input.auto_use ?? existing?.auto_use ?? 0),
    requires_approval: normalizeBooleanNumber(
      input.requires_approval ?? existing?.requires_approval ?? 1,
    ),
    config_source: input.config_source ?? existing?.config_source ?? "manual",
    config_version: Math.max(
      1,
      Math.round(Number(input.config_version ?? existing?.config_version ?? 1)),
    ),
    status: input.enabled === false ? "disabled" : (existing?.status ?? "unknown"),
    command: normalizeNullableText(input.command ?? existing?.command ?? null, 500),
    args_json: normalizeJsonArrayString(input.args ?? existing?.args_json ?? []),
    url: normalizeNullableText(input.url ?? existing?.url ?? null, 1_000),
    headers_json: normalizeStringRecordJson(input.headers ?? existing?.headers_json ?? {}),
    env_json: normalizeStringRecordJson(input.env ?? existing?.env_json ?? {}),
    cwd: normalizeNullableText(input.cwd ?? existing?.cwd ?? null, 1_000),
    timeout_seconds: normalizeTimeoutSeconds(
      input.timeout_seconds ?? existing?.timeout_seconds ?? 60,
    ),
    last_error: existing?.last_error ?? null,
    last_connected_at: existing?.last_connected_at ?? null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
    deleted_at: null,
    purge_after_at: null,
  };
}

function normalizeSkillToolInput(
  id: string,
  input: Partial<ToolSkillInput>,
  existing: DbToolRecord | null,
  now: number,
): NewToolRecord {
  const name = normalizeRequiredText(
    input.name ?? existing?.title ?? existing?.name ?? "",
    "name",
    120,
  );
  const category = normalizeRequiredText(
    input.category ?? existing?.category ?? "general",
    "category",
    80,
  );
  return {
    id,
    server_id: null,
    name: slugPart(name),
    title: name,
    description: normalizeText(input.description ?? existing?.description ?? "", 800),
    instructions: normalizeText(input.instructions ?? existing?.instructions ?? "", 20_000),
    kind: "skill",
    category,
    reference: `skill:${id}`,
    enabled: normalizeBooleanNumber(input.enabled ?? existing?.enabled ?? 1),
    auto_use: normalizeBooleanNumber(input.auto_use ?? existing?.auto_use ?? 0),
    requires_approval: normalizeBooleanNumber(
      input.requires_approval ?? existing?.requires_approval ?? 1,
    ),
    input_schema_json: normalizeJsonObjectString(
      input.configSchema ?? existing?.input_schema_json ?? {},
    ),
    output_schema_json: "{}",
    config_json: normalizeJsonObjectString(input.config ?? existing?.config_json ?? {}),
    trigger_keywords_json: normalizeJsonArrayString(
      input.triggerKeywords ?? existing?.trigger_keywords_json ?? [],
    ),
    tags_json: normalizeJsonArrayString(input.tags ?? existing?.tags_json ?? []),
    discovered_at: existing?.discovered_at ?? now,
    last_run_at: existing?.last_run_at ?? null,
    updated_at: now,
    deleted_at: null,
    purge_after_at: null,
  };
}

function getRequiredToolServer(id: string): ToolServer {
  const server = getToolServer(id);
  if (!server) throw new Error("Tool server not found.");
  return server;
}

function getRequiredToolRecord(id: string): DbToolRecord {
  const row = getDb().select().from(tools).where(eq(tools.id, id)).get();
  if (!row) throw new Error("Tool not found.");
  return row;
}

function ensureSyncProfile(): SyncState {
  const existing = getDb()
    .select()
    .from(syncProfiles)
    .where(eq(syncProfiles.id, DEFAULT_SYNC_PROFILE_ID))
    .get();
  if (existing) return existing as SyncState;
  const row: SyncState = {
    id: DEFAULT_SYNC_PROFILE_ID,
    mode: "local_only",
    endpoint: null,
    device_id: randomUUID(),
    encryption_enabled: 1,
    conflict_strategy: "last_write_wins",
    status: "idle",
    last_synced_at: null,
    updated_at: Date.now(),
  };
  getDb().insert(syncProfiles).values(row).run();
  return row;
}

function ensureAllagentRuntimeStates(): void {
  for (const agent of listAgents()) {
    if (!agentRuntimeStates.has(agent.id)) {
      upsertAgentRuntimeState({ agent_id: agent.id, status: "idle" });
    }
  }
}

function normalizeRuntimeKind(kind: string): NewRuntimeEvent["kind"] {
  if (kind === "model") return "model";
  if (kind === "tool" || kind === "test" || kind === "automation" || kind === "agent")
    return "tool";
  if (kind === "approval") return "approval";
  if (kind === "handoff" || kind === "consult") return "handoff";
  if (kind === "memory" || kind === "learning") return "memory";
  if (kind === "loop_input") return "loop_input";
  if (kind === "skill") return "skill";
  if (kind === "budget") return "budget";
  if (kind === "sandbox") return "sandbox";
  if (kind === "guardrail" || kind === "input_guardrail" || kind === "output_guardrail")
    return "guardrail";
  if (kind === "error") return "error";
  return "diagnostic";
}

function redactDetail(detail: unknown): unknown {
  const redactKeys = new Set(["apiKey", "api_key", "authorization", "password", "secret", "token"]);
  if (Array.isArray(detail)) return detail.map(redactDetail);
  if (detail && typeof detail === "object") {
    return Object.fromEntries(
      Object.entries(detail as Record<string, unknown>).map(([key, value]) => [
        key,
        redactKeys.has(key.toLowerCase()) ? "[redacted]" : redactDetail(value),
      ]),
    );
  }
  return detail;
}

function normalizeRequiredText(raw: unknown, label: string, maxLength: number): string {
  const value = stringifyInput(raw).trim().slice(0, maxLength);
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function normalizeText(raw: unknown, maxLength: number): string {
  return stringifyInput(raw).trim().slice(0, maxLength);
}

function normalizeNullableText(raw: unknown, maxLength: number): string | null {
  if (raw === null || raw === undefined) return null;
  const value = stringifyInput(raw).trim().slice(0, maxLength);
  return value || null;
}

function normalizeAvatar(raw: unknown): string {
  const value = stringifyInput(raw ?? "A").trim();
  return (value || "A").slice(0, 8);
}

function stringifyInput(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
    return String(raw);
  }
  return "";
}

function normalizeBooleanNumber(raw: unknown): number {
  return raw === true || raw === 1 || raw === "1" ? 1 : 0;
}

function normalizeTimeoutSeconds(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 60;
  return Math.min(600, Math.max(1, Math.round(parsed)));
}

function normalizeJsonObjectString(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return JSON.stringify(
        parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {},
      );
    } catch {
      return "{}";
    }
  }
  return JSON.stringify(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {});
}

function normalizeJsonArrayString(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return JSON.stringify(Array.isArray(parsed) ? parsed : []);
    } catch {
      return "[]";
    }
  }
  return JSON.stringify(Array.isArray(raw) ? raw : []);
}

function normalizeStringRecordJson(raw: unknown): string {
  if (typeof raw === "string") {
    try {
      return normalizeStringRecordJson(JSON.parse(raw));
    } catch {
      return "{}";
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "{}";
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
    ),
  );
}

function normalizeMcpTransport(raw: unknown): ToolServer["transport"] {
  return raw === "http" || raw === "sse" ? raw : "stdio";
}

function normalizeSecretOwnerType(raw: unknown): ToolSecretOwnerType {
  return raw === "tool" || raw === "skill" ? "tool" : "server";
}

function normalizeSecretKey(raw: unknown): string {
  return normalizeRequiredText(raw, "secret key", 80).replace(/[^A-Za-z0-9_.-]/g, "_");
}

function publicToolSecret(secret: DbToolSecret): ToolSecretPublic {
  return {
    id: secret.id,
    owner_type: secret.owner_type,
    owner_id: secret.owner_id,
    key: secret.key,
    label: secret.label,
    updated_at: secret.updated_at,
  };
}

function parseSecretReference(value: string): string | null {
  const match = /^\$secret:([A-Za-z0-9_.-]+)$/.exec(value.trim());
  return match?.[1] ?? null;
}

function toolSecretId(ownerType: ToolSecretOwnerType, ownerId: string, key: string): string {
  return `${ownerType}-${slugPart(ownerId)}-${slugPart(key)}`;
}

function toolRowId(serverId: string, name: string): string {
  return `tool-${slugPart(serverId)}-${slugPart(name)}`;
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
