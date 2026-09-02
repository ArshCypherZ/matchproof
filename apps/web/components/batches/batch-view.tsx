"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { statusBucket } from "@/components/shared/status-bucket";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { Tally } from "@/components/shared/tally";
import { stepLabel } from "@/components/shared/step-labels";
import { CLASS_LABELS } from "@/components/incidents/queue-facets";
import { tallyCell } from "@/components/batches/tally-cell";

// The exact fields the batch roster renders. The server projects each
// incident down to this shape before it crosses into the client payload.
export type BatchIncident = {
  incident_id: string;
  incident_class: string;
  status: string;
  current_step: string;
};

function classLabel(value: string) {
  return (
    CLASS_LABELS[value] ??
    value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
  );
}

export function BatchView({
  batchId,
  incidents,
  total,
  startedLabel,
}: {
  batchId: string;
  incidents: BatchIncident[];
  // Every exception the batch accepted, present or not \u2014 the same number
  // the list row counts, passed down so the two pages cannot disagree.
  total: number;
  // Pre-formatted on the server: one explicit zone, one clock for the
  // whole console, and no client-side Intl to re-derive on hydration.
  startedLabel: string;
}) {
  const counts = incidents.reduce<Record<string, number>>((result, item) => {
    const key = statusBucket(item.status);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  const verified = counts.reconciled ?? 0;
  const escalated = counts.escalated ?? 0;
  const ambiguous = counts.ambiguous ?? 0;
  const terminal = verified + escalated + ambiguous;
  // Pending is what is left of the recorded roster, not a head count of
  // rows: an exception whose record has vanished from the store is not
  // verified, so it stays pending \u2014 the same read the list's band makes.
  const pending = Math.max(0, total - terminal);
  const closed = total > 0 && terminal === total;
  const previousTerminal = useRef<number | null>(null);
  const [justClosed, setJustClosed] = useState(false);
  useEffect(() => {
    const previous = previousTerminal.current;
    previousTerminal.current = terminal;
    // Both branches are transitions, checked against a previous reading:
    // the effect never writes state on its first run.
    if (previous !== null && previous < total && closed) {
      setJustClosed(true);
    } else if (previous !== null && !closed) {
      // A reopened batch must not keep announcing a stale close: the
      // live region speaks only while the batch is actually closed.
      setJustClosed(false);
    }
  }, [terminal, total, closed]);
  const remaining = escalated + ambiguous;
  // "Closed" is earned only when every exception verified. A batch that
  // finished with escalations or ambiguous calls still has outstanding
  // work, and its summary must not lead with a word that reads all-clear.
  // The numerals stay glued to their words: "2 exceptions" broken across
  // lines misreads the count.
  const closeSummary =
    verified === total
      ? "Batch closed. Every exception verified."
      : `Batch finished processing. ${remaining}\u00a0${
          remaining === 1 ? "exception needs" : "exceptions need"
        } your review.`;
  const completionIndex = `${terminal}\u00a0of\u00a0${total}\u00a0completed`;
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {/* The same quiet way out every record page carries: one link back
              to the list the operator came from. */}
          <Link
            href="/batches"
            className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:px-1.5"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Batches
          </Link>
          {/* The page-title role every screen shares; the batch id keeps the
              mono data voice even inside the heading, so the operator reads
              a machine identifier, not a word. */}
          <h1 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Batch <span className="font-data">{batchId.slice(0, 8)}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track each exception until it is verified, escalated, or flagged
            ambiguous.
          </p>
          {/* The started clock is page metadata, not a tally: it sat as the
              sixth cell of the count strip and broke the five-count pattern,
              so it reads here in the same muted voice the exception detail
              page uses for its "Updated …" line. The string arrives
              formatted from the server, date and time both. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Started {startedLabel}
          </p>
        </div>
        <div className="flex shrink-0 justify-start sm:mt-0 sm:justify-end">
          {/* stopOnNotFound: a deleted batch's progress endpoint answers
              404, and no retry can bring it back — the incident detail page
              reads its endpoint the same way. */}
          <LiveRefresh
            endpoint={`/api/incidents/batch/${batchId}/progress`}
            label="Batch"
            stopOnNotFound
          />
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {justClosed ? closeSummary : ""}
      </span>
      {/* A batch that accepted nothing has no proportions to count: five
          zero cells would read as broken, the same call the list rows make
          when they suppress their band. The count strip and the progress
          row appear only when there is something to measure. */}
      {total > 0 ? (
        <div className="mt-8">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border sm:grid-cols-3 lg:grid-cols-5">
            <div className={tallyCell}>
              <p className="font-display text-2xl font-medium leading-none tabular-nums">
                <Tally value={total} />
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {total === 1 ? "Exception" : "Exceptions"}
              </p>
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
          </div>
          {/* A half-pixel bar full of accent color read as a divider once
             the batch completed — a progress bar must announce itself. The
             track is thick enough to see, the fill carries meaning (accent
             while running, success once every exception is terminal), and
             the "N of M completed" index rides the same row so the state
             reads without hovering; the native title is the belt to that
             braces. */}
          <div className="mt-4 flex items-center gap-3">
            <div
              role="progressbar"
              aria-label="Batch completion"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={terminal}
              aria-valuetext={`${terminal} of ${total} exceptions completed`}
              title={`${terminal} of ${total} exceptions completed`}
              className="h-1.5 flex-1 rounded-full bg-border"
            >
              <div
                className={`h-full w-full origin-left rounded-full transition-[background-color,transform] duration-[400ms] ease-[var(--motion-ease-out)] motion-reduce:transition-none ${
                  closed ? "bg-success" : "bg-primary"
                }`}
                style={{ transform: `scaleX(${terminal / total})` }}
              />
            </div>
            <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {completionIndex}
            </p>
          </div>
          {closed ? (
            /* The close sentence is also the hand-off: a finished batch with
               outstanding exceptions ends at a door, not a dead end. The
               queue link is unfiltered — "needs review" spans escalated and
               ambiguous, and no single facet holds both. */
            <p className="mt-6 max-w-2xl text-sm leading-6 text-muted-foreground">
              {remaining > 0 ? (
                <>
                  Batch finished processing. {remaining}{" "}
                  {remaining === 1 ? "exception needs" : "exceptions need"} your
                  review.{" "}
                  <Link
                    href="/incidents"
                    className="focus-ring -mx-1 rounded-md px-1 text-foreground underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:inline-flex pointer-coarse:items-center"
                  >
                    Review them in the queue
                  </Link>
                  .
                </>
              ) : (
                closeSummary
              )}
            </p>
          ) : null}
        </div>
      ) : null}
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
                  <p
                    className="mt-1 truncate font-data text-xs text-muted-foreground"
                    title={item.incident_id}
                  >
                    {item.incident_id}
                  </p>
                  {/* The current step moves to the row's end from sm up,
                      where the wider row holds it inline; on phones it
                      stacks under the id — the same fact the /incidents
                      queue's mobile cards keep — instead of disappearing.
                      Truncation needs the full text reachable, so the title
                      mirrors the sm+ span. */}
                  <p
                    className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden"
                    title={stepLabel(item.current_step)}
                  >
                    {stepLabel(item.current_step)}
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
            {/* The tally above counts the recorded roster; this note must
                not contradict it. An empty roster with a nonzero count
                means the records are gone, not that the batch accepted
                nothing. */}
            {total === 0
              ? "No exceptions were recorded for this batch."
              : "None of the exceptions recorded for this batch are still available."}
          </div>
        )}
      </Card>
    </main>
  );
}
