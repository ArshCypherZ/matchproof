import crypto from "node:crypto";
import { eq, isNull, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, type Database } from "../db/client";
import { auditEvents, incidents, payments, recoveries } from "../db/schema";
import { incidentProgress, razorpayWebhookEvents } from "../db/schema";
import { createSqliteDatabase, type SqliteDatabase } from "../db/sqlite-client";
import { DiagnosisOutputSchema, IncidentBundleSchema, ReconstructionSchema, type DiagnosisOutput, type Evidence, type IncidentBundle, type Reconstruction } from "../domain/schemas";
export class EvidenceError extends Error {}
export class DiagnosisError extends Error {}
export class ModelCallError extends Error {}
export class AuthorizationError extends Error {}
const MAX = 100_000_000_000;
const pid = /^pay_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const key = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const eid = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/;
const now = () => new Date().toISOString().replace(".000Z", "Z");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
type SignaturePayload = Record<string, string | number | boolean | null>;
export function processorSignature(payload: SignaturePayload, secret: string) {
  const p = { ...payload };
  delete p.signature_verified;
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(p, Object.keys(p).sort()))
    .digest("hex");
}
export function verifyProcessorSignature(
  p: SignaturePayload,
  s: string,
  secret: string,
) {
  const a = Buffer.from(processorSignature(p, secret)),
    b = Buffer.from(String(s));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function verifyBundle(
  input: unknown,
  secret = process.env.PROCESSOR_WEBHOOK_SECRET,
): IncidentBundle {
  if (!secret)
    throw new EvidenceError(
      "prototype processor-signature secret is not configured",
    );
  let b: IncidentBundle;
  try { b = IncidentBundleSchema.parse(input); } catch (error) { throw new EvidenceError(error instanceof Error ? error.message : "incident bundle failed schema validation"); }
  const ids = b.evidence.map((x) => x.evidence_id);
  if (new Set(ids).size !== ids.length)
    throw new EvidenceError("evidence IDs must be unique");
  const req = b.evidence.find((x): x is Extract<Evidence, { kind: "payment_request" }> => x.kind === "payment_request");
  if (!req) throw new EvidenceError("payment request is required");
  let outcomes = new Set<string>();
  let requestTime = Date.parse(req.occurred_at);
  for (const x of b.evidence) {
    const p = x.payload;
    const sources: Record<Evidence["kind"], string> = {
      payment_request: "merchant-payment-service",
      processor_timeout: "merchant-payment-service",
      internal_state: "merchant-order-store",
      processor_webhook: "processor-webhook",
    };
    if (x.source !== sources[x.kind])
      throw new EvidenceError(`${x.evidence_id} has invalid source/provenance`);
    if (p.payment_id !== b.payment_id)
      throw new EvidenceError(
        `${x.evidence_id} belongs to ${p.payment_id}, not ${b.payment_id}`,
      );
    if (Date.parse(x.received_at) < Date.parse(x.occurred_at))
      throw new EvidenceError(
        `${x.evidence_id} was received before it occurred`,
      );
    if (x.kind !== "processor_timeout") {
      if ("amount_minor" in p && "currency" in p && (p.amount_minor !== req.payload.amount_minor || p.currency !== req.payload.currency))
        throw new EvidenceError("financial amount conflicts across evidence");
    }
    if (!p.operation || p.operation !== "capture")
      throw new EvidenceError(
        `${x.kind}.operation is not an allowed operation`,
      );
    const operationKey = x.kind === "internal_state" ? (p as Extract<Evidence, { kind: "internal_state" }>["payload"]).last_operation_key : "idempotency_key" in p ? p.idempotency_key : undefined;
    if (operationKey !== b.idempotency_key)
      throw new EvidenceError(
        `${x.kind} operation identity conflicts with incident`,
      );
    if (x.kind === "processor_webhook") {
      const webhookPayload = p as Extract<Evidence, { kind: "processor_webhook" }>["payload"];
      if (!verifyProcessorSignature(p as SignaturePayload, x.processor_signature, secret))
        throw new EvidenceError(
          `${x.evidence_id} failed prototype processor-signature verification`,
        );
      if (
        !["payment.captured", "payment.failed", "payment.refunded"].includes(webhookPayload.event_type) ||
          webhookPayload.payment_state !=
          ({
            "payment.captured": "captured",
            "payment.failed": "failed",
            "payment.refunded": "refunded",
          } as Record<string, string>)[webhookPayload.event_type]
      )
        throw new EvidenceError(
          "processor event identity conflicts with outcome state",
        );
      outcomes.add(webhookPayload.event_type);
      if (Date.parse(x.occurred_at) < requestTime)
        throw new EvidenceError(
          "processor webhook causally precedes payment request",
        );
    }
    if (x.kind === "internal_state" && (p as Extract<Evidence, { kind: "internal_state" }>["payload"]).payment_state !== "capture_pending")
      throw new EvidenceError(
        "internal payment state is invalid for ingestion",
      );
    if (
      (x.kind === "processor_webhook" || x.kind === "internal_state") &&
      ("amount_minor" in p && "currency" in p && (p.amount_minor !== req.payload.amount_minor || p.currency !== req.payload.currency))
    )
      throw new EvidenceError("financial amount conflicts across evidence");
  }
  if (outcomes.has("payment.captured") && outcomes.has("payment.failed"))
    throw new EvidenceError(
      "contradictory processor outcomes cannot be accepted",
    );
  return Object.freeze(b);
}
export function reconstruct(bundle: IncidentBundle): Reconstruction {
  const seen = new Set<string>(),
    dups: string[] = [],
    canonical: Evidence[] = [];
  for (const x of [...bundle.evidence].sort(
    (a, b) => Date.parse(a.received_at) - Date.parse(b.received_at),
  )) {
    const id =
      x.kind === "processor_webhook"
        ? `${x.kind}:${x.payload.event_id}`
        : `${x.kind}:${x.evidence_id}`;
    if (seen.has(id)) {
      dups.push(x.evidence_id);
      continue;
    }
    seen.add(id);
    canonical.push(x);
  }
  const timeline = canonical.sort(
    (a, b) =>
      Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
      a.evidence_id.localeCompare(b.evidence_id),
  );
  let state: string | undefined;
  const trans: Reconstruction["observation_transitions"] = [];
  for (const x of canonical.sort(
    (a, b) => Date.parse(a.received_at) - Date.parse(b.received_at),
  )) {
    let n = state,
      r = "";
    if (x.kind === "payment_request") {
      n = "requested";
      r = "capture request was issued";
    } else if (x.kind === "processor_timeout") {
      n = "ambiguous_after_timeout";
      r = "processor response timed out; mutation result is unknown";
    } else if (
      x.kind === "processor_webhook" &&
      x.payload.event_type === "payment.captured"
    ) {
      n = "captured_verified";
      r = "late verified processor event establishes capture success";
    }
    if (n && n !== state) {
      trans.push({
        observed_at: x.received_at,
        state: n,
        reason: r,
        evidence_ids: [x.evidence_id],
      });
      state = n;
    }
  }
  const request = bundle.evidence.find((x): x is Extract<Evidence, { kind: "payment_request" }> => x.kind === "payment_request");
  if (!request) throw new EvidenceError("payment request is required");
  return ReconstructionSchema.parse({
    timeline: timeline.map((x) => ({ evidence_id: x.evidence_id, kind: x.kind, occurred_at: x.occurred_at, received_at: x.received_at })),
    observation_transitions: trans,
    duplicate_evidence_ids: dups,
    current_state: state,
    ambiguity_reasons: [],
    impact_summary: {
      payments_affected: 1,
      payment_id: bundle.payment_id,
      amount_minor: request.payload.amount_minor,
      currency: request.payload.currency,
      duplicate_events_suppressed: dups.length,
      money_movement_executed_by_recovery: false,
    },
  });
}
export function evaluate(
  rec: DiagnosisOutput["diagnosis"]["recommendation"],
  bundle: IncidentBundle,
  recon: Reconstruction,
  merchant?: unknown,
) {
  const valid = new Set(recon.timeline.map((x) => x.evidence_id));
  if (
    !rec.evidence_ids?.length ||
    rec.evidence_ids.some((x: string) => !valid.has(x))
  )
    return {
      ...rec,
      allowed: false,
      reason: "blocked: recommendation cites non-canonical or missing evidence",
    };
  if (rec.action === "retry_capture")
    return {
      ...rec,
      allowed: false,
      reason:
        "blocked: retry_capture is never authorized by this recovery workflow",
    };
  if (rec.action === "escalate")
    return {
      ...rec,
      allowed: true,
      reason: "approved: escalation changes no payment or financial state",
    };
  if (rec.action !== "reconcile_internal_state")
    return {
      ...rec,
      allowed: false,
      reason: "blocked: unsupported action fails closed",
    };
  const ok = !recon.ambiguity_reasons.length;
  return {
    ...rec,
    allowed: ok,
    reason: ok
      ? "approved: all request, processor, internal, and reconstructed invariants agree"
      : "blocked: reconciliation invariants failed",
  };
}
export class IncidentStore {
  readonly db: Database | SqliteDatabase;
  private readonly pool?: ReturnType<typeof createDatabase>["pool"];
  private readonly sqlite?: ReturnType<typeof createSqliteDatabase>["client"];
  private readonly postgres: boolean;
  constructor(readonly statePath: string, private readonly reset = false, readonly secret?: string) {
    this.postgres = statePath === "postgresql" || statePath === "postgres" || statePath.startsWith("postgres://") || statePath.startsWith("postgresql://");
    if (this.postgres) { const connectionUrl = /^(postgres|postgresql):\/\//.test(statePath) ? statePath : undefined; const connection = createDatabase(connectionUrl); this.db = connection.db; this.pool = connection.pool; }
    else { const connection = createSqliteDatabase(statePath); this.db = connection.db; this.sqlite = connection.client; }
  }
  async initialize() {
    if (this.postgres) { const db = this.db as Database; await migrate(db, { migrationsFolder: "drizzle" }); if (this.reset) await db.execute(sql`TRUNCATE TABLE ${auditEvents}, ${recoveries}, ${incidents}, ${payments}, ${razorpayWebhookEvents}, ${incidentProgress} RESTART IDENTITY`); }
    else { const db = this.db as SqliteDatabase; db.run(sql`CREATE TABLE IF NOT EXISTS payments (payment_id text primary key, state text not null, amount_minor integer not null, currency text not null, operation text not null, operation_key text not null, updated_at text not null)`); db.run(sql`CREATE TABLE IF NOT EXISTS incidents (incident_id text primary key, payment_id text not null, idempotency_key text not null, bundle text not null)`); db.run(sql`CREATE TABLE IF NOT EXISTS recoveries (execution_key text primary key, action text not null, status text not null, before_state text not null, after_state text not null, completed_at text not null)`); db.run(sql`CREATE TABLE IF NOT EXISTS audit_events (sequence integer primary key autoincrement, recorded_at text not null, event_type text not null, payload text not null)`); db.run(sql`CREATE TABLE IF NOT EXISTS razorpay_webhook_events (event_id text primary key, event_type text not null, signature text not null, body text not null, payment_id text, received_at text not null, accepted_at text not null, incident_id text)`); db.run(sql`CREATE TABLE IF NOT EXISTS incident_progress (incident_id text primary key, step text not null, status text not null, updated_at text not null, details text not null)`); db.run(sql`CREATE INDEX IF NOT EXISTS payments_payment_id_idx ON payments(payment_id)`); db.run(sql`CREATE INDEX IF NOT EXISTS payments_operation_key_idx ON payments(operation_key)`); db.run(sql`CREATE INDEX IF NOT EXISTS incidents_payment_id_idx ON incidents(payment_id)`); db.run(sql`CREATE INDEX IF NOT EXISTS incidents_idempotency_key_idx ON incidents(idempotency_key)`); db.run(sql`CREATE INDEX IF NOT EXISTS webhook_payment_id_idx ON razorpay_webhook_events(payment_id)`); if (this.reset) this.sqlite?.exec("DELETE FROM audit_events; DELETE FROM recoveries; DELETE FROM incidents; DELETE FROM payments; DELETE FROM razorpay_webhook_events; DELETE FROM incident_progress;"); }
  }
  async close() { if (this.pool) await this.pool.end(); else this.sqlite?.close(); }
  async ingest(b: unknown) {
    const v = verifyBundle(b, this.secret);
    const p = v.evidence.find(
      (x): x is Extract<Evidence, { kind: "processor_webhook" }> =>
        x.kind === "processor_webhook" &&
        x.payload.event_type === "payment.captured",
    );
    if (!p) throw new EvidenceError("captured processor webhook is required");
    if (!this.postgres) { const db = this.db as SqliteDatabase; this.sqlite?.transaction(() => { db.run(sql`INSERT OR IGNORE INTO payments(payment_id,state,amount_minor,currency,operation,operation_key,updated_at) VALUES(${p.payload.payment_id},'capture_pending',${p.payload.amount_minor},${p.payload.currency},'capture',${p.payload.idempotency_key},${new Date().toISOString()})`); db.run(sql`INSERT OR IGNORE INTO incidents(incident_id,payment_id,idempotency_key,bundle) VALUES(${v.incident_id},${v.payment_id},${v.idempotency_key},${JSON.stringify(v)})`); const rows = db.all(sql`SELECT payment_id,idempotency_key FROM incidents WHERE incident_id=${v.incident_id}`) as Array<{payment_id:string;idempotency_key:string}>; const existing = rows[0]; if (!existing || existing.payment_id !== v.payment_id || existing.idempotency_key !== v.idempotency_key) throw new EvidenceError("incident ID was already stored with different identity"); db.run(sql`UPDATE razorpay_webhook_events SET incident_id=${v.incident_id} WHERE payment_id=${v.payment_id} AND incident_id IS NULL`); db.run(sql`INSERT INTO incident_progress(incident_id,step,status,updated_at,details) VALUES(${v.incident_id},'detect','completed',${new Date().toISOString()},'{}') ON CONFLICT(incident_id) DO UPDATE SET step=excluded.step,status=excluded.status,updated_at=excluded.updated_at,details=excluded.details`); })(); return; }
    await (this.db as Database).transaction(async (tx) => { await tx.insert(payments).values({ paymentId: p.payload.payment_id, state: "capture_pending", amountMinor: p.payload.amount_minor, currency: p.payload.currency, operation: "capture", operationKey: p.payload.idempotency_key, updatedAt: new Date() }).onConflictDoNothing(); await tx.insert(incidents).values({ incidentId: v.incident_id, paymentId: v.payment_id, idempotencyKey: v.idempotency_key, bundle: v }).onConflictDoNothing(); const rows = await tx.select({ paymentId: incidents.paymentId, idempotencyKey: incidents.idempotencyKey }).from(incidents).where(eq(incidents.incidentId, v.incident_id)); const existing = rows[0]; if (!existing || existing.paymentId !== v.payment_id || existing.idempotencyKey !== v.idempotency_key) throw new EvidenceError("incident ID was already stored with different identity"); await tx.update(razorpayWebhookEvents).set({ incidentId: v.incident_id }).where(sql`${razorpayWebhookEvents.paymentId} = ${v.payment_id} AND ${isNull(razorpayWebhookEvents.incidentId)}`); await tx.insert(incidentProgress).values({ incidentId: v.incident_id, step: "detect", status: "completed", updatedAt: new Date(), details: {} }).onConflictDoUpdate({ target: incidentProgress.incidentId, set: { step: "detect", status: "completed", updatedAt: new Date(), details: {} } }); });
  }
  async incident(id: string) {
    if (!this.postgres) { const row = (this.db as SqliteDatabase).all(sql`SELECT bundle FROM incidents WHERE incident_id=${id}`) as Array<{bundle: string}>; return row[0] ? verifyBundle(JSON.parse(row[0].bundle), this.secret) : null; }
    const [row] = await (this.db as Database).select().from(incidents).where(eq(incidents.incidentId, id));
    return row ? verifyBundle(row.bundle, this.secret) : null;
  }
  async payment(id: string) {
    if (!this.postgres) { const row = (this.db as SqliteDatabase).all(sql`SELECT * FROM payments WHERE payment_id=${id}`) as Array<{payment_id:string;state:string;amount_minor:number;currency:string;operation:string;operation_key:string;updated_at:string}>; return row[0]; }
    const [row] = await (this.db as Database).select().from(payments).where(eq(payments.paymentId, id));
    return row ? { payment_id: row.paymentId, state: row.state, amount_minor: row.amountMinor, currency: row.currency, operation: row.operation, operation_key: row.operationKey, updated_at: row.updatedAt.toISOString() } : undefined;
  }
  async recovery(key: string) { if (!this.postgres) return ((this.db as SqliteDatabase).all(sql`SELECT * FROM recoveries WHERE execution_key=${key}`) as Array<Record<string,string>>)[0]; const [row] = await (this.db as Database).select().from(recoveries).where(eq(recoveries.executionKey, key)); return row ? { execution_key: row.executionKey, action: row.action, status: row.status, before_state: row.beforeState, after_state: row.afterState, completed_at: row.completedAt.toISOString() } : undefined; }
  async completeRecovery(key: string, row: { action: string; status: string; before_state: string; after_state: string; completed_at: string }) { if (!this.postgres) { (this.db as SqliteDatabase).run(sql`INSERT INTO recoveries(execution_key,action,status,before_state,after_state,completed_at) VALUES(${key},${row.action},${row.status},${row.before_state},${row.after_state},${row.completed_at}) ON CONFLICT(execution_key) DO UPDATE SET status=excluded.status,after_state=excluded.after_state,completed_at=excluded.completed_at`); return; } await (this.db as Database).insert(recoveries).values({ executionKey: key, action: row.action, status: row.status, beforeState: row.before_state, afterState: row.after_state, completedAt: new Date(row.completed_at) }).onConflictDoUpdate({ target: recoveries.executionKey, set: { status: row.status, afterState: row.after_state, completedAt: new Date(row.completed_at) } }); }
  async updatePayment(id: string, state: string) { if (!this.postgres) { (this.db as SqliteDatabase).run(sql`UPDATE payments SET state=${state},updated_at=${new Date().toISOString()} WHERE payment_id=${id}`); return; } await (this.db as Database).update(payments).set({ state, updatedAt: new Date() }).where(eq(payments.paymentId, id)); }
  async audit(t: string, p: unknown) {
    if (!this.postgres) { const row = (this.db as SqliteDatabase).all(sql`INSERT INTO audit_events(recorded_at,event_type,payload) VALUES(${new Date().toISOString()},${t},${JSON.stringify(p)}) RETURNING sequence`) as Array<{sequence:number}>; return row[0]?.sequence; }
    const [row] = await (this.db as Database).insert(auditEvents).values({ recordedAt: new Date(), eventType: t, payload: p }).returning({ sequence: auditEvents.sequence });
    return row?.sequence;
  }
  async auditRecords() {
    if (!this.postgres) return (this.db as SqliteDatabase).all(sql`SELECT * FROM audit_events ORDER BY sequence`);
    const rows = await (this.db as Database).select().from(auditEvents).orderBy(auditEvents.sequence);
    return rows.map((row) => ({ sequence: row.sequence, recorded_at: row.recordedAt.toISOString(), event_type: row.eventType, payload: JSON.stringify(row.payload) }));
  }
  async setProgress(incidentId: string, step: string, status: string, details: unknown) { if (!this.postgres) { (this.db as SqliteDatabase).run(sql`INSERT INTO incident_progress(incident_id,step,status,updated_at,details) VALUES(${incidentId},${step},${status},${new Date().toISOString()},${JSON.stringify(details)}) ON CONFLICT(incident_id) DO UPDATE SET step=excluded.step,status=excluded.status,updated_at=excluded.updated_at,details=excluded.details`); return; } await (this.db as Database).insert(incidentProgress).values({ incidentId, step, status, updatedAt: new Date(), details }).onConflictDoUpdate({ target: incidentProgress.incidentId, set: { step, status, updatedAt: new Date(), details } }); }
  async progress(incidentId: string) { if (!this.postgres) return (this.db as SqliteDatabase).all(sql`SELECT * FROM incident_progress WHERE incident_id=${incidentId}`); return (this.db as Database).select().from(incidentProgress).where(eq(incidentProgress.incidentId, incidentId)); }
  async webhookEvent(eventId: string) { if (!this.postgres) { const rows = (this.db as SqliteDatabase).all(sql`SELECT * FROM razorpay_webhook_events WHERE event_id=${eventId}`) as Array<Record<string, string | null>>; return rows[0]; } const [row] = await (this.db as Database).select().from(razorpayWebhookEvents).where(eq(razorpayWebhookEvents.eventId, eventId)); return row ? { event_id: row.eventId, event_type: row.eventType, signature: row.signature, body: row.body, payment_id: row.paymentId, received_at: row.receivedAt.toISOString(), accepted_at: row.acceptedAt.toISOString(), incident_id: row.incidentId } : undefined; }
  async ingestWebhook(event: { eventId: string; eventType: string; signature: string; body: string; receivedAt: string; paymentId?: string }, incidentId?: string) { if (!this.postgres) { const db = this.db as SqliteDatabase; return this.sqlite!.transaction(() => { const inserted = db.run(sql`INSERT OR IGNORE INTO razorpay_webhook_events(event_id,event_type,signature,body,payment_id,received_at,accepted_at,incident_id) VALUES(${event.eventId},${event.eventType},${event.signature},${event.body},${event.paymentId ?? null},${event.receivedAt},${new Date().toISOString()},${incidentId ?? null})`); const rows = db.all(sql`SELECT * FROM razorpay_webhook_events WHERE event_id=${event.eventId}`) as Array<{event_id:string;event_type:string;signature:string;body:string;received_at:string}>; const existing = rows[0]!; if (existing.signature !== event.signature || existing.body !== event.body) throw new Error("webhook event ID was already stored with different evidence"); return { status: inserted.changes > 0 ? "accepted" as const : "duplicate" as const, eventId: existing.event_id, eventType: existing.event_type, receivedAt: existing.received_at }; })(); } const db = this.db as Database; return await db.transaction(async (tx) => { const inserted = await tx.insert(razorpayWebhookEvents).values({ eventId: event.eventId, eventType: event.eventType, signature: event.signature, body: event.body, paymentId: event.paymentId, receivedAt: new Date(event.receivedAt), acceptedAt: new Date(), incidentId: incidentId ?? null }).onConflictDoNothing().returning({ eventId: razorpayWebhookEvents.eventId }); if (inserted.length) return { status: "accepted" as const, eventId: event.eventId, eventType: event.eventType, receivedAt: event.receivedAt }; const [existing] = await tx.select().from(razorpayWebhookEvents).where(eq(razorpayWebhookEvents.eventId, event.eventId)); if (!existing) throw new Error("webhook event insert was not observable"); if (existing.signature !== event.signature || existing.body !== event.body) throw new Error("webhook event ID was already stored with different evidence"); return { status: "duplicate" as const, eventId: existing.eventId, eventType: existing.eventType, receivedAt: existing.receivedAt.toISOString() }; }); }
}
export class FixtureDiagnosisAdapter {
  provider = "fixture";
  model = "fixture-diagnosis-v1";
  diagnose(_bundle?: IncidentBundle, _reconstruction?: Reconstruction) {
    return DiagnosisOutputSchema.parse({
      diagnosis: {
        hypotheses: [
          {
            rank: 1,
            summary:
              "The processor completed capture before the caller timed out.",
            reasoning:
              "The verified capture event occurred before the timeout response.",
            uncertainty: "The synchronous acknowledgement was lost.",
            confidence: 0.98,
            evidence_ids: ["EV-REQ-001", "EV-TIMEOUT-001", "EV-WEBHOOK-001"],
          },
        ],
        recommendation: {
          action: "reconcile_internal_state",
          reasoning:
            "Apply the verified capture to the merchant record without mutation.",
          uncertainty: "Escalate if deterministic invariants do not agree.",
          evidence_ids: ["EV-STATE-001", "EV-WEBHOOK-001"],
        },
      },
      provenance: {
        provider: this.provider,
        requested_model: this.model,
        returned_model: this.model,
        request_id: "fixture-call",
        strict_schema: true,
      },
    });
  }
}
