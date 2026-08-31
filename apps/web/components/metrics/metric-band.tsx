export function MetricBand({
  value,
  label,
  note,
  tone = "default",
}: {
  value: string;
  label: string;
  note?: string;
  tone?: "default" | "warning" | "safe" | "destructive";
}) {
  const toneClass =
    tone === "warning"
      ? "border-warning"
      : tone === "safe"
        ? "border-primary"
        : tone === "destructive"
          ? "border-destructive"
          : "border-border";
  const valueClass =
    value.length > 8 ? "text-[1.65rem] leading-tight" : "text-4xl lg:text-5xl";
  return (
    <article className={`border-l-2 py-3 pl-4 ${toneClass}`}>
      <p
        className={`font-display font-medium tracking-tight tabular-nums [overflow-wrap:anywhere] ${valueClass}`}
      >
        {value}
      </p>
      <p className="mt-2 text-sm font-medium">{label}</p>
      {note ? (
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{note}</p>
      ) : null}
    </article>
  );
}
