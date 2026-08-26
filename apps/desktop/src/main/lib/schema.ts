import { DEFAULT_AGENT_AVATAR_ID } from "../../shared/agent-avatar";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull().default("New conversation"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    message_revision: integer("message_revision").notNull().default(0),
    deleted_at: integer("deleted_at"),
    purge_after_at: integer("purge_after_at"),
  },
  (table) => [
    index("idx_conversations_deleted_at").on(table.deleted_at),
    index("idx_conversations_purge_after_at").on(table.purge_after_at),
  ],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    content_json: text("content_json").notNull(),
    metadata_json: text("metadata_json").notNull().default("{}"),
    created_at: integer("created_at").notNull(),
  },
  (table) => [index("idx_messages_conversation").on(table.conversation_id)],
);

export const cronJobs = sqliteTable(
  "cron_jobs",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    schedule_json: text("schedule_json").notNull(),
    payload_json: text("payload_json").notNull(),
    status: text("status", { enum: ["active", "paused", "completed", "error"] })
      .notNull()
      .default("active"),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    next_run_at: integer("next_run_at"),
    last_run_at: integer("last_run_at"),
    claimed_at: integer("claimed_at"),
    claim_token: text("claim_token"),
    retry_count: integer("retry_count").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_cron_jobs_due").on(table.status, table.next_run_at),
    index("idx_cron_jobs_conversation").on(table.conversation_id),
  ],
);

export const cronRuns = sqliteTable(
  "cron_runs",
  {
    id: text("id").primaryKey(),
    job_id: text("job_id")
      .notNull()
      .references(() => cronJobs.id, { onDelete: "cascade" }),
    conversation_id: text("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "skipped", "cancelled"],
    })
      .notNull()
      .default("queued"),
    scheduled_for: integer("scheduled_for").notNull(),
    started_at: integer("started_at"),
    finished_at: integer("finished_at"),
    attempt: integer("attempt").notNull().default(1),
    output: text("output"),
    error: text("error"),
    runtime_run_id: text("runtime_run_id"),
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_cron_runs_job").on(table.job_id, table.created_at),
    index("idx_cron_runs_status").on(table.status),
  ],
);

export const catalogSources = sqliteTable(
  "catalog_sources",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["modelscope-skills", "skills-sh", "builtin-mcp"] }).notNull(),
    url: text("url").notNull(),
    enabled: integer("enabled").notNull().default(1),
    builtin: integer("builtin").notNull().default(0),
    config_json: text("config_json").notNull().default("{}"),
    last_synced_at: integer("last_synced_at"),
    last_error: text("last_error"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [index("idx_catalog_sources_kind").on(table.kind, table.enabled)],
);

export const catalogItems = sqliteTable(
  "catalog_items",
  {
    id: text("id").primaryKey(),
    source_id: text("source_id")
      .notNull()
      .references(() => catalogSources.id, { onDelete: "cascade" }),
    artifact_type: text("artifact_type", { enum: ["skill", "mcp"] }).notNull(),
    external_id: text("external_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    version: text("version"),
    install_url: text("install_url"),
    detail_json: text("detail_json").notNull().default("{}"),
    content_hash: text("content_hash"),
    cached_at: integer("cached_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_catalog_items_source").on(table.source_id, table.artifact_type),
    index("idx_catalog_items_name").on(table.name),
  ],
);

export const artifactInstallations = sqliteTable(
  "artifact_installations",
  {
    id: text("id").primaryKey(),
    item_id: text("item_id").references(() => catalogItems.id, { onDelete: "set null" }),
    source_id: text("source_id").references(() => catalogSources.id, { onDelete: "set null" }),
    artifact_type: text("artifact_type", { enum: ["skill", "mcp"] }).notNull(),
    name: text("name").notNull(),
    version: text("version"),
    content_hash: text("content_hash"),
    install_path: text("install_path"),
    status: text("status", {
      enum: ["disabled", "enabled", "error", "update-available"],
    })
      .notNull()
      .default("disabled"),
    safety_json: text("safety_json").notNull().default("{}"),
    config_json: text("config_json").notNull().default("{}"),
    tool_server_id: text("tool_server_id").references(() => toolServers.id, {
      onDelete: "set null",
    }),
    skill_id: text("skill_id").references(() => tools.id, { onDelete: "set null" }),
    last_error: text("last_error"),
    installed_at: integer("installed_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_artifact_installations_item").on(table.item_id),
    index("idx_artifact_installations_type").on(table.artifact_type, table.status),
  ],
);

export const agents = sqliteTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    instructions: text("instructions").notNull(),
    persona: text("persona").notNull().default(""),
    description: text("description").notNull().default(""),
    avatar: text("avatar").notNull().default(DEFAULT_AGENT_AVATAR_ID),
    status: text("status", { enum: ["active", "draft", "archived"] })
      .notNull()
      .default("active"),
    kind: text("kind", { enum: ["main", "child"] })
      .notNull()
      .default("child"),
    parent_agent_id: text("parent_agent_id"),
    locked: integer("locked").notNull().default(0),
    enabled: integer("enabled").notNull().default(1),
    model_ref: text("model_ref"),
    voice: text("voice"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_agents_status").on(table.status),
    index("idx_agents_kind").on(table.kind),
    index("idx_agents_parent").on(table.parent_agent_id),
  ],
);

