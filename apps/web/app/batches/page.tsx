import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight } from "lucide-react";
import {
  requestContext,
  listBatchDtos,
  listIncidentDtos,
} from "@/lib/incidents";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CountChip } from "@/components/shared/count-chip";
import { formatDate } from "@/components/shared/format";
import { statusBucket } from "@/components/shared/status-bucket";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { StartBatchButton } from "@/components/batches/start-batch-button";

export const metadata: Metadata = { title: "Batches" };

export const dynamic = "force-dynamic";

// A status band is a live state, not a brand mark. Pending and ambiguous
// ask for different responses, so they must not share a swatch: pending
// reads as caution (awaiting the operator), ambiguous as the neutral
// indeterminate ink — the system could not decide, which is information,
// not a warning. Escalated is destructive, verified is success, the same
// pairing the queue's StatusBadge variants draw. Segments are sized by
// each status's share of the batch, so the read stays honest at any batch
// size, and the legend beside the section heading, the aria-label, and
// the row's title spell out the exact counts beside the colors.
const SEGMENT_TONES = [
  ["pending", "Pending", "bg-warning"],
  ["ambiguous", "Ambiguous", "bg-ink-tertiary"],
  ["escalated", "Escalated", "bg-destructive"],
  ["reconciled", "Verified", "bg-success"],
] as const;

export default async function BatchesPage() {
  const headerList = await headers();
  const { tenantId } = requestContext(headerList);
  const [batches, incidents] = await Promise.all([
    listBatchDtos(tenantId),
    listIncidentDtos(tenantId),
  ]);
  const incidentStatus = new Map(
    incidents.map((incident) => [incident.incident_id, incident.status]),
  );
  const pendingIncidentIds = incidents
    .filter((item) => item.status === "pending")
    .map((item) => item.incident_id);
  const batchWord = batches.length === 1 ? "batch" : "batches";
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Batches
            </h1>
            {/* Baseline-aligned with the title so figure and heading read as
                one row; boxed on a tonal surface so the count is a unit,
                not a stray number floating beside the heading. */}
            <CountChip value={batches.length}>{batchWord}</CountChip>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Start a batch from pending exceptions and track it to a close.
          </p>
        </div>
        {/* The action group lives in the header's right-end slot, so its
            children right-align from sm up: buttons and the reason line
            share the same right edge, reading as one block anchored to the
            slot. Below sm the buttons go full width, so the column keeps
            its start alignment — a right-aligned reason under full-width
            buttons would float. */}
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <LiveRefresh endpoint="/api/batches/fingerprint" label="Batches" />
            <Button
              render={<Link href="/incidents" />}
              variant="outline"
              data-icon="inline-end"
              className="max-sm:w-full"
            >
              Select exceptions <ArrowRight aria-hidden="true" />
            </Button>
            <StartBatchButton
              incidentIds={pendingIncidentIds}
              reasonId="start-batch-reason"
            />
          </div>
          <p id="start-batch-reason" className="text-xs text-muted-foreground">
            {pendingIncidentIds.length
              ? `Starts a batch with all ${pendingIncidentIds.length} pending ${
                  pendingIncidentIds.length === 1 ? "exception" : "exceptions"
                }.`
              : "Nothing to batch. Every exception is verified, escalated, or flagged ambiguous."}
          </p>
        </div>
      </div>
      <Card className="mt-10">
        <CardHeader>
          <h2 className="text-sm font-semibold">Batch history</h2>
          {/* The band's colors are meaningless without their words: the
              legend rides the header row, keyed to the same tone array the
              rows render, so sighted and colorblind operators read the
              proportions without opening a batch. */}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {SEGMENT_TONES.map(([key, label, tone]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-2 ${tone}`} />
                {label}
              </span>
            ))}
          </div>
        </CardHeader>
        {batches.length ? (
          <div className="divide-y divide-border">
            {batches.map((batch) => {
              const counts = batch.incident_ids.reduce(
                (result, incidentId) => {
                  // The same bucketing the batch detail tallies through:
                  // an unknown or missing status reads as pending, so the
                  // two pages cannot disagree about the same batch.
                  const key = statusBucket(incidentStatus.get(incidentId));
                  result[key] += 1;
                  return result;
                },
                { pending: 0, reconciled: 0, escalated: 0, ambiguous: 0 },
              );
              const exceptionWord =
                batch.incident_ids.length === 1 ? "exception" : "exceptions";
              // The row's spoken name reads its meaning, not its hex: only
              // statuses the batch actually holds enter the label.
              const composition = SEGMENT_TONES.filter(
                ([key]) => counts[key] > 0,
              )
                .map(([key, label]) => `${counts[key]} ${label.toLowerCase()}`)
                .join(", ");
              return (
                /* One row, one human label: when the batch started leads,
                    and the id follows at its slice(0, 8) — the same short
                    form the detail heading shows — so a 36-character UUID
                    never becomes the row's identity. From sm up the label,
                    band, and arrow share a line; below it the band flexes
                    into the width the label gives up, giving its
                    proportions more resolution than the fixed desktop
                    width. Press feedback reuses the hover tone: touch
                    never fires hover. History is append-only, so each row
                    also carries the touch-action floor Buttons get and a
                    content-visibility guard that keeps a long-lived
                    tenant's list cheap to paint. */
                <Link
                  key={batch.batch_id}
                  href={`/batches/${batch.batch_id}`}
                  /* The band's proportions reach sighted operators too, not
                     only the aria-label: hovering the row speaks the same
                     composition string. An empty roster has no composition
                     to speak. */
                  title={composition || undefined}
                  className="focus-ring touch-manipulation [contain-intrinsic-size:auto_4.5rem] [content-visibility:auto] flex flex-col gap-2 px-4 py-4 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] hover:bg-surface-subtle active:bg-surface-subtle sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {formatDate(batch.started_at)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="font-data" title={batch.batch_id}>
                        {batch.batch_id.slice(0, 8)}
                      </span>
                      {" · "}
                      <span className="font-data">
                        {batch.incident_ids.length}
                      </span>{" "}
                      {exceptionWord}
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-3 sm:shrink-0 sm:gap-4">
                    {/* A batch that accepted nothing has no proportions to
                        show: a blank strip reading "0, 0, 0, 0" would look
                        broken, so the row speaks through its count alone. */}
                    {batch.incident_ids.length > 0 ? (
                      <div
                        role="img"
                        aria-label={composition}
                        className="flex h-2 flex-1 overflow-hidden sm:w-28 sm:flex-none"
                      >
                        {SEGMENT_TONES.map(([key, , tone]) => (
                          <span
                            key={key}
                            className={tone}
                            style={{ flexGrow: counts[key] }}
                          />
                        ))}
                      </div>
                    ) : null}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="bg-surface-subtle px-5 py-16 text-center">
            <p className="font-display text-2xl font-medium tracking-tight">
              No batches yet
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {pendingIncidentIds.length
                ? "Start a batch with every pending exception, or select specific ones in the queue."
                : "Nothing is pending right now. Batches start from pending exceptions in the queue."}
            </p>
            <Button
              render={<Link href="/incidents" />}
              data-icon="inline-end"
              className="mt-5"
            >
              Select exceptions <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </Card>
    </main>
  );
}
