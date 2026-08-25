import fs from "node:fs";
import {
  parseDiagnosisOutput,
  RecoveryOutcomeSchema,
  VerifiedPaymentStateSchema,
} from "../domain/schemas";
import {
  IncidentStore,
  FixtureDiagnosisAdapter,
  verifyBundle,
  reconstruct,
  evaluateAndAudit,
  reconcile,
} from "./core";
import type { EvidenceGatherer } from "./evidence-gatherer";
import type { PolicyAuditLogger } from "./policy";
import { RecoveryExecutor } from "./recovery-executor";
import type { MerchantPlatformAdapter } from "../db/merchant-platform-adapter";
import {
  AfterstateVerifier,
  RazorpayProviderAfterstateAdapter,
  type AfterstateVerificationResult,
  type ProviderAfterstateAdapter,
} from "./afterstate-verifier";
export async function runIncident(
  fixture: string,
  state: string,
  opts: {
    resetState?: boolean;
    processorSecret?: string;
    diagnosisAdapter?: FixtureDiagnosisAdapter;
    diagnosisMode?: string;
    evidenceGatherer?: EvidenceGatherer;
    merchantPlatformAdapter?: MerchantPlatformAdapter;
    providerAfterstateAdapter?: ProviderAfterstateAdapter;
    tenantId?: string;
  } = {},
) {
  const raw: unknown = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const initialBundle = verifyBundle(
    raw,
    opts.processorSecret ?? "test-prototype-secret",
  );
  const merchantOrderId = initialBundle.evidence.find(
    (entry) => entry.kind === "merchant_order_state",
  )?.payload.order_id;
  const gatheredEvidence = opts.evidenceGatherer
    ? await opts.evidenceGatherer.gather({
        paymentId: initialBundle.payment_id,
        ...(merchantOrderId ? { orderId: merchantOrderId } : {}),
        idempotencyKey: initialBundle.idempotency_key,
      })
    : [];
  const bundle = verifyBundle(
    {
      ...initialBundle,
      evidence: [...initialBundle.evidence, ...gatheredEvidence],
    },
    opts.processorSecret ?? "test-prototype-secret",
  );
  const store = new IncidentStore(
    state,
    opts.resetState ?? false,
    opts.processorSecret ?? "test-prototype-secret",
  );
  await store.initialize();
  await store.ingest(bundle);
  const resumeFrom = (await store.latestProgress(bundle.incident_id))?.step;
  const completedSteps = new Set(
    (await store.progress(bundle.incident_id))
      .filter((entry) => entry.status === "completed")
      .map((entry) => entry.step),
  );
  const markCompleted = async (step: string, details: unknown) => {
    if (completedSteps.has(step)) return;
    await store.setProgress(bundle.incident_id, step, "completed", details);
    completedSteps.add(step);
  };
  await markCompleted("gather", {
    evidence_count: bundle.evidence.length,
    provider_evidence_count: gatheredEvidence.length,
  });
  const saved = await store.incident(bundle.incident_id);
  if (!saved)
    throw new Error(`incident ${bundle.incident_id} was not persisted`);
  const recon = reconstruct(saved);
  const reconciliation = reconcile(saved);
  await markCompleted("reconcile", { current_state: recon.current_state });
  const adapter = opts.diagnosisAdapter ?? new FixtureDiagnosisAdapter();
  const model = parseDiagnosisOutput(
    adapter.diagnose(saved, recon, reconciliation),
    new Set(recon.timeline.map((entry) => entry.evidence_id)),
  );
  await markCompleted("diagnose", { provider: model.provenance.provider });
  const rec = model.diagnosis.recommendation;
  const auditPolicy: PolicyAuditLogger = (event) =>
    store.audit(event.event_type, event.payload).then(() => undefined);
  let dec = await evaluateAndAudit(
    rec,
    saved,
    recon,
    await store.payment(saved.payment_id),
    reconciliation,
    auditPolicy,
  );
  const gateDecisions = [dec];
  await markCompleted("gate", { allowed: dec.allowed });
  let recommendation = rec;
  if (!dec.allowed) {
    recommendation = {
      action: "escalate",
      reasoning: "Required reconciliation invariants did not hold.",
      uncertainty: dec.reason,
      evidence_ids: rec.evidence_ids,
    };
    dec = await evaluateAndAudit(
      recommendation,
      saved,
      recon,
      await store.payment(saved.payment_id),
      reconciliation,
      auditPolicy,
    );
    gateDecisions.push(dec);
  }
  const key = `${recommendation.action}:${saved.incident_id}:${saved.payment_id}:${saved.idempotency_key}`;
  let outcome;
  let afterstateVerification: AfterstateVerificationResult | undefined;
  const existing = await store.recovery(key);
  const payment = await store.payment(saved.payment_id);
  if (!payment)
    throw new Error(`payment ${saved.payment_id} was not persisted`);
  if (existing && payment.state === existing.after_state)
    outcome = RecoveryOutcomeSchema.parse({
      status: "already_completed",
      action: recommendation.action,
      idempotency_key: key,
      before_state: existing.before_state,
      after_state: existing.after_state,
      reason: "recovery already completed and durable state agrees",
    });
  else if (
    opts.merchantPlatformAdapter &&
    recommendation.action === "reconcile_internal_state"
  ) {
    const orderId = initialBundle.evidence.find(
      (entry) => entry.kind === "merchant_order_state",
    )?.payload.order_id;
    if (!orderId)
      throw new Error(
        "merchant order evidence is required for adapter recovery",
      );
    const executor = new RecoveryExecutor(store, opts.merchantPlatformAdapter);
    outcome = await executor.execute(dec, {
      tenantId: opts.tenantId ?? "default",
      incidentId: saved.incident_id,
      paymentId: saved.payment_id,
      orderId,
      beforeState: payment.state,
      targetState: "paid",
    });
    await markCompleted("execute", { action: recommendation.action });
    await store.audit("recovery_completed", outcome);
    afterstateVerification = await new AfterstateVerifier(
      store,
      opts.providerAfterstateAdapter ?? new RazorpayProviderAfterstateAdapter(),
      opts.merchantPlatformAdapter,
    ).verify({
      executionKey: outcome.idempotency_key,
      paymentId: saved.payment_id,
      orderId,
      amountMinor: payment.amount_minor,
      currency: payment.currency,
    });
    await store.audit("afterstate_observed", afterstateVerification);
  } else {
    const after =
      recommendation.action === "reconcile_internal_state"
        ? VerifiedPaymentStateSchema.parse(recon.current_state)
        : payment.state;
    if (recommendation.action === "reconcile_internal_state")
      await store.updatePayment(saved.payment_id, after);
    await markCompleted("execute", { action: recommendation.action });
    await store.completeRecovery(key, {
      action: recommendation.action,
      status:
        recommendation.action === "reconcile_internal_state"
          ? "reconciled"
          : "escalated",
      before_state: payment.state,
      after_state: after,
      completed_at: new Date().toISOString(),
    });
    await store.audit("recovery_completed", {
      status:
        recommendation.action === "reconcile_internal_state"
          ? "reconciled"
          : "escalated",
      before_state: payment.state,
      after_state: after,
    });
    outcome = RecoveryOutcomeSchema.parse({
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
      ...(recommendation.action === "escalate"
        ? {
            escalation_reason: dec.reason,
            terminal_owner: "payment-operations",
            policy_version: "fixture-policy-v1",
            credential_scope: "merchant-state-reconciliation",
          }
        : {}),
    });
  }
  const paymentAfter = await store.payment(saved.payment_id);
  if (!paymentAfter)
    throw new Error(`payment ${saved.payment_id} disappeared after recovery`);
  const verificationDetails = {
    payment_state: paymentAfter.state,
    afterstate_status: afterstateVerification?.status ?? "not_required",
  };
  if (
    afterstateVerification &&
    afterstateVerification.status !== "verified" &&
    !completedSteps.has("verify")
  )
    await store.setProgress(
      saved.incident_id,
      "verify",
      afterstateVerification.status,
      verificationDetails,
    );
  else await markCompleted("verify", verificationDetails);
  if (
    (outcome.status === "reconciled" ||
      outcome.status === "already_completed") &&
    afterstateVerification &&
    afterstateVerification.status !== "verified"
  )
    outcome = RecoveryOutcomeSchema.parse({
      status: "escalated",
      action: recommendation.action,
      idempotency_key: outcome.idempotency_key,
      before_state: outcome.before_state,
      after_state: outcome.after_state,
      reason:
        afterstateVerification.status === "held"
          ? "fresh afterstate could not be obtained"
          : "fresh afterstate did not satisfy the recovery invariant",
      escalation_reason: afterstateVerification.reasons.join("; "),
      terminal_owner: "payment-operations",
      policy_version: "deterministic-policy-v1",
      credential_scope: "merchant-state-reconciliation",
    });
  const terminalStep =
    outcome.status === "reconciled" ||
    (outcome.status === "already_completed" &&
      afterstateVerification?.status === "verified")
      ? "close"
      : "escalate";
  await markCompleted(terminalStep, { outcome: outcome.status });
  const auditRecords = await store.auditRecords();
  await store.close();
  return {
    bundle: saved,
    reconstruction: recon,
    reconciliation,
    diagnosis: model.diagnosis,
    model_provenance: model.provenance,
    diagnosis_mode: opts.diagnosisMode || "fixture",
    resumed_from: resumeFrom,
    gate_decisions: gateDecisions,
    outcome,
    afterstate_verification: afterstateVerification,
    payment_state: {
      ...paymentAfter,
      state: outcome.after_state,
    },
    audit_records: auditRecords,
    state_path: state,
  };
}
