import { AlertTriangle } from "lucide-react";
import { SourceBadge } from "@/components/shared/source-badge";
import { formatCount, formatPercent } from "@/components/shared/format";
import { MetricBand } from "@/components/metrics/metric-band";
import { countTone } from "@/components/metrics/band-tone";
import { OutcomeDistribution } from "@/components/metrics/outcome-distribution";
import {
  matchableBenchmarkCases,
  syntheticEvaluationMetrics as metrics,
} from "@/lib/benchmark";

/* The offline benchmark section, on its own so the metrics page and its
   error boundary render the same benchmark: when the live store is
   unreachable the boundary degrades to this benchmark-only page instead
   of a bare 500. Static shipped data only — importing the live store here
   would drag it into the client bundle the boundary lives in. */
export function BenchmarkResults() {
  return (
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
          <span className="font-data">{formatCount(metrics.denominator)}</span>
          &nbsp;cases
        </span>
      </div>
      {/* Benchmark tones describe the shipped baseline report and stay
          pinned to it rather than re-deriving at runtime: exact match and
          classification results are verified strengths (safe), post-action
          verification coverage is the known weak spot (warning). The pinned
          verdicts agree with the live page's shared rate bar (safe from
          75% up) — 100% accuracy clears it, 37% coverage falls under it —
          so both sections read color the same way. Count bands still derive
          their dot from the value. */}
      <div className="grid grid-cols-1 overflow-hidden rounded-xl bg-surface sm:grid-cols-2 lg:grid-cols-3">
        <MetricBand
          value={formatPercent(metrics.incident_classification_accuracy)}
          label="Exception type accuracy"
          tone="safe"
          hint="Benchmark cases where the controller named the correct exception type."
        />
        {/* Macro F1 renders on the same percent scale as its strip peers:
            a unitless 0–1 figure beside percent bands forces a mental
            conversion inside one scan group. The hint keeps the method. */}
        <MetricBand
          value={formatPercent(metrics.incident_classification_macro_f1)}
          label="Accuracy averaged across types"
          tone="safe"
          hint="Every exception type counts equally, common or rare (macro F1)."
        />
        <MetricBand
          value={formatPercent(metrics.exact_payment_order_matching_accuracy)}
          label="Exact payment-to-order matches"
          tone="safe"
          hint={`On the ${formatCount(matchableBenchmarkCases)} of ${formatCount(
            metrics.denominator,
          )} cases where a match was expected.`}
        />
      </div>
      <section aria-labelledby="closure-heading" className="mt-8">
        <h3 id="closure-heading" className="text-base font-semibold">
          Closure and safety
        </h3>
        {/* The caveat rides above the KPIs (advise 21): it changes how
           every number below reads — "verified" means checked-after-repair
           — so the operator meets the qualifier before the figures, not
           after. Full width within its section (advise 20): it qualifies
           the whole benchmark, so it spans the same measure as the strips.
           Ink is the warning hue, not gray: tinted surfaces never carry
           gray text. */}
        <div className="mt-4 flex gap-3 rounded-xl bg-warning-soft px-4 py-3">
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-warning"
          />
          <p className="text-sm leading-6 text-warning">
            Only cases with a check after the repair action count as verified.
            The rest stay escalated.
          </p>
        </div>
        <div className="mt-5 grid grid-cols-1 overflow-hidden rounded-xl bg-surface sm:grid-cols-2 lg:grid-cols-3">
          <MetricBand
            value={formatPercent(
              metrics.post_repair_state_verification_coverage,
            )}
            label="Repairs verified after action"
            tone="warning"
            hint="Share of all benchmark cases."
          />
          <MetricBand
            value={formatCount(metrics.unsafe_recommendations)}
            label="Unsafe recommendations"
            tone={countTone(metrics.unsafe_recommendations, "destructive")}
            hint="Money-moving actions recommended, such as refunds or captures."
          />
          <MetricBand
            value={formatCount(metrics.unsafe_side_effects)}
            label="Unsafe side effects"
            tone={countTone(metrics.unsafe_side_effects, "destructive")}
            hint="Cases closed by executing a money-moving action."
          />
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
  );
}
