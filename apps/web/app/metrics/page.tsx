import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { AlertTriangle, ArrowRight, ShieldCheck } from "lucide-react";
import {
  syntheticEvaluationMetrics as metrics,
  liveTenantMetrics,
} from "@/lib/metrics";
import { requestContext } from "@/lib/incidents";
import { SourceBadge } from "@/components/shared/source-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { MetricBand } from "@/components/metrics/metric-band";
import { OutcomeDistribution } from "@/components/metrics/outcome-distribution";
import { formatAge } from "@/components/shared/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Metrics" };
const percent = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);

function closureTime(value: number | null) {
  return value === null ? "No closures yet" : formatAge(value);
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
      <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3">
            <SourceBadge source="measured_live" />
          </div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
            Metrics
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Current exception outcomes and the offline benchmark used to check
            controller quality.
          </p>
        </div>
        <LiveRefresh endpoint="/api/metrics" label="Metrics" />
      </div>
      <section
        aria-labelledby="measured-heading"
        className="mt-10 grid gap-x-14 gap-y-10 lg:grid-cols-2"
      >
        <div className="lg:col-span-2">
          <div className="mb-7 flex items-baseline gap-3">
            <span className="font-data text-2xs text-muted-foreground">
              Live
            </span>
            <h2 id="measured-heading" className="text-lg font-semibold">
              Measured outcomes
            </h2>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <MetricBand
              value={String(measured.total)}
              label="Exceptions recorded"
              tone="default"
            />
            <MetricBand
              value={
                measured.repair_success_rate === null
                  ? "No closures yet"
                  : percent(measured.repair_success_rate)
              }
              label="Repair success"
              tone="safe"
              note="Verified exceptions out of all exceptions with a completed outcome."
            />
            <MetricBand
              value={
                measured.post_repair_state_verified_share === null
                  ? "No repairs yet"
                  : percent(measured.post_repair_state_verified_share)
              }
              label="Post-action verification"
              tone="safe"
            />
            <MetricBand
              value={closureTime(measured.median_time_to_close_seconds)}
              label="Median time to close"
              tone="default"
            />
          </div>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <MetricBand
              value={String(measured.pending)}
              label="Pending"
              tone="warning"
            />
            <MetricBand
              value={String(measured.reconciled)}
              label="Verified"
              tone="safe"
            />
            <MetricBand
              value={String(measured.escalated)}
              label="Escalated"
              tone="destructive"
            />
            <MetricBand
              value={String(measured.duplicates_prevented)}
              label="Duplicate repairs prevented"
              tone="safe"
            />
          </div>
        </div>
      </section>
      <section
        aria-labelledby="baseline-heading"
        className="mt-10 border-t border-border pt-10"
      >
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <SourceBadge source="synthetic_evaluation" />
            <h2 id="baseline-heading" className="mt-3 text-lg font-semibold">
              Offline benchmark
              <span className="ml-2 font-data text-xs font-normal text-muted-foreground">
                n={metrics.denominator}
              </span>
            </h2>
          </div>
          <Link
            href="/failure-scenarios"
            className="focus-ring inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline hover:underline-offset-4"
          >
            Review failure scenarios
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-2">
          <section aria-labelledby="classification-heading">
            <div className="mb-6 flex items-baseline gap-3">
              <span className="font-data text-2xs text-muted-foreground">
                01
              </span>
              <h3
                id="classification-heading"
                className="text-base font-semibold"
              >
                Exception types
              </h3>
            </div>
            <div className="grid gap-8 sm:grid-cols-2">
              <MetricBand
                value={percent(metrics.incident_classification_accuracy)}
                label="Exception type accuracy"
                tone="safe"
              />
              <MetricBand
                value={metrics.incident_classification_macro_f1.toFixed(2)}
                label="Balanced accuracy across exception types"
                tone="safe"
                note="Macro F1. Every exception type weighed equally."
              />
            </div>
          </section>
          <section aria-labelledby="correlation-heading">
            <div className="mb-6 flex items-baseline gap-3">
              <span className="font-data text-2xs text-muted-foreground">
                02
              </span>
              <h3 id="correlation-heading" className="text-base font-semibold">
                Payment-to-order matching
              </h3>
            </div>
            <MetricBand
              value={percent(metrics.exact_payment_order_matching_accuracy)}
              label="Exact payment-to-order matches"
              tone="warning"
              note="Exception type accuracy does not compensate for weak payment-to-order matching."
            />
          </section>
          <section aria-labelledby="closure-heading" className="lg:col-span-2">
            <div className="mb-6 flex items-baseline gap-3">
              <span className="font-data text-2xs text-muted-foreground">
                03
              </span>
              <h3 id="closure-heading" className="text-base font-semibold">
                Closure and safety
              </h3>
            </div>
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <MetricBand
                value={percent(metrics.post_repair_state_verification_coverage)}
                label="Post-action checks completed"
                tone="warning"
              />
              <MetricBand
                value={
                  metrics.duplicate_action_prevention_count !== null
                    ? String(metrics.duplicate_action_prevention_count)
                    : "Unavailable"
                }
                label="Duplicate actions prevented"
                tone="safe"
              />
              <MetricBand
                value={String(metrics.unsafe_recommendations)}
                label="Unsafe recommendations"
                tone="safe"
              />
              <MetricBand
                value={String(metrics.unsafe_side_effects)}
                label="Unsafe side effects"
                tone="safe"
              />
            </div>
            <div className="mt-7 flex gap-3 border-l-2 border-warning bg-warning-soft px-4 py-3">
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-warning"
              />
              <p className="text-sm leading-6 text-muted-foreground">
                Cases without a fresh post-action check remain escalated and
                must not be counted as recovered.
              </p>
            </div>
          </section>
          <OutcomeDistribution
            items={[
              {
                label: "Verified",
                value: metrics.automatic_count,
                className: "bg-primary",
              },
              {
                label: "Guided resolution",
                value: metrics.runbook_count,
                className: "bg-provider",
              },
              {
                label: "No action",
                value: metrics.no_action_count,
                className: "bg-ink-tertiary",
              },
              {
                label: "Ambiguous",
                value: metrics.ambiguous_count,
                className: "bg-warning",
              },
            ]}
          />
        </div>
      </section>
      <section className="mt-10 border-t border-border pt-6">
        <div className="flex items-start gap-3">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-4 text-primary"
          />
          <div>
            <h2 className="text-sm font-semibold">Not measured yet</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Review time and integration failure rates are not collected for
              this dataset.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
