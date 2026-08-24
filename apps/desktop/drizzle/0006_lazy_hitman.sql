ALTER TABLE `sandbox_artifacts` ADD `entry_path` text;--> statement-breakpoint
ALTER TABLE `sandbox_artifacts` ADD `mime_type` text;--> statement-breakpoint
ALTER TABLE `sandbox_artifacts` ADD `sha256` text;--> statement-breakpoint
ALTER TABLE `sandbox_artifacts` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `sandbox_artifacts` ADD `updated_at` integer DEFAULT 0 NOT NULL;