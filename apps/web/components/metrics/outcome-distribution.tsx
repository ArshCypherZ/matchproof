const items = [
  { label: "Automatic", value: 37, className: "bg-primary" },
  { label: "Runbook", value: 37, className: "bg-provider" },
  { label: "No action", value: 0, className: "bg-ink-tertiary" },
  { label: "Ambiguous", value: 63, className: "bg-warning" },
];

export function OutcomeDistribution() {
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
