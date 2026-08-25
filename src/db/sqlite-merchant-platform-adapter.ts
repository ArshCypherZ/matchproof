import { and, asc, eq, lte } from "drizzle-orm";
import type { SqliteDatabase } from "./sqlite-client";
import { merchantOrders, merchantOrderUpdates } from "./sqlite-schema";
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
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    observed_at: observedAt.toISOString(),
  });

export class SqliteMerchantPlatformAdapter implements MerchantPlatformAdapter {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchOrderState(orderId: string) {
    const parsedOrderId = parseOrderId(orderId);
    const [row] = this.db
      .select()
      .from(merchantOrders)
      .where(eq(merchantOrders.orderId, parsedOrderId))
      .limit(1)
      .all();
    return row ? asOrder(row, this.now()) : null;
  }

  async listPendingOrders(since: Date, limit: number) {
    const query = parsePendingQuery(since, limit);
    const observedAt = this.now();
    const rows = this.db
      .select()
      .from(merchantOrders)
      .where(
        and(
          eq(merchantOrders.state, "pending"),
          lte(merchantOrders.updatedAt, query.since.toISOString()),
        ),
      )
      .orderBy(asc(merchantOrders.updatedAt), asc(merchantOrders.orderId))
      .limit(query.limit)
      .all();
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
    const acknowledgement = this.db.transaction((tx) => {
      const [order] = tx
        .select()
        .from(merchantOrders)
        .where(eq(merchantOrders.orderId, parsedOrderId))
        .limit(1)
        .all();
      if (!order)
        throw new MerchantOrderNotFoundError(
          `merchant order ${parsedOrderId} was not found`,
        );

      const [existing] = tx
        .select()
        .from(merchantOrderUpdates)
        .where(eq(merchantOrderUpdates.idempotencyKey, parsedKey))
        .limit(1)
        .all();
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
          acknowledged_at: existing.acknowledgedAt,
        });
      }

      const beforeState = MerchantOrderStateSchema.parse(order.state);
      assertAllowedTransition(beforeState, parsedState);
      const acknowledgedAt = this.now().toISOString();
      if (beforeState !== parsedState)
        tx.update(merchantOrders)
          .set({ state: parsedState, updatedAt: acknowledgedAt })
          .where(eq(merchantOrders.orderId, parsedOrderId))
          .run();
      tx.insert(merchantOrderUpdates)
        .values({
          idempotencyKey: parsedKey,
          orderId: parsedOrderId,
          requestedState: parsedState,
          beforeState,
          afterState: parsedState,
          acknowledgedAt,
        })
        .run();
      return MerchantOrderUpdateAcknowledgementSchema.parse({
        status: beforeState === parsedState ? "already_applied" : "updated",
        order_id: parsedOrderId,
        idempotency_key: parsedKey,
        before_state: beforeState,
        requested_state: parsedState,
        acknowledged_at: acknowledgedAt,
      });
    });

    const observation = await this.fetchOrderState(parsedOrderId);
    assertReadAfterWrite(observation, parsedOrderId, parsedState);
    return { acknowledgement, observation };
  }
}
