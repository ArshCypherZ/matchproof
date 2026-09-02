import { Ban, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

type Reconciliation = {
  resolution: string;
  target_order_id: string | null;
  target_state: string | null;
  ambiguity_reasons: string[];
  discrepancies: string[];
};

// The backend reason arrives lowercase ("no unique merchant order context
// exists"); it is a sentence, so it starts like one.
function reasonSentence(reason: string) {
  return reason.replace(/^./, (letter) => letter.toUpperCase());
}

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
  const blockReason =
    reconciliation.ambiguity_reasons[0]?.replaceAll("_", " ") ??
    reconciliation.discrepancies[0]?.replaceAll("_", " ");
  const Icon = allowed || noAction ? Check : Ban;
  const title = allowed
    ? "Allowed with approval"
    : noAction
      ? "No action required"
      : "Blocked by policy";
  const variant = allowed ? "success" : noAction ? "neutral" : "danger";
  return (
    <Card aria-labelledby="policy-heading">
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="policy-heading" className="text-lg font-semibold">
            Approval decision
          </h2>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Whether policy authorizes a merchant-side repair.
          </p>
        </div>
        <Badge variant={variant} className="shrink-0">
          <Icon aria-hidden="true" />
          {title}
        </Badge>
      </CardHeader>
      {/* The decision sentence sits on the card's own surface like every
          other card body — no tonal band. The badge above carries the
          state (success / neutral / danger, each with its own icon); a
          filled band here only raised "why is this row a different
          color?" without adding meaning. */}
      <div className="px-5 py-4">
        <p className="max-w-prose break-words text-sm leading-6">
          {allowed
            ? `Reconcile merchant order ${reconciliation.target_order_id} to ${reconciliation.target_state}.`
            : noAction
              ? "Provider and merchant records already agree. No order change is needed."
              : blockReason
                ? reasonSentence(blockReason)
                : "The evidence does not authorize a merchant-side repair."}
        </p>
      </div>
      <dl className="grid gap-4 px-5 py-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Scope</dt>
          <dd className="mt-1">Merchant order state</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Policy</dt>
          <dd className="mt-1">
            <Badge className="font-data">rule-based-policy</Badge>
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">
            One-time approval key
          </dt>
          {/* Case-sensitive value the operator copies: rendered verbatim in
              the data voice, never uppercased by a chip or mangled by
              browser auto-translate. */}
          <dd translate="no" className="mt-1 break-all font-data text-xs">
            {idempotencyKey}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
