CREATE TABLE `browser_tabs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`url` text DEFAULT 'about:blank' NOT NULL,
	`title` text DEFAULT 'New tab' NOT NULL,
	`favicon_url` text,
	`position` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`loading` integer DEFAULT 0 NOT NULL,
	`can_go_back` integer DEFAULT 0 NOT NULL,
	`can_go_forward` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_browser_tabs_conversation` ON `browser_tabs` (`conversation_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_browser_tabs_active` ON `browser_tabs` (`conversation_id`,`active`);