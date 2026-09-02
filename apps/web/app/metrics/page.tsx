import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight } from "lucide-react";
import { liveTenantMetrics } from "@/lib/metrics";
import { requestContext, listIncidentDtos } from "@/lib/incidents";
import { SourceBadge } from "@/components/shared/source-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import {
  formatAge,
  formatCount,
  formatPercent,
} from "@/components/shared/format";
import { Button } from "@/components/ui/button";
import { MetricBand } from "@/components/metrics/metric-band";
import { rateTone, countTone } from "@/components/metrics/band-tone";
import { BenchmarkResults } from "@/components/metrics/benchmark-results";
import { IncidentSummaryLedger } from "@/components/incidents/incident-summary-ledger";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Metrics" };

function closureTime(value: number | null) {
  return value === null ? "None yet" : formatAge(value);
}

export default async function MetricsPage() {
  const headerList = await headers();
  const { tenantId } = requestContext(headerList);
  /* Two reads of the same store: rates and timings come from the metrics
     aggregate, but the queue-state ledger also needs the ambiguous count,
     which TenantMetrics does not carry. Tallying the same DTO list the
     queue page reduces keeps this strip and the queue's own strip in
     agreement (advise 2). */
  const [measured, incidents] = await Promise.all([
    liveTenantMetrics(tenantId),
    listIncidentDtos(tenantId),
  ]);
  const queueSummary = incidents.reduce<Record<string, number>>(
    (result, item) => {
      result[item.status] = (result[item.status] ?? 0) + 1;
      return result;
    },
    {},
  );
  // The ledger cells are cross-page navigation: each state opens the queue
  // pre-filtered to it, the same destinations the queue's own strip toggles.
  const queueHrefs = {
    pending: "/incidents?status=pending",
    reconciled: "/incidents?status=reconciled",
    escalated: "/incidents?status=escalated",
    ambiguous: "/incidents?status=ambiguous",
  };
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Metrics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live exception outcomes and the offline benchmark that measures
            controller quality.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveRefresh endpoint="/api/metrics" label="Metrics" />
          <Button
            render={<Link href="/failure-scenarios" />}
            variant="outline"
            data-icon="inline-end"
            className="max-sm:w-full max-sm:flex-1"
          >
            Review failure scenarios <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      {/* Section cadence: h2 sections turn at mt-10 (the benchmark's border
          makes the chapter break), h3 groups inside them sit mt-8, and each
          section leads with its headline KPI strip before its named groups —
          the same shape in both sections so live and offline read as peers
          (advise 17). */}
      <section aria-labelledby="measured-heading" className="mt-10">
        {/* The heading carries the section; provenance rides its baseline
            as metadata, the same role the count plays next to the page
            titles on the queue and batches screens. */}
        <div className="mb-7 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="measured-heading" className="text-lg font-semibold">
            Measured outcomes
          </h2>
          <SourceBadge source="measured_live" />
        </div>
        {measured.total === 0 ? (
          /* First-use state: a wall of zeros teaches nothing. The section
             heading and its provenance stay; the bands wait for data. */
          <div className="rounded-xl bg-surface-subtle px-5 py-16 text-center">
            <p className="font-display text-2xl font-medium tracking-tight">
              No exceptions recorded yet
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              These metrics fill in as exceptions reach outcomes in the queue.
              The benchmark below already measures controller quality.
            </p>
          </div>
        ) : (
          <>
            {/* The section's lead group: the live pipeline's headline
                measurements in one bounded strip. "Duplicate actions
                prevented" is the fifth cell, not a queue facet (advise 2):
                it measures the live system, so it belongs beside the
                outcome rates rather than among the state counts below. */}
            <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-surface sm:grid-cols-2 lg:grid-cols-5">
              <MetricBand
                value={formatCount(measured.total)}
                label="Exceptions recorded"
                tone="default"
                hint="Every exception the live queue has recorded, whatever its state."
              />
              <MetricBand
                value={
                  measured.repair_success_rate === null
                    ? "None yet"
                    : formatPercent(measured.repair_success_rate)
                }
                label="Resolution rate"
                tone={rateTone(measured.repair_success_rate)}
                muted={measured.repair_success_rate === null}
                hint="Verified exceptions out of all exceptions that reached an outcome."
              />
              {/* Same label as its benchmark twin: the live share and the
                  benchmark coverage name one concept — repairs that a
                  check after the action actually confirmed. The hint
                  carries each side's basis. */}
              <MetricBand
                value={
                  measured.post_repair_state_verified_share === null
                    ? "None yet"
                    : formatPercent(measured.post_repair_state_verified_share)
                }
                label="Repairs verified after action"
                tone={rateTone(measured.post_repair_state_verified_share)}
                muted={measured.post_repair_state_verified_share === null}
                hint="Checks that confirmed the repair, out of all checks run."
              />
              <MetricBand
                value={closureTime(measured.median_time_to_close_seconds)}
                label="Median time to close"
                tone="default"
                muted={measured.median_time_to_close_seconds === null}
                hint="From first evidence to a resolved or escalated outcome."
              />
              <MetricBand
                value={formatCount(measured.duplicates_prevented)}
                label="Duplicate actions prevented"
                tone={countTone(measured.duplicates_prevented, "safe")}
                hint="Repeat recoveries stopped because the action had already completed."
              />
            </div>
            {/* The queue-facet counts reuse the queue page's linked strip
                (advise 2): the same geometry, click-to-filter navigation,
                and pending spinner, so the pattern reads as one control
                across pages. */}
            <section aria-labelledby="queue-state-heading" className="mt-8">
              <h3 id="queue-state-heading" className="text-base font-semibold">
                Where exceptions stand
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Each state opens its filtered queue.
              </p>
              <div className="mt-5">
                <IncidentSummaryLedger
                  summary={queueSummary}
                  hrefs={queueHrefs}
                />
              </div>
            </section>
          </>
        )}
      </section>
      <BenchmarkResults />
    </main>
  );
}
