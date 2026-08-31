"use client";

import { useState } from "react";
import { Check, Clock3, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TechBadge } from "@/components/shared/tech-badge";
import { formatMoney } from "@/components/shared/format";

type Reconciliation = {
  provider_state: string;
  provider_amount_minor: number | null;
  provider_currency: string | null;
  merchant_state: string;
  target_order_id: string | null;
  invariant_results: Record<string, boolean>;
};

function ResultTag({ holds }: { holds: boolean }) {
  return (
    <TechBadge accent={holds ? "primary" : "warning"}>
      {holds ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
      {holds ? "Holds" : "Not proven"}
    </TechBadge>
  );
}

export function PostRepairStateComparison({
  reconciliation,
  verified,
}: {
  reconciliation: Reconciliation;
  verified: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const rows = [
    {
      label: "State",
      provider: reconciliation.provider_state,
      merchant: reconciliation.merchant_state,
      holds: Boolean(reconciliation.invariant_results.status),
    },
    {
      label: "Amount",
      provider: formatMoney(
        reconciliation.provider_amount_minor,
        reconciliation.provider_currency ?? undefined,
      ),
      merchant: "Recorded in merchant evidence",
      holds: Boolean(reconciliation.invariant_results.amount),
    },
    {
      label: "Identity",
      provider: "Provider payment linked",
      merchant: reconciliation.target_order_id ?? "No unique order",
      holds: Boolean(
        reconciliation.invariant_results.identity &&
        reconciliation.invariant_results.order,
      ),
    },
  ];
  const copyProviderObservation = async () => {
    try {
      await navigator.clipboard.writeText(
        rows.map((row) => `${row.label}: ${row.provider}`).join("\n"),
      );
      setCopied(true);
      // Clear so the live region announces again on a second copy.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked; the observations stay readable in
      // the table.
    }
  };
  return (
    <section
      id="workbench-verification"
      aria-labelledby="verification-heading"
      className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
            Post-action verification
          </p>
          <h2 id="verification-heading" className="mt-1 text-lg font-semibold">
            Verification
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Do not close this exception until fresh Razorpay and merchant checks
            agree.
          </p>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-auto">
          <TechBadge
            accent={verified ? "primary" : "warning"}
            className="shrink-0"
          >
            {verified ? (
              <Check aria-hidden="true" />
            ) : (
              <Clock3 aria-hidden="true" />
            )}
            {verified ? "Verified" : "Not observed"}
          </TechBadge>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={copyProviderObservation}
            aria-label="Copy provider observation"
            title="Copy provider observation"
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>
      <div className="px-5 py-2">
        {/* The table owns its scroll: observations are mono figures that
            refuse to crush, so a narrow band scrolls inside the panel
            while the page keeps its width. */}
        <div className="overflow-x-auto">
          <table className="hidden w-full text-left text-xs sm:table">
            <caption className="sr-only">
              Provider and merchant observations per verification check
            </caption>
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Check
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Provider observation
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Merchant observation
                </th>
                <th scope="col" className="py-2 pl-3 font-medium">
                  Result
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-border last:border-0"
                >
                  <th scope="row" className="py-3 pr-3 font-medium">
                    {row.label}
                  </th>
                  <td className="px-3 py-3 font-data [overflow-wrap:anywhere]">
                    {row.provider}
                  </td>
                  <td className="px-3 py-3 font-data [overflow-wrap:anywhere]">
                    {row.merchant}
                  </td>
                  <td className="py-3 pl-3">
                    <ResultTag holds={row.holds} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl
          aria-label="Provider and merchant observations per verification check"
          className="divide-y divide-border sm:hidden"
        >
          {rows.map((row) => (
            <div key={row.label} className="py-3 first:pt-1 last:pb-1">
              <dt className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium">{row.label}</span>
                <ResultTag holds={row.holds} />
              </dt>
              <dd className="mt-2 space-y-1.5">
                <p className="font-data text-xs">
                  <span className="text-muted-foreground">Provider: </span>
                  {row.provider}
                </p>
                <p className="font-data text-xs">
                  <span className="text-muted-foreground">Merchant: </span>
                  {row.merchant}
                </p>
              </dd>
            </div>
          ))}
        </dl>
      </div>
      {!verified ? (
        <div className="mx-5 mb-5 flex gap-3 border-l-2 border-warning bg-warning-soft px-4 py-3">
          <Clock3
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <p className="text-sm text-muted-foreground">
            Fresh Razorpay and merchant checks have not been recorded. Keep this
            exception open.
          </p>
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {copied ? "Provider observation copied" : ""}
      </span>
    </section>
  );
}
