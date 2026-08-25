import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const payments = pgTable(
  "payments",
  {
    paymentId: text("payment_id").primaryKey(),
    state: text("state").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    operation: text("operation").notNull(),
    operationKey: text("operation_key").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    paymentCorrelation: index("payments_payment_id_idx").on(table.paymentId),
    operationCorrelation: index("payments_operation_key_idx").on(
      table.operationKey,
    ),
  }),
);
export const merchantOrders = pgTable(
  "merchant_orders",
  {
    orderId: text("order_id").primaryKey(),
    paymentId: text("payment_id"),
    state: text("state").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    paymentCorrelation: index("merchant_orders_payment_id_idx").on(
      table.paymentId,
    ),
    pendingDiscovery: index("merchant_orders_state_updated_at_idx").on(
      table.state,
      table.updatedAt,
    ),
  }),
);
export const merchantOrderUpdates = pgTable(
  "merchant_order_updates",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    orderId: text("order_id").notNull(),
    requestedState: text("requested_state").notNull(),
    beforeState: text("before_state").notNull(),
    afterState: text("after_state").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", {
      withTimezone: true,
    }).notNull(),
  },
  (table) => ({
    orderCorrelation: index("merchant_order_updates_order_id_idx").on(
      table.orderId,
    ),
    orderReference: foreignKey({
      columns: [table.orderId],
      foreignColumns: [merchantOrders.orderId],
      name: "merchant_order_updates_order_id_merchant_orders_order_id_fk",
    }),
  }),
);
export const incidents = pgTable(
  "incidents",
  {
    incidentId: text("incident_id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default-merchant"),
    paymentId: text("payment_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    bundle: jsonb("bundle").notNull(),
  },
  (table) => ({
    tenantCorrelation: index("incidents_tenant_id_idx").on(table.tenantId),
    paymentCorrelation: index("incidents_payment_id_idx").on(table.paymentId),
    operationCorrelation: index("incidents_idempotency_key_idx").on(
      table.idempotencyKey,
    ),
    paymentReference: foreignKey({
      columns: [table.paymentId],
      foreignColumns: [payments.paymentId],
      name: "incidents_payment_id_payments_payment_id_fk",
    }),
  }),
);
export const recoveries = pgTable("recoveries", {
  executionKey: text("execution_key").primaryKey(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  beforeState: text("before_state").notNull(),
  afterState: text("after_state").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
});
export const recoveryAttempts = pgTable("recovery_attempts", {
  executionKey: text("execution_key").primaryKey(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  beforeState: text("before_state").notNull(),
  afterState: text("after_state"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
export const afterstateObservations = pgTable("afterstate_observations", {
  executionKey: text("execution_key").primaryKey(),
  observation: jsonb("observation").notNull(),
});
export const auditEvents = pgTable("audit_events", {
  sequence: integer("sequence").generatedAlwaysAsIdentity().primaryKey(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
});
export const razorpayWebhookEvents = pgTable(
  "razorpay_webhook_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    signature: text("signature").notNull(),
    body: text("body").notNull(),
    paymentId: text("payment_id"),
    incidentId: text("incident_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    paymentCorrelation: index("webhook_payment_id_idx").on(table.paymentId),
    incidentReference: foreignKey({
      columns: [table.incidentId],
      foreignColumns: [incidents.incidentId],
      name: "webhook_incident_id_incidents_incident_id_fk",
    }),
  }),
);
export const incidentProgress = pgTable(
  "incident_progress",
  {
    sequence: integer("sequence").generatedAlwaysAsIdentity().primaryKey(),
    incidentId: text("incident_id").notNull(),
    step: text("step").notNull(),
    status: text("status").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    details: jsonb("details").notNull(),
  },
  (table) => ({
    incidentIndex: index("incident_progress_incident_id_idx").on(
      table.incidentId,
    ),
    stepIndex: index("incident_progress_step_idx").on(table.step),
    stepStatusIdentity: uniqueIndex(
      "incident_progress_incident_step_status_idx",
    ).on(table.incidentId, table.step, table.status),
    incidentReference: foreignKey({
      columns: [table.incidentId],
      foreignColumns: [incidents.incidentId],
      name: "incident_progress_incident_id_incidents_incident_id_fk",
    }),
  }),
);
export const schema = {
  payments,
  merchantOrders,
  merchantOrderUpdates,
  incidents,
  recoveries,
  recoveryAttempts,
  afterstateObservations,
  auditEvents,
  razorpayWebhookEvents,
  incidentProgress,
};
