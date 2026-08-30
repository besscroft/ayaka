export interface Conversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_revision: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

export type TrayAction = "open-settings" | "open-home" | "new-chat";

export interface TrayMenuLabels {
  settings: string;
  openHome: string;
  chat: string;
  quit: string;
}

/** 消息记录（对应 DB 中的 messages 表） */
export interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  /** Serialized UIMessage JSON. Kept for renderer compatibility. */
  content: string;
  content_json?: string;
  metadata_json?: string;
  created_at: number;
}

export interface MessageSnapshot {
  messages: MessageRow[];
  revision: number;
}

export interface MessagePatch {
  conversationId: string;
  baseRevision: number;
  upserts: MessageRow[];
  deleteIds: string[];
}

export interface MessagePatchResult {
  applied: boolean;
  revision: number;
}

export type CronSchedule =
  | { kind: "once"; at: string }
  | { kind: "interval"; everyMs: number; anchorAt?: string }
  | { kind: "cron"; expression: string; timezone: string };

export interface CronPayload {
  prompt: string;
  agentId?: string;
  modelRef?: string;
  reasoning?: ChatReasoningLevel;
  skillIds?: string[];
  toolSelection?: ChatToolSelectionRequest;
}

export type CronJobStatus = "active" | "paused" | "completed" | "error";

export interface CronJob {
  id: string;
  name: string;
  description: string;
  schedule: CronSchedule;
  payload: CronPayload;
  status: CronJobStatus;
  conversationId: string;
  nextRunAt: number | null;
  lastRunAt: number | null;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CronRun {
  id: string;
  jobId: string;
  conversationId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
  scheduledFor: number;
  startedAt: number | null;
  finishedAt: number | null;
  attempt: number;
  output: string | null;
  error: string | null;
  runtimeRunId: string | null;
  createdAt: number;
}

export interface CronJobInput {
  name: string;
  description?: string;
  schedule: CronSchedule;
  payload: CronPayload;
}

export type CatalogArtifactType = "skill" | "mcp";
export type CatalogSourceKind = "modelscope-skills" | "skills-sh" | "builtin-mcp";
export type CatalogSourceFilter = "all" | CatalogSourceKind;
export type CatalogSort = "featured" | "latest" | "name";
export type CatalogTagFilter = "featured" | "verified";

export interface CatalogMetric {
  installs?: number;
  downloads?: number;
}

export interface CatalogItem {
  id: string;
  sourceId: string;
  sourceKind: CatalogSourceKind;
  sourceLabel: string;
  artifactType: CatalogArtifactType;
  externalId: string;
  canonicalKey: string | null;
  name: string;
  description: string;
  version: string | null;
  installUrl: string | null;
  catalogUrl: string | null;
  metrics: CatalogMetric;
  detail: JsonObject;
  contentHash: string | null;
  cachedAt: number;
  installed: boolean;
  updateAvailable: boolean;
}

export interface CatalogItemDetail {
  itemId: string;
  artifactType: CatalogArtifactType;
  markdown: string;
  files: Array<{ path: string; size: number }>;
  totalBytes: number;
  contentHash: string;
  safetyChecks: string[];
  executionMode?: SkillExecutionMode;
  scripts?: SkillEntry[];
  dependencies?: SkillDependencyStatus[];
  mcp?: CatalogMcpDetail;
}

export interface CatalogMcpConfig {
  transport: "stdio" | "http" | "sse";
  command: string | null;
  args: string[];
  url: string | null;
  headers: Record<string, string>;
  env: Record<string, string>;
  secretKeys: string[];
}

export interface CatalogMcpToolSummary {
  name: string;
  description: string;
}

export interface CatalogMcpDetail {
  author: string;
  repositoryUrl: string | null;
  homepageUrl: string | null;
  docsUrl: string | null;
  tags: string[];
  category: string | null;
  featured: boolean;
  verified: boolean;
  config: CatalogMcpConfig;
  tools: CatalogMcpToolSummary[];
  parseStatus: "ready" | "partial" | "unsupported";
  warnings: string[];
}

export interface McpPresetDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  repositoryUrl?: string | null;
  homepageUrl?: string | null;
  docsUrl?: string | null;
  tags?: string[];
  category?: string | null;
  featured?: boolean;
  verified?: boolean;
  transport: Exclude<McpTransportKind, "builtin">;
  command?: string | null;
  args?: string[];
  url?: string | null;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  secretKeys?: string[];
  tools?: CatalogMcpToolSummary[];
  warnings?: string[];
}

export interface CatalogFacet {
  id: string;
  label: string;
  count: number;
}

export interface CatalogFacets {
  categories: CatalogFacet[];
  tags: Array<{ id: CatalogTagFilter; count: number }>;
}

export interface ArtifactInstallation {
  id: string;
  itemId: string | null;
  sourceId: string | null;
  artifactType: CatalogArtifactType;
  name: string;
  version: string | null;
  contentHash: string | null;
  installPath: string | null;
  status: "disabled" | "enabled" | "error" | "update-available";
  safety: JsonObject;
  config: JsonObject;
  toolServerId: string | null;
  skillId: string | null;
  lastError: string | null;
  installedAt: number;
  updatedAt: number;
}

export interface CatalogInstallInput {
  itemId: string;
  enable?: boolean;
  secrets?: Record<string, string>;
  config?: JsonObject;
}

export interface CatalogSnapshot {
  installations: ArtifactInstallation[];
}

export interface CatalogSearchInput {
  query?: string;
  page?: number;
  pageSize?: number;
  source?: CatalogSourceFilter;
  artifactType?: CatalogArtifactType;
  sort?: CatalogSort;
  tag?: CatalogTagFilter;
  category?: string;
}

export interface CatalogSourceState {
  source: CatalogSourceKind;
  status: "online" | "cache" | "error" | "idle" | "builtin";
  hasMore: boolean;
  error?: string;
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  sources: CatalogSourceState[];
  facets?: CatalogFacets;
}

export type AgentStatus = "active" | "draft" | "archived";
export type AgentKind = "main" | "child";
export type AgentHandoffMode = "handoff" | "consult" | "both";
export type AgentRuntimeStatus =
  | "idle"
  | "queued"
  | "running"
  | "reviewing"
  | "handoff"
  | "tool_calling"
  | "sandbox"
  | "learning"
  | "blocked"
  | "failed";

export function isAgentRuntimeBusy(status: AgentRuntimeStatus | null | undefined): boolean {
  switch (status) {
    case "queued":
    case "running":
    case "reviewing":
    case "handoff":
    case "tool_calling":
    case "sandbox":
    case "learning":
      return true;
    default:
      return false;
  }
}

export type AgentReviewPolicy = "inherit" | "auto" | "review_sensitive" | "review_all";
export type AgentSandboxPolicy = "inherit" | "disabled" | "local" | "docker";
export type ChatToolReference = string;

export interface AgentToolPolicy {
  mode: "inherit" | "custom";
  allowedToolIds: ChatToolReference[];
  requireApprovalToolIds: ChatToolReference[];
}

export interface AgentHandoffConfig {
  mode: AgentHandoffMode;
  priority: "low" | "normal" | "high";
  accepts: string[];
  expectedOutput: string;
}

export interface AgentRuntimeConfig {
  maxTurns: number;
  maxDurationMs?: number;
  maxToolCalls?: number;
  absoluteMaxDurationMs?: number;
  absoluteMaxToolCalls?: number;
  maxNoProgressRounds?: number;
  maxConcurrentSubagents?: number;
  totalTimeoutMs?: number;
  contextPolicy?: AgentContextPolicy;
  compactionModelRef?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  reasoning?: ChatReasoningLevel;
  reviewPolicy?: AgentReviewPolicy;
  sandboxPolicy?: AgentSandboxPolicy;
  notes?: string;
}

export type AgentContextMode = "off" | "prune" | "semantic";

export interface AgentContextPolicy {
  mode: AgentContextMode;
  pruneThreshold: number;
  compactThreshold: number;
  targetRatio: number;
  keepRecentTokens: number;
}

export type AgentInstanceStatus =
  | "queued"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "interrupted";

export type AgentCollaborationAction =
  | "spawn_agent"
  | "send_message"
  | "followup_task"
  | "wait_agent"
  | "interrupt_agent"
  | "list_agents";

export type AgentRuntimeEventType =
  | "agent.lifecycle"
  | "agent.text.delta"
  | "tool.call"
  | "tool.result"
  | "collaboration.call"
  | "collaboration.result"
  | "agent.message"
  | "ownership.changed"
  | "context.compacted"
  | "run.completed"
  | "run.failed";

