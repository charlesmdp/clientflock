CREATE TABLE `budgets` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `searches` (
	`id` text PRIMARY KEY NOT NULL,
	`cache_key` text NOT NULL,
	`input` text NOT NULL,
	`stage` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'working' NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`response_id` text,
	`lease` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `searches_cache_key_unique` ON `searches` (`cache_key`);