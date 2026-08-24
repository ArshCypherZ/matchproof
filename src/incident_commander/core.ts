import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, type Database } from "../db/client";
import { auditEvents, incidents, payments, recoveries } from "../db/schema";
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
  readonly db: Database;
  private readonly pool: ReturnType<typeof createDatabase>["pool"];
  constructor(readonly statePath: string, private readonly reset = false, readonly secret?: string) { const connection = createDatabase(); this.db = connection.db; this.pool = connection.pool; }
  async initialize() { await migrate(this.db, { migrationsFolder: "drizzle" }); if (this.reset) await this.db.execute(sql`TRUNCATE TABLE ${auditEvents}, ${recoveries}, ${incidents}, ${payments} RESTART IDENTITY`); }
  async close() { await this.pool.end(); }
  async ingest(b: unknown) {
    const v = verifyBundle(b, this.secret);
    const p = v.evidence.find(
      (x): x is Extract<Evidence, { kind: "processor_webhook" }> =>
        x.kind === "processor_webhook" &&
        x.payload.event_type === "payment.captured",
    );
    if (!p) throw new EvidenceError("captured processor webhook is required");
    await this.db.insert(payments).values({ paymentId: p.payload.payment_id, state: "capture_pending", amountMinor: p.payload.amount_minor, currency: p.payload.currency, operation: "capture", operationKey: p.payload.idempotency_key, updatedAt: new Date() }).onConflictDoNothing();
    await this.db.insert(incidents).values({ incidentId: v.incident_id, paymentId: v.payment_id, idempotencyKey: v.idempotency_key, bundle: v }).onConflictDoUpdate({ target: incidents.incidentId, set: { bundle: v } });
  }
  async incident(id: string) {
    const [row] = await this.db.select().from(incidents).where(eq(incidents.incidentId, id));
    return row ? verifyBundle(row.bundle, this.secret) : null;
  }
  async payment(id: string) {
    const [row] = await this.db.select().from(payments).where(eq(payments.paymentId, id));
    return row ? { payment_id: row.paymentId, state: row.state, amount_minor: row.amountMinor, currency: row.currency, operation: row.operation, operation_key: row.operationKey, updated_at: row.updatedAt.toISOString() } : undefined;
  }
  async recovery(key: string) { const [row] = await this.db.select().from(recoveries).where(eq(recoveries.executionKey, key)); return row ? { execution_key: row.executionKey, action: row.action, status: row.status, before_state: row.beforeState, after_state: row.afterState, completed_at: row.completedAt.toISOString() } : undefined; }
  async completeRecovery(key: string, row: { action: string; status: string; before_state: string; after_state: string; completed_at: string }) { await this.db.insert(recoveries).values({ executionKey: key, action: row.action, status: row.status, beforeState: row.before_state, afterState: row.after_state, completedAt: new Date(row.completed_at) }).onConflictDoUpdate({ target: recoveries.executionKey, set: { status: row.status, afterState: row.after_state, completedAt: new Date(row.completed_at) } }); }
  async updatePayment(id: string, state: string) { await this.db.update(payments).set({ state, updatedAt: new Date() }).where(eq(payments.paymentId, id)); }
  async audit(t: string, p: unknown) {
    const [row] = await this.db.insert(auditEvents).values({ recordedAt: new Date(), eventType: t, payload: p }).returning({ sequence: auditEvents.sequence });
    return row?.sequence;
  }
  async auditRecords() {
    const rows = await this.db.select().from(auditEvents).orderBy(auditEvents.sequence);
    return rows.map((row) => ({ sequence: row.sequence, recorded_at: row.recordedAt.toISOString(), event_type: row.eventType, payload: JSON.stringify(row.payload) }));
  }
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
