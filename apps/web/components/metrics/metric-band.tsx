import Link from "next/link";
import { cn } from "@/lib/utils";

/* A KPI band. Tone is a quiet status dot on the label row — the value
   stays neutral ink so a wall of four bands never reads as a color field.
   "default" carries no dot: the metric is informational, not good or bad.
   A placeholder value ("None yet", "Unavailable") keeps the same KPI size
   as its peers so a row stays aligned, and drops to muted ink so it reads
   as a secondary state rather than a real number. */
const dotTone = {
  default: null,
  warning: "bg-warning",
  safe: "bg-success",
  destructive: "bg-destructive",
} as const;

export function MetricBand({
  value,
  label,
  note,
  tone = "default",
  muted = false,
  className,
  href,
}: {
  value: string;
  label: string;
  note?: string;
  tone?: "default" | "warning" | "safe" | "destructive";
  muted?: boolean;
  className?: string;
  /* A band whose count is a queue facet drills down to that facet's
     filtered queue. The label is the link — it names the destination —
     styled as the app's quiet-link idiom (footer nav), never the big
     KPI value, which stays pure data. */
  href?: string;
}) {
  const dotClass = dotTone[tone];
  return (
    <article className={cn("py-3", className)}>
      <p
        className={`font-display font-medium tracking-tight tabular-nums [overflow-wrap:anywhere] text-4xl lg:text-5xl ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
        {dotClass ? (
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${dotClass}`}
          />
        ) : null}
        {href ? (
          <Link
            href={href}
            className="focus-ring -mx-1 flex items-center rounded-md px-1 py-1 underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
          >
            {label}
          </Link>
        ) : (
          label
        )}
      </p>
      {note ? (
        <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{note}</p>
      ) : null}
    </article>
  );
}
