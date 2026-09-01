"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { Tally } from "@/components/shared/tally";
import { stepLabel } from "@/components/shared/step-labels";
import { CLASS_LABELS } from "@/components/incidents/queue-facets";

// The exact fields the batch roster renders. The server projects each
// incident down to this shape before it crosses into the client payload.
export type BatchIncident = {
  incident_id: string;
  incident_class: string;
  status: string;
  current_step: string;
  source_kind: string;
};

function startedTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  // One explicit zone, the same clock every server-rendered timestamp on
  // the console uses, so the list and the detail never disagree.
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function classLabel(value: string) {
  return (
    CLASS_LABELS[value] ??
    value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
  );
}

// A summary strip cell: one count (or the started time) on a tonal surface,
// hairline dividers only. The divider rules step the grid from two columns on
// narrow screens to three at sm and a single row of six at lg.
const tallyCell =
  "px-4 py-4 [&:nth-child(even)]:border-l [&:nth-child(n+3)]:border-t sm:[&:nth-child(3n+2)]:border-l sm:[&:nth-child(3n)]:border-l sm:[&:nth-child(3n+1)]:border-l-0 sm:[&:nth-child(-n+3)]:border-t-0 lg:[&:not(:first-child)]:border-l lg:[&:nth-child(n)]:border-t-0";

export function BatchView({
  batchId,
  incidents,
  startedAt,
}: {
  batchId: string;
  incidents: BatchIncident[];
  startedAt: string;
}) {
  const counts = incidents.reduce<Record<string, number>>((result, item) => {
    const key =
      item.status === "reconciled"
        ? "reconciled"
        : item.status === "escalated"
          ? "escalated"
          : item.status === "ambiguous"
            ? "ambiguous"
            : "pending";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  const pending = counts.pending ?? 0;
  const verified = counts.reconciled ?? 0;
  const escalated = counts.escalated ?? 0;
  const ambiguous = counts.ambiguous ?? 0;
  const total = incidents.length;
  const terminal = verified + escalated + ambiguous;
  const closed = total > 0 && terminal === total;
  const previousTerminal = useRef<number | null>(null);
  const [justClosed, setJustClosed] = useState(false);
  useEffect(() => {
    const previous = previousTerminal.current;
    previousTerminal.current = terminal;
    if (previous !== null && previous < total && closed) {
      setJustClosed(true);
    }
  }, [terminal, total, closed]);
  const exceptionWord = total === 1 ? "exception" : "exceptions";
  const remaining = escalated + ambiguous;
  // The ratio keeps its numerals glued to their words: "2 of 5" broken
  // across lines misreads the count.
  const closeSummary =
    verified === total
      ? "Batch closed. Every exception verified."
      : `Batch closed. ${remaining}\u00a0of\u00a0${total}\u00a0${exceptionWord} ${
          remaining === 1 ? "remains" : "remain"
        } in the queue for review.`;
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {/* The page-title role every screen shares; the batch id keeps the
              mono data voice even inside the heading, so the operator reads
              a machine identifier, not a word. */}
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Batch <span className="font-data">{batchId.slice(0, 8)}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track each exception until it is verified, escalated, or flagged
            ambiguous.
          </p>
        </div>
        <div className="flex shrink-0 justify-start sm:mt-0 sm:justify-end">
          <LiveRefresh
            endpoint={`/api/incidents/batch/${batchId}/progress`}
            label="Batch"
          />
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {justClosed ? closeSummary : ""}
      </span>
      <div className="mt-8">
        <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-surface sm:grid-cols-3 lg:grid-cols-6">
          <div className={tallyCell}>
            <p className="font-display text-2xl font-medium leading-none tabular-nums">
              <Tally value={incidents.length} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Exceptions</p>
          </div>
          <div className={tallyCell}>
            <p className="font-display text-2xl font-medium leading-none tabular-nums">
              <Tally value={pending} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Pending</p>
          </div>
          <div className={tallyCell}>
            <p className="font-display text-2xl font-medium leading-none tabular-nums">
              <Tally value={verified} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Verified</p>
          </div>
          <div className={tallyCell}>
            <p className="font-display text-2xl font-medium leading-none tabular-nums">
              <Tally value={escalated} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Escalated</p>
          </div>
          <div className={tallyCell}>
            <p className="font-display text-2xl font-medium leading-none tabular-nums">
              <Tally value={ambiguous} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Ambiguous</p>
          </div>
          <div className={tallyCell}>
            <p className="font-display text-2xl font-medium leading-none tabular-nums">
              {startedTime(startedAt)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Started</p>
          </div>
        </div>
        {incidents.length ? (
          <div
            role="progressbar"
            aria-label="Batch completion"
            aria-valuemin={0}
            aria-valuemax={incidents.length}
            aria-valuenow={terminal}
            aria-valuetext={`${terminal} of ${incidents.length} exceptions completed`}
            className="mt-4 h-0.5 bg-border"
          >
            <div
              className="h-full origin-left bg-primary transition-transform duration-[400ms] ease-[var(--motion-ease-out)] motion-reduce:transition-none"
              style={{ transform: `scaleX(${terminal / incidents.length})` }}
            />
          </div>
        ) : null}
        {closed ? (
          <p className="mt-6 max-w-2xl text-sm leading-6 text-muted-foreground">
            {closeSummary}
          </p>
        ) : null}
      </div>
      <Card className="mt-8">
        <CardHeader>
          <h2 className="text-sm font-semibold">Exceptions</h2>
        </CardHeader>
        {incidents.length ? (
          <div className="divide-y divide-border">
            {incidents.map((item) => (
              <Link
                key={item.incident_id}
                href={`/incidents/${item.incident_id}`}
                className="focus-ring touch-manipulation [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto] flex items-center justify-between gap-4 px-4 py-4 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] hover:bg-surface-subtle active:bg-surface-subtle sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-sm font-medium">
                      {classLabel(item.incident_class)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-data text-xs text-muted-foreground">
                    {item.incident_id}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span
                    className="hidden sm:inline"
                    title={stepLabel(item.current_step)}
                  >
                    {stepLabel(item.current_step)}
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="bg-surface-subtle px-5 py-12 text-center text-sm text-muted-foreground">
            No exceptions were recorded for this batch.
          </div>
        )}
      </Card>
    </main>
  );
}
