import { desc, eq, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  auditEvents,
  incidentProgress,
  incidents,
  payments,
  recoveries,
  razorpayWebhookEvents,
} from "./schema";
import { createDatabase, type Database } from "./client";
import {
  ActionSchema,
  IncidentBundleSchema,
  PaymentStateSchema,
  RecoveryOutcomeSchema,
  type PaymentState,
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
import { derivePaymentSeed } from "./repository";

const migrationsFolder = "drizzle";
const asPayment = (row: typeof payments.$inferSelect): PaymentRecord => ({
  payment_id: row.paymentId,
  state: PaymentStateSchema.parse(row.state),
  amount_minor: row.amountMinor,
  currency: row.currency,
  operation: row.operation,
  operation_key: row.operationKey,
  updated_at: row.updatedAt.toISOString(),
});
const asProgress = (
  row: typeof incidentProgress.$inferSelect,
): ProgressRecord => ({
  sequence: row.sequence,
  incident_id: row.incidentId,
  step: row.step,
  status: row.status,
  updated_at: row.updatedAt.toISOString(),
  details: row.details,
});
const asWebhook = (
  row: typeof razorpayWebhookEvents.$inferSelect,
): WebhookRecord => ({
  event_id: row.eventId,
  event_type: row.eventType,
  signature: row.signature,
  body: row.body,
  payment_id: row.paymentId,
  received_at: row.receivedAt.toISOString(),
  accepted_at: row.acceptedAt.toISOString(),
  incident_id: row.incidentId,
});

export class PostgresIncidentRepository implements IncidentRepository {
  private readonly connection: ReturnType<typeof createDatabase>;
  private readonly db: Database;
  constructor(connectionString?: string) {
    this.connection = createDatabase(connectionString);
    this.db = this.connection.db;
  }

  async initialize(reset: boolean) {
    await migrate(this.db, { migrationsFolder });
    if (reset) {
      await this.db.execute(
        sql`TRUNCATE TABLE ${auditEvents}, ${recoveries}, ${incidents}, ${payments}, ${razorpayWebhookEvents}, ${incidentProgress} RESTART IDENTITY`,
      );
    }
  }
  async close() {
    await this.connection.pool.end();
  }

  async ingest(bundle: IncidentBundle) {
    const seed = derivePaymentSeed(bundle);
    await this.db.transaction(async (tx) => {
      if (seed) {
        await tx
          .insert(payments)
          .values({
            paymentId: bundle.payment_id,
            state: seed.state,
            amountMinor: seed.amount_minor,
            currency: seed.currency,
            operation: seed.operation,
            operationKey: bundle.idempotency_key,
            updatedAt: new Date(),
          })
          .onConflictDoNothing();
      }
      await tx
        .insert(incidents)
        .values({
          incidentId: bundle.incident_id,
          paymentId: bundle.payment_id,
          idempotencyKey: bundle.idempotency_key,
          bundle,
        })
        .onConflictDoNothing();
      const [existing] = await tx
        .select({
          paymentId: incidents.paymentId,
          idempotencyKey: incidents.idempotencyKey,
        })
        .from(incidents)
        .where(eq(incidents.incidentId, bundle.incident_id));
      if (
        !existing ||
        existing.paymentId !== bundle.payment_id ||
        existing.idempotencyKey !== bundle.idempotency_key
      )
        throw new Error(
          "incident ID was already stored with different identity",
        );
      await tx
        .update(razorpayWebhookEvents)
        .set({ incidentId: bundle.incident_id })
        .where(
          sql`${razorpayWebhookEvents.paymentId} = ${bundle.payment_id} AND ${isNull(razorpayWebhookEvents.incidentId)}`,
        );
      await tx
        .insert(incidentProgress)
        .values({
          incidentId: bundle.incident_id,
          step: "detect",
          status: "completed",
          updatedAt: new Date(),
          details: {},
        })
        .onConflictDoNothing();
    });
  }

  async incident(id: string, _secret?: string) {
    const [row] = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.incidentId, id));
    if (!row) return null;
    return IncidentBundleSchema.parse(row.bundle);
  }
  async payment(id: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.paymentId, id));
    return row ? asPayment(row) : undefined;
  }
  async updatePayment(id: string, state: PaymentState) {
    await this.db
      .update(payments)
      .set({ state, updatedAt: new Date() })
      .where(eq(payments.paymentId, id));
  }
  async recovery(key: string) {
    const [row] = await this.db
      .select()
      .from(recoveries)
      .where(eq(recoveries.executionKey, key));
    return row
      ? {
          execution_key: row.executionKey,
          action: ActionSchema.parse(row.action),
          status: RecoveryOutcomeSchema.shape.status.parse(row.status),
          before_state: PaymentStateSchema.parse(row.beforeState),
          after_state: PaymentStateSchema.parse(row.afterState),
          completed_at: row.completedAt.toISOString(),
        }
      : undefined;
  }
  async completeRecovery(key: string, value: RecoveryInput) {
    await this.db
      .insert(recoveries)
      .values({
        executionKey: key,
        action: value.action,
        status: value.status,
        beforeState: value.before_state,
        afterState: value.after_state,
        completedAt: new Date(value.completed_at),
      })
      .onConflictDoUpdate({
        target: recoveries.executionKey,
        set: {
          status: value.status,
          afterState: value.after_state,
          completedAt: new Date(value.completed_at),
        },
      });
  }
  async audit(type: string, payload: unknown) {
    const [row] = await this.db
      .insert(auditEvents)
      .values({ recordedAt: new Date(), eventType: type, payload })
      .returning({ sequence: auditEvents.sequence });
    return row?.sequence;
  }
  async auditRecords() {
    const rows = await this.db
      .select()
      .from(auditEvents)
      .orderBy(auditEvents.sequence);
    return rows.map((row) => ({
      sequence: row.sequence,
      recorded_at: row.recordedAt.toISOString(),
      event_type: row.eventType,
      payload: JSON.stringify(row.payload),
    }));
  }
  async setProgress(
    incidentId: string,
    step: string,
    status: string,
    details: unknown,
  ) {
    await this.db
      .insert(incidentProgress)
      .values({ incidentId, step, status, updatedAt: new Date(), details })
      .onConflictDoNothing();
  }
  async progress(incidentId: string) {
    const rows = await this.db
      .select()
      .from(incidentProgress)
      .where(eq(incidentProgress.incidentId, incidentId))
      .orderBy(incidentProgress.sequence);
    return rows.map(asProgress);
  }
  async latestProgress(incidentId: string) {
    const [row] = await this.db
      .select()
      .from(incidentProgress)
      .where(eq(incidentProgress.incidentId, incidentId))
      .orderBy(desc(incidentProgress.sequence))
      .limit(1);
    return row ? asProgress(row) : undefined;
  }
  async webhookEvent(eventId: string) {
    const [row] = await this.db
      .select()
      .from(razorpayWebhookEvents)
      .where(eq(razorpayWebhookEvents.eventId, eventId));
    return row ? asWebhook(row) : undefined;
  }
  async ingestWebhook(event: WebhookInput, incidentId?: string) {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(razorpayWebhookEvents)
        .values({
          eventId: event.eventId,
          eventType: event.eventType,
          signature: event.signature,
          body: event.body,
          paymentId: event.paymentId,
          receivedAt: new Date(event.receivedAt),
          acceptedAt: new Date(),
          incidentId: incidentId ?? null,
        })
        .onConflictDoNothing()
        .returning({ eventId: razorpayWebhookEvents.eventId });
      const [row] = await tx
        .select()
        .from(razorpayWebhookEvents)
        .where(eq(razorpayWebhookEvents.eventId, event.eventId));
      if (!row) throw new Error("webhook event insert was not observable");
      if (row.signature !== event.signature || row.body !== event.body)
        throw new Error(
          "webhook event ID was already stored with different evidence",
        );
      return {
        status: inserted.length
          ? ("accepted" as const)
          : ("duplicate" as const),
        eventId: row.eventId,
        eventType: row.eventType,
        receivedAt: row.receivedAt.toISOString(),
      };
    });
  }
}
