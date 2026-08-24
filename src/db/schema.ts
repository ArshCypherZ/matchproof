import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const payments = pgTable("payments", {
  paymentId: text("payment_id").primaryKey(), state: text("state").notNull(),
  amountMinor: integer("amount_minor").notNull(), currency: text("currency").notNull(),
  operation: text("operation").notNull(), operationKey: text("operation_key").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (table) => ({ paymentCorrelation: index("payments_payment_id_idx").on(table.paymentId), operationCorrelation: index("payments_operation_key_idx").on(table.operationKey) }));
export const incidents = pgTable("incidents", {
  incidentId: text("incident_id").primaryKey(), paymentId: text("payment_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), bundle: jsonb("bundle").notNull(),
}, (table) => ({ paymentCorrelation: index("incidents_payment_id_idx").on(table.paymentId), operationCorrelation: index("incidents_idempotency_key_idx").on(table.idempotencyKey) }));
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
  eventId: text("event_id").primaryKey(), eventType: text("event_type").notNull(), signature: text("signature").notNull(), body: text("body").notNull(), paymentId: text("payment_id"), incidentId: text("incident_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(), acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
}, (table) => ({ paymentCorrelation: index("webhook_payment_id_idx").on(table.paymentId) }));
export const incidentProgress = pgTable("incident_progress", {
  incidentId: text("incident_id").primaryKey(), step: text("step").notNull(), status: text("status").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(), details: jsonb("details").notNull(),
}, (table) => ({ stepIndex: index("incident_progress_step_idx").on(table.step) }));
export const schema = { payments, incidents, recoveries, auditEvents, razorpayWebhookEvents, incidentProgress };
