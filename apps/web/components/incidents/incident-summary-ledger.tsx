import Link from "next/link";
import { Tally } from "@/components/shared/tally";

const items = [
  { key: "pending", label: "Pending" },
  { key: "reconciled", label: "Verified" },
  { key: "escalated", label: "Escalated" },
  { key: "ambiguous", label: "Ambiguous" },
] as const;

export function IncidentSummaryLedger({
  summary,
  hrefs,
  activeStatus,
}: {
  summary: Record<string, number>;
  hrefs: Record<string, string>;
  activeStatus?: string;
}) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-surface sm:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.key}
          href={hrefs[item.key] ?? "/incidents"}
          aria-pressed={activeStatus === item.key || undefined}
          className="focus-ring px-4 py-4 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] hover:bg-surface-subtle aria-pressed:bg-surface-subtle [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t sm:[&:not(:first-child)]:border-l sm:[&:nth-child(n+3)]:border-t-0"
        >
          <p className="font-display text-2xl font-medium leading-none tabular-nums">
            <Tally value={summary[item.key] ?? 0} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
        </Link>
      ))}
    </div>
  );
}
