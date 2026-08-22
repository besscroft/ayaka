DROP INDEX `idx_managed_runtimes_identity`;--> statement-breakpoint
ALTER TABLE `managed_runtimes` ADD `libc` text;--> statement-breakpoint
ALTER TABLE `managed_runtimes` ADD `verified_commands_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_managed_runtimes_identity` ON `managed_runtimes` (`kind`,`version`,`platform`,`architecture`,`libc`);