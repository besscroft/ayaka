CREATE TABLE `conversation_workspaces` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`parent_path` text NOT NULL,
	`root_path` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_workspaces_root_path_unique` ON `conversation_workspaces` (`root_path`);--> statement-breakpoint
CREATE INDEX `idx_conversation_workspaces_status` ON `conversation_workspaces` (`status`);