CREATE TABLE `audit_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`recorded_at` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `incident_progress` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` text NOT NULL,
	`step` text NOT NULL,
	`status` text NOT NULL,
	`updated_at` text NOT NULL,
	`details` text NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`incident_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `incident_progress_incident_id_idx` ON `incident_progress` (`incident_id`);--> statement-breakpoint
CREATE INDEX `incident_progress_step_idx` ON `incident_progress` (`step`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`incident_id` text PRIMARY KEY NOT NULL,
	`payment_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`bundle` text NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payments`(`payment_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `incidents_payment_id_idx` ON `incidents` (`payment_id`);--> statement-breakpoint
CREATE INDEX `incidents_idempotency_key_idx` ON `incidents` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `payments` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`operation` text NOT NULL,
	`operation_key` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_payment_id_idx` ON `payments` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payments_operation_key_idx` ON `payments` (`operation_key`);--> statement-breakpoint
CREATE TABLE `razorpay_webhook_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`signature` text NOT NULL,
	`body` text NOT NULL,
	`payment_id` text,
	`received_at` text NOT NULL,
	`accepted_at` text NOT NULL,
	`incident_id` text,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`incident_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `webhook_payment_id_idx` ON `razorpay_webhook_events` (`payment_id`);--> statement-breakpoint
CREATE TABLE `recoveries` (
	`execution_key` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`before_state` text NOT NULL,
	`after_state` text NOT NULL,
	`completed_at` text NOT NULL
);
