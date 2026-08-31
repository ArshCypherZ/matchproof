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
    <div className="grid grid-cols-2 border-y border-border sm:grid-cols-4">
      {items.map((item, index) => (
        <Link
          key={item.key}
          href={hrefs[item.key] ?? "/incidents"}
          aria-current={activeStatus === item.key ? "page" : undefined}
          className={`focus-ring border-border px-4 py-4 transition-colors hover:bg-surface-subtle aria-[current=page]:bg-surface-subtle sm:border-b-0 sm:border-r sm:last:border-r-0 ${index < 2 ? "border-b" : ""} ${index % 2 === 0 ? "border-r" : ""}`}
        >
          <p className="font-display text-3xl font-medium">
            <Tally value={summary[item.key] ?? 0} />
          </p>
          <p className="mt-1 font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
            {item.label}
          </p>
        </Link>
      ))}
    </div>
  );
}
