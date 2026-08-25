import {
  type IncidentClass,
  IncidentBundleSchema,
  type Evidence,
  type IncidentBundle,
} from "../domain/schemas";
import { EvidenceError } from "./errors";
import { verifyProcessorSignature, type SignaturePayload } from "./signatures";

export function classifyIncident(bundle: IncidentBundle): IncidentClass {
  const evidence = bundle.evidence;
  const webhooks = evidence.filter(
    (entry): entry is Extract<Evidence, { kind: "processor_webhook" }> =>
      entry.kind === "processor_webhook",
  );
  const paymentFetches = evidence
    .filter(
      (entry): entry is Extract<Evidence, { kind: "provider_payment_fetch" }> =>
        entry.kind === "provider_payment_fetch",
    )
    .filter(
      (entry): entry is typeof entry & { payload: { result: "success" } } =>
        entry.payload.result === "success",
    );
  const orders = evidence.filter(
    (entry): entry is Extract<Evidence, { kind: "merchant_order_state" }> =>
      entry.kind === "merchant_order_state",
  );
  const deliveryFailure = evidence.some(
    (entry) =>
      entry.kind === "webhook_delivery" &&
      entry.payload.delivery_status !== "received",
  );
  const capturedOrPaid =
    webhooks.some((entry) =>
      ["captured", "paid"].includes(entry.payload.payment_state),
    ) || paymentFetches.some((entry) => entry.payload.status === "captured");
  const providerAmount =
    webhooks.find((webhook) =>
      ["captured", "paid"].includes(webhook.payload.payment_state),
    )?.payload.amount_minor ??
    paymentFetches.find((entry) => entry.payload.status === "captured")?.payload
      .amount_minor;
  const providerCurrency =
    webhooks.find((webhook) =>
      ["captured", "paid"].includes(webhook.payload.payment_state),
    )?.payload.currency ??
    paymentFetches.find((entry) => entry.payload.status === "captured")?.payload
      .currency;
  const hasMatchedMerchantOrder = orders.some(
    (entry) =>
      ["paid", "fulfilled"].includes(entry.payload.order_state) &&
      entry.payload.amount_minor === providerAmount &&
      entry.payload.currency === providerCurrency,
  );
  const hasTimeout = evidence.some(
    (entry) =>
      entry.kind === "processor_timeout" &&
      entry.payload.operation === "capture",
  );

  if (new Set(orders.map((entry) => entry.payload.order_id)).size > 1)
    return "one_payment_two_orders";
  if (
    evidence.some(
      (entry) =>
        entry.kind === "settlement_observation" &&
        entry.payload.settlement_status !== "settled",
    ) &&
    capturedOrPaid &&
    hasMatchedMerchantOrder
  )
    return "settlement_exception";
  if (deliveryFailure) return "webhook_delivery_failure";
  if (hasTimeout) return "capture_timeout";
  if (
    evidence.some(
      (entry) =>
        entry.kind === "callback_observation" &&
        entry.payload.callback_status === "missing",
    ) &&
    capturedOrPaid
  )
    return "callback_missing_webhook_recovers";
  if (
    capturedOrPaid &&
    orders.some((entry) => entry.payload.order_state === "pending")
  )
    return "paid_pending";
  if (
    webhooks.some((entry) => entry.payload.payment_state === "authorized") ||
    paymentFetches.some((entry) => entry.payload.status === "authorized")
  )
    return "late_authorized";
  if (
    capturedOrPaid &&
    !evidence.some((entry) => entry.kind === "internal_state") &&
    (orders.length === 0 ||
      orders.every((entry) => entry.payload.order_state === "missing"))
  )
    return "paid_missing";
  throw new EvidenceError("evidence does not match a bounded incident class");
}

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
  const financialEvidence = bundle.evidence.filter(
    (
      evidence,
    ): evidence is Extract<
      Evidence,
      { payload: { amount_minor: number; currency: string } }
    > => "amount_minor" in evidence.payload && "currency" in evidence.payload,
  );
  if (
    new Set(financialEvidence.map((evidence) => evidence.payload.amount_minor))
      .size > 1 ||
    new Set(financialEvidence.map((evidence) => evidence.payload.currency))
      .size > 1
  )
    throw new EvidenceError(
      "financial amount or currency conflicts across evidence",
    );
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
  for (const evidence of bundle.evidence) {
    if (
      evidence.kind === "provider_payment_fetch" &&
      evidence.payload.result === "success"
    )
      outcomes.add(evidence.payload.status);
  }
  if (outcomes.has("captured") && outcomes.has("failed"))
    throw new EvidenceError(
      "contradictory processor outcomes cannot be accepted",
    );
  const incidentClass = classifyIncident(bundle);
  if (
    incidentClass === "paid_missing" &&
    bundle.evidence.some((evidence) => evidence.kind === "internal_state")
  )
    throw new EvidenceError(
      "paid_missing evidence must not contain internal state",
    );
  return Object.freeze(bundle);
}
