import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const payments = sqliteTable(
  "payments",
  {
    paymentId: text("payment_id").primaryKey(),
    state: text("state").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    operation: text("operation").notNull(),
    operationKey: text("operation_key").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    paymentCorrelation: index("payments_payment_id_idx").on(table.paymentId),
    operationCorrelation: index("payments_operation_key_idx").on(
      table.operationKey,
    ),
  }),
);
export const merchantOrders = sqliteTable(
  "merchant_orders",
  {
    orderId: text("order_id").primaryKey(),
    paymentId: text("payment_id"),
    state: text("state").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
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
export const merchantOrderUpdates = sqliteTable(
  "merchant_order_updates",
  {
    idempotencyKey: text("idempotency_key").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => merchantOrders.orderId),
    requestedState: text("requested_state").notNull(),
    beforeState: text("before_state").notNull(),
    afterState: text("after_state").notNull(),
    acknowledgedAt: text("acknowledged_at").notNull(),
  },
  (table) => ({
    orderCorrelation: index("merchant_order_updates_order_id_idx").on(
      table.orderId,
    ),
  }),
);
export const incidents = sqliteTable(
  "incidents",
  {
    incidentId: text("incident_id").primaryKey(),
    tenantId: text("tenant_id").notNull().default("default-merchant"),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.paymentId),
    idempotencyKey: text("idempotency_key").notNull(),
    bundle: text("bundle").notNull(),
  },
  (table) => ({
    tenantCorrelation: index("incidents_tenant_id_idx").on(table.tenantId),
    paymentCorrelation: index("incidents_payment_id_idx").on(table.paymentId),
    operationCorrelation: index("incidents_idempotency_key_idx").on(
      table.idempotencyKey,
    ),
  }),
);
export const recoveries = sqliteTable("recoveries", {
  executionKey: text("execution_key").primaryKey(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  beforeState: text("before_state").notNull(),
  afterState: text("after_state").notNull(),
  completedAt: text("completed_at").notNull(),
});
export const recoveryAttempts = sqliteTable("recovery_attempts", {
  executionKey: text("execution_key").primaryKey(),
  action: text("action").notNull(),
  status: text("status").notNull(),
  beforeState: text("before_state").notNull(),
  afterState: text("after_state"),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});
export const postRepairStateObservations = sqliteTable(
  "post_repair_state_observations",
  {
    executionKey: text("execution_key").primaryKey(),
    observation: text("observation").notNull(),
  },
);
export const auditEvents = sqliteTable("audit_events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  recordedAt: text("recorded_at").notNull(),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
});
export const razorpayWebhookEvents = sqliteTable(
  "razorpay_webhook_events",
  {
    eventId: text("event_id").primaryKey(),
    eventType: text("event_type").notNull(),
    signature: text("signature").notNull(),
    body: text("body").notNull(),
    paymentId: text("payment_id"),
    receivedAt: text("received_at").notNull(),
    acceptedAt: text("accepted_at").notNull(),
    incidentId: text("incident_id").references(() => incidents.incidentId),
  },
  (table) => ({
    paymentCorrelation: index("webhook_payment_id_idx").on(table.paymentId),
  }),
);
export const incidentProgress = sqliteTable(
  "incident_progress",
  {
    sequence: integer("sequence").primaryKey({ autoIncrement: true }),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.incidentId),
    step: text("step").notNull(),
    status: text("status").notNull(),
    updatedAt: text("updated_at").notNull(),
    details: text("details").notNull(),
  },
  (table) => ({
    incidentIndex: index("incident_progress_incident_id_idx").on(
      table.incidentId,
    ),
    stepIndex: index("incident_progress_step_idx").on(table.step),
    stepStatusIdentity: uniqueIndex(
      "incident_progress_incident_step_status_idx",
    ).on(table.incidentId, table.step, table.status),
  }),
);
export const schema = {
  payments,
  merchantOrders,
  merchantOrderUpdates,
  incidents,
  recoveries,
  recoveryAttempts,
  postRepairStateObservations,
  auditEvents,
  razorpayWebhookEvents,
  incidentProgress,
};
