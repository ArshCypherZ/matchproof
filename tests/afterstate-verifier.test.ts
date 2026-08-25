import { describe, expect, it, vi } from "vitest";
import type { MerchantPlatformAdapter } from "../src/db/merchant-platform-adapter";
import type { AfterstateObservation } from "../src/domain/schemas";
import {
  AfterstateVerifier,
  type ProviderAfterstateAdapter,
} from "../src/incident_commander/afterstate-verifier";

const context = {
  executionKey: "recovery:afterstate-demo-001",
  paymentId: "pay_demo_001",
  orderId: "order_demo_001",
  amountMinor: 125000,
  currency: "INR",
};

const payment = () => ({
  entity: "payment" as const,
  id: context.paymentId,
  status: "captured" as const,
  captured: true,
  amount: context.amountMinor,
  currency: context.currency,
  order_id: context.orderId,
  amount_refunded: 0,
  refund_status: null,
  error_code: null,
  error_description: null,
});

const order = () => ({
  order_id: context.orderId,
  payment_id: context.paymentId,
  state: "paid" as const,
  amount_minor: context.amountMinor,
  currency: context.currency,
  created_at: "2026-08-25T10:00:00.000Z",
  updated_at: "2026-08-25T12:00:00.000Z",
  observed_at: "2026-08-25T12:01:00.000Z",
});

class MemoryAfterstateRepository {
  observations = new Map<string, AfterstateObservation>();

  async afterstateObservation(key: string) {
    return this.observations.get(key);
  }

  async saveAfterstateObservation(
    key: string,
    observation: AfterstateObservation,
  ) {
    if (this.observations.has(key)) return false;
    this.observations.set(key, observation);
    return true;
  }
}

const adapters = () => {
  const provider: ProviderAfterstateAdapter = {
    fetchPayment: vi.fn(async () => payment()),
  };
  const merchant: MerchantPlatformAdapter = {
    fetchOrderState: vi.fn(async () => order()),
    updateOrderState: vi.fn(),
    listPendingOrders: vi.fn(),
  };
  return { provider, merchant };
};

describe("AfterstateVerifier", () => {
  it("verifies and durably records matching fresh observations", async () => {
    const repository = new MemoryAfterstateRepository();
    const { provider, merchant } = adapters();
    const verifier = new AfterstateVerifier(
      repository,
      provider,
      merchant,
      () => new Date("2026-08-25T12:02:00.000Z"),
    );

    const result = await verifier.verify(context);

    expect(result).toMatchObject({
      status: "verified",
      replayed: false,
      reasons: [],
      observation: {
        invariant_holds: true,
        observed_at: "2026-08-25T12:02:00.000Z",
      },
    });
    expect(repository.observations.get(context.executionKey)).toEqual(
      "observation" in result ? result.observation : undefined,
    );
  });

  it("escalates and records identity, state, amount, and currency mismatches", async () => {
    const repository = new MemoryAfterstateRepository();
    const { provider, merchant } = adapters();
    vi.mocked(provider.fetchPayment).mockResolvedValue({
      ...payment(),
      order_id: "order_other_001",
      status: "authorized",
      captured: false,
      amount: 120000,
      currency: "USD",
    });
    vi.mocked(merchant.fetchOrderState).mockResolvedValue({
      ...order(),
      payment_id: "pay_other_001",
      state: "pending",
      amount_minor: 120000,
      currency: "USD",
    });

    const result = await new AfterstateVerifier(
      repository,
      provider,
      merchant,
    ).verify(context);

    expect(result.status).toBe("escalated");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "provider order identity does not match",
        "provider payment is not captured",
        "provider amount does not match",
        "provider currency does not match",
        "merchant payment identity does not match",
        "merchant order is not paid",
        "merchant amount does not match",
        "merchant currency does not match",
      ]),
    );
    expect(
      repository.observations.get(context.executionKey)?.invariant_holds,
    ).toBe(false);
  });

  it("holds when the provider afterstate read fails", async () => {
    const repository = new MemoryAfterstateRepository();
    const { provider, merchant } = adapters();
    vi.mocked(provider.fetchPayment).mockRejectedValue(new Error("timeout"));

    const result = await new AfterstateVerifier(
      repository,
      provider,
      merchant,
    ).verify(context);

    expect(result).toEqual({
      status: "held",
      reasons: ["provider afterstate read failed"],
      replayed: false,
    });
    expect(merchant.fetchOrderState).toHaveBeenCalledOnce();
    expect(repository.observations.size).toBe(0);
  });

  it("holds when the merchant afterstate read fails", async () => {
    const repository = new MemoryAfterstateRepository();
    const { provider, merchant } = adapters();
    vi.mocked(merchant.fetchOrderState).mockRejectedValue(new Error("offline"));

    const result = await new AfterstateVerifier(
      repository,
      provider,
      merchant,
    ).verify(context);

    expect(result).toEqual({
      status: "held",
      reasons: ["merchant afterstate read failed"],
      replayed: false,
    });
    expect(provider.fetchPayment).toHaveBeenCalledOnce();
    expect(repository.observations.size).toBe(0);
  });

  it("replays the durable observation without repeating provider or merchant reads", async () => {
    const repository = new MemoryAfterstateRepository();
    const firstAdapters = adapters();
    const first = new AfterstateVerifier(
      repository,
      firstAdapters.provider,
      firstAdapters.merchant,
    );
    await first.verify(context);

    const restartAdapters = adapters();
    const replay = await new AfterstateVerifier(
      repository,
      restartAdapters.provider,
      restartAdapters.merchant,
    ).verify(context);

    expect(replay).toMatchObject({ status: "verified", replayed: true });
    expect(restartAdapters.provider.fetchPayment).not.toHaveBeenCalled();
    expect(restartAdapters.merchant.fetchOrderState).not.toHaveBeenCalled();
  });
});
