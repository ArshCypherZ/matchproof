import { desc, eq, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createSqliteDatabase, type SqliteDatabase } from "./sqlite-client";
import {
  auditEvents,
  incidentProgress,
  incidents,
  payments,
  recoveries,
  razorpayWebhookEvents,
} from "./sqlite-schema";
import {
  ActionSchema,
  IncidentBundleSchema,
  PaymentStateSchema,
  type PaymentState,
  RecoveryOutcomeSchema,
  type IncidentBundle,
} from "../domain/schemas";
import type {
  IncidentRepository,
  PaymentRecord,
  ProgressRecord,
  RecoveryInput,
  WebhookInput,
  WebhookRecord,
} from "./repository";

const asPayment = (row: typeof payments.$inferSelect): PaymentRecord => ({
  payment_id: row.paymentId,
  state: PaymentStateSchema.parse(row.state),
  amount_minor: row.amountMinor,
  currency: row.currency,
  operation: row.operation,
  operation_key: row.operationKey,
  updated_at: row.updatedAt,
});
const asProgress = (
  row: typeof incidentProgress.$inferSelect,
): ProgressRecord => ({
  sequence: row.sequence,
  incident_id: row.incidentId,
  step: row.step,
  status: row.status,
  updated_at: row.updatedAt,
  details: JSON.parse(row.details),
});
const asWebhook = (
  row: typeof razorpayWebhookEvents.$inferSelect,
): WebhookRecord => ({
  event_id: row.eventId,
  event_type: row.eventType,
  signature: row.signature,
  body: row.body,
  payment_id: row.paymentId,
  received_at: row.receivedAt,
  accepted_at: row.acceptedAt,
  incident_id: row.incidentId,
});

