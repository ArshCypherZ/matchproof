import { describe, expect, it, vi } from "vitest";
import type { MerchantPlatformAdapter } from "../src/db/merchant-platform-adapter";
import type {
  RecoveryAttempt,
  RecoveryInput,
  RecoveryRecord,
} from "../src/db/repository";
import {
  RecoveryExecutor,
  recoveryExecutionKey,
} from "../src/incident_commander/recovery-executor";

const allowed = {
  action: "reconcile_internal_state" as const,
  allowed: true,
  reason: "approved",
  approval_required: null,
};
const context = {
  tenantId: "tenant_demo",
  incidentId: "inc_demo_001",
  paymentId: "pay_demo_001",
  orderId: "order_demo_001",
  beforeState: "pending" as const,
  targetState: "paid" as const,
};

class MemoryRecoveryRepository {
  attempts = new Map<string, RecoveryAttempt>();
  recoveries = new Map<string, RecoveryRecord>();

  async recovery(key: string) {
    return this.recoveries.get(key);
  }
  async recoveryAttempt(key: string) {
    return this.attempts.get(key);
  }
  async startRecoveryAttempt(input: RecoveryAttempt) {
    const existing = this.attempts.get(input.execution_key);
    if (existing && existing.status !== "failed") return false;
    // Mirrors the durable repositories: only a failed attempt is re-claimable,
    // so an in-progress or succeeded execution stays owned by its caller.
    this.attempts.set(input.execution_key, input);
    return true;
  }
  async completeRecoveryAttempt(
    key: string,
    input: Pick<
      RecoveryAttempt,
      "status" | "after_state" | "error" | "completed_at"
    >,
  ) {
    this.attempts.set(key, { ...this.attempts.get(key)!, ...input });
  }
  async completeRecovery(key: string, input: RecoveryInput) {
    this.recoveries.set(key, { execution_key: key, ...input });
  }
}

const merchant = (): MerchantPlatformAdapter => ({
  fetchOrderState: vi.fn(),
  listPendingOrders: vi.fn(),
  updateOrderState: vi.fn(async (orderId, state, idempotencyKey) => ({
    acknowledgement: {
      status: "updated" as const,
      order_id: orderId,
      idempotency_key: idempotencyKey,
      before_state: "pending" as const,
      requested_state: state,
      acknowledged_at: "2026-08-25T12:00:00.000Z",
    },
    observation: {
      order_id: orderId,
      payment_id: context.paymentId,
      state,
      amount_minor: 125000,
      currency: "INR",
      created_at: "2026-08-25T10:00:00.000Z",
      updated_at: "2026-08-25T12:00:00.000Z",
      observed_at: "2026-08-25T12:00:00.000Z",
    },
  })),
});

describe("RecoveryExecutor", () => {
  it("hashes canonical execution identity consistently", () => {
    const first = recoveryExecutionKey(allowed, context);
    expect(first).toMatch(/^recovery:[a-f0-9]{64}$/);
    expect(recoveryExecutionKey({ ...allowed }, { ...context })).toBe(first);
    expect(
      recoveryExecutionKey(allowed, { ...context, orderId: "order_demo_002" }),
    ).not.toBe(first);
  });

  it("rejects policy bypass and unsupported allowed actions", async () => {
    const executor = new RecoveryExecutor(
      new MemoryRecoveryRepository(),
      merchant(),
    );
    await expect(
      executor.execute({ ...allowed, allowed: false }, context),
    ).rejects.toThrow("allowed policy decision");
    await expect(
      executor.execute({ ...allowed, action: "retry_safe_read" }, context),
    ).rejects.toThrow("is not supported");
  });

  it("records success and suppresses completed duplicate execution", async () => {
    const repository = new MemoryRecoveryRepository();
    const adapter = merchant();
    const executor = new RecoveryExecutor(repository, adapter);
    const first = await executor.execute(allowed, context);
    const duplicate = await executor.execute(allowed, context);

    expect(first.status).toBe("reconciled");
    expect(duplicate.status).toBe("already_completed");
    expect(adapter.updateOrderState).toHaveBeenCalledTimes(1);
    expect(repository.attempts.get(first.idempotency_key)).toMatchObject({
      status: "succeeded",
      before_state: "pending",
      after_state: "paid",
    });
  });

  it("records adapter failure and retries the same idempotent execution afterwards", async () => {
    const repository = new MemoryRecoveryRepository();
    const adapter = merchant();
    vi.mocked(adapter.updateOrderState).mockRejectedValueOnce(
      new Error("timeout"),
    );
    const executor = new RecoveryExecutor(repository, adapter);

    await expect(executor.execute(allowed, context)).rejects.toThrow("timeout");
    expect([...repository.attempts.values()][0]).toMatchObject({
      status: "failed",
      error: "timeout",
    });

    // A failed attempt is a recorded fact, not a terminal state: the next
    // execution re-claims it under the same idempotency key, so the merchant
    // acknowledgement still guards against a double write.
    const retried = await executor.execute(allowed, context);
    expect(retried.status).toBe("reconciled");
    expect(adapter.updateOrderState).toHaveBeenCalledTimes(2);
    const keys = vi
      .mocked(adapter.updateOrderState)
      .mock.calls.map((call) => call[2]);
    expect(new Set(keys).size).toBe(1);
    expect(repository.attempts.get(retried.idempotency_key)).toMatchObject({
      status: "succeeded",
    });
  });

  it("allows a single concurrent caller to claim the adapter execution", async () => {
    const repository = new MemoryRecoveryRepository();
    const adapter = merchant();
    let release!: () => void;
    vi.mocked(adapter.updateOrderState).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              merchant().updateOrderState(
                context.orderId,
                context.targetState,
                recoveryExecutionKey(allowed, context),
              ),
            );
        }),
    );
    const executor = new RecoveryExecutor(repository, adapter);
    const first = executor.execute(allowed, context);
    await expect(executor.execute(allowed, context)).rejects.toThrow(
      "already in progress",
    );
    release();
    await expect(first).resolves.toMatchObject({ status: "reconciled" });
    expect(adapter.updateOrderState).toHaveBeenCalledTimes(1);
  });
});
