import { Check, Clock3, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { formatMoney } from "@/components/shared/format";

type Evidence = {
  kind: string;
  occurred_at: string;
  payload: unknown;
}[];

type Reconciliation = {
  provider_state: string;
  provider_amount_minor: number | null;
  provider_currency: string | null;
  merchant_state: string;
  merchant_order_ids: string[];
  invariant_results: Record<string, boolean>;
};

function ResultTag({ holds }: { holds: boolean }) {
  // The result names the invariant between the two observations, not a
  // verification run: a record can hold on every row and still be waiting
  // for its fresh checks, which the badge above the table carries.
  return (
    <Badge variant={holds ? "success" : "caution"}>
      {holds ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}
      {holds ? "Holds" : "Does not hold"}
    </Badge>
  );
}

// Machine states read as observations: "captured_verified" names a fact about
// provenance, not a word the operator should have to parse.
const STATE_LABELS: Record<string, string> = {
  captured_verified: "Captured (verified)",
  authorized_verified: "Authorized (verified)",
  failed_verified: "Failed (verified)",
  refunded_verified: "Refunded (verified)",
  paid_verified: "Paid (verified)",
  captured: "Captured",
  authorized: "Authorized",
  failed: "Failed",
  refunded: "Refunded",
  paid: "Paid",
  pending: "Pending",
  missing: "Missing",
  fulfilled: "Fulfilled",
  ambiguous_after_timeout: "Unknown after timeout",
  unknown: "Unknown",
};

function stateLabel(state: string) {
  return STATE_LABELS[state] ?? state.replaceAll("_", " ");
}

// The card's four outcomes. "closed" is the defensive one: a record that
// closed without a recorded fresh check — the loop says it is done, and the
// card must not tell the operator to keep it open.
type Verification = "verified" | "escalated" | "open" | "closed";

const OUTCOME_COPY: Record<Verification, { badge: string; subtitle: string }> =
  {
    verified: {
      badge: "Verified",
      subtitle:
        "Razorpay and merchant observations agreed before this exception closed.",
    },
    escalated: {
      badge: "Not observed",
      subtitle:
        "Verification runs after an approved repair. This exception was escalated without one.",
    },
    open: {
      badge: "Not observed",
      subtitle:
        "Do not close this exception until fresh Razorpay and merchant checks agree.",
    },
    closed: {
      badge: "Not observed",
      subtitle: "This exception closed without a recorded fresh check.",
    },
  };

const BAND_COPY: Partial<Record<Verification, string>> = {
  escalated: "No repair was applied, so no verification checks were recorded.",
  open: "Fresh Razorpay and merchant checks have not been recorded. Keep this exception open.",
  closed: "Fresh Razorpay and merchant checks have not been recorded.",
};

export function PostRepairStateComparison({
  evidence,
  reconciliation,
  payment,
  verification,
}: {
  evidence: Evidence;
  reconciliation: Reconciliation;
  payment: {
    state: string;
    amount_minor: number | null;
    currency: string | null;
  } | null;
  verification: Verification;
}) {
  // The merchant observations come from what the record actually holds, never
  // from the repair plan — a blocked or finished record has no target order,
  // but its observations still name what was seen. Once the fresh check
  // verified, the durable payment record carries the aligned state.
  // A malformed timestamp must not decide which observation is latest: a NaN
  // comparator leaves the sort order undefined, and a badly dated fact could
  // pose as the freshest observation. It sorts as the oldest instead.
  const stamp = (value: string) => {
    const time = Date.parse(value);
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };
  const latestOrder = evidence
    .filter((item) => item.kind === "merchant_order_state")
    .sort((left, right) => stamp(left.occurred_at) - stamp(right.occurred_at))
    .at(-1);
  const latestOrderPayload = (latestOrder?.payload ?? {}) as {
    amount_minor?: number;
    currency?: string;
  };
  const orderCount = reconciliation.merchant_order_ids.length;
  const merchantIdentity =
    orderCount === 0
      ? "No merchant order"
      : orderCount === 1
        ? reconciliation.merchant_order_ids[0]
        : `${orderCount} orders`;
  const verified = verification === "verified";
  const rows = [
    {
      label: "State",
      provider: stateLabel(reconciliation.provider_state),
      merchant:
        payment && verified
          ? stateLabel(payment.state)
          : stateLabel(reconciliation.merchant_state),
      holds: verified || Boolean(reconciliation.invariant_results.status),
    },
    {
      label: "Amount",
      provider: formatMoney(
        reconciliation.provider_amount_minor,
        reconciliation.provider_currency ?? undefined,
      ),
      merchant:
        payment && verified
          ? formatMoney(payment.amount_minor, payment.currency ?? undefined)
          : latestOrder
            ? formatMoney(
                latestOrderPayload.amount_minor,
                latestOrderPayload.currency,
              )
            : "No merchant order",
      holds: verified || Boolean(reconciliation.invariant_results.amount),
    },
    {
      label: "Identity",
      provider: "Razorpay payment linked",
      merchant: merchantIdentity,
      holds:
        verified ||
        Boolean(
          reconciliation.invariant_results.identity &&
          reconciliation.invariant_results.order,
        ),
    },
  ];
  return (
    <Card aria-labelledby="verification-heading">
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="verification-heading" className="text-lg font-semibold">
            Verification
          </h2>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            {OUTCOME_COPY[verification].subtitle}
          </p>
        </div>
        {/* The observations live in the table below, in selectable text —
            no copy control. A button that duplicates what selection already
            does adds chrome, not capability. */}
        <Badge variant={verified ? "success" : "caution"} className="shrink-0">
          {verified ? (
            <Check aria-hidden="true" />
          ) : (
            <Clock3 aria-hidden="true" />
          )}
          {OUTCOME_COPY[verification].badge}
        </Badge>
      </CardHeader>
      <div className="px-5 py-2">
        {/* The table owns its scroll: observations are mono figures that
            refuse to crush, so a narrow band scrolls inside the panel
            while the page keeps its width. */}
        <div className="overflow-x-auto">
          <table className="hidden w-full text-left text-xs sm:table">
            <caption className="sr-only">
              Razorpay and merchant observations per verification check
            </caption>
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Check
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Razorpay observation
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
          aria-label="Razorpay and merchant observations per verification check"
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
                  <span className="text-muted-foreground">Razorpay: </span>
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
      {BAND_COPY[verification] ? (
        <div className="flex gap-3 bg-warning-soft px-5 py-3">
          <Clock3
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <p className="text-sm text-muted-foreground">
            {BAND_COPY[verification]}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
