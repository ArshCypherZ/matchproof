ALTER TABLE "razorpay_webhook_events" ADD COLUMN "payment_id" text;--> statement-breakpoint
CREATE INDEX "webhook_payment_id_idx" ON "razorpay_webhook_events" USING btree ("payment_id");