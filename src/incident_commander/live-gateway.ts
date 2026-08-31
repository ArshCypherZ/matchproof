import {
  fetchTestModeOrderStatus,
  fetchTestModePaymentStatus,
  listTestModePayments,
  type RazorpayClient,
} from "./razorpay";
import { RazorpayMcpReadGateway } from "./razorpay-mcp";
import type { RazorpayMcpTransport } from "./razorpay-mcp";

/**
 * Tier 1 tool surface: every read the cluster investigator may request is a
 * real Razorpay Test-mode REST call through the official SDK. `search_events`
 * maps to the payment collection listing, which is the closest read-only
 * provider surface for delivery evidence available in Test mode.
 */
export const liveTestModeTransport =
  (client?: RazorpayClient): RazorpayMcpTransport =>
  async ({ tool, input }) => {
    if (tool === "fetch_payment") {
      const paymentId = input.payment_id;
      if (typeof paymentId !== "string")
        throw new Error("payment_id is required");
      return await fetchTestModePaymentStatus(paymentId, client);
    }
    if (tool === "fetch_order") {
      const orderId = input.order_id;
      if (typeof orderId !== "string") throw new Error("order_id is required");
      return await fetchTestModeOrderStatus(orderId, client);
    }
    if (tool === "search_events") {
      const requested = input.count;
      const count =
        typeof requested === "number" && Number.isInteger(requested)
          ? Math.min(100, Math.max(1, requested))
          : 20;
      return await listTestModePayments(count, client);
    }
    throw new Error(`unsupported read tool ${tool}`);
  };

export class LiveRazorpayReadGateway extends RazorpayMcpReadGateway {
  constructor(
    client?: RazorpayClient,
    options: { timeoutMs?: number; now?: () => Date } = {},
  ) {
    super(liveTestModeTransport(client), options.timeoutMs, options.now);
  }
}