export interface AgentInstanceRecord {
  id: string;
  run_id: string;
  agent_id: string;
  agent_path: string;
  parent_instance_id: string | null;
  parent_agent_path: string | null;
  status: AgentInstanceStatus;
  task_name: string;
  task_summary: string;
  turn_count: number;
  last_message: string | null;
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface AgentCollaborationMessage {
  id: string;
  run_id: string;
  author_path: string;
  recipient_path: string;
  kind: "task" | "message" | "final_answer";
  content: string;
  created_at: number;
  delivered_at: number | null;
}

export interface AgentContextCheckpoint {
  id: string;
  run_id: string | null;
  conversation_id: string | null;
  agent_instance_id: string | null;
  agent_path: string;
  version: number;
  reason: "threshold" | "overflow" | "manual";
  summary: string;
  source_message_count: number;
  retained_message_count: number;
  estimated_tokens_before: number;
  estimated_tokens_after: number;
  model_ref: string | null;
  created_at: number;
}

export interface ContextUsage {
  inputTokens: number;
  contextWindow: number;
  availableInputTokens: number;
  utilization: number;
  accuracy: "exact" | "estimate";
  pruneCount: number;
  compactionCount: number;
}

export interface CompactionCheckpoint extends AgentContextCheckpoint {
  strategy: "server" | "semantic";
  providerItemId?: string;
}

export interface ContextEngineResult {
  messages: unknown[];
  changed: boolean;
  usage: ContextUsage;
  checkpoints: CompactionCheckpoint[];
}

export interface AgentRuntimeProtocolEvent {
  id: string;
  runId: string;
  sequence: number;
  type: AgentRuntimeEventType;
  agentPath: string;
  parentAgentPath: string | null;
  phase?: "start" | "progress" | "final_answer" | "end" | "error";
  createdAt: number;
  payload: JsonObject;
}

export interface AgentBackendCapabilities {
  provider: "ai-sdk" | "openai-responses-multi-agent" | "harness";
  hostedCollaboration: boolean;
  perAgentToolPolicies: boolean;
  httpOutputItemReplay: boolean;
  batchPendingFunctionCalls: boolean;
  websocketInjection: boolean;
  injectionAcknowledgements: boolean;
  responseCompletedContinuation: boolean;
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  instructions?: string;
  persona?: string;
  description: string;
  personality: string;
  soul_prompt: string;
  avatar: string;
  status: AgentStatus;
  kind: AgentKind;
  parent_agent_id: string | null;
  locked: number;
  enabled: number;
  tool_policy_json: string;
  handoff_config_json: string;
  runtime_config_json: string;
  model_ref: string | null;
  voice: string | null;
  created_at: number;
  updated_at: number;
}

export interface AgentInput {
  name: string;
  role: string;
  description: string;
  personality: string;
  soul_prompt: string;
  avatar: string;
  status?: AgentStatus;
  enabled?: boolean | number;
  model_ref?: string | null;
  voice?: string | null;
  tool_policy_json?: string;
  handoff_config_json?: string;
  runtime_config_json?: string;
}

export interface RuntimeRun {
  id: string;
  conversation_id: string | null;
  root_agent_id: string | null;
  final_agent_id: string | null;
  origin: AgentRunOrigin;
  finish_reason: AgentRunFinishReason | null;
  status: RunStatus;
  model_ref: string | null;
  started_at: number;
  finished_at: number | null;
  trace_id: string | null;
  input_summary: string | null;
  output_summary: string | null;
  error: string | null;
  usage_json: string | null;
  metadata_json?: string;
  updated_at?: number;
}

export type RuntimeStepKind =
  | "agent"
  | "model"
  | "tool"
  | "approval"
  | "handoff"
  | "memory"
  | "loop_input"
  | "skill"
  | "budget"
  | "sandbox"
  | "guardrail"
  | "diagnostic"
  | "error";

export type WorkspaceCommandRisk =
  | "read_only"
  | "write"
  | "destructive"
  | "install"
  | "network"
  | "process"
  | "unknown";

export type WorkspaceCommandOutcome = "completed" | "failed_to_start" | "timed_out" | "cancelled";

export interface WorkspaceCommandInput {
  executable: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface WorkspaceCommandResult {
  executable: string;
  args: string[];
  cwd: string;
  outcome: WorkspaceCommandOutcome;
  risk: WorkspaceCommandRisk;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  aborted: boolean;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  error?: string;
}

export interface RuntimeStep {
  id: string;
  run_id: string;
  agent_id: string | null;
  tool_id?: string | null;
  kind: RuntimeStepKind;
  status: RunStatus;
  title: string;
  detail_json: string;
  started_at: number;
  finished_at: number | null;
  error: string | null;
}

export interface AgentRuntimeState {
  agent_id: string;
  status: AgentRuntimeStatus;
  current_run_id: string | null;
  last_handoff_at: number | null;
  last_tool_at: number | null;
  last_learning_at: number | null;
  last_error: string | null;
  updated_at: number;
}

export interface ConversationAgentState {
  conversation_id: string;
  active_agent_id: string | null;
  current_run_id: string | null;
  current_step_id: string | null;
  status: AgentRuntimeStatus;
  summary: string | null;
  updated_at: number;
}

export type MemoryScope = "global" | "agent";
export type MemoryKind = "fact" | "preference" | "episode" | "profile" | "skill";
export type MemoryOrigin = "manual" | "auto" | "dream" | "import" | "system";
export type MemoryStatus = "active" | "superseded" | "archived" | "deleted";
export type MemorySyncStatus = "pending" | "synced" | "failed";

export interface MemoryRecord {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  title: string;
  content: string;
  agent_id: string | null;
  conversation_id: string | null;
  source_run_id?: string | null;
  salience: number;
  pinned: number;
  confidence?: number;
  origin?: MemoryOrigin;
  status?: MemoryStatus;
  evidence_json?: string;
  last_used_at?: number | null;
  expires_at?: number | null;
  supersedes_id?: string | null;
  mem0_id?: string | null;
  sync_status?: MemorySyncStatus;
  strength?: number;
  last_reinforced_at?: number | null;
  created_at: number;
  updated_at: number;
}

export type MemoryObservationStatus = "pending" | "promoted" | "expired" | "rejected";

export interface MemoryObservation {
  id: string;
  dedupe_key: string;
  title: string;
  content: string;
  kind: MemoryKind;
  source_conversation_id: string | null;
  source_run_id: string | null;
  source_agent_id: string | null;
  confidence: number;
  evidence_count: number;
  evidence_json: string;
  status: MemoryObservationStatus;
  expires_at: number;
  promoted_memory_id: string | null;
  created_at: number;
  updated_at: number;
}

export type MemoryJobKind = "learn" | "consolidate" | "sync" | "decay" | "rehydrate";
export type MemoryJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface MemoryJob {
  id: string;
  idempotency_key: string | null;
  kind: MemoryJobKind;
  status: MemoryJobStatus;
  conversation_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  scheduled_at: number;
  started_at: number | null;
  finished_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface MemoryContextSnapshot {
  agentId: string;
  conversationId: string | null;
  promptBlock: string;
  relevantMemories: MemoryRecord[];
  charBudget: number;
  charCount: number;
  generatedAt: number;
}

/** 智能体自动提取后、等待用户确认的记忆建议（已废弃，保留类型避免旧数据反序列化失败） */
export interface MemoryPendingSuggestion {
  id: string;
  title: string;
  content: string;
  scope: MemoryScope;
  kind: MemoryKind;
  salience: number;
  suggestedAt: number;
  sourceConversationId: string;
  sourceAgentId: string | null;
}

/** 有界记忆文件类型 */
export type MemoryFileKind = "soul" | "user" | "memory";

/** 记忆文件快照，供渲染层记忆页面展示 */
export interface AgentMemoryFileSnapshot {
  kind: MemoryFileKind;
  content: string;
  charLimit: number;
  charCount: number;
  updatedAt: number;
}

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_handoff"
  | "blocked"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type RuntimeStatus = RunStatus;
export type AgentRunOrigin = "chat" | "automation" | "system";
export type AgentRunFinishReason =
  | "natural"
  | "budget_exhausted"
  | "absolute_limit"
  | "cancelled"
  | "interrupted"
  | "error";
export type AgentRunInputKind = "steering" | "follow_up";
export type AgentRunInputSource = "user" | "system" | "automation" | "tool";
export type AgentRunInputStatus = "queued" | "consumed" | "discarded";

export interface AgentRunInput {
  id: string;
  run_id: string;
  kind: AgentRunInputKind;
  source: AgentRunInputSource;
  status: AgentRunInputStatus;
  message_json: string;
  sequence: number;
  created_at: number;
  consumed_at: number | null;
  discarded_reason: string | null;
}

export interface AgentLoopControlMetadata {
  windowCount: number;
  totalTurns: number;
  totalToolCalls: number;
  noProgressRounds: number;
  absoluteDeadline: number;
  blockedReason?: string;
  resumable: boolean;
  windowStartedAt?: number;
}

export interface RuntimeEvent {
  id: string;
  run_id: string | null;
  step_id: string | null;
  conversation_id: string | null;
  agent_id: string | null;
  tool_id: string | null;
  owner_type: string | null;
  owner_id: string | null;
  kind: RuntimeStepKind;
  status: RunStatus;
  severity: "debug" | "info" | "warning" | "error";
  title: string;
  detail_json: string;
  duration_ms: number | null;
  created_at: number;
  event_type?: AgentRuntimeEventType | null;
  agent_path?: string | null;
  parent_agent_path?: string | null;
  sequence?: number | null;
}

export type ErrorLogSource = "main" | "renderer";
export type ErrorLogLevel = "warning" | "error";
export type ErrorLogOrigin =
  | "console"
  | "window-error"
  | "unhandledrejection"
  | "uncaughtException";

export interface ErrorLogError {
  name: string;
  message: string;
  stack?: string;
}

export interface ErrorLogInput {
  source: ErrorLogSource;
  level: ErrorLogLevel;
  origin: ErrorLogOrigin;
  message?: string;
  args?: unknown[];
  details?: unknown;
  error?: unknown;
  timestamp?: number;
}

export interface ErrorLogRecord {
  timestamp: string;
  source: ErrorLogSource;
  level: ErrorLogLevel;
  origin: ErrorLogOrigin;
  message: string;
  details?: unknown;
  error?: ErrorLogError;
}

export type ErrorLogExportResult = "saved" | "empty" | "cancelled";

export type SandboxIsolationMode = "docker" | "local";
export type SandboxStatus = "active" | "stopped" | "failed";

export interface SandboxSession {
  id: string;
  conversation_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  root_path: string;
  isolation_mode: SandboxIsolationMode;
  status: SandboxStatus;
  docker_available: number;
  created_at: number;
  updated_at: number;
}

/** Renderer-safe sandbox session projection. It intentionally omits root_path. */
export type SandboxSessionView = Omit<SandboxSession, "root_path">;

export interface SandboxSnapshot {
  id: string;
  session_id: string;
  label: string;
  manifest_json: string;
  created_at: number;
}

export interface SandboxArtifact {
  id: string;
  session_id: string;
  kind: SandboxArtifactKind;
  path: string;
  url: string | null;
  size_bytes: number | null;
  entry_path: string | null;
  mime_type: string | null;
  sha256: string | null;
  status: SandboxArtifactStatus;
  created_at: number;
  updated_at: number;
  /** Only populated by the main-process public artifact projection. */
  authorized?: boolean;
}

/** Main-process event projection; conversationId is never persisted in artifact metadata. */
export interface SandboxArtifactUpdate extends SandboxArtifact {
  conversationId: string;
}

export type SandboxArtifactKind = "file" | "directory" | "html" | "static" | "preview";
export type SandboxArtifactStatus = "candidate" | "ready" | "running" | "stopped" | "failed";

export type SandboxPreviewStatus = "starting" | "running" | "stopped" | "failed";

export interface SandboxPreview {
  id: string;
  artifact_id: string;
  conversation_id: string;
  port: number;
  url: string;
  status: SandboxPreviewStatus;
  error: string | null;
  updated_at: number;
}

export interface BrowserTab {
  id: string;
  conversation_id: string;
  url: string;
  title: string;
  favicon_url: string | null;
  position: number;
  active: number;
  loading: number;
  can_go_back: number;
  can_go_forward: number;
  updated_at: number;
}

export interface BrowserElementSnapshot {
  ref: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  type?: string;
  checked?: boolean;
  disabled?: boolean;
}

export interface BrowserPageSnapshot {
  tabId: string;
  url: string;
  title: string;
  text: string;
  elements: BrowserElementSnapshot[];
  snapshotId: string;
}

export interface BrowserScreenshot {
  id: string;
  tabId: string;
  path: string;
  filename: string;
  mediaType: "image/png";
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: number;
}

export interface BrowserDownload {
  id: string;
  tabId: string;
  filename: string;
  path: string;
  url: string;
  sizeBytes: number | null;
  status: "progressing" | "completed" | "cancelled" | "interrupted";
  createdAt: number;
}

export interface BrowserSessionSnapshot {
  conversationId: string;
  tabs: BrowserTab[];
  activeTabId: string | null;
  latestScreenshot: BrowserScreenshot | null;
  downloads: BrowserDownload[];
}

export interface BrowserSessionUpdate {
  conversationId: string;
  session: BrowserSessionSnapshot;
}

export interface BrowserCaptureResult {
  screenshot: BrowserScreenshot;
  data: ArrayBuffer;
}

export interface SandboxArtifactReadResult {
  artifactId: string;
  kind: "html";
  path: string;
  mimeType: "text/html";
  sizeBytes: number;
  sha256: string;
  text: string;
  truncated: boolean;
}

export type ToolStatus = "ready" | "disabled" | "error" | "unknown";
export type McpTransportKind = "stdio" | "http" | "sse" | "builtin";
export type McpProtocolEra = "modern" | "legacy";
export type RuntimeKind = "node" | "uv";
export type RuntimePlatform = "win32" | "darwin" | "linux";
export type RuntimeArchitecture = "x64" | "arm64";
export type McpConfigSource = "manual" | "preset" | "import" | "system";
export type McpLifecycleDesiredState = "stopped" | "running";
export type McpLifecycleState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "reconnecting"
  | "needs_runtime"
  | "needs_install"
  | "needs_confirmation"
  | "error";
export type ManagedRuntimeStatus = "available" | "installing" | "failed" | "uninstalled";
export type RuntimeLibc = "gnu" | "musl" | null;
export type RuntimeArchiveLayout = "flat" | "top-level-directory";
export type RuntimeSourceKind = "bundled" | "official" | "custom";
export type RuntimeExecutableCommand = "node" | "npx" | "npm" | "uv" | "uvx";
export type McpDependencyStatus =
  | "not_applicable"
  | "not_installed"
  | "installing"
  | "installed"
  | "needs_confirmation"
  | "failed";

export function isMcpOAuthTransport(transport: McpTransportKind): boolean {
  return transport === "http" || transport === "sse";
}
export type ToolServerKind = "mcp" | "local" | "sandbox";
export type ToolRecordKind = "builtin" | "mcp" | "skill" | "sandbox";
export type ToolSecretOwnerType = "server" | "tool";

export interface McpCapabilitySummary {
  tools: boolean;
  resources: boolean;
  resourceTemplates: boolean;
  prompts: boolean;
  resourceSubscriptions: boolean;
  listChanged: { tools: boolean; resources: boolean; prompts: boolean };
  sampling: boolean;
  elicitation: boolean;
}

export interface McpServerIdentity {
  name: string;
  version: string;
  websiteUrl?: string;
}

export interface McpResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptArgument {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

export interface McpPrompt {
  name: string;
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpCapabilitySnapshot {
  serverId: string;
  protocolEra: McpProtocolEra;
  protocolVersion: string | null;
  identity: McpServerIdentity | null;
  instructions: string | null;
  capabilities: McpCapabilitySummary;
  resources: McpResource[];
  resourceTemplates: McpResourceTemplate[];
  prompts: McpPrompt[];
  auth: McpAuthStatus;
  connectedAt: number | null;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpReadResourceResult {
  contents: McpResourceContent[];
}

export interface McpPromptMessage {
  role: "user" | "assistant";
  content: JsonObject;
}

export interface McpPromptResult {
  description?: string;
  messages: McpPromptMessage[];
}

export interface McpCompletionResult {
  values: string[];
  total?: number;
  hasMore?: boolean;
}

export interface McpAuthStatus {
  status: "unknown" | "not_required" | "authorized" | "pending" | "error";
  expiresAt: number | null;
  error?: string;
}

export interface McpAuthorizationResult {
  status: McpAuthStatus["status"];
  authorizationUrl?: string;
  message?: string;
}

export type McpInputRequestKind = "form" | "url" | "sampling";

export interface McpInputRequest {
  id: string;
  serverId: string;
  conversationId: string | null;
  agentId: string | null;
  kind: McpInputRequestKind;
  message: string;
  url: string | null;
  requestedSchema: JsonObject | null;
  createdAt: number;
}

export interface ToolServer {
  id: string;
  name: string;
  description: string;
  kind: ToolServerKind;
  transport: McpTransportKind;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  config_source?: McpConfigSource;
  config_version?: number;
  status: ToolStatus;
  command: string | null;
  args_json: string;
  url: string | null;
  headers_json: string;
  env_json: string;
  cwd: string | null;
  timeout_seconds: number;
  last_error: string | null;
  last_connected_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

export interface ToolServerInput {
  name: string;
  description?: string;
  transport: McpTransportKind;
  enabled?: boolean | number;
  auto_use?: boolean | number;
  requires_approval?: boolean | number;
  config_source?: McpConfigSource;
  config_version?: number;
  command?: string | null;
  args?: string[] | string;
  url?: string | null;
  headers?: Record<string, string> | string;
  env?: Record<string, string> | string;
  cwd?: string | null;
  timeout_seconds?: number | string | null;
}

export interface McpServerConfig {
  id?: string;
  name: string;
  description?: string;
  transport: Exclude<McpTransportKind, "builtin">;
  command?: string | null;
  args?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  url?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number;
  enabled?: boolean;
  autoUse?: boolean;
  requiresApproval?: boolean;
  source?: McpConfigSource;
}

export interface ManagedRuntime {
  id: string;
  kind: RuntimeKind;
  version: string;
  platform: RuntimePlatform;
  architecture: RuntimeArchitecture;
  libc: RuntimeLibc;
  rootPath: string;
  executablePath: string;
  sourceUrl: string;
  sha256: string;
  verifiedCommands: RuntimeExecutableCommand[];
  channel: "stable";
  status: ManagedRuntimeStatus;
  installedAt: number | null;
  updatedAt: number;
  lastError: string | null;
}

export interface RuntimePreference {
  kind: RuntimeKind;
  manifestUrl: string;
  channel: "stable";
  updatedAt: number;
}

export interface McpServerRuntimeState {
  serverId: string;
  desiredState: McpLifecycleDesiredState;
  state: McpLifecycleState;
  pid: number | null;
  resolvedCommand: string | null;
  runtimeInstallationId: string | null;
  startedAt: number | null;
  lastExitAt: number | null;
  restartAttempts: number;
  nextRetryAt: number | null;
  lastError: string | null;
  updatedAt: number;
}

export interface McpDependencyInstallation {
  id: string;
  serverId: string;
  manager: "npx" | "uvx" | "none";
  packageSpecs: string[];
  installRoot: string | null;
  status: McpDependencyStatus;
  scriptsAllowed: number;
  runtimeInstallationId: string | null;
  installedAt: number | null;
  updatedAt: number;
  lastError: string | null;
}

export interface McpServerView {
  server: ToolServer;
  runtime: McpServerRuntimeState;
  dependency: McpDependencyInstallation | null;
}

export interface McpManagerSnapshot {
  servers: McpServerView[];
  managedRuntimes: ManagedRuntime[];
  runtimePreferences: RuntimePreference[];
  tools: ToolRecord[];
}

export type McpConfigFormat = "claude-json" | "codex-toml";

export interface McpConfigImportPreview {
  token: string;
  format: McpConfigFormat;
  expiresAt: number;
  servers: Array<{
    id: string;
    name: string;
    transport: Exclude<McpTransportKind, "builtin">;
    command: string | null;
    url: string | null;
    envKeys: string[];
    headerKeys: string[];
    conflictServerId: string | null;
    diffs: string[];
    warnings: string[];
  }>;
  warnings: string[];
}

export interface McpConfigImportResult {
  created: string[];
  updated: string[];
  warnings: string[];
}

export interface RuntimeManifestAsset {
  runtime: RuntimeKind;
  version: string;
  platform: RuntimePlatform;
  architecture: RuntimeArchitecture;
  libc?: RuntimeLibc;
  minimumGlibc?: string | null;
  archiveUrl: string;
  fallbackArchiveUrls?: string[];
  archiveType: "zip" | "tar.gz";
  archiveLayout?: RuntimeArchiveLayout;
  sha256: string;
  executableRelativePath: string;
  providedCommands: string[];
  executables?: Array<{
    command: RuntimeExecutableCommand;
    relativePath: string;
  }>;
}

export interface ManagedRuntimeManifest {
  schema: "ayaka-runtime-manifest-v2";
  runtime: RuntimeKind;
  channel: "stable";
  generatedAt: string;
  releases: Array<{
    version: string;
    assets: RuntimeManifestAsset[];
  }>;
}

export interface RuntimeTarget {
  platform: RuntimePlatform;
  architecture: RuntimeArchitecture;
  libc: RuntimeLibc;
  glibcVersion: string | null;
}

export interface SystemRuntimeInfo {
  kind: RuntimeKind;
  command: string;
  available: boolean;
  version: string | null;
  companion?: {
    command: string;
    available: boolean;
    version: string | null;
  };
}

export interface ManagedRuntimeSnapshot {
  runtimes: ManagedRuntime[];
  preferences: RuntimePreference[];
  system: SystemRuntimeInfo[];
  target: RuntimeTarget;
}

export interface ToolRecord {
  id: string;
  server_id: string | null;
  name: string;
  title: string | null;
  description: string;
  instructions: string;
  kind: ToolRecordKind;
  category: string;
  reference: string;
  input_schema_json: string;
  output_schema_json: string;
  config_json: string;
  trigger_keywords_json: string;
  tags_json: string;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  discovered_at: number;
  last_run_at: number | null;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

export interface McpToolPolicy {
  available: boolean;
  defaultAuto: boolean;
  requiresApproval: boolean;
}

/**
 * Resolve the effective policy for an MCP tool.
 *
 * The server enabled state gates the tool, while automation and approval are
 * controlled by the tool-level settings so the MCP workspace switches remain
 * authoritative.
 */
export function resolveMcpToolPolicy(
  server: Pick<ToolServer, "enabled">,
  tool: Pick<ToolRecord, "enabled" | "auto_use" | "requires_approval">,
): McpToolPolicy {
  const available = server.enabled !== 0 && tool.enabled !== 0;
  return {
    available,
    defaultAuto: available && tool.auto_use !== 0,
    requiresApproval: tool.requires_approval !== 0,
  };
}

export interface ToolDiscoveryResult {
  server: ToolServer;
  tools: ToolRecord[];
  resources: number;
  resourceTemplates: number;
  prompts: number;
  message: string;
  protocolEra?: McpProtocolEra;
  protocolVersion?: string | null;
  serverIdentity?: McpServerIdentity | null;
  instructions?: string | null;
  capabilities?: McpCapabilitySummary;
}

export interface ToolSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  category: string;
  enabled: number;
  auto_use: number;
  requires_approval: number;
  trigger_keywords_json: string;
  tags_json: string;
  config_schema_json: string;
  config_json: string;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  purge_after_at: number | null;
}

export type SkillExecutionMode = "instructions" | "scripts" | "hybrid";
export type SkillPackageStatus =
  | "disabled"
  | "ready"
  | "needs_confirmation"
  | "needs_runtime"
  | "error";
export type SkillEntryRuntime = "node" | "python" | "powershell" | "cmd" | "shell";
export type SkillRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "cancelled";

export interface SkillEntry {
  id: string;
  skillId: string;
  relativePath: string;
  name: string;
  runtime: SkillEntryRuntime;
  enabled: boolean;
  available: boolean;
  unavailableReason?: string;
  timeoutMs: number;
}

export interface SkillDependencyStatus {
  id: string;
  skillId: string;
  kind: "mcp" | "runtime" | "browser";
  name: string;
  status: "ready" | "needs_confirmation" | "needs_runtime" | "needs_install" | "failed";
  source?: string;
  detail?: string;
  error?: string;
}

export interface SkillPackage {
  id: string;
  skillId: string;
  source: "manual" | "upload" | "catalog" | "system";
  rootPath: string;
  contentHash: string;
  executionMode: SkillExecutionMode;
  status: SkillPackageStatus;
  manifest: JsonObject;
  safety: JsonObject;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SkillRunInput {
  skillId: string;
  entryId: string;
  args: string[];
  cwd?: "skill" | "workspace";
  conversationId?: string;
  agentId?: string | null;
}

export interface SkillRunResult {
  runId: string;
  skillId: string;
  entryId: string;
  status: Exclude<SkillRunStatus, "queued" | "running">;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  error?: string;
}

export interface SkillRunRecord extends Omit<SkillRunResult, "status"> {
  status: SkillRunStatus;
  conversationId: string | null;
  agentId: string | null;
  cwd: string;
  argsJson: string;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
}

export interface SkillInspection {
  skill: ToolSkill;
  package: SkillPackage | null;
  files: Array<{ path: string; size: number }>;
  entries: SkillEntry[];
  dependencies: SkillDependencyStatus[];
  runs: SkillRunRecord[];
}

export interface ToolSkillInput {
  name: string;
  description?: string;
  instructions?: string;
  category?: string;
  enabled?: boolean | number;
  auto_use?: boolean | number;
  requires_approval?: boolean | number;
  triggerKeywords?: string[] | string;
  tags?: string[] | string;
  configSchema?: JsonObject | string;
  config?: JsonObject | string;
}

export interface SkillDraftRequest {
  prompt: string;
}

export interface SkillDraftResult {
  markdown: string;
}

export interface ToolSecret {
  id: string;
  owner_type: ToolSecretOwnerType;
  owner_id: string;
  key: string;
  label: string;
  ciphertext: string;
  updated_at: number;
}

export interface ToolSecretInput {
  ownerType: ToolSecretOwnerType;
  ownerId: string;
  key: string;
  label?: string;
  value: string;
}

export interface ToolSecretPublic {
  id: string;
  owner_type: ToolSecretOwnerType;
  owner_id: string;
  key: string;
  label: string;
  updated_at: number;
}

export interface ToolsSnapshot {
  toolServers: ToolServer[];
  toolRecords: ToolRecord[];
  skills: ToolSkill[];
  skillPackages: SkillPackage[];
  skillEntries: SkillEntry[];
  skillRuns: SkillRunRecord[];
  secrets: ToolSecretPublic[];
  runtimeEvents: RuntimeEvent[];
}

export const CHAT_SESSION_HEADER = "x-ayaka-session";
export const CHAT_RUN_ID_HEADER = "x-ayaka-run-id";

export interface LocalServerInfo {
  port: number;
  token: string;
}

export type UpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export type UpdateErrorCode = "network" | "invalid" | "unknown" | "busy";

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  progress: UpdateProgress | null;
  errorCode: UpdateErrorCode | null;
  lastCheckedAt: number | null;
}

export interface ChatExecutionMetadata {
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  model?: string;
  agentId?: string | null;
  agentPath?: string | null;
  finishReason?: string;
  inputTokens?: number;
  textOutputTokens?: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  contextUtilization?: number;
  contextWindow?: number;
  compactionCount?: number;
  tokenCountAccuracy?: "exact" | "estimate";
  reasoningLevel?: ChatReasoningLevel;
  reasoningOverridden?: boolean;
  stepCount?: number;
  toolCallCount?: number;
}

export interface ChatReactionMetadata {
  emoji: string;
  label: string;
  createdAt: number;
}

export interface ChatMessageMetadata {
  execution?: ChatExecutionMetadata;
  reaction?: ChatReactionMetadata;
  mediaGeneration?: JsonObject;
  followupSuggestions?: string[];
}

export type ChatErrorCode =
  | "invalid_request"
  | "invalid_media_input"
  | "invalid_run_id"
  | "invalid_mode"
  | "missing_model"
  | "model_unavailable"
  | "vision_model_unavailable"
  | "unauthorized"
  | "configuration"
  | "network"
  | "rate_limited"
  | "timeout"
  | "provider"
  | "runtime"
  | "run_conflict"
  | "run_not_found"
  | "run_not_active"
  | "conversation_mismatch"
  | "conversation_busy"
  | "cancelled"
  | "unknown";

export interface ChatErrorResponse {
  error: string;
  code: ChatErrorCode;
  retryable: boolean;
}

export const CHAT_TOOL_IDS = [
  "web_search",
  "web_open",
  "browser_tabs",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_scroll",
  "browser_wait",
  "browser_screenshot",
  "file_search",
  "code_interpreter",
  "tool_search",
  "current_time",
  "memory_search",
  "runtime_snapshot",
  "model_capabilities",
  "conversation_search",
  "memory_save",
  "memory_update",
  "memory_delete",
  "sandbox_list_files",
  "sandbox_read_file",
  "sandbox_write_file",
  "sandbox_run_command",
  "sandbox_snapshot",
  "sandbox_restore",
  "sandbox_list_artifacts",
  "sandbox_preview_port",
  "sandbox_publish_artifact",
  "sandbox_start_preview",
  "workspace_run_command",
  "cron",
] as const;

export type ChatToolId = (typeof CHAT_TOOL_IDS)[number];

export const SILENT_ROOT_MEMORY_TOOL_IDS = [
  "memory_search",
  "memory_save",
  "memory_update",
  "memory_delete",
] as const satisfies readonly ChatToolId[];

export function isSilentRootMemoryTool(id: string): id is ChatToolId {
  return (SILENT_ROOT_MEMORY_TOOL_IDS as readonly string[]).includes(id);
}

export type ChatToolMode = "off" | "auto" | "manual";

export interface ChatToolSelectionRequest {
  mode: ChatToolMode;
  selectedToolIds: ChatToolReference[];
}

export interface ChatToolsSetting {
  version: 1;
  byConversation: Record<string, ChatToolSelectionRequest>;
}

export type ChatPermissionMode = "ask" | "approve_risky" | "full_access";

export interface ChatPermissionsSetting {
  version: 1;
  defaultMode: ChatPermissionMode;
  byConversation: Record<string, ChatPermissionMode>;
}

export interface ChatPermissionResolution {
  mode: ChatPermissionMode;
  source: "default" | "conversation";
}

export const DEFAULT_CHAT_PERMISSION_MODE: ChatPermissionMode = "approve_risky";

export function isChatPermissionMode(value: unknown): value is ChatPermissionMode {
  return value === "ask" || value === "approve_risky" || value === "full_access";
}

export function normalizeChatPermissionMode(
  raw: unknown,
  fallback: ChatPermissionMode = DEFAULT_CHAT_PERMISSION_MODE,
): ChatPermissionMode {
  return isChatPermissionMode(raw) ? raw : fallback;
}

export function parseChatPermissionsSetting(
  raw: string | null | undefined,
): ChatPermissionsSetting {
  if (!raw) {
    return { version: 1, defaultMode: DEFAULT_CHAT_PERMISSION_MODE, byConversation: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ChatPermissionsSetting>;
    const byConversation: Record<string, ChatPermissionMode> = {};
    if (
      parsed.version === 1 &&
      parsed.byConversation &&
      typeof parsed.byConversation === "object" &&
      !Array.isArray(parsed.byConversation)
    ) {
      for (const [conversationId, mode] of Object.entries(parsed.byConversation)) {
        if (conversationId && isChatPermissionMode(mode)) byConversation[conversationId] = mode;
      }
    }
    return {
      version: 1,
      defaultMode: normalizeChatPermissionMode(parsed.defaultMode),
      byConversation,
    };
  } catch {
    return { version: 1, defaultMode: DEFAULT_CHAT_PERMISSION_MODE, byConversation: {} };
  }
}

export function getChatPermissionForConversation(
  rawSetting: string | null | undefined,
  conversationId: string,
): ChatPermissionResolution {
  const setting = parseChatPermissionsSetting(rawSetting);
  const override = setting.byConversation[conversationId];
  return override
    ? { mode: override, source: "conversation" }
    : { mode: setting.defaultMode, source: "default" };
}

export function withChatPermissionForConversation(
  rawSetting: string | null | undefined,
  conversationId: string,
  mode: ChatPermissionMode,
): ChatPermissionsSetting {
  const setting = parseChatPermissionsSetting(rawSetting);
  return {
    version: 1,
    defaultMode: setting.defaultMode,
    byConversation: {
      ...setting.byConversation,
      [conversationId]: normalizeChatPermissionMode(mode),
    },
  };
}

export function clearChatPermissionForConversation(
  rawSetting: string | null | undefined,
  conversationId: string,
): ChatPermissionsSetting {
  const setting = parseChatPermissionsSetting(rawSetting);
  const byConversation = { ...setting.byConversation };
  delete byConversation[conversationId];
  return { version: 1, defaultMode: setting.defaultMode, byConversation };
}

export function withChatPermissionDefault(
  rawSetting: string | null | undefined,
  mode: ChatPermissionMode,
): ChatPermissionsSetting {
  const setting = parseChatPermissionsSetting(rawSetting);
  return {
    version: 1,
    defaultMode: normalizeChatPermissionMode(mode),
    byConversation: setting.byConversation,
  };
}

export interface ChatToolDescriptor {
  id: ChatToolReference;
  label: string;
  description: string;
  kind: "provider" | "host";
  execution?: "provider" | "host";
  category:
    | "web"
    | "browser"
    | "system"
    | "memory"
    | "runtime"
    | "model"
    | "conversation"
    | "sandbox"
    | "execution"
    | "automation"
    | "mcp"
    | "skill";
  defaultAuto: boolean;
  requiresApproval: boolean;
  available: boolean;
  unavailableReason?: string;
  sourceId?: string;
  sourceName?: string;
}

export const DEFAULT_CHAT_TOOL_SELECTION: ChatToolSelectionRequest = {
  mode: "auto",
  selectedToolIds: [],
};

export const DEFAULT_AGENT_TOOL_POLICY: AgentToolPolicy = {
  mode: "inherit",
  allowedToolIds: [],
  requireApprovalToolIds: [],
};

export const DEFAULT_AGENT_HANDOFF_CONFIG: AgentHandoffConfig = {
  mode: "consult",
  priority: "normal",
  accepts: [],
  expectedOutput: "Return concise findings, constraints, and recommended next steps.",
};

export const DEFAULT_AGENT_RUNTIME_CONFIG: AgentRuntimeConfig = {
  maxTurns: 8,
  maxDurationMs: 600_000,
  maxToolCalls: 50,
  absoluteMaxDurationMs: 3_600_000,
  absoluteMaxToolCalls: 250,
  maxNoProgressRounds: 3,
  maxConcurrentSubagents: 3,
  totalTimeoutMs: 120_000,
  contextPolicy: {
    mode: "semantic",
    pruneThreshold: 0.6,
    compactThreshold: 0.75,
    targetRatio: 0.5,
    keepRecentTokens: 20_000,
  },
  reviewPolicy: "review_sensitive",
  sandboxPolicy: "local",
};

export const MIN_CONCURRENT_SUBAGENTS = 3;
export const MAX_CONCURRENT_SUBAGENTS = 20;

export function normalizeMaxConcurrentSubagents(value: unknown, fallback = 3): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  const safeFallback = Number.isFinite(fallback) ? fallback : 3;
  return Math.round(
    Math.min(
      MAX_CONCURRENT_SUBAGENTS,
      Math.max(MIN_CONCURRENT_SUBAGENTS, Number.isFinite(parsed) ? parsed : safeFallback),
    ),
  );
}

export function normalizeAgentToolPolicy(
  raw: unknown,
  fallback: AgentToolPolicy = DEFAULT_AGENT_TOOL_POLICY,
): AgentToolPolicy {
  const value = readAgentConfigObject(raw);
  const requireApprovalToolIds = normalizeToolIdList(
    value?.requireApprovalToolIds,
    fallback.requireApprovalToolIds,
  ).filter((id) => !isChatToolId(id));
  return {
    mode: value?.mode === "custom" ? "custom" : fallback.mode === "custom" ? "custom" : "inherit",
    allowedToolIds: normalizeToolIdList(value?.allowedToolIds, fallback.allowedToolIds),
    requireApprovalToolIds,
  };
}

export function normalizeAgentHandoffConfig(
  raw: unknown,
  fallback: AgentHandoffConfig = DEFAULT_AGENT_HANDOFF_CONFIG,
): AgentHandoffConfig {
  const value = readAgentConfigObject(raw);
  return {
    mode: isAgentHandoffMode(value?.mode) ? value.mode : fallback.mode,
    priority: isAgentHandoffPriority(value?.priority) ? value.priority : fallback.priority,
    accepts: Array.isArray(value?.accepts)
      ? value.accepts.map(String).filter(Boolean).slice(0, 12)
      : [...fallback.accepts],
    expectedOutput:
      typeof value?.expectedOutput === "string" && value.expectedOutput.trim()
        ? value.expectedOutput.trim()
        : fallback.expectedOutput,
  };
}

export function normalizeAgentRuntimeConfig(
  raw: unknown,
  fallback: AgentRuntimeConfig = DEFAULT_AGENT_RUNTIME_CONFIG,
): AgentRuntimeConfig {
  const value = readAgentConfigObject(raw);
  const config: AgentRuntimeConfig = {
    maxTurns: Math.round(clampFiniteNumber(value?.maxTurns, fallback.maxTurns, 1, 20)),
    maxDurationMs: Math.round(
      clampFiniteNumber(value?.maxDurationMs, fallback.maxDurationMs ?? 600_000, 10_000, 3_600_000),
    ),
    maxToolCalls: Math.round(
      clampFiniteNumber(value?.maxToolCalls, fallback.maxToolCalls ?? 50, 1, 500),
    ),
    absoluteMaxDurationMs: Math.round(
      clampFiniteNumber(
        value?.absoluteMaxDurationMs,
        fallback.absoluteMaxDurationMs ?? 3_600_000,
        60_000,
        86_400_000,
      ),
    ),
    absoluteMaxToolCalls: Math.round(
      clampFiniteNumber(
        value?.absoluteMaxToolCalls,
        fallback.absoluteMaxToolCalls ?? 250,
        10,
        10_000,
      ),
    ),
    maxNoProgressRounds: Math.round(
      clampFiniteNumber(value?.maxNoProgressRounds, fallback.maxNoProgressRounds ?? 3, 1, 20),
    ),
    maxConcurrentSubagents: normalizeMaxConcurrentSubagents(
      value?.maxConcurrentSubagents,
      fallback.maxConcurrentSubagents ?? 3,
    ),
    totalTimeoutMs: Math.round(
      clampFiniteNumber(value?.totalTimeoutMs, fallback.totalTimeoutMs ?? 120_000, 10_000, 900_000),
    ),
    contextPolicy: normalizeAgentContextPolicy(
      value?.contextPolicy,
      fallback.contextPolicy ?? DEFAULT_AGENT_RUNTIME_CONFIG.contextPolicy!,
    ),
    reviewPolicy: isAgentReviewPolicy(value?.reviewPolicy)
      ? value.reviewPolicy
      : fallback.reviewPolicy,
    sandboxPolicy: isAgentSandboxPolicy(value?.sandboxPolicy)
      ? value.sandboxPolicy
      : fallback.sandboxPolicy,
  };

  if (typeof value?.temperature === "number") {
    config.temperature = clampFiniteNumber(value.temperature, fallback.temperature ?? 0.7, 0, 2);
  } else if (fallback.temperature !== undefined) {
    config.temperature = fallback.temperature;
  }

  if (typeof value?.topP === "number") {
    config.topP = clampFiniteNumber(value.topP, fallback.topP ?? 1, 0, 1);
  } else if (fallback.topP !== undefined) {
    config.topP = fallback.topP;
  }

  if (typeof value?.maxOutputTokens === "number") {
    config.maxOutputTokens = Math.floor(
      clampFiniteNumber(value.maxOutputTokens, fallback.maxOutputTokens ?? 4096, 1, 32768),
    );
  } else if (fallback.maxOutputTokens !== undefined) {
    config.maxOutputTokens = fallback.maxOutputTokens;
  }

  if (isChatReasoningLevel(value?.reasoning)) {
    config.reasoning = value.reasoning;
  } else if (fallback.reasoning !== undefined) {
    config.reasoning = fallback.reasoning;
  }

  if (typeof value?.notes === "string") {
    config.notes = value.notes;
  } else if (fallback.notes !== undefined) {
    config.notes = fallback.notes;
  }

  if (typeof value?.compactionModelRef === "string" && value.compactionModelRef.trim()) {
    config.compactionModelRef = value.compactionModelRef.trim();
  } else if (fallback.compactionModelRef !== undefined) {
    config.compactionModelRef = fallback.compactionModelRef;
  }

  return config;
}

function normalizeAgentContextPolicy(
  raw: unknown,
  fallback: AgentContextPolicy,
): AgentContextPolicy {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
  const mode: AgentContextMode =
    value?.mode === "off" || value?.mode === "prune" || value?.mode === "semantic"
      ? value.mode
      : fallback.mode;
  const pruneThreshold = clampFiniteNumber(
    value?.pruneThreshold,
    fallback.pruneThreshold,
    0.3,
    0.9,
  );
  const compactThreshold = clampFiniteNumber(
    value?.compactThreshold,
    fallback.compactThreshold,
    Math.min(0.95, pruneThreshold + 0.05),
    0.98,
  );
  return {
    mode,
    pruneThreshold,
    compactThreshold,
    targetRatio: clampFiniteNumber(value?.targetRatio, fallback.targetRatio, 0.2, pruneThreshold),
    keepRecentTokens: Math.round(
      clampFiniteNumber(value?.keepRecentTokens, fallback.keepRecentTokens, 1_000, 200_000),
    ),
  };
}

export function isChatToolId(value: unknown): value is ChatToolId {
  return typeof value === "string" && (CHAT_TOOL_IDS as readonly string[]).includes(value);
}

export function isToolRecordReference(value: unknown): value is string {
  return typeof value === "string" && /^mcp:[A-Za-z0-9_.-]+:.+$/.test(value);
}

export function isSkillToolReference(value: unknown): value is string {
  return typeof value === "string" && /^skill:[A-Za-z0-9_.-]+$/.test(value);
}

export function isChatToolReference(value: unknown): value is ChatToolReference {
  return isChatToolId(value) || isToolRecordReference(value) || isSkillToolReference(value);
}

export function isChatToolMode(value: unknown): value is ChatToolMode {
  return value === "off" || value === "auto" || value === "manual";
}

export function normalizeChatToolSelection(raw: unknown): ChatToolSelectionRequest {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CHAT_TOOL_SELECTION };
  const value = raw as Partial<ChatToolSelectionRequest>;
  const ids = Array.isArray(value.selectedToolIds)
    ? value.selectedToolIds.filter(isChatToolReference)
    : [];
  return {
    mode: isChatToolMode(value.mode) ? value.mode : DEFAULT_CHAT_TOOL_SELECTION.mode,
    selectedToolIds: [...new Set(ids)],
  };
}

export function parseChatToolsSetting(raw: string | null | undefined): ChatToolsSetting {
  if (!raw) return { version: 1, byConversation: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<ChatToolsSetting>;
    const byConversation: Record<string, ChatToolSelectionRequest> = {};
    if (
      parsed.version === 1 &&
      parsed.byConversation &&
      typeof parsed.byConversation === "object"
    ) {
      for (const [conversationId, selection] of Object.entries(parsed.byConversation)) {
        if (conversationId) byConversation[conversationId] = normalizeChatToolSelection(selection);
      }
    }
    return { version: 1, byConversation };
  } catch {
    return { version: 1, byConversation: {} };
  }
}

export function getChatToolSelectionForConversation(
  rawSetting: string | null | undefined,
  conversationId: string,
): ChatToolSelectionRequest {
  const setting = parseChatToolsSetting(rawSetting);
  return setting.byConversation[conversationId] ?? { ...DEFAULT_CHAT_TOOL_SELECTION };
}

export function withChatToolSelectionForConversation(
  rawSetting: string | null | undefined,
  conversationId: string,
  selection: ChatToolSelectionRequest,
): ChatToolsSetting {
  const setting = parseChatToolsSetting(rawSetting);
  return {
    version: 1,
    byConversation: {
      ...setting.byConversation,
      [conversationId]: normalizeChatToolSelection(selection),
    },
  };
}

function readAgentConfigObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return readAgentConfigObject(parsed);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return null;
}

function normalizeToolIdList(
  raw: unknown,
  fallback: readonly ChatToolReference[],
): ChatToolReference[] {
  const source = Array.isArray(raw) ? raw : fallback;
  return [...new Set(source.filter(isChatToolReference))];
}

function isAgentHandoffMode(value: unknown): value is AgentHandoffMode {
  return value === "handoff" || value === "consult" || value === "both";
}

function isAgentHandoffPriority(value: unknown): value is AgentHandoffConfig["priority"] {
  return value === "low" || value === "normal" || value === "high";
}

function isAgentReviewPolicy(value: unknown): value is AgentReviewPolicy {
  return (
    value === "inherit" ||
    value === "auto" ||
    value === "review_sensitive" ||
    value === "review_all"
  );
}

function isAgentSandboxPolicy(value: unknown): value is AgentSandboxPolicy {
  return value === "inherit" || value === "disabled" || value === "local" || value === "docker";
}

function clampFiniteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export const DEFAULT_AGENT_ID = "agent-ayaka";

export interface InteractionProfile {
  id: string;
  kind: "chat" | "voice" | "video" | "mouse";
  label: string;
  enabled: number;
  status: "ready" | "prototype" | "blocked";
  config_json: string;
  updated_at: number;
}

export interface SyncState {
  id: string;
  mode: "local_only" | "manual" | "cloud";
  endpoint: string | null;
  device_id: string;
  encryption_enabled: number;
  conflict_strategy: "last_write_wins" | "merge_with_review";
  status: "idle" | "syncing" | "error";
  last_synced_at: number | null;
  updated_at: number;
}
export type ModelProviderKind = "openai" | "openai-compatible" | "anthropic" | "google";
export type ModelCatalogSource = "builtin" | "custom";
/** Whether a provider requires a user-managed credential before requests. */
export type ProviderAuthKind = "api-key" | "none";

export const CUSTOM_PROVIDER_API_FORMATS = [
  "chat-completions",
  "responses",
  "anthropic-messages",
] as const;

export type CustomProviderApiFormat = (typeof CUSTOM_PROVIDER_API_FORMATS)[number];

export const DEFAULT_CUSTOM_PROVIDER_API_FORMAT: CustomProviderApiFormat = "chat-completions";

export function isCustomProviderApiFormat(value: unknown): value is CustomProviderApiFormat {
  return (CUSTOM_PROVIDER_API_FORMATS as readonly unknown[]).includes(value);
}

export type JsonObject = Record<string, unknown>;

export const CHAT_REASONING_LEVELS = [
  "provider-default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ChatReasoningLevel = (typeof CHAT_REASONING_LEVELS)[number];

export function isChatReasoningLevel(value: unknown): value is ChatReasoningLevel {
  return typeof value === "string" && (CHAT_REASONING_LEVELS as readonly string[]).includes(value);
}

export const MODEL_CAPABILITY_KEYS = [
  "textGeneration",
  "vision",
  "imageOutput",
  "speechOutput",
  "transcription",
  "toolCalling",
  "reasoning",
  "embedding",
] as const;

export type ModelCapabilityKey = (typeof MODEL_CAPABILITY_KEYS)[number];
export type ModelCapabilitySource = "provider" | "inferred" | "manual";
export type ModelCapabilitySources = Partial<Record<ModelCapabilityKey, ModelCapabilitySource>>;

export interface ModelCapabilities {
  textGeneration: boolean;
  vision: boolean;
  imageOutput: boolean;
  speechOutput: boolean;
  transcription: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  embedding: boolean;
  /** Per-tool overrides for providers whose model catalog cannot describe tools precisely. */
  toolCapabilities?: Partial<Record<ChatToolId, boolean>>;
}

export interface ModelOption {
  id: string;
  label?: string;
  source: ModelCatalogSource;
  enabled: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  capabilities: ModelCapabilities;
  providerOptions: JsonObject;
  /** Model-specific default used when no explicit reasoning override is supplied. */
  reasoningDefault?: ChatReasoningLevel;
  /** Reasoning levels advertised or inferred for this model. */
  reasoningLevels?: ChatReasoningLevel[];
  /** Source of each synchronized capability field. */
  capabilitySources?: ModelCapabilitySources;
  /** Last successful provider catalog sync timestamp. */
  lastSyncedAt?: number;
}

/** Provider metadata without API keys. */
export interface ProviderInfo {
  id: string;
  label: string;
  kind: ModelProviderKind;
  source: ModelCatalogSource;
  models: ModelOption[];
  /** API-key help link for built-in providers. Custom providers do not store one. */
  helpUrl?: string;
  baseUrl?: string;
  /** Text API protocol used by custom providers. Built-in providers use fixed adapters. */
  apiFormat?: CustomProviderApiFormat;
  /** Authentication mode. Missing legacy values are treated as `api-key`. */
  authKind?: ProviderAuthKind;
  /** Provider-level or legacy model-level API key is available. */
  hasApiKey: boolean;
  /** A provider-level API key is configured. */
  hasProviderApiKey: boolean;
}

export interface CustomProviderInput {
  id?: string;
  label: string;
  baseUrl: string;
  apiFormat?: CustomProviderApiFormat;
}

export interface CustomModelInput {
  providerId: string;
  id: string;
  label?: string;
  enabled?: boolean;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  capabilities?: Partial<ModelCapabilities>;
  reasoningDefault?: ChatReasoningLevel;
  reasoningLevels?: ChatReasoningLevel[];
  capabilitySources?: ModelCapabilitySources;
  providerOptions?: JsonObject;
  providerOptionsJson?: string;
}

export interface ModelCatalogSettings {
  providers: Array<{
    id: string;
    label: string;
    kind: "openai-compatible";
    baseUrl: string;
    apiFormat?: CustomProviderApiFormat;
    createdAt: number;
    updatedAt: number;
  }>;
  models: Array<{
    providerId: string;
    id: string;
    label?: string;
    enabled: boolean;
    temperature: number;
    topP: number;
    maxOutputTokens: number;
    contextWindow: number;
    capabilities: ModelCapabilities;
    providerOptions: JsonObject;
    reasoningDefault?: ChatReasoningLevel;
    reasoningLevels?: ChatReasoningLevel[];
    capabilitySources?: ModelCapabilitySources;
    lastSyncedAt?: number;
    createdAt: number;
    updatedAt: number;
  }>;
  modelStates: Array<{
    providerId: string;
    id: string;
    enabled: boolean;
    updatedAt: number;
  }>;
}

/** Cached metadata for a built-in provider, kept separate from custom providers. */
export interface BuiltinModelInfo {
  id: string;
  label?: string;
  enabled: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  capabilities: ModelCapabilities;
  providerOptions: JsonObject;
  reasoningDefault?: ChatReasoningLevel;
  reasoningLevels?: ChatReasoningLevel[];
  capabilitySources?: ModelCapabilitySources;
  lastSyncedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface BuiltinModelCatalogSettings {
  version: 1;
  models: BuiltinModelInfo[];
  modelsDevEtag?: string;
  updatedAt?: number;
}

export interface ManagedModelInfo {
  ref: string;
  providerId: string;
  providerLabel: string;
  providerKind: ModelProviderKind;
  providerSource: ModelCatalogSource;
  providerBaseUrl?: string;
  providerApiFormat?: CustomProviderApiFormat;
  /** Authentication mode inherited from the provider. */
  authKind?: ProviderAuthKind;
  /** API-key help link for built-in providers. Custom providers do not expose one. */
  providerHelpUrl?: string;
  modelId: string;
  modelLabel?: string;
  modelSource: ModelCatalogSource;
  enabled: boolean;
  hasApiKey: boolean;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  contextWindow: number;
  capabilities: ModelCapabilities;
  providerOptions: JsonObject;
  providerOptionsJson: string;
  reasoningDefault?: ChatReasoningLevel;
  reasoningLevels?: ChatReasoningLevel[];
  capabilitySources?: ModelCapabilitySources;
  lastSyncedAt?: number;
}

export interface ProviderTestResult {
  ok: boolean;
  providerId: string;
  checkedModels: number;
  message?: string;
}

export interface ProviderModelSyncResult {
  provider: ProviderInfo;
  discovered: number;
  added: number;
  updated: number;
  updatedCapabilities: number;
}

export type MediaGenerationKind = "image" | "speech" | "transcription";

export const MEDIA_GENERATION_TOOL_NAME = "generate_media" as const;

export interface MediaGenerationFile {
  type: "file";
  mediaType: string;
  filename: string;
  url: string;
  size?: number;
}

export interface MediaGenerationOptions {
  size?: string;
  aspectRatio?: string;
  count?: number;
  seed?: number;
  voice?: string;
  outputFormat?: string;
  speed?: number;
  language?: string;
  instructions?: string;
}

export interface MediaGenerationToolInput {
  kind: MediaGenerationKind;
  content?: string;
  sourceFilename?: string;
  options?: MediaGenerationOptions;
}

export type MediaGenerationRequest =
  | {
      kind: "image";
      model: string;
      prompt: string;
      options?: Pick<MediaGenerationOptions, "size" | "aspectRatio" | "count" | "seed">;
      conversationId?: string;
    }
  | {
      kind: "speech";
      model: string;
      text: string;
      options?: Pick<
        MediaGenerationOptions,
        "voice" | "outputFormat" | "speed" | "language" | "instructions"
      >;
      conversationId?: string;
    }
  | {
      kind: "transcription";
      model: string;
      audio: {
        url: string;
        mediaType?: string;
        filename?: string;
      };
      options?: Pick<MediaGenerationOptions, "language">;
      conversationId?: string;
    };

export interface MediaGenerationResponse {
  kind: MediaGenerationKind;
  text: string;
  files: MediaGenerationFile[];
  metadata?: JsonObject;
}

export type MediaGenerationErrorCode =
  | "unauthorized"
  | "invalid_request"
  | "no_model"
  | "unsupported_model"
  | "permission_denied"
  | "upstream_error";

export interface MediaGenerationErrorResponse {
  error: string;
  code: MediaGenerationErrorCode;
  kind?: MediaGenerationKind;
  model?: string;
}

export interface MediaGenerationKindSettings {
  modelRef: string | null;
  options: MediaGenerationOptions;
}

export interface MediaGenerationSettings {
  version: 1;
  defaults: Record<MediaGenerationKind, MediaGenerationKindSettings>;
  vision: VisionModelSettings;
}

export type VisionModelMode = "inherit" | "model";

export interface VisionModelSettings {
  mode: VisionModelMode;
  modelRef: string | null;
}

export const DEFAULT_MEDIA_GENERATION_SETTINGS: MediaGenerationSettings = {
  version: 1,
  defaults: {
    image: {
      modelRef: null,
      options: {},
    },
    speech: {
      modelRef: null,
      options: {},
    },
    transcription: {
      modelRef: null,
      options: {},
    },
  },
  vision: {
    mode: "inherit",
    modelRef: null,
  },
};

/**
 * 应用设置键名枚举（避免拼写错误）
 *
 * 所有设置项统一以字符串存入 settings 表的 KV 结构。
 * 复杂结构（如 accent）也以字符串形式存储，由渲染层解析。
 */
export const SettingKey = {
  // ——— 主题 / 外观 ———
  /** 主题模式：'light' | 'dark' | 'system' */
  Skin: "skin",
  /** 识别样式预设 ID */
  /** UI 字体 CSS font-family；空字符串表示沿用主题默认值 */
  FontFamily: "font_family",
  /** 等宽字体 CSS font-family；空字符串表示沿用主题默认值 */
  MonoFontFamily: "mono_font_family",
  /** 交互元素使用指针光标 */
  UsePointerCursor: "use_pointer_cursor",
  /** 减少动态效果：'system' | 'on' | 'off' */
  ReduceMotion: "reduce_motion",
  /** 字号级别：'xs' | 'sm' | 'base' | 'lg' | 'xl' */
  FontSize: "font_size",
  /** 代码字体大小（px） */
  CodeFontSizePx: "code_font_size_px",
  /** 差异标记：'color' | 'symbol' */
  DiffMark: "diff_mark",
  /** 界面密度：'compact' | 'comfortable' | 'loose' */
  LayoutDensity: "layout_density",
  /** 界面语言：'zh-CN' | 'en' */
  Language: "language",
  // ——— 模型 ———
  /** 当前选中的模型引用，形如 "openai/gpt-4o" */
  SelectedModel: "selected_model",
  /** 采样温度 0~2，默认 0.7 */
  ModelTemperature: "model_temperature",
  /** 最大输出 token 数，默认 4096 */
  ModelMaxTokens: "model_max_tokens",
  /** nucleus sampling 概率 0~1，默认 1 */
  ModelTopP: "model_top_p",
  /** Chat reasoning effort level. */
  ChatReasoningLevel: "chat_reasoning_level",
  /** Per-conversation chat tool mode and manual selections. */
  ChatTools: "chat_tools",
  /** Global and per-conversation chat permission modes. */
  ChatPermissions: "chat_permissions",
  /** Chat media generation defaults. */
  MediaGeneration: "media_generation",
  /** Custom provider and model catalog JSON. */
  ModelCatalog: "model_catalog",
  /** Built-in provider model catalog JSON, including its conditional-fetch ETag. */
  BuiltinModelCatalog: "builtin_model_catalog",
  /** Global limit for child agents running at the same time. */
  MaxConcurrentSubagents: "max_concurrent_subagents",
  // ——— 其它 ———
  /** 当前会话 ID */
  ActiveConversationId: "active_conversation_id",
  /** 当前智能体 ID */
  ActiveAgentId: "active_agent_id",
  WorkspaceParentDirectory: "workspace_parent_directory",
} as const;

export type SettingKeyType = (typeof SettingKey)[keyof typeof SettingKey];

export type WorkspaceStatus = "active" | "orphaned";

export interface WorkspaceInfo {
  conversationId: string;
  relativePath: string;
  status: WorkspaceStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceOrphan {
  id: string;
  name: string;
  modifiedAt: number;
}

export interface WorkspaceFileRef {
  path: string;
  filename: string;
  mediaType: string;
  size: number;
}

export interface WorkspaceFileContent extends WorkspaceFileRef {
  /** ArrayBuffer is used across the Electron contextBridge boundary. */
  data: ArrayBuffer;
}

export interface WorkspaceMediaSaveInput {
  filename?: string;
  mediaType?: string;
  data: ArrayBuffer;
}

export interface WorkspaceMediaSaveResult {
  saved: boolean;
  path?: string;
}

// ============================================================
// 设置项类型定义
// ============================================================

/** 主题模式 */
export type SkinId = "white" | "black" | "zzz";

/** 字号级别 */
export type FontSizeLevel = "xs" | "sm" | "base" | "lg" | "xl";

/** 界面密度 */
export type LayoutDensity = "compact" | "comfortable" | "loose";

/** 减少动态效果偏好 */
export type ReduceMotion = "system" | "on" | "off";

/** 差异标记方式 */
export type DiffMark = "color" | "symbol";

/** 支持的界面语言 */
export type AppLanguage = "zh-CN" | "en";

export type LanguageMode = "system" | AppLanguage;

/** 字号级别到像素值的映射（应用于 CSS font-size） */
export const FONT_SIZE_PX: Record<FontSizeLevel, number> = {
  xs: 13,
  sm: 14,
  base: 15,
  lg: 16,
  xl: 18,
};

/** UI 字体预设 */
export interface FontPreset {
  id: string;
  label: string;
  /** CSS font-family 字符串 */
  value: string;
}

export const FONT_PRESETS: FontPreset[] = [
  {
    id: "system",
    label: "System UI",
    value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  },
  {
    id: "sans",
    label: "Inter / 苹方黑体",
    value: "'Inter', 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  { id: "rounded", label: "Rounded", value: "'Nunito', 'Quicksand', system-ui, sans-serif" },
  { id: "serif", label: "Serif", value: "'Source Serif Pro', 'Noto Serif SC', Georgia, serif" },
  { id: "mono", label: "Mono", value: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" },
];

export const MONO_FONT_PRESETS: FontPreset[] = [
  {
    id: "system-mono",
    label: "System Mono",
    value: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  },
  { id: "jetbrains", label: "JetBrains Mono", value: "'JetBrains Mono', ui-monospace, monospace" },
  { id: "fira", label: "Fira Code", value: "'Fira Code', ui-monospace, monospace" },
  {
    id: "cascadia",
    label: "Cascadia Code",
    value: "'Cascadia Code', 'Cascadia Mono', ui-monospace, monospace",
  },
  { id: "menlo", label: "Menlo / Consolas", value: "Menlo, Consolas, 'Courier New', monospace" },
];

export interface RuntimeSnapshot {
  agents: AgentProfile[];
  runtimeRuns: RuntimeRun[];
  runtimeSteps: RuntimeStep[];
  agentRuntimeStates: AgentRuntimeState[];
  conversationAgentStates: ConversationAgentState[];
  sandboxSessions: SandboxSessionView[];
  sandboxSnapshots: SandboxSnapshot[];
  sandboxArtifacts: SandboxArtifact[];
  memories: MemoryRecord[];
  agentRunInputs: AgentRunInput[];
  runtimeEvents: RuntimeEvent[];
  agentInstances: AgentInstanceRecord[];
  collaborationMessages: AgentCollaborationMessage[];
  contextCheckpoints: AgentContextCheckpoint[];
  interactionProfiles: InteractionProfile[];
  syncState: SyncState;
}

/**
 * 应用设置聚合（渲染层使用）
 *
 * 每个字段都可独立持久化，聚合后便于在 UI 中统一消费与实时应用。
 */
export interface AppSettings {
  skin: SkinId;
  fontFamily: string;
  monoFontFamily: string;
  usePointerCursor: boolean;
  reduceMotion: ReduceMotion;
  fontSize: FontSizeLevel;
  codeFontSizePx: number;
  diffMark: DiffMark;
  density: LayoutDensity;
  language: LanguageMode;
  selectedModel: string | null;
  modelTemperature: number;
  modelMaxTokens: number;
  modelTopP: number;
  chatReasoningLevel: ChatReasoningLevel;
}

/**
 * 默认设置
 *
 * "恢复默认设置" 一键重置到此对象。
 */
export const DEFAULT_SETTINGS: AppSettings = {
  skin: "white",
  fontFamily: "",
  monoFontFamily: "",
  usePointerCursor: true,
  reduceMotion: "system",
  fontSize: "base",
  codeFontSizePx: 13,
  diffMark: "color",
  density: "comfortable",
  language: "system",
  selectedModel: null,
  modelTemperature: 0.7,
  modelMaxTokens: 4096,
  modelTopP: 1,
  chatReasoningLevel: "provider-default",
};
