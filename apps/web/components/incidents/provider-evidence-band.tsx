import { CircleCheck, CircleX, Radio } from "lucide-react";
import { formatMoney } from "@/components/shared/format";
import { SourceBadge } from "@/components/shared/source-badge";

type Summary = Awaited<
  ReturnType<typeof import("@/lib/razorpay").getRazorpayTestModeSummary>
>;

export function ProviderEvidenceBand({ summary }: { summary: Summary }) {
  return (
    <section
      aria-label="Razorpay Test mode evidence"
      className="mt-5 border-l-2 border-provider bg-provider-soft px-4 py-4 sm:px-5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <SourceBadge source="razorpay_test" />
          <p className="mt-2 text-sm font-medium">
            {summary.connected
              ? "Authoritative provider records are connected."
              : "Provider records are currently unavailable."}
          </p>
        </div>
        {summary.connected ? (
          <dl className="grid gap-4 text-xs sm:grid-cols-3 lg:min-w-[42rem]">
            <div>
              <dt className="text-muted-foreground">Captured payment</dt>
              <dd className="mt-1 flex items-center gap-1.5 font-data">
                <CircleCheck
                  aria-hidden="true"
                  className="size-3.5 text-primary"
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
              <dd className="mt-1 truncate text-muted-foreground">
                {summary.latest_failure?.id ?? "None observed"}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}
