import crypto from "node:crypto";
import type { Evidence } from "../domain/schemas";
import type { RazorpayPayment } from "./razorpay";
import { RazorpayWebhookInbox } from "./webhook";
import { verifyBundle } from "./validation";
import { recoveryExecutionKey } from "./recovery-executor";
import { derivePaymentSeed } from "../db/repository";
import type { IncidentStore } from "./core";

export type DemoProviderOrder = {
  id: string;
  amount: number;
  currency: string;
};

/** The public checkout payload: the key id is safe for the browser, the secret never leaves the server. */
export function publicOrderPayload(order: { id: string }, keyId: string) {
  return { order_id: order.id, key_id: keyId };
}

/** Webhook-shaped body for the captured payment that drives the demo incident. */
export function demoWebhookBody(payment: RazorpayPayment) {
  // The event is signed at staging time, so created_at reflects that moment
  // and stays inside the replay-acceptance window regardless of when the
  // payment itself was made.
  return JSON.stringify({
    event: "payment.captured",
    created_at: Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: payment.id,
          status: payment.status,
          captured: payment.captured,
          amount: payment.amount,
          currency: payment.currency,
          order_id: payment.order_id,
          created_at: payment.created_at,
        },
      },
    },
  });
}

export function demoSignature(rawBody: string, webhookSecret: string) {
  return crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
}

export function demoIncidentId(paymentId: string) {
  return `inc_webhook_${paymentId}`;
}

/**
 * Every execution key a demo run can record for one payment: the plain keys
 * the workflow writes and the hashed keys the recovery executor derives. A
 * re-staged rehearsal must clear exactly these rows, or the next run replays
 * the prior outcome instead of re-executing the repair.
 */
export function demoExecutionKeys(input: {
  incidentId: string;
  paymentId: string;
  orderId: string;
  idempotencyKey: string;
  tenantId: string;
}) {
  const context = {
    tenantId: input.tenantId,
    incidentId: input.incidentId,
    paymentId: input.paymentId,
    orderId: input.orderId,
    // Only the canonical identity above feeds the hash; the before-state is
    // required by the context type but never part of the key.
    beforeState: "pending" as const,
    targetState: "paid" as const,
  };
  const executionKey = (action: "reconcile_internal_state" | "escalate") =>
    recoveryExecutionKey(
      {
        action,
        allowed: true,
        reason: "demo execution key derivation",
        approval_required: null,
      },
      context,
    );
  return [
    `reconcile_internal_state:${input.incidentId}:${input.paymentId}:${input.idempotencyKey}`,
    `escalate:${input.incidentId}:${input.paymentId}:${input.idempotencyKey}`,
    executionKey("reconcile_internal_state"),
    executionKey("escalate"),
  ];
}

/** The merchant order is deliberately left pending to stage the discrepancy. */
export function demoMerchantEvidence(input: {
  orderId: string;
  payment: Pick<RazorpayPayment, "id" | "order_id">;
  providerOrder: DemoProviderOrder;
  receivedAt: string;
  idempotencyKey: string;
}): Extract<Evidence, { kind: "merchant_order_state" }> {
  if (input.payment.order_id && input.payment.order_id !== input.orderId)
    throw new Error("provider order identity does not match the payment");
  return {
    evidence_id: `merchant-order:${input.orderId}`,
    kind: "merchant_order_state",
    occurred_at: input.receivedAt,
    received_at: input.receivedAt,
    source: "merchant-order-store",
    payload: {
      payment_id: input.payment.id,
      order_id: input.orderId,
      order_state: "pending",
      amount_minor: input.providerOrder.amount,
      currency: input.providerOrder.currency,
      operation: "capture",
      idempotency_key: input.idempotencyKey,
    },
  };
}

export type StagedDemoIncident = {
  incidentId: string;
  paymentId: string;
};

/**
 * Ingest a self-signed captured-payment webhook, then append the pending
 * merchant order evidence so the stored incident carries both sides of the
 * discrepancy.
 */
export async function stageDemoIncident(
  store: IncidentStore,
  input: {
    webhookBody: string;
    webhookSecret: string;
    processorSecret: string;
    eventId: string;
    merchantEvidence: Extract<Evidence, { kind: "merchant_order_state" }>;
    /**
     * Clears the merchant platform's idempotent update acknowledgements for a
     * prior run's execution keys. The incident store cannot reach the merchant
     * tables, so the caller (which owns the merchant connection) provides the
     * eraser; without it a re-staged run would read "already applied" for a
     * repair that no longer holds.
     */
    clearMerchantUpdateAcknowledgements?: (
      executionKeys: string[],
    ) => Promise<void>;
  },
): Promise<StagedDemoIncident> {
  const inbox = new RazorpayWebhookInbox(store);
  const signature = demoSignature(input.webhookBody, input.webhookSecret);
  await inbox.ingest({
    eventId: input.eventId,
    rawBody: input.webhookBody,
    signature,
    webhookSecret: input.webhookSecret,
  });
  const processed = await inbox.process(input.eventId, {
    webhookSecret: input.webhookSecret,
    processorSecret: input.processorSecret,
    tenantId: store.tenantId,
  });
  if (!processed?.incidentId)
    throw new Error("the demo webhook did not produce an incident");
  const incidentId = processed.incidentId;
  const bundle = await store.incident(incidentId);
  if (!bundle) throw new Error("the demo incident was not persisted");
  // Staging the same payment again must be a genuinely fresh rehearsal: a
  // prior run's terminal progress and durable repair records would otherwise
  // be replayed, leaving the freshly staged discrepancy unresolvable.
  const restaged = processed.status === "updated";
  if (restaged) {
    const executionKeys = demoExecutionKeys({
      incidentId,
      paymentId: bundle.payment_id,
      orderId: input.merchantEvidence.payload.order_id,
      idempotencyKey: bundle.idempotency_key,
      tenantId: store.tenantId,
    });
    await store.resetIncidentExecution({ incidentId, executionKeys });
    await input.clearMerchantUpdateAcknowledgements?.(executionKeys);
  }
  const existing = new Map(
    bundle.evidence.map((entry) => [entry.evidence_id, entry]),
  );
  existing.set(input.merchantEvidence.evidence_id, input.merchantEvidence);
  const staged = verifyBundle(
    { ...bundle, evidence: [...existing.values()] },
    input.processorSecret,
  );
  await store.updateIncident(staged);
  if (restaged) {
    // The controller-observed payment state must describe the re-staged
    // discrepancy, not the prior run's verified outcome.
    const seed = derivePaymentSeed(staged);
    if (seed) await store.updatePayment(bundle.payment_id, seed.state);
  }
  return { incidentId, paymentId: bundle.payment_id };
}
