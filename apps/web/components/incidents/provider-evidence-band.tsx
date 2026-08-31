import { CircleCheck, CircleX, ChevronDown, Radio } from "lucide-react";
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
      className="mt-5 border-l-2 border-provider bg-surface-raised px-4 py-3 sm:px-5"
    >
      <div className="flex items-center gap-3">
        <span className="h-5 w-28 animate-pulse rounded-sm bg-surface-subtle motion-reduce:animate-none" />
        <span className="h-4 w-44 animate-pulse rounded-sm bg-surface-subtle motion-reduce:animate-none" />
      </div>
    </div>
  );
}

export async function ProviderEvidenceBand() {
  const summary = await getRazorpayTestModeSummary();
  // Collapsed by default: this is provider context for the queue below,
  // not the page's primary content, so it must not compete with it.
  return (
    <details className="group mt-5 border-l-2 border-provider bg-surface-raised">
      <summary
        aria-label="Razorpay Test mode evidence"
        className="focus-ring flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-sm px-4 py-3 sm:px-5"
      >
        <SourceBadge source="razorpay_test" />
        <span className="text-sm font-medium">
          {summary.connected
            ? "Razorpay records are available."
            : "Provider records are currently unavailable."}
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <span className="group-open:hidden">Provider evidence</span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          />
        </span>
      </summary>
      <div className="px-4 pb-4 sm:px-5">
        {summary.connected ? (
          <dl className="grid gap-4 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Captured payment</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-data">
                <CircleCheck
                  aria-hidden="true"
                  className="size-3.5 text-provider"
                />
                {summary.captured?.id ?? "None observed"}
              </dd>
              {summary.captured ? (
                <dd className="mt-1 text-muted-foreground">
                  {formatMoney(
                    summary.captured.amount,
                    summary.captured.currency,
                  )}{" "}
                  via {summary.captured.method}
                </dd>
              ) : null}
            </div>
            <div>
              <dt className="text-muted-foreground">Linked order</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-data">
                <Radio aria-hidden="true" className="size-3.5 text-provider" />
                {summary.order?.id ?? "Unavailable"}
              </dd>
              <dd className="mt-1 capitalize text-muted-foreground">
                {summary.order?.status ?? "No linked order"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Failed attempts</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-data">
                <CircleX
                  aria-hidden="true"
                  className="size-3.5 text-destructive"
                />
                {summary.failed}
              </dd>
              <dd
                className="mt-1 truncate text-muted-foreground"
                title={summary.latest_failure?.id ?? undefined}
              >
                {summary.latest_failure?.id ?? "None observed"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="pt-1 text-xs leading-6 text-muted-foreground">
            Live Razorpay reads are unavailable right now. The queue below still
            shows every recorded exception with its evidence.
          </p>
        )}
      </div>
    </details>
  );
}
