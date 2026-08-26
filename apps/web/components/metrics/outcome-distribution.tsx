import { syntheticEvaluationMetrics as metrics } from "@/lib/metrics";

export function OutcomeDistribution() {
  const items = [
    {
      label: "Automatic",
      value: metrics.automatic_count,
      className: "bg-primary",
    },
    {
      label: "Runbook",
      value: metrics.runbook_count,
      className: "bg-provider",
    },
    {
      label: "No action",
      value: metrics.no_action_count,
      className: "bg-ink-tertiary",
    },
    {
      label: "Ambiguous",
      value: metrics.ambiguous_count,
      className: "bg-warning",
    },
  ];
  return (
    <section aria-labelledby="outcome-heading">
      <h2 id="outcome-heading" className="text-base font-semibold">
        Outcome distribution
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Categories report the current deterministic baseline and may overlap by
        evaluation definition.
      </p>
      <div
        className="mt-5 flex h-4 overflow-hidden rounded-sm bg-surface-subtle"
        aria-hidden="true"
      >
        {items
          .filter((item) => item.value > 0)
          .map((item) => (
            <span
              key={item.label}
              className={item.className}
              style={{ flexGrow: item.value }}
            />
          ))}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-baseline justify-between gap-4 border-b border-border pb-2"
          >
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="font-data text-sm font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
