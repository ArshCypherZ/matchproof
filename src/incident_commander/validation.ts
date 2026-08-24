import {
  IncidentBundleSchema,
  type Evidence,
  type IncidentBundle,
} from "../domain/schemas";
import { EvidenceError } from "./errors";
import { verifyProcessorSignature, type SignaturePayload } from "./signatures";

export function verifyBundle(
  input: unknown,
  secret = process.env.PROCESSOR_WEBHOOK_SECRET,
): IncidentBundle {
  if (!secret)
    throw new EvidenceError(
      "prototype processor-signature secret is not configured",
    );
  let bundle: IncidentBundle;
  try {
    bundle = IncidentBundleSchema.parse(input);
  } catch (error) {
    throw new EvidenceError(
      error instanceof Error
        ? error.message
        : "incident bundle failed schema validation",
    );
  }
  const ids = bundle.evidence.map((evidence) => evidence.evidence_id);
  if (new Set(ids).size !== ids.length)
    throw new EvidenceError("evidence IDs must be unique");
  const paymentRequest = bundle.evidence.find(
    (evidence): evidence is Extract<Evidence, { kind: "payment_request" }> =>
      evidence.kind === "payment_request",
  );
  const requestAmount =
    paymentRequest && "amount_minor" in paymentRequest.payload
      ? paymentRequest.payload.amount_minor
      : undefined;
  const requestCurrency =
    paymentRequest && "currency" in paymentRequest.payload
      ? paymentRequest.payload.currency
      : undefined;
  for (const evidence of bundle.evidence) {
    const payload = evidence.payload;
    if ("payment_id" in payload && payload.payment_id !== bundle.payment_id)
      throw new EvidenceError(
        `${evidence.evidence_id} belongs to ${payload.payment_id}, not ${bundle.payment_id}`,
      );
    if (Date.parse(evidence.received_at) < Date.parse(evidence.occurred_at))
      throw new EvidenceError(
        `${evidence.evidence_id} was received before it occurred`,
      );
    if (
      requestAmount !== undefined &&
      "amount_minor" in payload &&
      payload.amount_minor !== requestAmount
    )
      throw new EvidenceError("financial amount conflicts across evidence");
    if (
      requestCurrency !== undefined &&
      "currency" in payload &&
      payload.currency !== requestCurrency
    )
      throw new EvidenceError("financial currency conflicts across evidence");
    if (
      "operation" in payload &&
      "idempotency_key" in payload &&
      payload.idempotency_key !== bundle.idempotency_key
    )
      throw new EvidenceError(
        `${evidence.kind} operation identity conflicts with incident`,
      );
    if (
      evidence.kind === "internal_state" &&
      evidence.payload.last_operation_key !== bundle.idempotency_key
    )
      throw new EvidenceError(
        "internal state operation identity conflicts with incident",
      );
    if (evidence.kind === "processor_webhook") {
      if (
        !verifyProcessorSignature(
          evidence.payload as SignaturePayload,
          evidence.processor_signature,
          secret,
        )
      )
        throw new EvidenceError(
          `${evidence.evidence_id} failed prototype processor-signature verification`,
        );
      const expectedState = {
        "payment.authorized": "authorized",
        "payment.captured": "captured",
        "payment.failed": "failed",
        "payment.refunded": "refunded",
        "order.paid": "paid",
        "refund.created": "refunded",
        "refund.processed": "refunded",
        "refund.failed": "failed",
      }[evidence.payload.event_type];
      if (
        expectedState !== undefined &&
        evidence.payload.payment_state !== expectedState
      )
        throw new EvidenceError(
          "processor event identity conflicts with outcome state",
        );
      if (
        paymentRequest &&
        Date.parse(evidence.occurred_at) <
          Date.parse(paymentRequest.occurred_at)
      )
        throw new EvidenceError(
          "processor webhook causally precedes payment request",
        );
    }
  }
  const outcomes = new Set(
    bundle.evidence
      .filter(
        (
          evidence,
        ): evidence is Extract<Evidence, { kind: "processor_webhook" }> =>
          evidence.kind === "processor_webhook",
      )
      .map((evidence) => evidence.payload.payment_state),
  );
  if (outcomes.has("captured") && outcomes.has("failed"))
    throw new EvidenceError(
      "contradictory processor outcomes cannot be accepted",
    );
  return Object.freeze(bundle);
}
