CREATE TABLE `merchant_order_updates` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`requested_state` text NOT NULL,
	`before_state` text NOT NULL,
	`after_state` text NOT NULL,
	`acknowledged_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `merchant_orders`(`order_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `merchant_order_updates_order_id_idx` ON `merchant_order_updates` (`order_id`);--> statement-breakpoint
CREATE TABLE `merchant_orders` (
	`order_id` text PRIMARY KEY NOT NULL,
	`payment_id` text,
	`state` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `merchant_orders_payment_id_idx` ON `merchant_orders` (`payment_id`);--> statement-breakpoint
CREATE INDEX `merchant_orders_state_updated_at_idx` ON `merchant_orders` (`state`,`updated_at`);