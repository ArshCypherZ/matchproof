import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MerchantOrderRecord } from "../src/db/merchant-platform-adapter";
import type { IncidentBundle } from "../src/domain/schemas";
import {
  EvidenceError,
  processorSignature,
  reconcile,
  verifyBundle,
} from "../src/incident_commander/core";

const secret = "test-prototype-secret";
const load = (name: string) =>
  verifyBundle(
    JSON.parse(fs.readFileSync(path.resolve(`fixtures/${name}.json`), "utf8")),
    secret,
  );

const merchantRecord = (
  orderId: string,
  paymentId: string | null,
  state: "pending" | "paid",
  amountMinor = 125000,
  currency = "INR",
): MerchantOrderRecord => ({
  order_id: orderId,
  payment_id: paymentId,
  state,
  amount_minor: amountMinor,
  currency,
  created_at: "2026-08-21T09:59:00.000Z",
  updated_at: "2026-08-21T10:00:05.100Z",
  observed_at: "2026-08-21T10:00:08.000Z",
});

const resignWebhooks = (bundle: IncidentBundle) => {
  for (const entry of bundle.evidence)
    if (entry.kind === "processor_webhook")
      entry.processor_signature = processorSignature(entry.payload, secret);
  return bundle;
};

describe("rule-based reconciliation", () => {
  it("compares exact provider and merchant invariants", () => {
    const result = reconcile(load("timeout_after_mutation"));
    expect(result).toMatchObject({
      incident_class: "capture_timeout",
      provider_state: "captured_verified",
      merchant_state: "pending",
      resolution: "reconcile_internal_state",
      rule_based_resolution: true,
    });
    expect(result.invariant_results).toMatchObject({
      identity: true,
      amount: true,
      currency: true,
      chronology: true,
      authenticity: true,
    });
  });

  it.each([
    ["paid_pending", "paid_pending", "reconcile_internal_state"],
    ["paid_missing", "paid_missing", "escalate"],
    ["one_payment_two_orders", "one_payment_two_orders", "escalate"],
    [
      "callback_missing_webhook_recovers",
      "callback_missing_webhook_recovers",
      "escalate",
    ],
    ["webhook_delivery_failure", "webhook_delivery_failure", "escalate"],
    ["late_authorized", "late_authorized", "reconcile_internal_state"],
    ["timeout_after_mutation", "capture_timeout", "reconcile_internal_state"],
    ["settlement_exception", "settlement_exception", "escalate"],
  ] as const)("covers %s by rule", (fixture, incidentClass, resolution) => {
    const result = reconcile(load(fixture));
    expect(result.incident_class).toBe(incidentClass);
    expect(result.resolution).toBe(resolution);
  });

  it("proves no action is required when paid provider and merchant agree", () => {
    const bundle = load("paid_pending");
    const order = bundle.evidence.find(
      (entry) => entry.kind === "merchant_order_state",
    );
    if (!order || order.kind !== "merchant_order_state")
      throw new Error("fixture order missing");
    order.payload.order_state = "paid";
    const result = reconcile(bundle);
    expect(result.incident_class).toBe("none");
    expect(result.status).toBe("agreed");
    expect(result.resolution).toBe("no_action_required");
  });

  it("uses T-007 merchant records and requires exact minor-unit amount", () => {
    const bundle = load("timeout_after_mutation");
    const result = reconcile(bundle, [
      merchantRecord("order_exact_001", bundle.payment_id, "pending", 125001),
    ]);
    expect(result.invariant_results.amount).toBe(false);
    expect(result.discrepancies).toContain("amount_mismatch");
    expect(result.resolution).toBe("escalate");
  });

  it("rejects currency drift without conversion or rounding", () => {
    const bundle = load("timeout_after_mutation");
    const result = reconcile(bundle, [
      merchantRecord(
        "order_currency_001",
        bundle.payment_id,
        "pending",
        125000,
        "USD",
      ),
    ]);
    expect(result.invariant_results.currency).toBe(false);
    expect(result.discrepancies).toContain("currency_mismatch");
    expect(result.resolution).toBe("escalate");
  });

  it("detects one payment mapped to two orders", () => {
    const bundle = load("timeout_after_mutation");
    const result = reconcile(bundle, [
      merchantRecord("order_one_001", bundle.payment_id, "pending"),
      merchantRecord("order_two_001", bundle.payment_id, "pending"),
    ]);
    expect(result.incident_class).toBe("one_payment_two_orders");
    expect(result.discrepancies).toContain("one_payment_two_orders");
    expect(result.resolution).toBe("escalate");
  });

  it("detects multiple payments mapped to one order", () => {
    const bundle = load("timeout_after_mutation");
    const result = reconcile(bundle, [
      merchantRecord("order_shared_001", bundle.payment_id, "pending"),
      merchantRecord("order_shared_001", "pay_other_001", "pending"),
    ]);
    expect(result.discrepancies).toContain("multiple_payments_one_order");
    expect(result.invariant_results.uniqueness).toBe(false);
    expect(result.resolution).toBe("escalate");
  });

  it("rejects forged signatures before reconciliation", () => {
    const bundle = JSON.parse(
      fs.readFileSync(path.resolve("fixtures/paid_pending.json"), "utf8"),
    );
    bundle.evidence[0].processor_signature = "forged";
    expect(() => verifyBundle(bundle, secret)).toThrow(EvidenceError);
  });

  it("suppresses replayed event IDs and ignores older reordered provider events", () => {
    const bundle = load("timeout_after_mutation");
    const result = reconcile(bundle);
    expect(result.provider_state).toBe("captured_verified");
    expect(result.provider_evidence_ids).toEqual([
      "EV-WEBHOOK-001",
      "EV-WEBHOOK-002",
    ]);
    expect(result.resolution).toBe("reconcile_internal_state");
  });

  it("treats provider read failure after capture timeout as unknown", () => {
    const source = load("timeout_after_mutation");
    const bundle = verifyBundle(
      {
        ...source,
        evidence: source.evidence
          .filter((entry) => entry.kind !== "processor_webhook")
          .concat({
            evidence_id: "EV-FETCH-TIMEOUT",
            kind: "provider_payment_fetch",
            occurred_at: "2026-08-21T10:00:09.000Z",
            received_at: "2026-08-21T10:00:09.000Z",
            source: "processor-api",
            payload: {
              payment_id: source.payment_id,
              result: "error",
              error_code: "ETIMEDOUT",
              error_message: "provider read timed out",
              timeout: true,
              operation: "read",
              idempotency_key: source.idempotency_key,
            },
          }),
      },
      secret,
    );
    const result = reconcile(bundle);
    expect(result.provider_state).toBe("unknown");
    expect(result.discrepancies).toContain("capture_outcome_unknown");
    expect(result.resolution).toBe("escalate");
  });

  it("treats stale provider fetches as non-repairable evidence", () => {
    const bundle = load("paid_pending");
    const webhook = bundle.evidence.find(
      (entry) => entry.kind === "processor_webhook",
    );
    if (!webhook || webhook.kind !== "processor_webhook")
      throw new Error("fixture webhook missing");
    bundle.evidence.push({
      evidence_id: "EV-STALE-FETCH",
      kind: "provider_payment_fetch",
      occurred_at: "2026-08-21T10:00:04.000Z",
      received_at: "2026-08-21T10:00:04.000Z",
      source: "processor-api",
      payload: {
        result: "success",
        payment_id: bundle.payment_id,
        status: "captured",
        captured: true,
        amount_minor: webhook.payload.amount_minor,
        currency: webhook.payload.currency,
        order_id: null,
        amount_refunded: 0,
        refund_status: null,
        error_code: null,
        error_description: null,
        fetched_at: "2026-08-21T10:00:04.000Z",
        freshness_ms: 600_001,
        operation: "read",
        idempotency_key: bundle.idempotency_key,
      },
    });
    const result = reconcile(bundle);
    expect(result.discrepancies).toContain("stale_evidence");
    expect(result.resolution).toBe("escalate");
  });

  it("escalates contradictory captured and failed provider outcomes", () => {
    const bundle = load("paid_pending");
    const captured = bundle.evidence.find(
      (entry) => entry.kind === "processor_webhook",
    );
    if (!captured || captured.kind !== "processor_webhook")
      throw new Error("fixture webhook missing");
    const failedPayload = {
      ...captured.payload,
      event_id: "evt_failed_after_capture_001",
      event_type: "payment.failed" as const,
      payment_state: "failed" as const,
      operation: "authorize" as const,
    };
    const unsafeBundle = resignWebhooks({
      ...bundle,
      evidence: [
        ...bundle.evidence,
        {
          ...captured,
          evidence_id: "EV-FAILED-AFTER-CAPTURE",
          occurred_at: "2026-08-21T10:00:04.000Z",
          received_at: "2026-08-21T10:00:04.000Z",
          payload: failedPayload,
          processor_signature: processorSignature(failedPayload, secret),
        },
      ],
    });
    expect(() => verifyBundle(unsafeBundle, secret)).toThrow(
      "contradictory processor outcomes",
    );
    const result = reconcile(unsafeBundle);
    expect(result.discrepancies).toContain("contradictory_provider_state");
    expect(result.resolution).toBe("escalate");
  });

  it("does not repair provider failure against fulfilled merchant state", () => {
    const bundle = load("paid_pending");
    const webhook = bundle.evidence.find(
      (entry) => entry.kind === "processor_webhook",
    );
    const order = bundle.evidence.find(
      (entry) => entry.kind === "merchant_order_state",
    );
    if (
      !webhook ||
      webhook.kind !== "processor_webhook" ||
      !order ||
      order.kind !== "merchant_order_state"
    )
      throw new Error("fixture evidence missing");
    const failedPayload = {
      ...webhook.payload,
      event_id: "evt_failed_merchant_fulfilled",
      event_type: "payment.failed" as const,
      payment_state: "failed" as const,
      operation: "authorize" as const,
    };
    webhook.payload = failedPayload;
    webhook.processor_signature = processorSignature(failedPayload, secret);
    order.payload.order_state = "fulfilled";
    const result = reconcile(bundle);
    expect(result.discrepancies).toContain(
      "provider_failed_merchant_fulfilled",
    );
    expect(result.resolution).toBe("escalate");
  });
});
