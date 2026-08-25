CREATE TABLE "recovery_attempts" (
	"execution_key" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"before_state" text NOT NULL,
	"after_state" text,
	"error" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
