CREATE TABLE "merchant_order_updates" (
	"idempotency_key" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"requested_state" text NOT NULL,
	"before_state" text NOT NULL,
	"after_state" text NOT NULL,
	"acknowledged_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_orders" (
	"order_id" text PRIMARY KEY NOT NULL,
	"payment_id" text,
	"state" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_order_updates" ADD CONSTRAINT "merchant_order_updates_order_id_merchant_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."merchant_orders"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_order_updates_order_id_idx" ON "merchant_order_updates" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "merchant_orders_payment_id_idx" ON "merchant_orders" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "merchant_orders_state_updated_at_idx" ON "merchant_orders" USING btree ("state","updated_at");