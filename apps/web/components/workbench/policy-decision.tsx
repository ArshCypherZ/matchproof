import { Ban, Check } from "lucide-react";

type Reconciliation = {
  status: string;
  resolution: string;
  target_order_id: string | null;
  target_state: string | null;
  ambiguity_reasons: string[];
  discrepancies: string[];
  invariant_results: Record<string, boolean>;
};

export function PolicyDecision({
  reconciliation,
  idempotencyKey,
}: {
  reconciliation: Reconciliation;
  idempotencyKey: string;
}) {
  const allowed =
    reconciliation.resolution === "reconcile_internal_state" &&
    reconciliation.target_order_id;
  const noAction = reconciliation.resolution === "no_action_required";
  const Icon = allowed || noAction ? Check : Ban;
  const title = allowed
    ? "Allowed with approval"
    : noAction
      ? "No action required"
      : "Blocked by policy";
  return (
    <section aria-labelledby="policy-heading">
      <h2 id="policy-heading" className="text-base font-semibold">
        Policy gate
      </h2>
      <div
        className={`mt-4 border-l-2 px-4 py-3 ${allowed || noAction ? "border-primary bg-accent" : "border-warning bg-warning-soft"}`}
      >
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4" />
          <p className="text-sm font-semibold">{title}</p>
        </div>
        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
          {allowed
            ? `Reconcile merchant order ${reconciliation.target_order_id} to ${reconciliation.target_state}.`
            : noAction
              ? "Provider and merchant state require no bounded merchant-side change."
              : (reconciliation.ambiguity_reasons[0] ??
                reconciliation.discrepancies[0]?.replaceAll("_", " ") ??
                "The evidence does not authorize a merchant-side repair.")}
        </p>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Scope</dt>
          <dd className="mt-1">Merchant state</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Policy version</dt>
          <dd className="mt-1 font-data">deterministic-v1</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">Idempotency key</dt>
          <dd className="mt-1 break-all font-data text-xs">{idempotencyKey}</dd>
        </div>
      </dl>
    </section>
  );
}
