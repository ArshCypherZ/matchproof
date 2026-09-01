import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AlertTriangle, ArrowRight } from "lucide-react";
import {
  syntheticEvaluationMetrics as metrics,
  liveTenantMetrics,
} from "@/lib/metrics";
// The exact-match rate is computed only on cases where a match was expected,
// so its band must state that basis. lib/metrics is shared and page-agnostic;
// the count is derived here from the same report import.
import report from "../../../../evaluation/baseline.json";
import { requestContext } from "@/lib/incidents";
import { SourceBadge } from "@/components/shared/source-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { Button } from "@/components/ui/button";
import { MetricBand } from "@/components/metrics/metric-band";
import { OutcomeDistribution } from "@/components/metrics/outcome-distribution";
import { formatAge } from "@/components/shared/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Metrics" };

// Formatters are built once: the measured counts on this page can reach the
// thousands, and every band formats at least one number.
const countFormat = new Intl.NumberFormat("en-IN");
const percentRound = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 0,
});
const percentPrecise = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 1,
});

/* A whole-percent format turns 99.6% into "100%" and 0.4% into "0%" — a
   rounding lie on the exact numbers an operator audits. At either boundary
   keep one decimal. A missing metric renders "Unavailable", never "NaN%". */
const percent = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  const rounded = Math.round(value * 100);
  return rounded === 0 || rounded === 100
    ? percentPrecise.format(value)
    : percentRound.format(value);
};

const count = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Unavailable"
    : countFormat.format(value);

const decimalFormat = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimal2 = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "Unavailable"
    : decimalFormat.format(value);

const records = report.records ?? [];
const matchableCases = records.filter(
  (row) => row.expected_match !== "abstained",
).length;

function closureTime(value: number | null) {
  return value === null ? "None yet" : formatAge(value);
}

/* The rate bands carry a dot only once there is a rate to judge: a muted
   "None yet" with a success dot contradicts itself, and a measured 0% with
   one is a green light on a record with nothing resolved. */
function rateTone(rate: number | null) {
  if (rate === null) return "default" as const;
  return rate > 0 ? ("safe" as const) : ("warning" as const);
}

/* Count bands follow the same rule: a dot appears only when the count is
   non-zero. A green dot beside "Verified 0" would contradict the amber one
   on "Resolution rate 0%", and a red dot on "Unsafe recommendations 0"
   alarms on a healthy state. */
function countTone(
  value: number | null,
  tone: "warning" | "safe" | "destructive",
) {
  return value !== null && value > 0 ? tone : ("default" as const);
}

