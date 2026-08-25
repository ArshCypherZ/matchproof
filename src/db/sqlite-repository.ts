import { desc, eq, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { createSqliteDatabase, type SqliteDatabase } from "./sqlite-client";
import {
  afterstateObservations,
  auditEvents,
  incidentProgress,
  incidents,
  payments,
  recoveryAttempts,
  recoveries,
  razorpayWebhookEvents,
} from "./sqlite-schema";
import {
  ActionSchema,
  AfterstateObservationSchema,
  IncidentBundleSchema,
  PaymentStateSchema,
  type PaymentState,
  type AfterstateObservation,
  RecoveryOutcomeSchema,
  type IncidentBundle,
} from "../domain/schemas";
import type {
  IncidentRepository,
  PaymentRecord,
  ProgressRecord,
  RecoveryInput,
  RecoveryAttempt,
  WebhookInput,
  WebhookRecord,
  WebhookProcessingInput,
  WebhookProcessingResult,
  IncidentBundleValidator,
} from "./repository";
import { derivePaymentSeed } from "./repository";

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
    migrate(this.db, { migrationsFolder: "drizzle-sqlite" });
    if (reset)
      this.connection.client.exec(
        "DELETE FROM audit_events; DELETE FROM afterstate_observations; DELETE FROM recovery_attempts; DELETE FROM recoveries; DELETE FROM incidents; DELETE FROM payments; DELETE FROM razorpay_webhook_events; DELETE FROM incident_progress; DELETE FROM merchant_order_updates; DELETE FROM merchant_orders;",
      );
  }
  async close() {
    this.connection.client.close();
  }
  async ingest(bundle: IncidentBundle) {
    const seed = derivePaymentSeed(bundle);
    this.connection.client.transaction(() => {
      if (seed)
        this.db
          .insert(payments)
          .values({
            paymentId: bundle.payment_id,
            state: seed.state,
            amountMinor: seed.amount_minor,
            currency: seed.currency,
            operation: seed.operation,
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
  async updateIncident(bundle: IncidentBundle) {
    this.connection.client.transaction(() => {
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
          "incident update identity does not match durable state",
        );
      this.db
        .update(incidents)
        .set({ bundle: JSON.stringify(bundle) })
        .where(eq(incidents.incidentId, bundle.incident_id))
        .run();
    })();
  }
  async incidentByPaymentId(paymentId: string) {
    const rows = this.db
      .select()
      .from(incidents)
      .where(eq(incidents.paymentId, paymentId))
      .limit(2)
      .all();
    if (rows.length > 1)
      throw new Error("payment is correlated to multiple incidents");
    return rows[0]
      ? IncidentBundleSchema.parse(JSON.parse(rows[0].bundle))
      : null;
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
  async recoveryAttempt(key: string) {
    const [row] = this.db
      .select()
      .from(recoveryAttempts)
      .where(eq(recoveryAttempts.executionKey, key))
      .all();
    return row
      ? {
          execution_key: row.executionKey,
          action: ActionSchema.parse(row.action),
          status: row.status as RecoveryAttempt["status"],
          before_state: PaymentStateSchema.parse(row.beforeState),
          ...(row.afterState
            ? { after_state: PaymentStateSchema.parse(row.afterState) }
            : {}),
          ...(row.error ? { error: row.error } : {}),
          started_at: row.startedAt,
          ...(row.completedAt ? { completed_at: row.completedAt } : {}),
        }
      : undefined;
  }
  async startRecoveryAttempt(input: RecoveryAttempt) {
    const result = this.db
      .insert(recoveryAttempts)
      .values({
        executionKey: input.execution_key,
        action: input.action,
        status: input.status,
        beforeState: input.before_state,
        afterState: input.after_state,
        error: input.error,
        startedAt: input.started_at,
        completedAt: input.completed_at,
      })
      .onConflictDoNothing()
      .run();
    return result.changes === 1;
  }
  async completeRecoveryAttempt(
    key: string,
    input: Pick<
      RecoveryAttempt,
      "status" | "after_state" | "error" | "completed_at"
    >,
  ) {
    this.db
      .update(recoveryAttempts)
      .set({
        status: input.status,
        afterState: input.after_state,
        error: input.error,
        completedAt: input.completed_at,
      })
      .where(eq(recoveryAttempts.executionKey, key))
      .run();
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
  async saveAfterstateObservation(
    executionKey: string,
    observation: AfterstateObservation,
  ) {
    const parsed = AfterstateObservationSchema.parse(observation);
    return this.connection.client.transaction(() => {
      const inserted = this.db
        .insert(afterstateObservations)
        .values({ executionKey, observation: JSON.stringify(parsed) })
        .onConflictDoNothing()
        .run();
      const [row] = this.db
        .select()
        .from(afterstateObservations)
        .where(eq(afterstateObservations.executionKey, executionKey))
        .all();
      if (!row) throw new Error("afterstate observation was not stored");
      const existing = AfterstateObservationSchema.parse(
        JSON.parse(row.observation),
      );
      if (JSON.stringify(existing) !== JSON.stringify(parsed))
        throw new Error(
          "execution key was already stored with a different afterstate observation",
        );
      return inserted.changes === 1;
    })();
  }
  async afterstateObservation(executionKey: string) {
    const [row] = this.db
      .select()
      .from(afterstateObservations)
      .where(eq(afterstateObservations.executionKey, executionKey))
      .all();
    return row
      ? AfterstateObservationSchema.parse(JSON.parse(row.observation))
      : undefined;
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
  async processWebhookEvidence(
    input: WebhookProcessingInput,
    validateBundle: IncidentBundleValidator,
  ): Promise<WebhookProcessingResult> {
    return this.connection.client.transaction(() => {
      const [webhook] = this.db
        .select()
        .from(razorpayWebhookEvents)
        .where(eq(razorpayWebhookEvents.eventId, input.eventId))
        .all();
      if (!webhook) throw new Error("webhook event must be ingested first");
      if (webhook.paymentId !== input.paymentId)
        throw new Error("webhook payment identity conflicts with evidence");
      const rows = this.db
        .select()
        .from(incidents)
        .where(eq(incidents.paymentId, input.paymentId))
        .limit(2)
        .all();
      if (rows.length > 1)
        throw new Error("payment is correlated to multiple incidents");
      const now = new Date().toISOString();
      if (!rows[0]) {
        const bundle = validateBundle({
          incident_id: input.createIncident.incidentId,
          payment_id: input.paymentId,
          idempotency_key: input.createIncident.idempotencyKey,
          evidence: [input.evidence],
        });
        const seed = derivePaymentSeed(bundle);
        if (!seed)
          throw new Error("webhook evidence has no financial identity");
        this.db
          .insert(payments)
          .values({
            paymentId: bundle.payment_id,
            state: seed.state,
            amountMinor: seed.amount_minor,
            currency: seed.currency,
            operation: seed.operation,
            operationKey: bundle.idempotency_key,
            updatedAt: now,
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
        this.db
          .update(razorpayWebhookEvents)
          .set({ incidentId: bundle.incident_id })
          .where(eq(razorpayWebhookEvents.eventId, input.eventId))
          .run();
        this.db
          .insert(incidentProgress)
          .values({
            incidentId: bundle.incident_id,
            step: "detect",
            status: "completed",
            updatedAt: now,
            details: JSON.stringify({
              trigger: "razorpay_webhook",
              event_id: input.eventId,
            }),
          })
          .onConflictDoNothing()
          .run();
        this.db
          .insert(incidentProgress)
          .values({
            incidentId: bundle.incident_id,
            step: "gather",
            status: "pending",
            updatedAt: now,
            details: JSON.stringify({
              trigger: "razorpay_webhook",
              event_id: input.eventId,
            }),
          })
          .onConflictDoNothing()
          .run();
        return {
          status: "created" as const,
          incidentId: bundle.incident_id,
          eventId: input.eventId,
          lateEvidence: false,
          reverifyRequired: false,
        };
      }
      const existing = validateBundle(JSON.parse(rows[0].bundle));
      const duplicate = existing.evidence.some(
        (entry) =>
          entry.kind === "processor_webhook" &&
          entry.payload.event_id === input.eventId,
      );
      if (duplicate) {
        this.db
          .update(razorpayWebhookEvents)
          .set({ incidentId: existing.incident_id })
          .where(eq(razorpayWebhookEvents.eventId, input.eventId))
          .run();
        return {
          status: "duplicate" as const,
          incidentId: existing.incident_id,
          eventId: input.eventId,
          lateEvidence: false,
          reverifyRequired: false,
        };
      }
      if (input.evidence.payload.idempotency_key !== existing.idempotency_key)
        throw new Error("webhook operation identity conflicts with incident");
      const bundle = validateBundle({
        ...existing,
        evidence: [...existing.evidence, input.evidence],
      });
      this.db
        .update(incidents)
        .set({ bundle: JSON.stringify(bundle) })
        .where(eq(incidents.incidentId, existing.incident_id))
        .run();
      this.db
        .update(razorpayWebhookEvents)
        .set({ incidentId: existing.incident_id })
        .where(eq(razorpayWebhookEvents.eventId, input.eventId))
        .run();
      const progress = this.db
        .select()
        .from(incidentProgress)
        .where(eq(incidentProgress.incidentId, existing.incident_id))
        .all();
      const resolved = progress.some(
        (entry) =>
          entry.status === "completed" &&
          (entry.step === "close" || entry.step === "escalate"),
      );
      this.db
        .insert(incidentProgress)
        .values({
          incidentId: existing.incident_id,
          step: resolved ? "verify" : "gather",
          status: "pending",
          updatedAt: now,
          details: JSON.stringify({
            trigger: "late_razorpay_webhook",
            event_id: input.eventId,
            reverify_required: resolved,
          }),
        })
        .onConflictDoNothing()
        .run();
      return {
        status: "updated" as const,
        incidentId: existing.incident_id,
        eventId: input.eventId,
        lateEvidence: resolved,
        reverifyRequired: resolved,
      };
    })();
  }
}
