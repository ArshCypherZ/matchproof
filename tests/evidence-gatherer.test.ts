import { describe, expect, it } from "vitest";
import { EvidenceGatherer } from "../src/incident_commander/evidence-gatherer";
import type { RazorpayClient } from "../src/incident_commander/razorpay";

const payment = {
  id: "pay_test_1",
  status: "captured" as const,
  captured: true,
  amount: 12500,
  currency: "INR",
  order_id: "order_test_1",
  amount_refunded: 0,
  refund_status: null,
  error_code: null,
  error_description: null,
};

const order = {
  id: "order_test_1",
  status: "paid" as const,
  amount: 12500,
  amount_paid: 12500,
  amount_due: 0,
  currency: "INR",
  attempts: 1,
};

function client(overrides: Partial<RazorpayClient> = {}) {
  return {
    orders: {
      create: async () => ({}),
      fetch: async () => order,
      fetchPayments: async () => ({ count: 0, items: [] }),
      ...overrides.orders,
    },
    payments: {
      fetch: async () => payment,
      all: async () => ({ items: [] }),
      ...overrides.payments,
    },
  } as RazorpayClient;
}

describe("EvidenceGatherer", () => {
  it("fetches payment and its linked order as validated evidence", async () => {
    const result = await new EvidenceGatherer({
      client: client(),
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    }).gather({
      paymentId: "pay_test_1",
      idempotencyKey: "gather-test-001",
    });

    expect(result.map((entry) => entry.kind)).toEqual([
      "provider_payment_fetch",
      "provider_order_fetch",
    ]);
    expect(result[0]).toMatchObject({
      source: "processor-api",
      payload: {
        result: "success",
        payment_id: "pay_test_1",
        order_id: "order_test_1",
        freshness_ms: 0,
      },
    });
    expect(result[1]).toMatchObject({
      payload: { result: "success", order_id: "order_test_1" },
    });
  });

  it("records provider failures and timeouts as evidence", async () => {
    const result = await new EvidenceGatherer({
      timeoutMs: 10,
      client: client({
        payments: {
          fetch: () => new Promise(() => undefined),
          all: async () => ({ items: [] }),
        },
      }),
    }).gather({
      paymentId: "pay_test_1",
      idempotencyKey: "gather-test-002",
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "provider_payment_fetch",
      payload: {
        result: "error",
        error_code: "provider_timeout",
        timeout: true,
        idempotency_key: "gather-test-002",
      },
    });
  });

  it("does not call a live-mode default client", async () => {
    const originalKey = process.env.RAZORPAY_API_KEY;
    const originalSecret = process.env.RAZORPAY_API_SECRET;
    process.env.RAZORPAY_API_KEY = "rzp_live_forbidden";
    process.env.RAZORPAY_API_SECRET = "secret";
    try {
      await expect(
        new EvidenceGatherer().gather({
          paymentId: "pay_test_1",
          idempotencyKey: "gather-test-003",
        }),
      ).rejects.toThrow("Razorpay Test Mode credentials are required");
    } finally {
      if (originalKey === undefined) delete process.env.RAZORPAY_API_KEY;
      else process.env.RAZORPAY_API_KEY = originalKey;
      if (originalSecret === undefined) delete process.env.RAZORPAY_API_SECRET;
      else process.env.RAZORPAY_API_SECRET = originalSecret;
    }
  });
});
