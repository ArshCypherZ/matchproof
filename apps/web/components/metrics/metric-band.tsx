export function MetricBand({
  value,
  label,
  source,
  note,
  tone = "default",
}: {
  value: string;
  label: string;
  source: string;
  note?: string;
  tone?: "default" | "warning" | "safe";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning"
      : tone === "safe"
        ? "border-primary"
        : "border-border";
  return (
    <div className={`border-l-2 ${toneClass} py-2 pl-4`}>
      <p className="font-data text-3xl font-medium tabular-nums">{value}</p>
      <p className="mt-2 text-sm font-medium">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{source}</p>
      {note ? (
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {note}
        </p>
      ) : null}
    </div>
  );
}
