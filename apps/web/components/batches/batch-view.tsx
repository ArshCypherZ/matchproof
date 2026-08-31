"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight } from "lucide-react";
import { CloseStamp } from "@/components/shared/close-stamp";
import { SourceBadge } from "@/components/shared/source-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { Tally } from "@/components/shared/tally";
import { stepLabel } from "@/components/shared/step-labels";

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
  return date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
  const recordWord = total === 1 ? "record" : "records";
  const outcomeParts = [
    verified ? `${verified} verified` : "",
    escalated ? `${escalated} escalated` : "",
    ambiguous ? `${ambiguous} ambiguous` : "",
  ].filter(Boolean);
  const closeSummary =
    verified > 0 && escalated === 0 && ambiguous === 0
      ? `Batch closed. All ${total} ${recordWord} verified.`
      : verified === 0
        ? `Batch closed. All ${total} ${recordWord} stayed on the exception list with evidence.`
        : `Batch closed. ${outcomeParts.join(" · ")}.`;
  const classLabel = (value: string) => value.replaceAll("_", " ");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3">
            <SourceBadge
              source={incidents[0]?.source_kind ?? "fixture_rehearsal"}
            />
          </div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
            Batch {batchId.slice(0, 8)}
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Track each exception until it is verified, escalated, or flagged
            ambiguous.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {closed ? <CloseStamp label="Closed" pressed={justClosed} /> : null}
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
        <div
          className={`grid grid-cols-2 border-t border-border sm:grid-cols-3 lg:grid-cols-6 ${closed ? "" : "border-b"}`}
        >
          <div className="border-b border-r border-border px-4 py-3 lg:border-b-0">
            <p className="font-display text-3xl font-medium tabular-nums">
              <Tally value={incidents.length} />
            </p>
            <p className="mt-1 font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
              Records
            </p>
          </div>
          <div className="border-b border-border px-4 py-3 sm:border-r lg:border-b-0">
            <p className="font-display text-3xl font-medium tabular-nums">
              <Tally value={pending} />
            </p>
            <p className="mt-1 font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
              Pending
            </p>
          </div>
          <div className="border-b border-r border-border px-4 py-3 sm:border-r-0 lg:border-b-0 lg:border-r">
            <p className="font-display text-3xl font-medium tabular-nums">
              <Tally value={verified} />
            </p>
            <p className="mt-1 font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
              Verified
            </p>
          </div>
          <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
            <p className="font-display text-3xl font-medium tabular-nums">
              <Tally value={escalated} />
            </p>
            <p className="mt-1 font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
              Escalated
            </p>
          </div>
          <div className="border-r border-border px-4 py-3">
            <p className="font-display text-3xl font-medium tabular-nums">
              <Tally value={ambiguous} />
            </p>
            <p className="mt-1 font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
              Ambiguous
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="font-display text-3xl font-medium tabular-nums">
              {startedTime(startedAt)}
            </p>
            <p className="mt-1 font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
              Started
            </p>
          </div>
        </div>
        <div
          role="progressbar"
          aria-label="Batch completion"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, incidents.length)}
          aria-valuenow={terminal}
          aria-valuetext={`${terminal} of ${incidents.length} records completed`}
          className="h-0.5 bg-border"
        >
          <div
            className="h-full origin-left bg-primary transition-transform duration-[400ms] ease-[var(--ease-out-expo)] motion-reduce:transition-none"
            style={{
              transform: `scaleX(${incidents.length ? terminal / incidents.length : 0})`,
            }}
          />
        </div>
        {closed ? (
          <div className="ledger-close-rule mt-7 pt-4">
            <p className="max-w-2xl font-serif text-xl leading-snug sm:text-2xl">
              {closeSummary}
            </p>
          </div>
        ) : null}
      </div>
      <div className="mt-8 overflow-hidden border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <Activity aria-hidden="true" className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Exceptions</h2>
          </div>
          <span className="font-data text-xs text-muted-foreground">
            {closed
              ? `All ${incidents.length} records completed`
              : `${terminal} of ${incidents.length} completed`}
          </span>
        </div>
        <div className="divide-y divide-border">
          {incidents.length ? (
            incidents.map((item, index) => (
              <Link
                key={item.incident_id}
                href={`/incidents/${item.incident_id}`}
                className="focus-ring animate-in fade-in slide-in-from-bottom-2 flex items-center justify-between gap-4 px-4 py-4 duration-500 hover:bg-surface-subtle sm:px-5"
                style={{
                  animationDelay: `${Math.min(index, 8) * 45}ms`,
                  animationFillMode: "both",
                }}
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-sm font-medium capitalize">
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
            ))
          ) : (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              No exceptions were recorded for this batch.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
