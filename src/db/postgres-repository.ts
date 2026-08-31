import { desc, eq, inArray, isNull, sql } from "drizzle-orm";
import path from "node:path";
import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  postRepairStateObservations,
  auditEvents,
  incidentProgress,
  incidents,
  merchantOrders,
  merchantOrderUpdates,
  payments,
  recoveryAttempts,
  recoveries,
  razorpayWebhookEvents,
} from "./schema";
import { createDatabase, type Database } from "./client";
import {
  ActionSchema,
  PostRepairStateObservationSchema,
  IncidentBundleSchema,
  PaymentStateSchema,
  RecoveryOutcomeSchema,
  type PaymentState,
  type PostRepairStateObservation,
  type IncidentBundle,
  AuditEventSchema,
  createAuditGovernancePayload,
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

const migrationsFolder = existsSync(
  path.resolve(process.cwd(), "drizzle/meta/_journal.json"),
)
  ? path.resolve(process.cwd(), "drizzle")
  : path.resolve(process.cwd(), "../../drizzle");
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
        sql`TRUNCATE TABLE ${auditEvents}, ${postRepairStateObservations}, ${recoveryAttempts}, ${recoveries}, ${incidents}, ${payments}, ${razorpayWebhookEvents}, ${incidentProgress}, ${merchantOrderUpdates}, ${merchantOrders} RESTART IDENTITY`,
      );
    }
  }
  async close() {
    await this.connection.pool.end();
  }

  async ingest(
    bundle: IncidentBundle,
    _secret?: string,
    tenantId = "default-merchant",
  ) {
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
          tenantId,
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
  async listIncidents(tenantId: string) {
    const rows = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.tenantId, tenantId));
    return rows.map((row) => IncidentBundleSchema.parse(row.bundle));
  }
  async incidentTenant(id: string) {
    const [row] = await this.db
      .select({ tenantId: incidents.tenantId })
      .from(incidents)
      .where(eq(incidents.incidentId, id));
    return row?.tenantId;
  }
  async updateIncident(bundle: IncidentBundle) {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({
          paymentId: incidents.paymentId,
          idempotencyKey: incidents.idempotencyKey,
        })
        .from(incidents)
        .where(eq(incidents.incidentId, bundle.incident_id))
        .for("update");
      if (
        !existing ||
        existing.paymentId !== bundle.payment_id ||
        existing.idempotencyKey !== bundle.idempotency_key
      )
        throw new Error(
          "incident update identity does not match durable state",
        );
      await tx
        .update(incidents)
        .set({ bundle })
        .where(eq(incidents.incidentId, bundle.incident_id));
    });
  }
  async incidentByPaymentId(paymentId: string) {
    const rows = await this.db
      .select()
      .from(incidents)
      .where(eq(incidents.paymentId, paymentId))
      .limit(2);
    if (rows.length > 1)
      throw new Error("payment is correlated to multiple incidents");
    return rows[0] ? IncidentBundleSchema.parse(rows[0].bundle) : null;
  }
  async payment(id: string) {
    const [row] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.paymentId, id));
    return row ? asPayment(row) : undefined;
  }
  async paymentsFor(paymentIds: string[]) {
    if (!paymentIds.length) return [];
    const rows = await this.db
      .select()
      .from(payments)
      .where(inArray(payments.paymentId, paymentIds));
    return rows.map(asPayment);
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
  async recoveryAttempt(key: string) {
    const [row] = await this.db
      .select()
      .from(recoveryAttempts)
      .where(eq(recoveryAttempts.executionKey, key));
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
          started_at: row.startedAt.toISOString(),
          ...(row.completedAt
            ? { completed_at: row.completedAt.toISOString() }
            : {}),
        }
      : undefined;
  }
  async startRecoveryAttempt(input: RecoveryAttempt) {
    const rows = await this.db
      .insert(recoveryAttempts)
      .values({
        executionKey: input.execution_key,
        action: input.action,
        status: input.status,
        beforeState: input.before_state,
        afterState: input.after_state,
        error: input.error,
        startedAt: new Date(input.started_at),
        completedAt: input.completed_at
          ? new Date(input.completed_at)
          : undefined,
      })
      .onConflictDoNothing()
      .returning({ executionKey: recoveryAttempts.executionKey });
    return rows.length === 1;
  }
  async completeRecoveryAttempt(
    key: string,
    input: Pick<
      RecoveryAttempt,
      "status" | "after_state" | "error" | "completed_at"
    >,
  ) {
    await this.db
      .update(recoveryAttempts)
      .set({
        status: input.status,
        afterState: input.after_state,
        error: input.error,
        completedAt: input.completed_at
          ? new Date(input.completed_at)
          : undefined,
      })
      .where(eq(recoveryAttempts.executionKey, key));
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
  async savePostRepairStateObservation(
    executionKey: string,
    observation: PostRepairStateObservation,
  ) {
    const parsed = PostRepairStateObservationSchema.parse(observation);
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(postRepairStateObservations)
        .values({ executionKey, observation: parsed })
        .onConflictDoNothing()
        .returning({ executionKey: postRepairStateObservations.executionKey });
      const [row] = await tx
        .select()
        .from(postRepairStateObservations)
        .where(eq(postRepairStateObservations.executionKey, executionKey));
      if (!row) throw new Error("post-repair state observation was not stored");
      const existing = PostRepairStateObservationSchema.parse(row.observation);
      if (JSON.stringify(existing) !== JSON.stringify(parsed))
        throw new Error(
          "execution key was already stored with a different post-repair state observation",
        );
      return inserted.length === 1;
    });
  }
  async postRepairStateObservation(executionKey: string) {
    const [row] = await this.db
      .select()
      .from(postRepairStateObservations)
      .where(eq(postRepairStateObservations.executionKey, executionKey));
    return row
      ? PostRepairStateObservationSchema.parse(row.observation)
      : undefined;
  }
  async audit(type: string, payload: unknown) {
    const governancePayload = createAuditGovernancePayload(type, payload);
    const [row] = await this.db
      .insert(auditEvents)
      .values({
        recordedAt: new Date(),
        eventType: type,
        payload: governancePayload,
      })
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
      eventType: row.eventType,
      payload: AuditEventSchema.shape.payload.parse(row.payload),
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
  async progressFor(incidentIds: string[]) {
    if (!incidentIds.length) return [];
    const rows = await this.db
      .select()
      .from(incidentProgress)
      .where(inArray(incidentProgress.incidentId, incidentIds))
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
  async processWebhookEvidence(
    input: WebhookProcessingInput,
    validateBundle: IncidentBundleValidator,
  ): Promise<WebhookProcessingResult> {
    return this.db.transaction(async (tx) => {
      const [webhook] = await tx
        .select()
        .from(razorpayWebhookEvents)
        .where(eq(razorpayWebhookEvents.eventId, input.eventId))
        .for("update");
      if (!webhook) throw new Error("webhook event must be ingested first");
      if (webhook.paymentId !== input.paymentId)
        throw new Error("webhook payment identity conflicts with evidence");
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${input.paymentId}))`,
      );
      const rows = await tx
        .select()
        .from(incidents)
        .where(eq(incidents.paymentId, input.paymentId))
        .limit(2)
        .for("update");
      if (rows.length > 1)
        throw new Error("payment is correlated to multiple incidents");
      const now = new Date();
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
        await tx
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
          .onConflictDoNothing();
        await tx
          .insert(incidents)
          .values({
            incidentId: bundle.incident_id,
            paymentId: bundle.payment_id,
            idempotencyKey: bundle.idempotency_key,
            bundle,
            ...(input.createIncident.tenantId
              ? { tenantId: input.createIncident.tenantId }
              : {}),
          })
          .onConflictDoNothing();
        await tx
          .update(razorpayWebhookEvents)
          .set({ incidentId: bundle.incident_id })
          .where(eq(razorpayWebhookEvents.eventId, input.eventId));
        await tx
          .insert(incidentProgress)
          .values([
            {
              incidentId: bundle.incident_id,
              step: "detect",
              status: "completed",
              updatedAt: now,
              details: { trigger: "razorpay_webhook", event_id: input.eventId },
            },
            {
              incidentId: bundle.incident_id,
              step: "gather",
              status: "pending",
              updatedAt: now,
              details: { trigger: "razorpay_webhook", event_id: input.eventId },
            },
          ])
          .onConflictDoNothing();
        return {
          status: "created",
          incidentId: bundle.incident_id,
          eventId: input.eventId,
          lateEvidence: false,
          reverifyRequired: false,
        };
      }
      const existing = validateBundle(rows[0].bundle);
      const duplicate = existing.evidence.some(
        (entry) =>
          entry.kind === "processor_webhook" &&
          entry.payload.event_id === input.eventId,
      );
      if (duplicate) {
        await tx
          .update(razorpayWebhookEvents)
          .set({ incidentId: existing.incident_id })
          .where(eq(razorpayWebhookEvents.eventId, input.eventId));
        return {
          status: "duplicate",
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
      await tx
        .update(incidents)
        .set({ bundle })
        .where(eq(incidents.incidentId, existing.incident_id));
      await tx
        .update(razorpayWebhookEvents)
        .set({ incidentId: existing.incident_id })
        .where(eq(razorpayWebhookEvents.eventId, input.eventId));
      const progress = await tx
        .select()
        .from(incidentProgress)
        .where(eq(incidentProgress.incidentId, existing.incident_id));
      const resolved = progress.some(
        (entry) =>
          entry.status === "completed" &&
          (entry.step === "close" || entry.step === "escalate"),
      );
      await tx
        .insert(incidentProgress)
        .values({
          incidentId: existing.incident_id,
          step: resolved ? "verify" : "gather",
          status: "pending",
          updatedAt: now,
          details: {
            trigger: resolved ? "late_razorpay_webhook" : "razorpay_webhook",
            event_id: input.eventId,
            reverify_required: resolved,
          },
        })
        .onConflictDoNothing();
      return {
        status: "updated",
        incidentId: existing.incident_id,
        eventId: input.eventId,
        lateEvidence: resolved,
        reverifyRequired: resolved,
      };
    });
  }
}
