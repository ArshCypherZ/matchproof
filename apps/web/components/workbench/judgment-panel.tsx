import { AlertTriangle, BookOpenCheck } from "lucide-react";

type Incident = {
  reconstruction: {
    current_state: string;
    ambiguity_reasons: string[];
    duplicate_evidence_ids: string[];
    impact_summary: { duplicate_events_suppressed: number };
  };
  reconciliation: {
    discrepancy: string | null;
    discrepancies: string[];
    resolution: string;
    ambiguity_reasons: string[];
    evidence_ids: string[];
  };
};

export function JudgmentPanel({ incident }: { incident: Incident }) {
  const hypothesis = incident.reconciliation.discrepancy
    ? incident.reconciliation.discrepancy.replaceAll("_", " ")
    : "Provider and merchant state currently agree.";
  const missing = incident.reconciliation.ambiguity_reasons;
  return (
    <section aria-labelledby="judgment-heading">
      <div className="flex items-center gap-2">
        <BookOpenCheck
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
        <h2 id="judgment-heading" className="text-base font-semibold">
          Current judgment
        </h2>
        <span className="rounded border border-border bg-surface-subtle px-1.5 py-0.5 text-[11px] text-muted-foreground">
          Advisory
        </span>
      </div>
      <div className="mt-5 space-y-5">
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">
            Reconstruction
          </h3>
          <p className="mt-1 text-sm leading-6">
            {incident.reconstruction.current_state.replaceAll("_", " ")}.
          </p>
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">
            Hypothesis
          </h3>
          <p className="mt-1 text-sm leading-6 capitalize">{hypothesis}.</p>
          <p className="mt-2 font-data text-xs text-muted-foreground">
            Evidence: {incident.reconciliation.evidence_ids.join(", ")}
          </p>
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">
            Missing or conflicting evidence
          </h3>
          {missing.length ? (
            <ul className="mt-2 space-y-2">
              {missing.map((item) => (
                <li
                  key={item}
                  className="flex gap-2 text-sm text-muted-foreground"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              No missing evidence was reported by deterministic reconciliation.
            </p>
          )}
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted-foreground">
            Selected runbook
          </h3>
          <p className="mt-1 text-sm leading-6">
            {incident.reconciliation.resolution === "reconcile_internal_state"
              ? "Reconcile the uniquely mapped merchant order after deterministic approval."
              : incident.reconciliation.resolution === "no_action_required"
                ? "Record that no merchant-side action is required."
                : "Create an accountable escalation with the current evidence bundle."}
          </p>
        </div>
        <div className="border-t border-border pt-4">
          <h3 className="text-xs font-medium text-muted-foreground">
            Research citations
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            No external diagnosis citations were recorded for this incident.
          </p>
        </div>
      </div>
    </section>
  );
}
