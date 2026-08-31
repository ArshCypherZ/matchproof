import "server-only";

import {
  fetchTestModeOrderStatus,
  listTestModePayments,
} from "../../../src/incident_commander/razorpay";

const SUMMARY_TTL_MS = 30_000;
const SUMMARY_TIMEOUT_MS = 2_500;
const DISCONNECTED_TTL_MS = 5_000;

type RazorpayTestModeSummary = Awaited<ReturnType<typeof loadSummary>>;

const disconnectedSummary = {
  connected: false as const,
  observed: 0,
  captured: null,
  order: null,
  failed: 0,
  latest_failure: null,
};

let summaryCache:
  { at: number; ttl: number; value: RazorpayTestModeSummary } | undefined;

async function loadSummary() {
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
    return disconnectedSummary;
  }
}

export async function getRazorpayTestModeSummary() {
  const now = Date.now();
  if (summaryCache && now - summaryCache.at < summaryCache.ttl)
    return summaryCache.value;
  // The Razorpay SDK has no request timeout; without this bound a slow
  // provider response would stall every page that renders the evidence band.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof disconnectedSummary>((resolve) => {
    timer = setTimeout(() => resolve(disconnectedSummary), SUMMARY_TIMEOUT_MS);
  });
  const value = await Promise.race([loadSummary(), timeout]);
  if (timer) clearTimeout(timer);
  summaryCache = {
    at: now,
    ttl: value.connected ? SUMMARY_TTL_MS : DISCONNECTED_TTL_MS,
    value,
  };
  return value;
}
