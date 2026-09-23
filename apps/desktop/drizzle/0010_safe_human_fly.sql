CREATE TABLE `realtime_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`transcript_json` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_realtime_sessions_updated` ON `realtime_sessions` (`updated_at`);