import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { createSqliteDatabase } from "../src/db/sqlite-client";
import { merchantOrders, merchantOrderUpdates } from "../src/db/sqlite-schema";
import { SqliteMerchantPlatformAdapter } from "../src/db/sqlite-merchant-platform-adapter";
import {
  MerchantIdempotencyConflictError,
  MerchantOrderNotFoundError,
  MerchantReadAfterWriteError,
  MerchantStateTransitionError,
} from "../src/db/merchant-platform-adapter";

const now = new Date("2026-08-25T12:00:00.000Z");

describe("merchant platform adapter", () => {
  let connection: ReturnType<typeof createSqliteDatabase>;

  beforeEach(() => {
    connection = createSqliteDatabase(":memory:");
    migrate(connection.db, { migrationsFolder: "drizzle-sqlite" });
  });

  afterEach(() => connection.client.close());

  const seedOrder = (input: {
    orderId: string;
    paymentId?: string;
    state?: "pending" | "paid";
    updatedAt?: string;
  }) => {
    const timestamp = input.updatedAt ?? "2026-08-25T10:00:00.000Z";
    connection.db
      .insert(merchantOrders)
      .values({
        orderId: input.orderId,
        paymentId: input.paymentId ?? null,
        state: input.state ?? "pending",
        amountMinor: 125000,
        currency: "INR",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  };

  it("fetches typed merchant order state and discovers stale pending orders", async () => {
    seedOrder({
      orderId: "merchant_order_old",
      paymentId: "pay_old_001",
      updatedAt: "2026-08-25T09:00:00.000Z",
    });
    seedOrder({
      orderId: "merchant_order_new",
      paymentId: "pay_new_001",
      updatedAt: "2026-08-25T11:30:00.000Z",
    });
    seedOrder({
      orderId: "merchant_order_paid",
      paymentId: "pay_paid_001",
      state: "paid",
      updatedAt: "2026-08-25T08:00:00.000Z",
    });
    const adapter = new SqliteMerchantPlatformAdapter(connection.db, () => now);

    await expect(
      adapter.fetchOrderState("merchant_order_old"),
    ).resolves.toEqual(
      expect.objectContaining({
        order_id: "merchant_order_old",
        payment_id: "pay_old_001",
        state: "pending",
        observed_at: now.toISOString(),
      }),
    );
    await expect(
      adapter.listPendingOrders(new Date("2026-08-25T10:00:00.000Z"), 10),
    ).resolves.toEqual([
      expect.objectContaining({ order_id: "merchant_order_old" }),
    ]);
  });

  it("updates pending to paid and returns a separate read-after-write observation", async () => {
    seedOrder({
      orderId: "merchant_order_update",
      paymentId: "pay_update_001",
    });
    class CountingAdapter extends SqliteMerchantPlatformAdapter {
      reads = 0;
      override async fetchOrderState(orderId: string) {
        this.reads += 1;
        return super.fetchOrderState(orderId);
      }
    }
    const adapter = new CountingAdapter(connection.db, () => now);

    const result = await adapter.updateOrderState(
      "merchant_order_update",
      "paid",
      "merchant:update:001",
    );

    expect(adapter.reads).toBe(1);
    expect(result.acknowledgement).toMatchObject({
      status: "updated",
      before_state: "pending",
      requested_state: "paid",
    });
    expect(result.observation).toMatchObject({
      order_id: "merchant_order_update",
      state: "paid",
      updated_at: now.toISOString(),
    });
  });

  it("replays the same idempotency key without applying a second update", async () => {
    seedOrder({ orderId: "merchant_order_replay" });
    const adapter = new SqliteMerchantPlatformAdapter(connection.db, () => now);

    await adapter.updateOrderState(
      "merchant_order_replay",
      "paid",
      "merchant:replay:001",
    );
    const replay = await adapter.updateOrderState(
      "merchant_order_replay",
      "paid",
      "merchant:replay:001",
    );
    const updates = connection.db.select().from(merchantOrderUpdates).all();

    expect(replay.acknowledgement.status).toBe("already_applied");
    expect(replay.observation.state).toBe("paid");
    expect(updates).toHaveLength(1);
  });

  it("rejects state regression, missing orders, and reused conflicting keys", async () => {
    seedOrder({ orderId: "merchant_order_paid", state: "paid" });
    seedOrder({ orderId: "merchant_order_first" });
    seedOrder({ orderId: "merchant_order_second" });
    const adapter = new SqliteMerchantPlatformAdapter(connection.db, () => now);

    await expect(
      adapter.updateOrderState(
        "merchant_order_paid",
        "pending",
        "merchant:regress:001",
      ),
    ).rejects.toBeInstanceOf(MerchantStateTransitionError);
    await expect(
      adapter.updateOrderState(
        "merchant_order_missing",
        "paid",
        "merchant:missing:001",
      ),
    ).rejects.toBeInstanceOf(MerchantOrderNotFoundError);
    await adapter.updateOrderState(
      "merchant_order_first",
      "paid",
      "merchant:shared:001",
    );
    await expect(
      adapter.updateOrderState(
        "merchant_order_second",
        "paid",
        "merchant:shared:001",
      ),
    ).rejects.toBeInstanceOf(MerchantIdempotencyConflictError);
    expect(
      connection.db
        .select({ state: merchantOrders.state })
        .from(merchantOrders)
        .where(eq(merchantOrders.orderId, "merchant_order_paid"))
        .get()?.state,
    ).toBe("paid");
  });

  it("fails closed when the independent post-repair state observation disagrees", async () => {
    seedOrder({ orderId: "merchant_order_stale" });
    class StaleReadAdapter extends SqliteMerchantPlatformAdapter {
      override async fetchOrderState(orderId: string) {
        const observation = await super.fetchOrderState(orderId);
        return observation
          ? { ...observation, state: "pending" as const }
          : null;
      }
    }
    const adapter = new StaleReadAdapter(connection.db, () => now);

    await expect(
      adapter.updateOrderState(
        "merchant_order_stale",
        "paid",
        "merchant:stale:001",
      ),
    ).rejects.toBeInstanceOf(MerchantReadAfterWriteError);
  });
});