export const agentPolicies = sqliteTable(
  "agent_policies",
  {
    agent_id: text("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    tool_policy_json: text("tool_policy_json").notNull().default("{}"),
    review_policy_json: text("review_policy_json").notNull().default("{}"),
    sandbox_policy_json: text("sandbox_policy_json").notNull().default("{}"),
    routing_policy_json: text("routing_policy_json").notNull().default("{}"),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [index("idx_agent_policies_updated").on(table.updated_at)],
);

export const runtimeRuns = sqliteTable(
  "runtime_runs",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    root_agent_id: text("root_agent_id").references(() => agents.id, { onDelete: "set null" }),
    final_agent_id: text("final_agent_id").references(() => agents.id, { onDelete: "set null" }),
    origin: text("origin", { enum: ["chat", "automation", "system"] })
      .notNull()
      .default("chat"),
    finish_reason: text("finish_reason", {
      enum: ["natural", "budget_exhausted", "absolute_limit", "cancelled", "interrupted", "error"],
    }),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "waiting_approval",
        "waiting_handoff",
        "blocked",
        "succeeded",
        "failed",
        "cancelled",
        "interrupted",
      ],
    }).notNull(),
    model_ref: text("model_ref"),
    trace_id: text("trace_id"),
    input_summary: text("input_summary"),
    output_summary: text("output_summary"),
    error: text("error"),
    usage_json: text("usage_json"),
    metadata_json: text("metadata_json").notNull().default("{}"),
    started_at: integer("started_at").notNull(),
    finished_at: integer("finished_at"),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_runtime_runs_conversation").on(table.conversation_id),
    index("idx_runtime_runs_root_agent").on(table.root_agent_id),
    index("idx_runtime_runs_started").on(table.started_at),
    index("idx_runtime_runs_status").on(table.status),
  ],
);

export const agentRunInputs = sqliteTable(
  "agent_run_inputs",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => runtimeRuns.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["steering", "follow_up"] }).notNull(),
    source: text("source", { enum: ["user", "system", "automation", "tool"] }).notNull(),
    status: text("status", { enum: ["queued", "consumed", "discarded"] })
      .notNull()
      .default("queued"),
    message_json: text("message_json").notNull(),
    sequence: integer("sequence").notNull(),
    created_at: integer("created_at").notNull(),
    consumed_at: integer("consumed_at"),
    discarded_reason: text("discarded_reason"),
  },
  (table) => [
    index("idx_agent_run_inputs_run_status_sequence").on(
      table.run_id,
      table.status,
      table.sequence,
    ),
  ],
);

export const agentInstances = sqliteTable(
  "agent_instances",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => runtimeRuns.id, { onDelete: "cascade" }),
    agent_id: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    agent_path: text("agent_path").notNull(),
    parent_instance_id: text("parent_instance_id"),
    parent_agent_path: text("parent_agent_path"),
    status: text("status", {
      enum: ["queued", "running", "waiting", "completed", "failed", "interrupted"],
    }).notNull(),
    task_name: text("task_name").notNull(),
    task_summary: text("task_summary").notNull(),
    turn_count: integer("turn_count").notNull().default(0),
    last_message: text("last_message"),
    error: text("error"),
    started_at: integer("started_at"),
    finished_at: integer("finished_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_agent_instances_run").on(table.run_id),
    index("idx_agent_instances_path").on(table.run_id, table.agent_path),
    index("idx_agent_instances_status").on(table.status),
  ],
);

export const collaborationMessages = sqliteTable(
  "agent_collaboration_messages",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => runtimeRuns.id, { onDelete: "cascade" }),
    author_path: text("author_path").notNull(),
    recipient_path: text("recipient_path").notNull(),
    kind: text("kind", { enum: ["task", "message", "final_answer"] }).notNull(),
    content: text("content").notNull(),
    created_at: integer("created_at").notNull(),
    delivered_at: integer("delivered_at"),
  },
  (table) => [
    index("idx_agent_messages_run").on(table.run_id),
    index("idx_agent_messages_recipient").on(table.run_id, table.recipient_path),
  ],
);

