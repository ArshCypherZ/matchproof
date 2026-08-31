import {
  IncidentStore,
  reconstruct,
  reconcile,
  evaluateAndAudit,
  RecoveryExecutor,
  type PolicyAuditLogger,
} from "./core";
import {
  PostRepairStateVerifier,
  type PostRepairStateVerificationResult,
  type ProviderPostRepairStateAdapter,
} from "./post-repair-state-verifier";
import type { MerchantPlatformAdapter } from "../db/merchant-platform-adapter";
import {
  RecommendationSchema,
  type ReconciliationResolution,
  type RecoveryOutcome,
} from "../domain/schemas";

export type ApprovedRecoveryOptions = {
  store: IncidentStore;
  incidentId: string;
  tenantId: string;
  actor: string;
  reason?: string;
  merchant: MerchantPlatformAdapter;
  provider: ProviderPostRepairStateAdapter;
};

export type ApprovedRecoveryResult =
  | { status: "not_found" }
  | {
      status: "nothing_to_approve";
      reason: string;
      resolution: ReconciliationResolution;
      ambiguity_reasons: string[];
    }
  | { status: "blocked"; reason: string }
  | {
      status: "executed";
      outcome: RecoveryOutcome;
      post_repair_state: PostRepairStateVerificationResult;
    };

/**
 * Executes the execution tail of the closed loop for one stored incident after
 * an operator approval. The incident is re-loaded, re-reconciled against the
 * current merchant state, and passed through the rule-based policy gate
 * before any merchant mutation is attempted.
 */
export async function executeApprovedRecovery(
  options: ApprovedRecoveryOptions,
): Promise<ApprovedRecoveryResult> {
  const { store, incidentId, tenantId, actor, reason, merchant, provider } =
    options;

  const bundle = await store.incident(incidentId);
  if (!bundle) return { status: "not_found" };

  const payment = await store.payment(bundle.payment_id);
  if (!payment) return { status: "not_found" };

  // The order identity seeds from signed merchant evidence in the bundle and
  // falls back to the reconciliation target, provider, or merchant order ids,
  // matching the derivation used by the workflow.
  let orderId = bundle.evidence.find(
    (entry) => entry.kind === "merchant_order_state",
  )?.payload.order_id;

  const reconstruction = reconstruct(bundle);
  const merchantObservation = orderId
    ? await merchant.fetchOrderState(orderId)
    : undefined;
  const reconciliation = reconcile({
    bundle,
    ...(merchantObservation ? { merchant: merchantObservation } : {}),
  });
  orderId ??=
    reconciliation.target_order_id ??
    reconciliation.provider_order_id ??
    reconciliation.merchant_order_ids[0] ??
    undefined;

  if (
    reconciliation.resolution !== "reconcile_internal_state" ||
    !reconciliation.rule_based_resolution
  )
    return {
      status: "nothing_to_approve",
      reason:
        reconciliation.ambiguity_reasons.join("; ") ||
        `reconciliation resolved to ${reconciliation.resolution}`,
      resolution: reconciliation.resolution,
      ambiguity_reasons: reconciliation.ambiguity_reasons,
    };

  await store.audit("operator_approve", {
    tenant_id: tenantId,
    actor,
    incident_id: incidentId,
    payment_id: bundle.payment_id,
    action: "approve",
    approval_state: "approved",
    reason: reason ?? "operator action",
  });

  const auditLogger: PolicyAuditLogger = (event) =>
    store.audit(event.event_type, event.payload).then(() => undefined);

  const timelineIds = new Set(
    reconstruction.timeline.map((entry) => entry.evidence_id),
  );
  const recommendation = RecommendationSchema.parse({
    action: "reconcile_internal_state",
    reasoning:
      "Operator approval authorizes one bounded merchant-state repair under the rule-based policy gate.",
    uncertainty:
      reconciliation.ambiguity_reasons.join("; ") ||
      "rule-based reconciliation resolved without ambiguity",
    evidence_ids: reconciliation.evidence_ids.filter((id) =>
      timelineIds.has(id),
    ),
  });

  const decision = await evaluateAndAudit(
    recommendation,
    bundle,
    reconstruction,
    payment,
    reconciliation,
    auditLogger,
  );
  if (!decision.allowed) {
    await store.setProgress(incidentId, "gate", "blocked", {
      action: "approve",
      reason: decision.reason,
      actor,
    });
    return { status: "blocked", reason: decision.reason };
  }

  if (!orderId) {
    await store.setProgress(incidentId, "gate", "blocked", {
      action: "approve",
      reason: "merchant order evidence is required for the approved repair",
      actor,
    });
    return {
      status: "blocked",
      reason: "merchant order evidence is required for the approved repair",
    };
  }

  const outcome = await new RecoveryExecutor(store, merchant).execute(
    decision,
    {
      tenantId,
      incidentId,
      paymentId: bundle.payment_id,
      orderId,
      beforeState: payment.state,
      targetState: "paid",
    },
  );
  await store.audit("recovery_completed", outcome);

  const providerStatus =
    reconciliation.provider_state === "authorized" ||
    reconciliation.provider_state === "authorized_verified"
      ? "authorized"
      : "captured";
  const postRepairState = await new PostRepairStateVerifier(
    store,
    provider,
    merchant,
  ).verify({
    executionKey: outcome.idempotency_key,
    paymentId: bundle.payment_id,
    orderId,
    amountMinor: payment.amount_minor,
    currency: payment.currency,
    providerStatus,
  });
  await store.audit("post_repair_state_observed", postRepairState);
  if (postRepairState.status === "verified") {
    // Keep the durable payment record aligned with the verified repair so the
    // reported state and the stored row cannot disagree.
    await store.updatePayment(bundle.payment_id, "paid");
  }

  await store.setProgress(incidentId, "execute", "completed", {
    action: "approve",
    outcome: outcome.status,
    actor,
    ...(reason ? { reason } : {}),
  });
  await store.setProgress(incidentId, "observe", "completed", {
    post_repair_state_status: postRepairState.status,
    ...(postRepairState.reasons.length
      ? { reasons: postRepairState.reasons }
      : {}),
  });
  const verified =
    outcome.status === "reconciled" && postRepairState.status === "verified";
  await store.setProgress(
    incidentId,
    verified ? "close" : "escalate",
    "completed",
    {
      action: "approve",
      outcome: outcome.status,
      post_repair_state_status: postRepairState.status,
      ...(postRepairState.reasons.length
        ? { reasons: postRepairState.reasons }
        : {}),
    },
  );

  return { status: "executed", outcome, post_repair_state: postRepairState };
}
