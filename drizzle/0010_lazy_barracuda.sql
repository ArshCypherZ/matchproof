ALTER TABLE "incidents" ADD COLUMN "tenant_id" text DEFAULT 'default-merchant' NOT NULL;--> statement-breakpoint
CREATE INDEX "incidents_tenant_id_idx" ON "incidents" USING btree ("tenant_id");