export const contextCheckpoints = sqliteTable(
  "agent_context_checkpoints",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id").references(() => runtimeRuns.id, { onDelete: "set null" }),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    agent_instance_id: text("agent_instance_id").references(() => agentInstances.id, {
      onDelete: "set null",
    }),
    agent_path: text("agent_path").notNull(),
    version: integer("version").notNull(),
    reason: text("reason", { enum: ["threshold", "overflow", "manual"] }).notNull(),
    summary: text("summary").notNull(),
    source_message_count: integer("source_message_count").notNull(),
    retained_message_count: integer("retained_message_count").notNull(),
    estimated_tokens_before: integer("estimated_tokens_before").notNull(),
    estimated_tokens_after: integer("estimated_tokens_after").notNull(),
    model_ref: text("model_ref"),
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_context_checkpoints_conversation").on(table.conversation_id, table.created_at),
    index("idx_context_checkpoints_instance").on(table.agent_instance_id),
  ],
);

export const runtimeSteps = sqliteTable(
  "runtime_steps",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => runtimeRuns.id, { onDelete: "cascade" }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    tool_id: text("tool_id"),
    kind: text("kind", {
      enum: [
        "agent",
        "model",
        "tool",
        "approval",
        "handoff",
        "memory",
        "loop_input",
        "skill",
        "budget",
        "sandbox",
        "guardrail",
        "diagnostic",
        "error",
      ],
    }).notNull(),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "waiting_approval",
        "waiting_handoff",
        "blocked",
        "succeeded",
        "failed",
        "cancelled",
        "interrupted",
      ],
    }).notNull(),
    title: text("title").notNull(),
    detail_json: text("detail_json").notNull().default("{}"),
    started_at: integer("started_at").notNull(),
    finished_at: integer("finished_at"),
    error: text("error"),
  },
  (table) => [
    index("idx_runtime_steps_run").on(table.run_id),
    index("idx_runtime_steps_agent").on(table.agent_id),
    index("idx_runtime_steps_kind").on(table.kind),
    index("idx_runtime_steps_started").on(table.started_at),
  ],
);

export const runtimeEvents = sqliteTable(
  "runtime_events",
  {
    id: text("id").primaryKey(),
    run_id: text("run_id").references(() => runtimeRuns.id, { onDelete: "set null" }),
    step_id: text("step_id").references(() => runtimeSteps.id, { onDelete: "set null" }),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    tool_id: text("tool_id"),
    owner_type: text("owner_type"),
    owner_id: text("owner_id"),
    kind: text("kind", {
      enum: [
        "agent",
        "model",
        "tool",
        "approval",
        "handoff",
        "memory",
        "loop_input",
        "skill",
        "budget",
        "sandbox",
        "guardrail",
        "diagnostic",
        "error",
      ],
    }).notNull(),
    status: text("status", {
      enum: [
        "queued",
        "running",
        "waiting_approval",
        "waiting_handoff",
        "blocked",
        "succeeded",
        "failed",
        "cancelled",
        "interrupted",
      ],
    }).notNull(),
    severity: text("severity", { enum: ["debug", "info", "warning", "error"] })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    detail_json: text("detail_json").notNull().default("{}"),
    duration_ms: integer("duration_ms"),
    event_type: text("event_type"),
    agent_path: text("agent_path"),
    parent_agent_path: text("parent_agent_path"),
    sequence: integer("sequence"),
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_runtime_events_run").on(table.run_id),
    index("idx_runtime_events_step").on(table.step_id),
    index("idx_runtime_events_conversation").on(table.conversation_id),
    index("idx_runtime_events_agent").on(table.agent_id),
    index("idx_runtime_events_tool").on(table.tool_id),
    index("idx_runtime_events_owner").on(table.owner_type, table.owner_id),
    index("idx_runtime_events_created").on(table.created_at),
    index("idx_runtime_events_kind").on(table.kind),
  ],
);

