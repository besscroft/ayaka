PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`instructions` text NOT NULL,
	`persona` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`avatar` text DEFAULT 'bloub-cercle-attentif-bleu-anime' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`kind` text DEFAULT 'child' NOT NULL,
	`parent_agent_id` text,
	`locked` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`model_ref` text,
	`voice` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_agents`("id", "name", "role", "instructions", "persona", "description", "avatar", "status", "kind", "parent_agent_id", "locked", "enabled", "model_ref", "voice", "created_at", "updated_at") SELECT "id", "name", "role", "instructions", "persona", "description", "avatar", "status", "kind", "parent_agent_id", "locked", "enabled", "model_ref", "voice", "created_at", "updated_at" FROM `agents`;--> statement-breakpoint
DROP TABLE `agents`;--> statement-breakpoint
ALTER TABLE `__new_agents` RENAME TO `agents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agents_kind` ON `agents` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_agents_parent` ON `agents` (`parent_agent_id`);