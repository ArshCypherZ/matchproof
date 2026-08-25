import {
  ReconstructionSchema,
  VerifiedPaymentStateSchema,
  type Evidence,
  type IncidentBundle,
  type Reconstruction,
} from "../domain/schemas";
import { classifyIncident } from "./validation";
import { EvidenceError } from "./errors";

export function reconstruct(bundle: IncidentBundle): Reconstruction {
  const incidentClass = classifyIncident(bundle);
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
  let latestProcessorOutcomeAt: number | undefined;
  const transitions: Reconstruction["observation_transitions"] = [];
  for (const evidence of [...canonical].sort(
    (a, b) =>
      Date.parse(a.received_at) - Date.parse(b.received_at) ||
      a.evidence_id.localeCompare(b.evidence_id),
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
    } else if (evidence.kind === "merchant_order_state") {
      next =
        evidence.payload.order_state === "pending"
          ? "paid_pending"
          : evidence.payload.order_state === "missing"
            ? "paid_missing"
            : evidence.payload.order_state;
      reason = "merchant order state was observed";
    } else if (evidence.kind === "callback_observation") {
      next =
        evidence.payload.callback_status === "missing"
          ? "callback_missing"
          : "callback_received";
      reason = "callback delivery state was observed";
    } else if (evidence.kind === "webhook_delivery") {
      next = `webhook_${evidence.payload.delivery_status}`;
      reason = "webhook delivery state was observed";
    } else if (evidence.kind === "settlement_observation") {
      next = `settlement_${evidence.payload.settlement_status}`;
      reason = "settlement state was observed";
    } else if (
      evidence.kind === "provider_payment_fetch" &&
      evidence.payload.result === "success"
    ) {
      const verifiedState = VerifiedPaymentStateSchema.safeParse(
        `${evidence.payload.status}_verified`,
      );
      next = verifiedState.success
        ? verifiedState.data
        : evidence.payload.status;
      reason = "fresh provider API fetch establishes provider outcome";
    } else if (
      evidence.kind === "provider_order_fetch" &&
      evidence.payload.result === "success"
    ) {
      const verifiedState = VerifiedPaymentStateSchema.safeParse(
        `${evidence.payload.status === "paid" ? "paid" : evidence.payload.status}_verified`,
      );
      next = verifiedState.success
        ? verifiedState.data
        : evidence.payload.status;
      reason = "fresh provider order API fetch establishes provider outcome";
    } else if (evidence.kind === "processor_webhook") {
      const occurredAt = Date.parse(evidence.occurred_at);
      if (
        latestProcessorOutcomeAt !== undefined &&
        occurredAt < latestProcessorOutcomeAt
      )
        continue;
      latestProcessorOutcomeAt = occurredAt;
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
    incident_class: incidentClass,
    timeline: timeline.map((evidence) => ({
      evidence_id: evidence.evidence_id,
      kind: evidence.kind,
      occurred_at: evidence.occurred_at,
      received_at: evidence.received_at,
    })),
    observation_transitions: transitions,
    duplicate_evidence_ids: duplicates,
    current_state: state ?? "unknown",
    ambiguity_reasons: [
      ...(state === "ambiguous_after_timeout"
        ? ["processor outcome remains unknown"]
        : []),
      ...(incidentClass === "settlement_exception"
        ? ["settlement reconciliation is outside this prototype scope"]
        : []),
      ...bundle.evidence
        .filter(
          (
            evidence,
          ): evidence is Extract<
            Evidence,
            { kind: "provider_payment_fetch" | "provider_order_fetch" }
          > =>
            evidence.kind === "provider_payment_fetch" ||
            evidence.kind === "provider_order_fetch",
        )
        .filter(
          (
            evidence,
          ): evidence is typeof evidence & {
            payload: { result: "error"; error_code: string };
          } => evidence.payload.result === "error",
        )
        .map(
          (evidence) =>
            `${evidence.kind} outcome is unknown: ${evidence.payload.error_code}`,
        ),
    ],
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