export const toolServers = sqliteTable(
  "tool_servers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind", { enum: ["mcp", "local", "sandbox"] })
      .notNull()
      .default("mcp"),
    transport: text("transport", { enum: ["stdio", "http", "sse", "builtin"] })
      .notNull()
      .default("stdio"),
    enabled: integer("enabled").notNull().default(1),
    auto_use: integer("auto_use").notNull().default(0),
    requires_approval: integer("requires_approval").notNull().default(1),
    config_source: text("config_source", { enum: ["manual", "preset", "import", "system"] })
      .notNull()
      .default("manual"),
    config_version: integer("config_version").notNull().default(1),
    status: text("status", { enum: ["ready", "disabled", "error", "unknown"] })
      .notNull()
      .default("unknown"),
    command: text("command"),
    args_json: text("args_json").notNull().default("[]"),
    url: text("url"),
    headers_json: text("headers_json").notNull().default("{}"),
    env_json: text("env_json").notNull().default("{}"),
    cwd: text("cwd"),
    timeout_seconds: integer("timeout_seconds").notNull().default(60),
    last_error: text("last_error"),
    last_connected_at: integer("last_connected_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    deleted_at: integer("deleted_at"),
    purge_after_at: integer("purge_after_at"),
  },
  (table) => [
    index("idx_tool_servers_kind").on(table.kind),
    index("idx_tool_servers_enabled").on(table.enabled),
    index("idx_tool_servers_status").on(table.status),
    index("idx_tool_servers_deleted_at").on(table.deleted_at),
    index("idx_tool_servers_purge_after_at").on(table.purge_after_at),
  ],
);

export const managedRuntimes = sqliteTable(
  "managed_runtimes",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["node", "uv"] }).notNull(),
    version: text("version").notNull(),
    platform: text("platform", { enum: ["win32", "darwin", "linux"] }).notNull(),
    architecture: text("architecture", { enum: ["x64", "arm64"] }).notNull(),
    libc: text("libc", { enum: ["gnu", "musl"] }),
    root_path: text("root_path").notNull(),
    executable_path: text("executable_path").notNull(),
    source_url: text("source_url").notNull(),
    sha256: text("sha256").notNull(),
    verified_commands_json: text("verified_commands_json").notNull().default("[]"),
    channel: text("channel", { enum: ["stable"] })
      .notNull()
      .default("stable"),
    status: text("status", { enum: ["available", "installing", "failed", "uninstalled"] })
      .notNull()
      .default("installing"),
    installed_at: integer("installed_at"),
    updated_at: integer("updated_at").notNull(),
    last_error: text("last_error"),
  },
  (table) => [
    uniqueIndex("idx_managed_runtimes_identity").on(
      table.kind,
      table.version,
      table.platform,
      table.architecture,
      table.libc,
    ),
    index("idx_managed_runtimes_kind_status").on(table.kind, table.status),
  ],
);

export const runtimePreferences = sqliteTable("runtime_preferences", {
  kind: text("kind", { enum: ["node", "uv"] }).primaryKey(),
  manifest_url: text("manifest_url").notNull(),
  channel: text("channel", { enum: ["stable"] })
    .notNull()
    .default("stable"),
  updated_at: integer("updated_at").notNull(),
});

export const mcpRuntimeStates = sqliteTable(
  "mcp_runtime_states",
  {
    server_id: text("server_id")
      .primaryKey()
      .references(() => toolServers.id, { onDelete: "cascade" }),
    desired_state: text("desired_state", { enum: ["stopped", "running"] })
      .notNull()
      .default("stopped"),
    state: text("state", {
      enum: [
        "stopped",
        "starting",
        "running",
        "stopping",
        "reconnecting",
        "needs_runtime",
        "needs_install",
        "needs_confirmation",
        "error",
      ],
    })
      .notNull()
      .default("stopped"),
    pid: integer("pid"),
    resolved_command: text("resolved_command"),
    runtime_installation_id: text("runtime_installation_id").references(() => managedRuntimes.id, {
      onDelete: "set null",
    }),
    started_at: integer("started_at"),
    last_exit_at: integer("last_exit_at"),
    restart_attempts: integer("restart_attempts").notNull().default(0),
    next_retry_at: integer("next_retry_at"),
    last_error: text("last_error"),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_mcp_runtime_states_state").on(table.state),
    index("idx_mcp_runtime_states_desired").on(table.desired_state),
  ],
);

export const mcpDependencyInstallations = sqliteTable(
  "mcp_dependency_installations",
  {
    id: text("id").primaryKey(),
    server_id: text("server_id")
      .notNull()
      .references(() => toolServers.id, { onDelete: "cascade" }),
    manager: text("manager", { enum: ["npx", "uvx", "none"] }).notNull(),
    package_specs_json: text("package_specs_json").notNull().default("[]"),
    install_root: text("install_root"),
    status: text("status", {
      enum: [
        "not_applicable",
        "not_installed",
        "installing",
        "installed",
        "needs_confirmation",
        "failed",
      ],
    })
      .notNull()
      .default("not_installed"),
    scripts_allowed: integer("scripts_allowed").notNull().default(0),
    runtime_installation_id: text("runtime_installation_id").references(() => managedRuntimes.id, {
      onDelete: "set null",
    }),
    installed_at: integer("installed_at"),
    updated_at: integer("updated_at").notNull(),
    last_error: text("last_error"),
  },
  (table) => [
    uniqueIndex("idx_mcp_dependency_installations_server").on(table.server_id),
    index("idx_mcp_dependency_installations_status").on(table.status),
  ],
);

