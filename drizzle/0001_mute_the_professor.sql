CREATE TABLE "incident_progress" (
	"incident_id" text PRIMARY KEY NOT NULL,
	"step" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "incident_progress_step_idx" ON "incident_progress" USING btree ("step");--> statement-breakpoint
CREATE INDEX "incidents_payment_id_idx" ON "incidents" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "incidents_idempotency_key_idx" ON "incidents" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_payment_id_idx" ON "payments" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payments_operation_key_idx" ON "payments" USING btree ("operation_key");