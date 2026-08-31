// The queue filters on a fixed vocabulary of statuses and incident classes.
// A facet value only counts as a filter when it names a real status or
// class; anything else in the URL is a typo, not an intent, and the server
// drops it before the page renders.
export const STATUS_FACETS = [
  "pending",
  "reconciled",
  "escalated",
  "ambiguous",
] as const;

export const CLASS_FACETS = [
  "paid_pending",
  "paid_missing",
  "one_payment_two_orders",
  "capture_timeout",
  "callback_missing_webhook_recovers",
  "webhook_delivery_failure",
  "late_authorized",
  "settlement_exception",
] as const;

export function normalizeFacet<T extends string>(
  raw: string | undefined,
  valid: readonly T[],
): T | undefined {
  if (raw === undefined) return undefined;
  return (valid as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

// The facet keys that travel between the queue, the record rows, and the
// workbench pager. Page and page size are queue-only concerns and never
// follow a row onto the workbench.
export const FACET_KEYS = ["status", "class", "q"] as const;

// Serialize the current facet state into a query string so a record row and
// its neighbors stay inside the same filtered view the operator is working.
export function facetQuery(params: URLSearchParams): string {
  const next = new URLSearchParams();
  for (const key of FACET_KEYS) {
    const raw = params.get(key);
    if (raw) next.set(key, raw);
  }
  const text = next.toString();
  return text ? `?${text}` : "";
}
