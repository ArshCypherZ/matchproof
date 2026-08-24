import fs from "node:fs";
import { parseDiagnosisOutput } from "../domain/schemas";
import {
  IncidentStore,
  FixtureDiagnosisAdapter,
  verifyBundle,
  reconstruct,
  evaluate,
} from "./core";
export async function runIncident(fixture: string, state: string, opts: { resetState?: boolean; processorSecret?: string; diagnosisAdapter?: FixtureDiagnosisAdapter; diagnosisMode?: string } = {}) {
  const raw: unknown = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const store = new IncidentStore(
    state,
    opts.resetState ?? false,
    opts.processorSecret ?? "test-prototype-secret",
  );
  await store.initialize();
  const bundle = verifyBundle(
    raw,
    opts.processorSecret ?? "test-prototype-secret",
  );
  await store.ingest(bundle);
  await store.setProgress(bundle.incident_id, "gather", "completed", { evidence_count: bundle.evidence.length });
  const saved = await store.incident(bundle.incident_id);
  if (!saved) throw new Error(`incident ${bundle.incident_id} was not persisted`);
  const recon = reconstruct(saved);
  await store.setProgress(saved.incident_id, "reconcile", "completed", { current_state: recon.current_state });
  const adapter = opts.diagnosisAdapter ?? new FixtureDiagnosisAdapter();
  const model = parseDiagnosisOutput(
    adapter.diagnose(saved, recon),
    new Set(recon.timeline.map((entry) => entry.evidence_id)),
  );
  await store.setProgress(saved.incident_id, "diagnose", "completed", { provider: model.provenance.provider });
  const rec = model.diagnosis.recommendation;
  let dec = evaluate(rec, saved, recon, await store.payment(saved.payment_id));
  await store.setProgress(saved.incident_id, "gate", "completed", { allowed: dec.allowed });
  let recommendation = rec;
  if (!dec.allowed) {
    recommendation = {
      action: "escalate",
      reasoning: "Required reconciliation invariants did not hold.",
      uncertainty: dec.reason,
      evidence_ids: rec.evidence_ids,
    };
    dec = evaluate(
      recommendation,
      saved,
      recon,
      await store.payment(saved.payment_id),
    );
  }
  const key = `${recommendation.action}:${saved.incident_id}:${saved.payment_id}:${saved.idempotency_key}`;
  let outcome;
  const existing = await store.recovery(key);
  const payment = await store.payment(saved.payment_id);
  if (!payment) throw new Error(`payment ${saved.payment_id} was not persisted`);
  if (
    existing &&
    (payment.state === existing.after_state ||
      payment.state === "captured_verified")
  )
    outcome = {
      status: "already_completed",
      action: recommendation.action,
      idempotency_key: key,
      before_state: existing.before_state,
      after_state: existing.after_state,
      reason: "recovery already completed and durable state agrees",
    };
  else {
    const after =
      recommendation.action === "reconcile_internal_state"
        ? "captured_verified"
        : payment.state;
    if (recommendation.action === "reconcile_internal_state") await store.updatePayment(saved.payment_id, after);
    await store.setProgress(saved.incident_id, "execute", "completed", { action: recommendation.action });
    await store.completeRecovery(key, { action: recommendation.action, status: recommendation.action === "reconcile_internal_state" ? "reconciled" : "escalated", before_state: payment.state, after_state: after, completed_at: new Date().toISOString() });
    await store.audit("recovery_completed", {
        status:
          recommendation.action === "reconcile_internal_state"
            ? "reconciled"
            : "escalated",
        before_state: payment.state,
        after_state: after,
      });
    outcome = {
      status:
        recommendation.action === "reconcile_internal_state"
          ? "reconciled"
          : "escalated",
      action: recommendation.action,
      idempotency_key: key,
      before_state: payment.state,
      after_state: after,
      reason:
        "durable merchant state reconciled from verified processor evidence",
    };
  }
  const paymentAfter = await store.payment(saved.payment_id);
  if (!paymentAfter) throw new Error(`payment ${saved.payment_id} disappeared after recovery`);
  await store.setProgress(saved.incident_id, "verify", "completed", { payment_state: paymentAfter.state });
  await store.setProgress(saved.incident_id, outcome.status === "reconciled" ? "close" : "escalate", "completed", { outcome: outcome.status });
  return {
    bundle: saved,
    reconstruction: recon,
    diagnosis: model.diagnosis,
    model_provenance: model.provenance,
    diagnosis_mode: opts.diagnosisMode || "fixture",
    gate_decisions: [
      {
        action: "retry_capture",
        allowed: false,
        reason:
          "blocked: retry_capture is never authorized by this recovery workflow",
      },
      dec,
    ],
    outcome,
    payment_state: {
      ...paymentAfter,
      state: outcome.after_state,
    },
    audit_records: await store.auditRecords(),
    state_path: state,
  };
}