export default async function MetricsPage() {
  const headerList = await headers();
  const { tenantId } = requestContext(headerList);
  const measured = await liveTenantMetrics(tenantId);
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Metrics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live exception outcomes and the offline benchmark used to check
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
      <section aria-labelledby="measured-heading" className="mt-10">
        {/* The heading carries the section; provenance and the case count
            ride its baseline as metadata, the same role the count plays
            next to the page titles on the queue and batches screens. */}
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
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <MetricBand
                value={count(measured.total)}
                label="Exceptions recorded"
                tone="default"
              />
              <MetricBand
                value={
                  measured.repair_success_rate === null
                    ? "None yet"
                    : percent(measured.repair_success_rate)
                }
                label="Resolution rate"
                tone={rateTone(measured.repair_success_rate)}
                muted={measured.repair_success_rate === null}
                note="Verified exceptions out of all exceptions that reached an outcome."
              />
              <MetricBand
                value={
                  measured.post_repair_state_verified_share === null
                    ? "None yet"
                    : percent(measured.post_repair_state_verified_share)
                }
                label="Post-action verification"
                tone={rateTone(measured.post_repair_state_verified_share)}
                muted={measured.post_repair_state_verified_share === null}
                note="Checks that confirmed the repair, out of all checks run."
              />
              <MetricBand
                value={closureTime(measured.median_time_to_close_seconds)}
                label="Median time to close"
                tone="default"
                muted={measured.median_time_to_close_seconds === null}
                note="From first evidence to a resolved or escalated outcome."
              />
            </div>
            <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {/* The three queue-facet counts drill down to the filtered
                  queue; the label is the link, the value stays pure data. */}
              <MetricBand
                value={count(measured.pending)}
                label="Pending"
                tone={countTone(measured.pending, "warning")}
                href="/incidents?status=pending"
              />
              <MetricBand
                value={count(measured.reconciled)}
                label="Verified"
                tone={countTone(measured.reconciled, "safe")}
                href="/incidents?status=reconciled"
              />
              <MetricBand
                value={count(measured.escalated)}
                label="Escalated"
                tone={countTone(measured.escalated, "destructive")}
                href="/incidents?status=escalated"
              />
              <MetricBand
                value={count(measured.duplicates_prevented)}
                label="Duplicate actions prevented"
                tone={countTone(measured.duplicates_prevented, "safe")}
              />
            </div>
          </>
        )}
      </section>
      <section
        aria-labelledby="baseline-heading"
        className="mt-10 border-t border-border pt-10"
      >
        <div className="mb-7 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="baseline-heading" className="text-lg font-semibold">
            Benchmark results
          </h2>
          <SourceBadge source="synthetic_evaluation" />
          <span className="text-xs text-muted-foreground">
            {/* Non-breaking space: the count must not orphan from "cases". */}
            <span className="font-data">{count(metrics.denominator)}</span>
            &nbsp;cases
          </span>
        </div>
        {/* Benchmark tones describe the shipped baseline report: the exact
            match and classification results are verified strengths (safe),
            post-action verification coverage is the known weak spot
            (warning). Count bands still derive their dot from the value. */}
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <MetricBand
            value={percent(metrics.incident_classification_accuracy)}
            label="Exception type accuracy"
            tone="safe"
          />
          <MetricBand
            value={decimal2(metrics.incident_classification_macro_f1)}
            label="Accuracy averaged across types"
            tone="safe"
            note="Macro F1. Every exception type counts equally."
          />
          <MetricBand
            value={percent(metrics.exact_payment_order_matching_accuracy)}
            label="Exact payment-to-order matches"
            tone="safe"
            note={`On the ${count(matchableCases)} of ${count(
              metrics.denominator,
            )} cases where a match was expected.`}
          />
        </div>
        <section aria-labelledby="closure-heading" className="mt-10">
          <h3 id="closure-heading" className="text-base font-semibold">
            Closure and safety
          </h3>
          <div className="mt-5 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <MetricBand
              value={percent(metrics.post_repair_state_verification_coverage)}
              label="Repairs verified after action"
              tone="warning"
              note="Share of all benchmark cases."
            />
            <MetricBand
              value={count(metrics.unsafe_recommendations)}
              label="Unsafe recommendations"
              tone={countTone(metrics.unsafe_recommendations, "destructive")}
              note="Money-moving actions recommended, such as refunds or captures."
            />
            <MetricBand
              value={count(metrics.unsafe_side_effects)}
              label="Unsafe side effects"
              tone={countTone(metrics.unsafe_side_effects, "destructive")}
              note="Cases closed by executing a money-moving action."
            />
          </div>
          {/* Capped so the caveat keeps a reading measure instead of one
             line stretched across the full workspace rail. Ink is the
             warning hue, not gray: tinted surfaces never carry gray text. */}
          <div className="mt-7 flex max-w-3xl gap-3 rounded-xl bg-warning-soft px-4 py-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <p className="text-sm leading-6 text-warning">
              Only cases with a check after the repair action count as verified.
              The rest stay escalated.
            </p>
          </div>
        </section>
        <OutcomeDistribution
          items={[
            {
              label: "Resolved automatically",
              value: metrics.automatic_count,
              tone: "success",
            },
            {
              label: "Guided resolution",
              value: metrics.runbook_count,
              tone: "provider",
            },
            {
              label: "No action needed",
              value: metrics.no_action_count,
              tone: "muted",
            },
            {
              label: "Ambiguous",
              value: metrics.ambiguous_count,
              tone: "warning",
            },
          ]}
        />
      </section>
    </main>
  );
}
