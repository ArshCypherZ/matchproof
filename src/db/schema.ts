import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const payments = pgTable("payments", {
  paymentId: text("payment_id").primaryKey(), state: text("state").notNull(),
  amountMinor: integer("amount_minor").notNull(), currency: text("currency").notNull(),
  operation: text("operation").notNull(), operationKey: text("operation_key").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});
export const incidents = pgTable("incidents", {
  incidentId: text("incident_id").primaryKey(), paymentId: text("payment_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), bundle: jsonb("bundle").notNull(),
});
export const recoveries = pgTable("recoveries", {
  executionKey: text("execution_key").primaryKey(), action: text("action").notNull(),
  status: text("status").notNull(), beforeState: text("before_state").notNull(),
  afterState: text("after_state").notNull(), completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
});
export const auditEvents = pgTable("audit_events", {
  sequence: integer("sequence").generatedAlwaysAsIdentity().primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(), eventType: text("event_type").notNull(), payload: jsonb("payload").notNull(),
});
export const razorpayWebhookEvents = pgTable("razorpay_webhook_events", {
  eventId: text("event_id").primaryKey(), eventType: text("event_type").notNull(), signature: text("signature").notNull(), body: text("body").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
});
export const schema = { payments, incidents, recoveries, auditEvents, razorpayWebhookEvents };
