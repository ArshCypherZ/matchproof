import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Database } from "./client";
import { merchantOrders, merchantOrderUpdates } from "./schema";
import {
  MerchantIdempotencyConflictError,
  MerchantOrderNotFoundError,
  MerchantOrderRecordSchema,
  MerchantOrderStateSchema,
  MerchantOrderUpdateAcknowledgementSchema,
  assertAllowedTransition,
  assertReadAfterWrite,
  parseIdempotencyKey,
  parseOrderId,
  parsePendingQuery,
  type MerchantOrderRecord,
  type MerchantOrderState,
  type MerchantPlatformAdapter,
} from "./merchant-platform-adapter";

const asOrder = (
  row: typeof merchantOrders.$inferSelect,
  observedAt: Date,
): MerchantOrderRecord =>
  MerchantOrderRecordSchema.parse({
    order_id: row.orderId,
    payment_id: row.paymentId,
    state: row.state,
    amount_minor: row.amountMinor,
    currency: row.currency,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    observed_at: observedAt.toISOString(),
  });

export class PostgresMerchantPlatformAdapter implements MerchantPlatformAdapter {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchOrderState(orderId: string) {
    const parsedOrderId = parseOrderId(orderId);
    const [row] = await this.db
      .select()
      .from(merchantOrders)
      .where(eq(merchantOrders.orderId, parsedOrderId))
      .limit(1);
    return row ? asOrder(row, this.now()) : null;
  }

  async listPendingOrders(since: Date, limit: number) {
    const query = parsePendingQuery(since, limit);
    const observedAt = this.now();
    const rows = await this.db
      .select()
      .from(merchantOrders)
      .where(
        and(
          eq(merchantOrders.state, "pending"),
          lte(merchantOrders.updatedAt, query.since),
        ),
      )
      .orderBy(asc(merchantOrders.updatedAt), asc(merchantOrders.orderId))
      .limit(query.limit);
    return rows.map((row) => asOrder(row, observedAt));
  }

  async updateOrderState(
    orderId: string,
    newState: MerchantOrderState,
    idempotencyKey: string,
  ) {
    const parsedOrderId = parseOrderId(orderId);
    const parsedState = MerchantOrderStateSchema.parse(newState);
    const parsedKey = parseIdempotencyKey(idempotencyKey);
    const acknowledgement = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${parsedKey}))`,
      );
      const [order] = await tx
        .select()
        .from(merchantOrders)
        .where(eq(merchantOrders.orderId, parsedOrderId))
        .limit(1)
        .for("update");
      if (!order)
        throw new MerchantOrderNotFoundError(
          `merchant order ${parsedOrderId} was not found`,
        );

      const [existing] = await tx
        .select()
        .from(merchantOrderUpdates)
        .where(eq(merchantOrderUpdates.idempotencyKey, parsedKey))
        .limit(1);
      if (existing) {
        if (
          existing.orderId !== parsedOrderId ||
          existing.requestedState !== parsedState
        )
          throw new MerchantIdempotencyConflictError(
            `idempotency key ${parsedKey} belongs to another merchant update`,
          );
        return MerchantOrderUpdateAcknowledgementSchema.parse({
          status: "already_applied",
          order_id: parsedOrderId,
          idempotency_key: parsedKey,
          before_state: existing.beforeState,
          requested_state: existing.requestedState,
          acknowledged_at: existing.acknowledgedAt.toISOString(),
        });
      }

      const beforeState = MerchantOrderStateSchema.parse(order.state);
      assertAllowedTransition(beforeState, parsedState);
      const acknowledgedAt = this.now();
      if (beforeState !== parsedState)
        await tx
          .update(merchantOrders)
          .set({ state: parsedState, updatedAt: acknowledgedAt })
          .where(eq(merchantOrders.orderId, parsedOrderId));
      await tx.insert(merchantOrderUpdates).values({
        idempotencyKey: parsedKey,
        orderId: parsedOrderId,
        requestedState: parsedState,
        beforeState,
        afterState: parsedState,
        acknowledgedAt,
      });
      return MerchantOrderUpdateAcknowledgementSchema.parse({
        status: beforeState === parsedState ? "already_applied" : "updated",
        order_id: parsedOrderId,
        idempotency_key: parsedKey,
        before_state: beforeState,
        requested_state: parsedState,
        acknowledged_at: acknowledgedAt.toISOString(),
      });
    });

    const observation = await this.fetchOrderState(parsedOrderId);
    assertReadAfterWrite(observation, parsedOrderId, parsedState);
    return { acknowledgement, observation };
  }
}
