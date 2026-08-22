CREATE TABLE `managed_runtimes` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`version` text NOT NULL,
	`platform` text NOT NULL,
	`architecture` text NOT NULL,
	`root_path` text NOT NULL,
	`executable_path` text NOT NULL,
	`source_url` text NOT NULL,
	`sha256` text NOT NULL,
	`channel` text DEFAULT 'stable' NOT NULL,
	`status` text DEFAULT 'installing' NOT NULL,
	`installed_at` integer,
	`updated_at` integer NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_runtimes_identity` ON `managed_runtimes` (`kind`,`version`,`platform`,`architecture`);--> statement-breakpoint
CREATE INDEX `idx_managed_runtimes_kind_status` ON `managed_runtimes` (`kind`,`status`);--> statement-breakpoint
CREATE TABLE `mcp_dependency_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`manager` text NOT NULL,
	`package_specs_json` text DEFAULT '[]' NOT NULL,
	`install_root` text,
	`status` text DEFAULT 'not_installed' NOT NULL,
	`scripts_allowed` integer DEFAULT 0 NOT NULL,
	`runtime_installation_id` text,
	`installed_at` integer,
	`updated_at` integer NOT NULL,
	`last_error` text,
	FOREIGN KEY (`server_id`) REFERENCES `tool_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runtime_installation_id`) REFERENCES `managed_runtimes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_dependency_installations_server` ON `mcp_dependency_installations` (`server_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_dependency_installations_status` ON `mcp_dependency_installations` (`status`);--> statement-breakpoint
CREATE TABLE `mcp_runtime_states` (
	`server_id` text PRIMARY KEY NOT NULL,
	`desired_state` text DEFAULT 'stopped' NOT NULL,
	`state` text DEFAULT 'stopped' NOT NULL,
	`pid` integer,
	`resolved_command` text,
	`runtime_installation_id` text,
	`started_at` integer,
	`last_exit_at` integer,
	`restart_attempts` integer DEFAULT 0 NOT NULL,
	`next_retry_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `tool_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runtime_installation_id`) REFERENCES `managed_runtimes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_mcp_runtime_states_state` ON `mcp_runtime_states` (`state`);--> statement-breakpoint
CREATE INDEX `idx_mcp_runtime_states_desired` ON `mcp_runtime_states` (`desired_state`);--> statement-breakpoint
CREATE TABLE `runtime_preferences` (
	`kind` text PRIMARY KEY NOT NULL,
	`manifest_url` text NOT NULL,
	`channel` text DEFAULT 'stable' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tool_servers` ADD `config_source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `tool_servers` ADD `config_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
UPDATE `tool_servers`
SET `enabled` = 0, `status` = 'disabled'
WHERE `kind` = 'mcp';--> statement-breakpoint
INSERT INTO `mcp_runtime_states` (
  `server_id`, `desired_state`, `state`, `pid`, `resolved_command`,
  `runtime_installation_id`, `started_at`, `last_exit_at`,
  `restart_attempts`, `next_retry_at`, `last_error`, `updated_at`
)
SELECT
  `id`, 'stopped', 'stopped', NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL,
  strftime('%s','now') * 1000
FROM `tool_servers`
WHERE `kind` = 'mcp';
