import {
  ReconstructionSchema,
  VerifiedPaymentStateSchema,
  type Evidence,
  type IncidentBundle,
  type Reconstruction,
} from "../domain/schemas";
import { EvidenceError } from "./errors";

export function reconstruct(bundle: IncidentBundle): Reconstruction {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const canonical: Evidence[] = [];
  for (const evidence of [...bundle.evidence].sort(
    (a, b) => Date.parse(a.received_at) - Date.parse(b.received_at),
  )) {
    const identity =
      evidence.kind === "processor_webhook"
        ? `${evidence.kind}:${evidence.payload.event_id}`
        : `${evidence.kind}:${evidence.evidence_id}`;
    if (seen.has(identity)) {
      duplicates.push(evidence.evidence_id);
      continue;
    }
    seen.add(identity);
    canonical.push(evidence);
  }
  const timeline = [...canonical].sort(
    (a, b) =>
      Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
      a.evidence_id.localeCompare(b.evidence_id),
  );
  let state: string | undefined;
  const transitions: Reconstruction["observation_transitions"] = [];
  for (const evidence of [...canonical].sort(
    (a, b) => Date.parse(a.received_at) - Date.parse(b.received_at),
  )) {
    let next = state;
    let reason = "";
    if (evidence.kind === "payment_request") {
      next = "requested";
      reason = "payment request was issued";
    } else if (evidence.kind === "processor_timeout") {
      next = "ambiguous_after_timeout";
      reason = "processor response timed out; mutation result is unknown";
    } else if (evidence.kind === "internal_state" && !state) {
      next = evidence.payload.payment_state;
      reason = "merchant state was observed";
    } else if (evidence.kind === "processor_webhook") {
      const verifiedState = VerifiedPaymentStateSchema.safeParse(
        `${evidence.payload.payment_state}_verified`,
      );
      next = verifiedState.success
        ? verifiedState.data
        : evidence.payload.payment_state;
      reason = "verified processor event establishes provider outcome";
    }
    if (next && next !== state) {
      transitions.push({
        observed_at: evidence.received_at,
        state: next,
        reason,
        evidence_ids: [evidence.evidence_id],
      });
      state = next;
    }
  }
  const reference = bundle.evidence.find(
    (evidence) =>
      "amount_minor" in evidence.payload && "currency" in evidence.payload,
  );
  if (
    !reference ||
    !("amount_minor" in reference.payload) ||
    !("currency" in reference.payload)
  )
    throw new EvidenceError("amount and currency evidence are required");
  return ReconstructionSchema.parse({
    timeline: timeline.map((evidence) => ({
      evidence_id: evidence.evidence_id,
      kind: evidence.kind,
      occurred_at: evidence.occurred_at,
      received_at: evidence.received_at,
    })),
    observation_transitions: transitions,
    duplicate_evidence_ids: duplicates,
    current_state: state ?? "unknown",
    ambiguity_reasons:
      state === "ambiguous_after_timeout"
        ? ["processor outcome remains unknown"]
        : [],
    impact_summary: {
      payments_affected: 1,
      payment_id: bundle.payment_id,
      amount_minor: reference.payload.amount_minor,
      currency: reference.payload.currency,
      duplicate_events_suppressed: duplicates.length,
      money_movement_executed_by_recovery: false,
    },
  });
}