export const tools = sqliteTable(
  "tools",
  {
    id: text("id").primaryKey(),
    server_id: text("server_id").references(() => toolServers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title"),
    description: text("description").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    kind: text("kind", { enum: ["builtin", "mcp", "skill", "sandbox"] }).notNull(),
    category: text("category").notNull().default("general"),
    reference: text("reference").notNull(),
    enabled: integer("enabled").notNull().default(1),
    auto_use: integer("auto_use").notNull().default(0),
    requires_approval: integer("requires_approval").notNull().default(1),
    input_schema_json: text("input_schema_json").notNull().default("{}"),
    output_schema_json: text("output_schema_json").notNull().default("{}"),
    config_json: text("config_json").notNull().default("{}"),
    trigger_keywords_json: text("trigger_keywords_json").notNull().default("[]"),
    tags_json: text("tags_json").notNull().default("[]"),
    discovered_at: integer("discovered_at").notNull(),
    last_run_at: integer("last_run_at"),
    updated_at: integer("updated_at").notNull(),
    deleted_at: integer("deleted_at"),
    purge_after_at: integer("purge_after_at"),
  },
  (table) => [
    index("idx_tools_server").on(table.server_id),
    index("idx_tools_kind").on(table.kind),
    index("idx_tools_reference").on(table.reference),
    index("idx_tools_enabled").on(table.enabled),
    index("idx_tools_deleted_at").on(table.deleted_at),
    index("idx_tools_purge_after_at").on(table.purge_after_at),
  ],
);

export const skillPackages = sqliteTable(
  "skill_packages",
  {
    id: text("id").primaryKey(),
    skill_id: text("skill_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["manual", "upload", "catalog", "system"] })
      .notNull()
      .default("manual"),
    root_path: text("root_path").notNull(),
    content_hash: text("content_hash").notNull(),
    execution_mode: text("execution_mode", { enum: ["instructions", "scripts", "hybrid"] })
      .notNull()
      .default("instructions"),
    status: text("status", {
      enum: ["disabled", "ready", "needs_confirmation", "needs_runtime", "error"],
    })
      .notNull()
      .default("disabled"),
    manifest_json: text("manifest_json").notNull().default("{}"),
    safety_json: text("safety_json").notNull().default("{}"),
    last_error: text("last_error"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_skill_packages_skill").on(table.skill_id),
    index("idx_skill_packages_status").on(table.status),
    index("idx_skill_packages_hash").on(table.content_hash),
  ],
);

export const skillEntries = sqliteTable(
  "skill_entries",
  {
    id: text("id").primaryKey(),
    skill_id: text("skill_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    package_id: text("package_id")
      .notNull()
      .references(() => skillPackages.id, { onDelete: "cascade" }),
    relative_path: text("relative_path").notNull(),
    name: text("name").notNull(),
    runtime: text("runtime", { enum: ["node", "python", "powershell", "cmd", "shell"] }).notNull(),
    enabled: integer("enabled").notNull().default(1),
    available: integer("available").notNull().default(1),
    unavailable_reason: text("unavailable_reason"),
    timeout_ms: integer("timeout_ms").notNull().default(60_000),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_skill_entries_skill").on(table.skill_id),
    index("idx_skill_entries_package").on(table.package_id),
    uniqueIndex("uq_skill_entries_package_path").on(table.package_id, table.relative_path),
  ],
);

export const skillRuns = sqliteTable(
  "skill_runs",
  {
    id: text("id").primaryKey(),
    skill_id: text("skill_id")
      .notNull()
      .references(() => tools.id, { onDelete: "cascade" }),
    entry_id: text("entry_id")
      .notNull()
      .references(() => skillEntries.id, { onDelete: "cascade" }),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "timed_out", "cancelled"],
    })
      .notNull()
      .default("queued"),
    cwd: text("cwd").notNull(),
    args_json: text("args_json").notNull().default("[]"),
    stdout: text("stdout").notNull().default(""),
    stderr: text("stderr").notNull().default(""),
    exit_code: integer("exit_code"),
    signal: text("signal"),
    duration_ms: integer("duration_ms").notNull().default(0),
    truncated: integer("truncated").notNull().default(0),
    error: text("error"),
    started_at: integer("started_at"),
    finished_at: integer("finished_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_skill_runs_skill_created").on(table.skill_id, table.created_at),
    index("idx_skill_runs_entry").on(table.entry_id),
    index("idx_skill_runs_conversation").on(table.conversation_id),
    index("idx_skill_runs_status").on(table.status),
  ],
);

export const toolSecrets = sqliteTable(
  "tool_secrets",
  {
    id: text("id").primaryKey(),
    owner_type: text("owner_type", { enum: ["server", "tool"] }).notNull(),
    owner_id: text("owner_id").notNull(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    ciphertext: text("ciphertext").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_tool_secrets_owner").on(table.owner_type, table.owner_id),
    index("idx_tool_secrets_key").on(table.key),
  ],
);

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["global", "agent"] }).notNull(),
    kind: text("kind", { enum: ["fact", "preference", "episode", "profile", "skill"] }).notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    source_run_id: text("source_run_id").references(() => runtimeRuns.id, {
      onDelete: "set null",
    }),
    salience: integer("salience").notNull().default(50),
    pinned: integer("pinned").notNull().default(0),
    confidence: integer("confidence").notNull().default(70),
    origin: text("origin", { enum: ["manual", "auto", "dream", "import", "system"] })
      .notNull()
      .default("manual"),
    status: text("status", { enum: ["active", "superseded", "archived", "deleted"] })
      .notNull()
      .default("active"),
    evidence_json: text("evidence_json").notNull().default("[]"),
    last_used_at: integer("last_used_at"),
    expires_at: integer("expires_at"),
    supersedes_id: text("supersedes_id"),
    mem0_id: text("mem0_id"),
    sync_status: text("sync_status", { enum: ["pending", "synced", "failed"] })
      .notNull()
      .default("pending"),
    strength: integer("strength").notNull().default(70),
    last_reinforced_at: integer("last_reinforced_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_memories_agent").on(table.agent_id),
    index("idx_memories_conversation").on(table.conversation_id),
    index("idx_memories_source_run").on(table.source_run_id),
    index("idx_memories_salience").on(table.salience),
    index("idx_memories_status").on(table.status),
    index("idx_memories_origin").on(table.origin),
    index("idx_memories_last_used").on(table.last_used_at),
    index("idx_memories_expires").on(table.expires_at),
    index("idx_memories_mem0").on(table.mem0_id),
    index("idx_memories_sync_status").on(table.sync_status),
  ],
);

