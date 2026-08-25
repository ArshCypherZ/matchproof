ALTER TABLE `incidents` ADD `tenant_id` text DEFAULT 'default-merchant' NOT NULL;--> statement-breakpoint
CREATE INDEX `incidents_tenant_id_idx` ON `incidents` (`tenant_id`);