export class SqliteIncidentRepository implements IncidentRepository {
  private readonly connection: ReturnType<typeof createSqliteDatabase>;
  private readonly db: SqliteDatabase;
  constructor(private readonly file: string) {
    this.connection = createSqliteDatabase(file);
    this.db = this.connection.db;
  }
  async initialize(reset: boolean) {
    const hasTables = this.connection.client
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'payments'",
      )
      .get();
    if (!hasTables) {
      migrate(this.db, { migrationsFolder: "drizzle-sqlite" });
    }
    const columns = this.connection.client
      .prepare("PRAGMA table_info(incident_progress)")
      .all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "sequence")) {
      this.connection.client.transaction(() => {
        this.connection.client.exec(
          "ALTER TABLE incident_progress RENAME TO incident_progress_legacy",
        );
        this.connection.client.exec(
          "CREATE TABLE incident_progress (sequence integer primary key autoincrement, incident_id text not null, step text not null, status text not null, updated_at text not null, details text not null)",
        );
        this.connection.client.exec(
          "INSERT INTO incident_progress(incident_id,step,status,updated_at,details) SELECT incident_id,step,status,updated_at,details FROM incident_progress_legacy",
        );
        this.connection.client.exec("DROP TABLE incident_progress_legacy");
      })();
    }
    this.db.run(
      sql`CREATE INDEX IF NOT EXISTS payments_payment_id_idx ON payments(payment_id)`,
    );
    this.db.run(
      sql`CREATE INDEX IF NOT EXISTS payments_operation_key_idx ON payments(operation_key)`,
    );
    this.db.run(
      sql`CREATE INDEX IF NOT EXISTS incidents_payment_id_idx ON incidents(payment_id)`,
    );
    this.db.run(
      sql`CREATE INDEX IF NOT EXISTS incidents_idempotency_key_idx ON incidents(idempotency_key)`,
    );
    this.db.run(
      sql`CREATE INDEX IF NOT EXISTS webhook_payment_id_idx ON razorpay_webhook_events(payment_id)`,
    );
    this.db.run(
      sql`CREATE INDEX IF NOT EXISTS incident_progress_incident_id_idx ON incident_progress(incident_id)`,
    );
    this.db.run(
      sql`CREATE INDEX IF NOT EXISTS incident_progress_step_idx ON incident_progress(step)`,
    );
    this.db.run(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS incident_progress_incident_step_status_idx ON incident_progress(incident_id,step,status)`,
    );
    if (reset)
      this.connection.client.exec(
        "DELETE FROM audit_events; DELETE FROM recoveries; DELETE FROM incidents; DELETE FROM payments; DELETE FROM razorpay_webhook_events; DELETE FROM incident_progress;",
      );
  }
  async close() {
    this.connection.client.close();
  }
  async ingest(bundle: IncidentBundle) {
    const evidence = bundle.evidence.find(
      (entry) => "amount_minor" in entry.payload && "currency" in entry.payload,
    );
    const internal = bundle.evidence.find(
      (entry) => entry.kind === "internal_state",
    );
    const processor = bundle.evidence.find(
      (entry) => entry.kind === "processor_webhook",
    );
    const amount =
      evidence && "amount_minor" in evidence.payload
        ? evidence.payload.amount_minor
        : 0;
    const currency =
      evidence && "currency" in evidence.payload
        ? evidence.payload.currency
        : "UNK";
    const operation =
      evidence && "operation" in evidence.payload
        ? evidence.payload.operation
        : "read";
    const state =
      internal?.payload.payment_state ??
      processor?.payload.payment_state ??
      "unknown";
    this.connection.client.transaction(() => {
      if (amount > 0 && currency !== "UNK")
        this.db
          .insert(payments)
          .values({
            paymentId: bundle.payment_id,
            state,
            amountMinor: amount,
            currency,
            operation,
            operationKey: bundle.idempotency_key,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoNothing()
          .run();
      this.db
        .insert(incidents)
        .values({
          incidentId: bundle.incident_id,
          paymentId: bundle.payment_id,
          idempotencyKey: bundle.idempotency_key,
          bundle: JSON.stringify(bundle),
        })
        .onConflictDoNothing()
        .run();
      const [existing] = this.db
        .select({
          paymentId: incidents.paymentId,
          idempotencyKey: incidents.idempotencyKey,
        })
        .from(incidents)
        .where(eq(incidents.incidentId, bundle.incident_id))
        .all();
      if (
        !existing ||
        existing.paymentId !== bundle.payment_id ||
        existing.idempotencyKey !== bundle.idempotency_key
      )
        throw new Error(
          "incident ID was already stored with different identity",
        );
      this.db
        .update(razorpayWebhookEvents)
        .set({ incidentId: bundle.incident_id })
        .where(
          sql`${razorpayWebhookEvents.paymentId} = ${bundle.payment_id} AND ${isNull(razorpayWebhookEvents.incidentId)}`,
        )
        .run();
      this.db
        .insert(incidentProgress)
        .values({
          incidentId: bundle.incident_id,
          step: "detect",
          status: "completed",
          updatedAt: new Date().toISOString(),
          details: "{}",
        })
        .onConflictDoNothing()
        .run();
    })();
  }
  async incident(id: string) {
    const [row] = this.db
      .select()
      .from(incidents)
      .where(eq(incidents.incidentId, id))
      .all();
    return row ? IncidentBundleSchema.parse(JSON.parse(row.bundle)) : null;
  }
  async payment(id: string) {
    const [row] = this.db
      .select()
      .from(payments)
      .where(eq(payments.paymentId, id))
      .all();
    return row ? asPayment(row) : undefined;
  }
  async updatePayment(id: string, state: PaymentState) {
    this.db
      .update(payments)
      .set({ state, updatedAt: new Date().toISOString() })
      .where(eq(payments.paymentId, id))
      .run();
  }
  async recovery(key: string) {
    const [row] = this.db
      .select()
      .from(recoveries)
      .where(eq(recoveries.executionKey, key))
      .all();
    return row
      ? {
          execution_key: row.executionKey,
          action: ActionSchema.parse(row.action),
          status: RecoveryOutcomeSchema.shape.status.parse(row.status),
          before_state: PaymentStateSchema.parse(row.beforeState),
          after_state: PaymentStateSchema.parse(row.afterState),
          completed_at: row.completedAt,
        }
      : undefined;
  }
  async completeRecovery(key: string, value: RecoveryInput) {
    this.db
      .insert(recoveries)
      .values({
        executionKey: key,
        action: value.action,
        status: value.status,
        beforeState: value.before_state,
        afterState: value.after_state,
        completedAt: value.completed_at,
      })
      .onConflictDoUpdate({
        target: recoveries.executionKey,
        set: {
          status: value.status,
          afterState: value.after_state,
          completedAt: value.completed_at,
        },
      })
      .run();
  }
  async audit(type: string, payload: unknown) {
    const [row] = this.db
      .insert(auditEvents)
      .values({
        recordedAt: new Date().toISOString(),
        eventType: type,
        payload: JSON.stringify(payload),
      })
      .returning({ sequence: auditEvents.sequence })
      .all();
    return row?.sequence;
  }
  async auditRecords() {
    return this.db
      .select()
      .from(auditEvents)
      .orderBy(auditEvents.sequence)
      .all();
  }
  async setProgress(
    incidentId: string,
    step: string,
    status: string,
    details: unknown,
  ) {
    this.db
      .insert(incidentProgress)
      .values({
        incidentId,
        step,
        status,
        updatedAt: new Date().toISOString(),
        details: JSON.stringify(details),
      })
      .onConflictDoNothing()
      .run();
  }
  async progress(incidentId: string) {
    return this.db
      .select()
      .from(incidentProgress)
      .where(eq(incidentProgress.incidentId, incidentId))
      .orderBy(incidentProgress.sequence)
      .all()
      .map(asProgress);
  }
  async latestProgress(incidentId: string) {
    const [row] = this.db
      .select()
      .from(incidentProgress)
      .where(eq(incidentProgress.incidentId, incidentId))
      .orderBy(desc(incidentProgress.sequence))
      .limit(1)
      .all();
    return row ? asProgress(row) : undefined;
  }
  async webhookEvent(eventId: string) {
    const [row] = this.db
      .select()
      .from(razorpayWebhookEvents)
      .where(eq(razorpayWebhookEvents.eventId, eventId))
      .all();
    return row ? asWebhook(row) : undefined;
  }
  async ingestWebhook(event: WebhookInput, incidentId?: string) {
    return this.connection.client.transaction(() => {
      const inserted = this.db
        .insert(razorpayWebhookEvents)
        .values({
          eventId: event.eventId,
          eventType: event.eventType,
          signature: event.signature,
          body: event.body,
          paymentId: event.paymentId,
          receivedAt: event.receivedAt,
          acceptedAt: new Date().toISOString(),
          incidentId: incidentId ?? null,
        })
        .onConflictDoNothing()
        .run();
      const [row] = this.db
        .select()
        .from(razorpayWebhookEvents)
        .where(eq(razorpayWebhookEvents.eventId, event.eventId))
        .all();
      if (!row) throw new Error("webhook event insert was not observable");
      if (row.signature !== event.signature || row.body !== event.body)
        throw new Error(
          "webhook event ID was already stored with different evidence",
        );
      return {
        status: inserted.changes
          ? ("accepted" as const)
          : ("duplicate" as const),
        eventId: row.eventId,
        eventType: row.eventType,
        receivedAt: row.receivedAt,
      };
    })();
  }
}