export const memoryObservations = sqliteTable(
  "memory_observations",
  {
    id: text("id").primaryKey(),
    dedupe_key: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    kind: text("kind", { enum: ["fact", "preference", "episode", "profile", "skill"] }).notNull(),
    source_conversation_id: text("source_conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    source_run_id: text("source_run_id").references(() => runtimeRuns.id, {
      onDelete: "set null",
    }),
    source_agent_id: text("source_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    confidence: integer("confidence").notNull().default(50),
    evidence_count: integer("evidence_count").notNull().default(1),
    evidence_json: text("evidence_json").notNull().default("[]"),
    status: text("status", { enum: ["pending", "promoted", "expired", "rejected"] })
      .notNull()
      .default("pending"),
    expires_at: integer("expires_at").notNull(),
    promoted_memory_id: text("promoted_memory_id").references(() => memories.id, {
      onDelete: "set null",
    }),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_memory_observations_dedupe").on(table.dedupe_key),
    index("idx_memory_observations_status_expires").on(table.status, table.expires_at),
    index("idx_memory_observations_conversation").on(table.source_conversation_id),
  ],
);

export const memoryJobs = sqliteTable(
  "memory_jobs",
  {
    id: text("id").primaryKey(),
    idempotency_key: text("idempotency_key"),
    kind: text("kind", {
      enum: ["learn", "consolidate", "sync", "decay", "rehydrate"],
    }).notNull(),
    status: text("status", {
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    })
      .notNull()
      .default("queued"),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    run_id: text("run_id").references(() => runtimeRuns.id, { onDelete: "set null" }),
    payload_json: text("payload_json").notNull().default("{}"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    scheduled_at: integer("scheduled_at").notNull(),
    started_at: integer("started_at"),
    finished_at: integer("finished_at"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_memory_jobs_status_scheduled").on(table.status, table.scheduled_at),
    index("idx_memory_jobs_kind").on(table.kind),
    index("idx_memory_jobs_idempotency").on(table.idempotency_key),
    index("idx_memory_jobs_conversation").on(table.conversation_id),
    index("idx_memory_jobs_agent").on(table.agent_id),
  ],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const conversationWorkspaces = sqliteTable(
  "conversation_workspaces",
  {
    conversation_id: text("conversation_id").primaryKey(),
    parent_path: text("parent_path").notNull(),
    root_path: text("root_path").notNull().unique(),
    status: text("status", { enum: ["active", "orphaned"] })
      .notNull()
      .default("active"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [index("idx_conversation_workspaces_status").on(table.status)],
);

export const modelProviders = sqliteTable("model_providers", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  kind: text("kind", { enum: ["openai", "openai-compatible", "anthropic", "google"] }).notNull(),
  source: text("source", { enum: ["builtin", "custom"] })
    .notNull()
    .default("custom"),
  base_url: text("base_url"),
  help_url: text("help_url").notNull().default(""),
  config_json: text("config_json").notNull().default("{}"),
  created_at: integer("created_at").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const modelApiKeys = sqliteTable(
  "model_api_keys",
  {
    provider_id: text("provider_id").notNull(),
    model_id: text("model_id").notNull(),
    ciphertext: text("ciphertext").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider_id, table.model_id] }),
    index("idx_model_api_keys_provider").on(table.provider_id),
  ],
);

export const apiKeys = sqliteTable("api_keys", {
  provider: text("provider").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const interactionProfiles = sqliteTable("interaction_profiles", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["chat", "voice", "video", "mouse"] }).notNull(),
  label: text("label").notNull(),
  enabled: integer("enabled").notNull().default(0),
  status: text("status", { enum: ["ready", "prototype", "blocked"] }).notNull(),
  config_json: text("config_json").notNull(),
  updated_at: integer("updated_at").notNull(),
});

export const syncProfiles = sqliteTable("sync_profiles", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["local_only", "manual", "cloud"] }).notNull(),
  endpoint: text("endpoint"),
  device_id: text("device_id").notNull(),
  encryption_enabled: integer("encryption_enabled").notNull().default(1),
  conflict_strategy: text("conflict_strategy", {
    enum: ["last_write_wins", "merge_with_review"],
  }).notNull(),
  status: text("status", { enum: ["idle", "syncing", "error"] }).notNull(),
  last_synced_at: integer("last_synced_at"),
  updated_at: integer("updated_at").notNull(),
});

