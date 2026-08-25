import "server-only";

import {
  fetchTestModeOrderStatus,
  listTestModePayments,
} from "../../../src/incident_commander/razorpay";

export async function getRazorpayTestModeSummary() {
  try {
    const collection = await listTestModePayments(25);
    const tagged = collection.items.filter(
      (payment) => payment.notes?.source === "Razorpay Test mode",
    );
    const payments = tagged.length ? tagged : collection.items;
    const captured = payments.find(
      (payment) => payment.status === "captured" && payment.captured,
    );
    const failed = payments.filter((payment) => payment.status === "failed");
    const order = captured?.order_id
      ? await fetchTestModeOrderStatus(captured.order_id)
      : null;

    return {
      connected: true as const,
      observed: payments.length,
      captured: captured
        ? {
            id: captured.id,
            amount: captured.amount,
            currency: captured.currency,
            method: captured.method,
          }
        : null,
      order,
      failed: failed.length,
      latest_failure: failed[0]
        ? { id: failed[0].id, reason: failed[0].error_reason }
        : null,
    };
  } catch {
    return {
      connected: false as const,
      observed: 0,
      captured: null,
      order: null,
      failed: 0,
      latest_failure: null,
    };
  }
}
