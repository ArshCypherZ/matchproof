const items = [
  { key: "pending", label: "Pending" },
  { key: "reconciled", label: "Verified" },
  { key: "escalated", label: "Escalated" },
  { key: "ambiguous", label: "Ambiguous" },
] as const;

export function IncidentSummaryLedger({
  summary,
}: {
  summary: Record<string, number>;
}) {
  return (
    <div className="grid grid-cols-2 border-y border-border sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.key}
          className="border-b border-border px-4 py-3 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
        >
          <p className="font-data text-xl font-medium tabular-nums">
            {summary[item.key] ?? 0}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
        </div>
      ))}
    </div>
  );
}