export const sandboxSessions = sqliteTable(
  "sandbox_sessions",
  {
    id: text("id").primaryKey(),
    conversation_id: text("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    run_id: text("run_id").references(() => runtimeRuns.id, { onDelete: "set null" }),
    agent_id: text("agent_id").references(() => agents.id, { onDelete: "set null" }),
    root_path: text("root_path").notNull(),
    isolation_mode: text("isolation_mode", { enum: ["docker", "local"] }).notNull(),
    status: text("status", { enum: ["active", "stopped", "failed"] }).notNull(),
    docker_available: integer("docker_available").notNull().default(0),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_sandbox_sessions_conversation").on(table.conversation_id),
    index("idx_sandbox_sessions_run").on(table.run_id),
    index("idx_sandbox_sessions_updated").on(table.updated_at),
  ],
);

export const sandboxSnapshots = sqliteTable(
  "sandbox_snapshots",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sandboxSessions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    manifest_json: text("manifest_json").notNull(),
    created_at: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_sandbox_snapshots_session").on(table.session_id),
    index("idx_sandbox_snapshots_created").on(table.created_at),
  ],
);

export const sandboxArtifacts = sqliteTable(
  "sandbox_artifacts",
  {
    id: text("id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sandboxSessions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["file", "directory", "html", "static", "preview"] }).notNull(),
    path: text("path").notNull(),
    url: text("url"),
    size_bytes: integer("size_bytes"),
    entry_path: text("entry_path"),
    mime_type: text("mime_type"),
    sha256: text("sha256"),
    status: text("status", {
      enum: ["candidate", "ready", "running", "stopped", "failed"],
    })
      .notNull()
      .default("ready"),
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull().default(0),
  },
  (table) => [
    index("idx_sandbox_artifacts_session").on(table.session_id),
    index("idx_sandbox_artifacts_created").on(table.created_at),
  ],
);

export const schema = {
  conversations,
  messages,
  cronJobs,
  cronRuns,
  catalogSources,
  catalogItems,
  artifactInstallations,
  agents,
  agentPolicies,
  runtimeRuns,
  agentRunInputs,
  agentInstances,
  collaborationMessages,
  contextCheckpoints,
  runtimeSteps,
  runtimeEvents,
  toolServers,
  managedRuntimes,
  runtimePreferences,
  mcpRuntimeStates,
  mcpDependencyInstallations,
  tools,
  skillPackages,
  skillEntries,
  skillRuns,
  toolSecrets,
  memories,
  memoryObservations,
  memoryJobs,
  settings,
  conversationWorkspaces,
  modelProviders,
  modelApiKeys,
  apiKeys,
  interactionProfiles,
  syncProfiles,
  sandboxSessions,
  sandboxSnapshots,
  sandboxArtifacts,
};

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
export type CronJob = typeof cronJobs.$inferSelect;
export type NewCronJob = typeof cronJobs.$inferInsert;
export type CronRun = typeof cronRuns.$inferSelect;
export type NewCronRun = typeof cronRuns.$inferInsert;
export type CatalogSource = typeof catalogSources.$inferSelect;
export type CatalogItem = typeof catalogItems.$inferSelect;
export type ArtifactInstallation = typeof artifactInstallations.$inferSelect;
export type AgentProfile = typeof agents.$inferSelect;
export type NewAgentProfile = typeof agents.$inferInsert;
export type AgentPolicy = typeof agentPolicies.$inferSelect;
export type NewAgentPolicy = typeof agentPolicies.$inferInsert;
export type RuntimeRun = typeof runtimeRuns.$inferSelect;
export type NewRuntimeRun = typeof runtimeRuns.$inferInsert;
export type AgentRunInput = typeof agentRunInputs.$inferSelect;
export type NewAgentRunInput = typeof agentRunInputs.$inferInsert;
export type AgentInstance = typeof agentInstances.$inferSelect;
export type NewAgentInstance = typeof agentInstances.$inferInsert;
export type CollaborationMessage = typeof collaborationMessages.$inferSelect;
export type NewCollaborationMessage = typeof collaborationMessages.$inferInsert;
export type ContextCheckpoint = typeof contextCheckpoints.$inferSelect;
export type NewContextCheckpoint = typeof contextCheckpoints.$inferInsert;
export type RuntimeStep = typeof runtimeSteps.$inferSelect;
export type NewRuntimeStep = typeof runtimeSteps.$inferInsert;
export type RuntimeEvent = typeof runtimeEvents.$inferSelect;
export type NewRuntimeEvent = typeof runtimeEvents.$inferInsert;
export type ToolServer = typeof toolServers.$inferSelect;
export type NewToolServer = typeof toolServers.$inferInsert;
export type ManagedRuntime = typeof managedRuntimes.$inferSelect;
export type NewManagedRuntime = typeof managedRuntimes.$inferInsert;
export type RuntimePreference = typeof runtimePreferences.$inferSelect;
export type NewRuntimePreference = typeof runtimePreferences.$inferInsert;
export type McpRuntimeState = typeof mcpRuntimeStates.$inferSelect;
export type NewMcpRuntimeState = typeof mcpRuntimeStates.$inferInsert;
export type McpDependencyInstallation = typeof mcpDependencyInstallations.$inferSelect;
export type NewMcpDependencyInstallation = typeof mcpDependencyInstallations.$inferInsert;
export type ToolRecord = typeof tools.$inferSelect;
export type NewToolRecord = typeof tools.$inferInsert;
export type SkillPackage = typeof skillPackages.$inferSelect;
export type NewSkillPackage = typeof skillPackages.$inferInsert;
export type SkillEntry = typeof skillEntries.$inferSelect;
export type NewSkillEntry = typeof skillEntries.$inferInsert;
export type SkillRun = typeof skillRuns.$inferSelect;
export type NewSkillRun = typeof skillRuns.$inferInsert;
export type ToolSecret = typeof toolSecrets.$inferSelect;
export type NewToolSecret = typeof toolSecrets.$inferInsert;
export type MemoryRecord = typeof memories.$inferSelect;
export type NewMemoryRecord = typeof memories.$inferInsert;
export type MemoryObservation = typeof memoryObservations.$inferSelect;
export type NewMemoryObservation = typeof memoryObservations.$inferInsert;
export type MemoryJob = typeof memoryJobs.$inferSelect;
export type NewMemoryJob = typeof memoryJobs.$inferInsert;
export type InteractionProfile = typeof interactionProfiles.$inferSelect;
export type SyncProfile = typeof syncProfiles.$inferSelect;
export type Setting = typeof settings.$inferSelect;
export type ConversationWorkspace = typeof conversationWorkspaces.$inferSelect;
export type NewConversationWorkspace = typeof conversationWorkspaces.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ModelApiKey = typeof modelApiKeys.$inferSelect;
export type ModelProvider = typeof modelProviders.$inferSelect;
export type SandboxSession = typeof sandboxSessions.$inferSelect;
export type NewSandboxSession = typeof sandboxSessions.$inferInsert;
export type SandboxSnapshot = typeof sandboxSnapshots.$inferSelect;
export type NewSandboxSnapshot = typeof sandboxSnapshots.$inferInsert;
export type SandboxArtifact = typeof sandboxArtifacts.$inferSelect;
export type NewSandboxArtifact = typeof sandboxArtifacts.$inferInsert;
