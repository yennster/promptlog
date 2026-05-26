CREATE TABLE `app_state` (
	`bundle_id` text PRIMARY KEY NOT NULL,
	`last_composer_text` text,
	`last_assistant_text` text,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE TABLE `prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`app` text NOT NULL,
	`prompt_text` text NOT NULL,
	`response_snippet` text,
	`sent_at` integer NOT NULL,
	`first_token_at` integer,
	`completed_at` integer,
	`latency_ms` integer,
	`est_prompt_tokens` integer,
	`est_response_tokens` integer,
	`est_cost_usd` real,
	`detected_cwd` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `prompts_session_idx` ON `prompts` (`session_id`);--> statement-breakpoint
CREATE INDEX `prompts_sent_at_idx` ON `prompts` (`sent_at`);--> statement-breakpoint
CREATE INDEX `prompts_app_idx` ON `prompts` (`app`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	`project_context` text,
	`notes` text
);
