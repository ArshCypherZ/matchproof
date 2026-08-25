import { z } from "zod";

export const MerchantOrderStateSchema = z.enum(["pending", "paid"]);
export type MerchantOrderState = z.infer<typeof MerchantOrderStateSchema>;

const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);

export const MerchantOrderRecordSchema = z
  .object({
    order_id: z.string().min(1).max(128),
    payment_id: z.string().min(1).max(128).nullable(),
    state: MerchantOrderStateSchema,
    amount_minor: z.number().int().safe().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    observed_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type MerchantOrderRecord = z.infer<typeof MerchantOrderRecordSchema>;

export const MerchantOrderUpdateAcknowledgementSchema = z
  .object({
    status: z.enum(["updated", "already_applied"]),
    order_id: z.string().min(1).max(128),
    idempotency_key: idempotencyKeySchema,
    before_state: MerchantOrderStateSchema,
    requested_state: MerchantOrderStateSchema,
    acknowledged_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type MerchantOrderUpdateAcknowledgement = z.infer<
  typeof MerchantOrderUpdateAcknowledgementSchema
>;

export type MerchantOrderUpdateResult = {
  acknowledgement: MerchantOrderUpdateAcknowledgement;
  /** A separate read performed after the write transaction completed. */
  observation: MerchantOrderRecord;
};

export interface MerchantPlatformAdapter {
  fetchOrderState(orderId: string): Promise<MerchantOrderRecord | null>;
  updateOrderState(
    orderId: string,
    newState: MerchantOrderState,
    idempotencyKey: string,
  ): Promise<MerchantOrderUpdateResult>;
  /** Returns pending orders whose last state update is at or before `since`. */
  listPendingOrders(since: Date, limit: number): Promise<MerchantOrderRecord[]>;
}

export class MerchantOrderNotFoundError extends Error {}
export class MerchantStateTransitionError extends Error {}
export class MerchantIdempotencyConflictError extends Error {}
export class MerchantReadAfterWriteError extends Error {}

export function parseOrderId(orderId: string) {
  return z.string().min(1).max(128).parse(orderId);
}

export function parseIdempotencyKey(idempotencyKey: string) {
  return idempotencyKeySchema.parse(idempotencyKey);
}

export function parsePendingQuery(since: Date, limit: number) {
  if (Number.isNaN(since.getTime())) throw new RangeError("since is invalid");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new RangeError("limit must be an integer between 1 and 1000");
  return { since, limit };
}

export function assertAllowedTransition(
  current: MerchantOrderState,
  requested: MerchantOrderState,
) {
  if (current === requested) return;
  if (current === "pending" && requested === "paid") return;
  throw new MerchantStateTransitionError(
    `merchant order transition ${current} -> ${requested} is not allowed`,
  );
}

export function assertReadAfterWrite(
  observation: MerchantOrderRecord | null,
  orderId: string,
  expectedState: MerchantOrderState,
): asserts observation is MerchantOrderRecord {
  if (!observation || observation.state !== expectedState)
    throw new MerchantReadAfterWriteError(
      `merchant order ${orderId} did not verify as ${expectedState}`,
    );
}
