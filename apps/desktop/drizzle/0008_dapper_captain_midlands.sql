CREATE TABLE `skill_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`package_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`name` text NOT NULL,
	`runtime` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`available` integer DEFAULT 1 NOT NULL,
	`unavailable_reason` text,
	`timeout_ms` integer DEFAULT 60000 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`package_id`) REFERENCES `skill_packages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_skill_entries_skill` ON `skill_entries` (`skill_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_entries_package` ON `skill_entries` (`package_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_skill_entries_package_path` ON `skill_entries` (`package_id`,`relative_path`);--> statement-breakpoint
CREATE TABLE `skill_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`root_path` text NOT NULL,
	`content_hash` text NOT NULL,
	`execution_mode` text DEFAULT 'instructions' NOT NULL,
	`status` text DEFAULT 'disabled' NOT NULL,
	`manifest_json` text DEFAULT '{}' NOT NULL,
	`safety_json` text DEFAULT '{}' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_skill_packages_skill` ON `skill_packages` (`skill_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_packages_status` ON `skill_packages` (`status`);--> statement-breakpoint
CREATE INDEX `idx_skill_packages_hash` ON `skill_packages` (`content_hash`);--> statement-breakpoint
CREATE TABLE `skill_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`conversation_id` text,
	`agent_id` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`cwd` text NOT NULL,
	`args_json` text DEFAULT '[]' NOT NULL,
	`stdout` text DEFAULT '' NOT NULL,
	`stderr` text DEFAULT '' NOT NULL,
	`exit_code` integer,
	`signal` text,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`truncated` integer DEFAULT 0 NOT NULL,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `tools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `skill_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_skill_runs_skill_created` ON `skill_runs` (`skill_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_skill_runs_entry` ON `skill_runs` (`entry_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_runs_conversation` ON `skill_runs` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_skill_runs_status` ON `skill_runs` (`status`);