CREATE TABLE "audit_events" (
	"sequence" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_events_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"recorded_at" timestamp with time zone NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"incident_id" text PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"bundle" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"payment_id" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"operation" text NOT NULL,
	"operation_key" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "razorpay_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"signature" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recoveries" (
	"execution_key" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"before_state" text NOT NULL,
	"after_state" text NOT NULL,
	"completed_at" timestamp with time zone NOT NULL
);
