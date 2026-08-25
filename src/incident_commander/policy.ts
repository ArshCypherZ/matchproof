import {
  PolicyGateDecisionSchema,
  VerifiedPaymentStateSchema,
  ActionSchema,
  type Action,
  type DiagnosisOutput,
  type IncidentBundle,
  type Reconstruction,
  type ReconciliationResult,
} from "../domain/schemas";

export const POLICY_VERSION = "deterministic-policy-v1";

export type PolicyAuditLogger = (event: {
  event_type: "policy_evaluated";
  payload: {
    policy_version: typeof POLICY_VERSION;
    action: Action;
    allowed: boolean;
    reason: string;
    approval_required: string | null;
    incident_id: string;
    payment_id: string;
  };
}) => void | Promise<void>;

const blockedApproval = (action: Action) =>
  action === "retry_capture"
    ? "operator-approved capture runbook"
    : action === "refund"
      ? "operator-approved refund runbook"
      : action === "payout"
        ? "operator-approved payout runbook"
        : action === "fulfil"
          ? "operator-approved fulfilment runbook"
          : action === "arbitrary_write"
            ? "explicitly scoped merchant adapter operation"
            : null;

const requiredInvariantNames = [
  "identity",
  "amount",
  "currency",
  "order",
  "chronology",
  "freshness",
  "uniqueness",
  "idempotency",
  "authenticity",
] as const;

const requiredInvariantsHold = (reconciliation: ReconciliationResult) =>
  requiredInvariantNames.every(
    (name) => reconciliation.invariant_results[name],
  );

export function evaluate(
  recommendation: DiagnosisOutput["diagnosis"]["recommendation"],
  _bundle: IncidentBundle,
  reconstruction: Reconstruction,
  _merchant?: unknown,
  reconciliation?: ReconciliationResult,
) {
  const decision = (action: Action, allowed: boolean, reason: string) =>
    PolicyGateDecisionSchema.parse({
      action,
      allowed,
      reason,
      approval_required: allowed ? null : blockedApproval(action),
    });
  const validEvidence = new Set(
    reconstruction.timeline.map((entry) => entry.evidence_id),
  );
  if (recommendation.evidence_ids.some((id) => !validEvidence.has(id)))
    return decision(
      recommendation.action,
      false,
      "blocked: recommendation cites non-canonical or missing evidence",
    );
  const reasons: Record<Action, string> = {
    retry_capture:
      "blocked: retry_capture is never authorized by this recovery workflow",
    refund: "blocked: financial mutation requires an explicit approved runbook",
    payout: "blocked: financial mutation requires an explicit approved runbook",
    fulfil:
      "blocked: fulfilment mutation requires an explicit approved runbook",
    arbitrary_write: "blocked: arbitrary writes are never authorized",
    retry_safe_read: "approved: read-only retry changes no financial state",
    no_action_required: "approved: no mutation is required",
    escalate: "approved: escalation changes no payment or financial state",
    reconcile_internal_state:
      "approved: all request, processor, internal, and reconstructed invariants agree",
  };
  const action = recommendation.action;
  const knownAction = ActionSchema.safeParse(action);
  if (!knownAction.success)
    throw new Error("policy rejected an unknown action");
  if (
    action === "reconcile_internal_state" &&
    (reconstruction.ambiguity_reasons.length ||
      !VerifiedPaymentStateSchema.safeParse(reconstruction.current_state)
        .success ||
      (reconciliation !== undefined &&
        (!reconciliation.deterministic_resolution ||
          reconciliation.resolution !== "reconcile_internal_state" ||
          reconciliation.status === "ambiguous" ||
          !requiredInvariantsHold(reconciliation))))
  )
    return decision(
      recommendation.action,
      false,
      "blocked: reconciliation invariants failed",
    );
  if (action === "no_action_required")
    return decision(
      action,
      reconciliation?.status === "agreed" &&
        reconciliation.resolution === "no_action_required" &&
        reconciliation.deterministic_resolution &&
        !reconciliation.ambiguity_reasons.length &&
        requiredInvariantsHold(reconciliation),
      reconciliation?.status === "agreed"
        ? reasons[action]
        : "blocked: no-action decision requires an agreed reconciliation",
    );
  if (action === "retry_safe_read") {
    const failedRead = _bundle.evidence.some(
      (entry) =>
        (entry.kind === "provider_payment_fetch" ||
          entry.kind === "provider_order_fetch") &&
        entry.payload.result === "error" &&
        entry.payload.operation === "read" &&
        entry.payload.idempotency_key === _bundle.idempotency_key,
    );
    return decision(
      action,
      failedRead,
      failedRead
        ? reasons[action]
        : "blocked: safe-read retry requires a failed idempotent read",
    );
  }
  return decision(
    action,
    action === "reconcile_internal_state" || action === "escalate",
    reasons[action],
  );
}

export async function evaluateAndAudit(
  recommendation: DiagnosisOutput["diagnosis"]["recommendation"],
  bundle: IncidentBundle,
  reconstruction: Reconstruction,
  merchant?: unknown,
  reconciliation?: ReconciliationResult,
  audit?: PolicyAuditLogger,
) {
  const decision = evaluate(
    recommendation,
    bundle,
    reconstruction,
    merchant,
    reconciliation,
  );
  if (audit)
    await audit({
      event_type: "policy_evaluated",
      payload: {
        policy_version: POLICY_VERSION,
        action: decision.action,
        allowed: decision.allowed,
        reason: decision.reason,
        approval_required: decision.approval_required,
        incident_id: bundle.incident_id,
        payment_id: bundle.payment_id,
      },
    });
  return decision;
}
