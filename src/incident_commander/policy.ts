import {
  PolicyGateDecisionSchema,
  VerifiedPaymentStateSchema,
  type Action,
  type DiagnosisOutput,
  type IncidentBundle,
  type Reconstruction,
} from "../domain/schemas";

export function evaluate(
  recommendation: DiagnosisOutput["diagnosis"]["recommendation"],
  _bundle: IncidentBundle,
  reconstruction: Reconstruction,
  _merchant?: unknown,
) {
  const decision = (action: Action, allowed: boolean, reason: string) =>
    PolicyGateDecisionSchema.parse({ action, allowed, reason });
  const validEvidence = new Set(
    reconstruction.timeline.map((entry) => entry.evidence_id),
  );
  if (recommendation.evidence_ids.some((id) => !validEvidence.has(id)))
    return decision(
      recommendation.action,
      false,
      "blocked: recommendation cites non-canonical or missing evidence",
    );
  const denied: Record<Action, string> = {
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
  if (
    action === "reconcile_internal_state" &&
    (reconstruction.ambiguity_reasons.length ||
      !VerifiedPaymentStateSchema.safeParse(reconstruction.current_state)
        .success)
  )
    return decision(
      recommendation.action,
      false,
      "blocked: reconciliation invariants failed",
    );
  return decision(
    recommendation.action,

    action === "reconcile_internal_state" ||
      action === "retry_safe_read" ||
      action === "no_action_required" ||
      action === "escalate",
    denied[action],
  );
}
