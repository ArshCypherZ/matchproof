import { Ban, Check } from "lucide-react";
import { TechBadge } from "@/components/shared/tech-badge";

type Reconciliation = {
  resolution: string;
  target_order_id: string | null;
  target_state: string | null;
  ambiguity_reasons: string[];
  discrepancies: string[];
};

export function PolicyDecision({
  reconciliation,
  idempotencyKey,
}: {
  reconciliation: Reconciliation;
  idempotencyKey: string;
}) {
  const allowed = Boolean(
    reconciliation.resolution === "reconcile_internal_state" &&
    reconciliation.target_order_id,
  );
  const noAction = reconciliation.resolution === "no_action_required";
  const Icon = allowed || noAction ? Check : Ban;
  const title = allowed
    ? "Allowed with approval"
    : noAction
      ? "No action required"
      : "Blocked by policy";
  return (
    <section
      id="workbench-policy"
      aria-labelledby="policy-heading"
      className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <p className="font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
            Approval policy / v1
          </p>
          <h2 id="policy-heading" className="mt-1 text-lg font-semibold">
            Approval decision
          </h2>
        </div>
        {/* Neutral accent on purpose: the decision band below already
            carries the one signature red for the allowed case. */}
        <TechBadge className="shrink-0">
          <Icon aria-hidden="true" />
          {title}
        </TechBadge>
      </div>
      <div
        className={`border-l-2 px-5 py-4 ${allowed || noAction ? "border-signature bg-surface-raised" : "border-warning bg-warning-soft"}`}
      >
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="size-4" />
          <p className="text-sm font-semibold">{title}</p>
        </div>
        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
          {allowed
            ? `Reconcile merchant order ${reconciliation.target_order_id} to ${reconciliation.target_state}.`
            : noAction
              ? "Provider and merchant records already agree. No order change is needed."
              : (reconciliation.ambiguity_reasons[0]?.replaceAll("_", " ") ??
                reconciliation.discrepancies[0]?.replaceAll("_", " ") ??
                "The evidence does not authorize a merchant-side repair.")}
        </p>
      </div>
      <dl className="grid gap-4 px-5 py-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Scope</dt>
          <dd className="mt-1">Merchant state</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Policy version</dt>
          <dd className="mt-1">
            <TechBadge>policy-v1</TechBadge>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">
            One-time approval key
          </dt>
          {/* Case-sensitive value the operator copies: rendered verbatim in
              the data voice, never uppercased by a chip. */}
          <dd className="mt-1 break-all font-data text-xs">{idempotencyKey}</dd>
        </div>
      </dl>
    </section>
  );
}
