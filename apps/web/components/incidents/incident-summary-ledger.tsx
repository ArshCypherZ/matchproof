"use client";

import Link, { useLinkStatus } from "next/link";
import { LoaderCircle } from "lucide-react";
import { Tally } from "@/components/shared/tally";

const items = [
  { key: "pending", label: "Pending" },
  { key: "reconciled", label: "Verified" },
  { key: "escalated", label: "Escalated" },
  { key: "ambiguous", label: "Ambiguous" },
] as const;

/* Clicking a cell refilters the queue, and the queue page is dynamic: the
   navigation can take as long as the query. The clicked cell says so — a
   small spinner beside its count until the route lands. */
function CellPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <LoaderCircle
      aria-hidden="true"
      className="ml-1.5 inline-block size-3.5 animate-spin align-baseline text-muted-foreground"
    />
  );
}

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
          /* A cell is a link to a filtered view, not a toggle control, so
             the active facet is "current" — the same semantics the primary
             nav uses for the page the operator is on. */
          aria-current={activeStatus === item.key ? "true" : undefined}
          className="focus-ring px-4 py-4 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] hover:bg-surface-subtle aria-[current=true]:bg-surface-subtle [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t sm:[&:not(:first-child)]:border-l sm:[&:nth-child(n+3)]:border-t-0"
        >
          <p className="font-display text-2xl font-medium leading-none tabular-nums">
            <Tally value={summary[item.key] ?? 0} />
            <CellPending />
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
        </Link>
      ))}
    </div>
  );
}
