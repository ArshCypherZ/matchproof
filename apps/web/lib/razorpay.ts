import "server-only";

import {
  fetchTestModeOrderStatus,
  listTestModePayments,
} from "../../../src/incident_commander/razorpay";

const SUMMARY_TTL_MS = 30_000;
const SUMMARY_TIMEOUT_MS = 2_500;
const DISCONNECTED_TTL_MS = 5_000;
/* A transient provider blip (one dropped request, a slow cold response) must
   not flip the band to "unavailable" while a fresh-enough read exists: the
   last connected summary keeps serving for up to this long as refreshes
   retry. Past it, the honest unavailable state returns — the band must not
   present hours-old records as current activity. */
const STALE_CONNECTED_TTL_MS = 180_000;

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
let lastConnected:
  | { at: number; value: Extract<RazorpayTestModeSummary, { connected: true }> }
  | undefined;
let inFlight: Promise<RazorpayTestModeSummary> | undefined;

async function loadSummary() {
  try {
    // One retry: a single dropped request is a blip, not an outage, and the
    // list call is cheap. A second failure falls through to disconnected.
    let collection;
    try {
      collection = await listTestModePayments(25);
    } catch {
      collection = await listTestModePayments(25);
    }
    const tagged = collection.items.filter(
      (payment) => payment.notes?.source === "Razorpay Test mode",
    );
    const payments = tagged.length ? tagged : collection.items;
    const captured = payments.find(
      (payment) => payment.status === "captured" && payment.captured,
    );
    const failed = payments.filter((payment) => payment.status === "failed");
    // The order fetch is secondary context beside the payment list that
    // already succeeded: its failure must not read as the provider being
    // unavailable, so it degrades to "no order observed" instead.
    let order = null;
    if (captured?.order_id) {
      try {
        order = await fetchTestModeOrderStatus(captured.order_id);
      } catch {
        order = null;
      }
    }

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

function startRefresh() {
  // Single flight: concurrent renders share one provider call instead of
  // stampeding the API behind one evidence band.
  inFlight = loadSummary()
    .then((value) => {
      // Late success is still evidence: a response slower than the render
      // bound lands in the cache for the next render instead of being
      // thrown away — the "sometimes unavailable" flicker.
      const at = Date.now();
      summaryCache = {
        at,
        ttl: value.connected ? SUMMARY_TTL_MS : DISCONNECTED_TTL_MS,
        value,
      };
      if (value.connected) lastConnected = { at, value };
      return value;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

export async function getRazorpayTestModeSummary() {
  const now = Date.now();
  if (summaryCache && now - summaryCache.at < summaryCache.ttl) {
    // A cached "unavailable" never outranks a fresh-enough connected read:
    // the blip that produced it should not erase the provider activity the
    // operator already saw on the last render.
    if (
      summaryCache.value.connected ||
      !lastConnected ||
      now - lastConnected.at >= STALE_CONNECTED_TTL_MS
    )
      return summaryCache.value;
    return lastConnected.value;
  }
  // The Razorpay SDK has no request timeout; without this bound a slow
  // provider response would stall every page that renders the evidence band.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), SUMMARY_TIMEOUT_MS);
  });
  const value = await Promise.race([startRefresh(), timeout]);
  if (timer) clearTimeout(timer);
  if (value) return value;
  // The refresh is still running past the render bound: keep the band on
  // the last connected summary while it stays fresh enough, else say so.
  if (lastConnected && now - lastConnected.at < STALE_CONNECTED_TTL_MS)
    return lastConnected.value;
  return disconnectedSummary;
}
