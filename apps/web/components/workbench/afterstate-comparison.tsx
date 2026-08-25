import { Check, Clock3, X } from "lucide-react";

type Reconciliation = {
  provider_state: string;
  provider_amount_minor: number | null;
  provider_currency: string | null;
  merchant_state: string;
  target_order_id: string | null;
  invariant_results: Record<string, boolean>;
};

export function AfterstateComparison({
  reconciliation,
  verified,
}: {
  reconciliation: Reconciliation;
  verified: boolean;
}) {
  const rows = [
    {
      label: "State",
      provider: reconciliation.provider_state,
      merchant: reconciliation.merchant_state,
      holds: reconciliation.invariant_results.status,
    },
    {
      label: "Amount",
      provider:
        reconciliation.provider_amount_minor == null
          ? "Unavailable"
          : `${reconciliation.provider_amount_minor} paise`,
      merchant: "Recorded in merchant evidence",
      holds: reconciliation.invariant_results.amount,
    },
    {
      label: "Identity",
      provider: "Provider payment linked",
      merchant: reconciliation.target_order_id ?? "No unique order",
      holds:
        reconciliation.invariant_results.identity &&
        reconciliation.invariant_results.order,
    },
  ];
  return (
    <section aria-labelledby="afterstate-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="afterstate-heading" className="text-base font-semibold">
            Afterstate
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            A tool response is not closure evidence.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${verified ? "border-primary/30 bg-accent text-accent-foreground" : "border-warning/40 bg-warning-soft text-warning"}`}
        >
          {verified ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Clock3 aria-hidden="true" className="size-3.5" />
          )}
          {verified ? "Verified" : "Not observed"}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="py-2 pr-3 font-medium">Check</th>
              <th className="px-3 py-2 font-medium">Provider observation</th>
              <th className="px-3 py-2 font-medium">Merchant observation</th>
              <th className="pl-3 py-2 font-medium">Invariant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className="border-b border-border last:border-0"
              >
                <th className="py-3 pr-3 font-medium">{row.label}</th>
                <td className="px-3 py-3 font-data">{row.provider}</td>
                <td className="px-3 py-3 font-data">{row.merchant}</td>
                <td className="pl-3 py-3">
                  {row.holds ? (
                    <span className="inline-flex items-center gap-1 text-accent-foreground">
                      <Check aria-hidden="true" className="size-3.5" />
                      Holds
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-destructive">
                      <X aria-hidden="true" className="size-3.5" />
                      Not proven
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!verified ? (
        <p className="mt-4 border-l-2 border-warning pl-3 text-sm text-muted-foreground">
          Provider and merchant read-after-write observations have not been
          recorded for this incident.
        </p>
      ) : null}
    </section>
  );
}
