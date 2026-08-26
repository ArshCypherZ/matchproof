import type { Metadata } from "next";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { syntheticEvaluationMetrics as metrics } from "@/lib/metrics";
import { SourceBadge } from "@/components/shared/source-badge";
import { MetricBand } from "@/components/metrics/metric-band";
import { OutcomeDistribution } from "@/components/metrics/outcome-distribution";

export const metadata: Metadata = { title: "Metrics" };
const percent = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value);

export default function MetricsPage() {
  const source = `${metrics.source}, n=${metrics.denominator}`;
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="border-b border-border pb-5">
        <div className="mb-3">
          <SourceBadge source="synthetic_evaluation" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Metrics</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Measured baseline quality, closure coverage, and unsafe behavior
          counts.
        </p>
      </div>
      <div className="mt-7 grid gap-x-14 gap-y-10 lg:grid-cols-2">
        <section aria-labelledby="classification-heading">
          <h2
            id="classification-heading"
            className="mb-6 text-base font-semibold"
          >
            Classification
          </h2>
          <div className="grid gap-8 sm:grid-cols-2">
            <MetricBand
              value={percent(metrics.incident_classification_accuracy)}
              label="Incident classification accuracy"
              source={source}
              tone="safe"
            />
            <MetricBand
              value={metrics.incident_classification_macro_f1.toFixed(2)}
              label="Classification macro F1"
              source={source}
              tone="safe"
            />
          </div>
        </section>
        <section aria-labelledby="correlation-heading">
          <h2 id="correlation-heading" className="mb-6 text-base font-semibold">
            Correlation
          </h2>
          <MetricBand
            value={percent(metrics.exact_payment_order_matching_accuracy)}
            label="Exact payment and order match"
            source={source}
            tone="warning"
            note="Strong incident classification does not compensate for weak identity correlation."
          />
        </section>
        <section aria-labelledby="closure-heading">
          <h2 id="closure-heading" className="mb-6 text-base font-semibold">
            Closure and safety
          </h2>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <MetricBand
              value={percent(metrics.afterstate_verification_coverage)}
              label="Afterstate coverage"
              source={source}
              tone="warning"
            />
            <MetricBand
              value={
                metrics.duplicate_action_prevention_count !== null
                  ? String(metrics.duplicate_action_prevention_count)
                  : "Unavailable"
              }
              label="Duplicate actions prevented"
              source={source}
              tone="safe"
            />
            <MetricBand
              value={String(metrics.unsafe_recommendations)}
              label="Unsafe recommendations"
              source={source}
              tone="safe"
            />
            <MetricBand
              value={String(metrics.unsafe_side_effects)}
              label="Unsafe side effects"
              source={source}
              tone="safe"
            />
          </div>
          <div className="mt-7 flex gap-3 border-l-2 border-warning bg-warning-soft px-4 py-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            <p className="text-sm leading-6 text-muted-foreground">
              Afterstate verification remains unavailable in this baseline. No
              run should be presented as a verified recovery result.
            </p>
          </div>
        </section>
        <OutcomeDistribution />
      </div>
      <section className="mt-10 border-t border-border pt-6">
        <div className="flex items-start gap-3">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-4 text-primary"
          />
          <div>
            <h2 className="text-sm font-semibold">Unavailable measurements</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Operator review time and provider or merchant integration failure
              counts have no recorded denominator in the current evaluation.
              They are unavailable, not zero.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
