import { CircleCheck, CircleX, ChevronDown } from "lucide-react";
import { formatMoney } from "@/components/shared/format";
import { SourceBadge } from "@/components/shared/source-badge";
import { getRazorpayTestModeSummary } from "@/lib/razorpay";

// The provider call can take up to its timeout window on a cold cache, so
// the band fetches its own summary and streams in behind a Suspense
// boundary. The fallback keeps the collapsed band's exact footprint so the
// queue below never shifts when the real band lands.
export function ProviderEvidenceBandFallback() {
  return (
    <div
      aria-hidden="true"
      className="mt-4 rounded-xl bg-surface px-4 py-3 sm:px-5"
    >
      <div className="flex items-center gap-3">
        <span className="h-5 w-28 animate-pulse rounded-md bg-surface-subtle motion-reduce:animate-none" />
        <span className="h-4 w-44 animate-pulse rounded-md bg-surface-subtle motion-reduce:animate-none" />
      </div>
    </div>
  );
}

export async function ProviderEvidenceBand() {
  const summary = await getRazorpayTestModeSummary();
  // Collapsed by default: this is provider context for the queue below,
  // not the page's primary content, so it must not compete with it. A
  // healthy provider needs no sentence — the source label plus the
  // disclosure affordance say it; only the failure state gets words.
  return (
    <details className="group mt-4 rounded-xl bg-surface">
      <summary className="focus-ring flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-xl px-4 py-3 sm:px-5">
        <SourceBadge source="razorpay_test" />
        {summary.connected ? null : (
          <span className="text-sm font-medium text-warning">
            Provider records are currently unavailable.
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          {/* Names what the band is — provider-side activity for the queue
              below — not a vague recency claim the data never makes. */}
          <span>Provider activity for this queue</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] group-open:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </summary>
      <div className="px-4 pb-4 sm:px-5">
        {summary.connected ? (
          // Each observation reads as a sentence first, in the evidence
          // timeline's voice ("Razorpay webhook received with payment state
          // captured."), with the raw id demoted to a muted mono second
          // line: a pay_/order_ id alone told the operator nothing. Icons
          // mark outcomes only — a check for a settled good state, an x for
          // failures; absence and not-yet states carry no mark, so the icon
          // is never decoration.
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                {summary.captured ? (
                  <CircleCheck
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-provider"
                  />
                ) : null}
                <span className="min-w-0">
                  {summary.captured
                    ? `Captured ${formatMoney(
                        summary.captured.amount,
                        summary.captured.currency,
                      )} via ${summary.captured.method}`
                    : "No captured payment observed."}
                </span>
              </p>
              {summary.captured ? (
                <p
                  className="mt-1 truncate font-data text-xs text-muted-foreground"
                  title={summary.captured.id}
                >
                  {summary.captured.id}
                </p>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                {summary.order?.status === "paid" ? (
                  <CircleCheck
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-provider"
                  />
                ) : null}
                <span className="min-w-0">
                  {summary.order
                    ? `Order ${summary.order.status}`
                    : "No order linked."}
                </span>
              </p>
              {summary.order ? (
                <p
                  className="mt-1 truncate font-data text-xs text-muted-foreground"
                  title={summary.order.id}
                >
                  {summary.order.id}
                </p>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                {summary.failed > 0 ? (
                  <CircleX
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-destructive"
                  />
                ) : (
                  <CircleCheck
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-provider"
                  />
                )}
                <span className="min-w-0">
                  {summary.failed === 0
                    ? "No failed attempts."
                    : `${summary.failed} failed attempt${summary.failed === 1 ? "" : "s"}${
                        summary.latest_failure?.reason
                          ? `, latest: ${summary.latest_failure.reason.replaceAll("_", " ")}`
                          : ""
                      }`}
                </span>
              </p>
              {summary.latest_failure ? (
                <p
                  className="mt-1 truncate font-data text-xs text-muted-foreground"
                  title={summary.latest_failure.id}
                >
                  {summary.latest_failure.id}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="pt-1 text-xs leading-6 text-muted-foreground">
            Provider records are currently unavailable. The queue below still
            shows every recorded exception with its evidence.
          </p>
        )}
      </div>
    </details>
  );
}
