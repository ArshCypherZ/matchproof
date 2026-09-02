import report from "../../../evaluation/baseline.json";

/* The offline benchmark is static shipped data with no store dependency,
   so it is safe to import from a client component: the /metrics error
   boundary renders this same benchmark when the live store is
   unreachable. Live-store metrics stay in lib/metrics, which must never
   cross into a client bundle. */
export const syntheticEvaluationMetrics = {
  source: "Offline benchmark",
  denominator: report.record_count,
  generated_at: report.generated_at,
  exact_payment_order_matching_accuracy:
    report.metrics.exact_match_accuracy_on_matchable,
  incident_classification_accuracy:
    report.metrics.controller_incident_classification_accuracy,
  incident_classification_macro_f1:
    report.metrics.controller_incident_classification_macro_f1,
  automatic_count: report.metrics.automatic_count,
  runbook_count: report.metrics.runbook_count,
  no_action_count: report.metrics.no_action_count,
  ambiguous_count: report.metrics.ambiguous_count,
  post_repair_state_verification_coverage:
    report.metrics.post_repair_state_verification_coverage,
  unsafe_recommendations: report.metrics.enforced_unsafe_recommendation_count,
  unsafe_side_effects: report.metrics.unsafe_side_effect_count,
  duplicate_action_prevention_count:
    report.metrics.duplicate_action_prevention_count,
  operator_review_time_seconds: null as number | null,
  provider_integration_failures: null as number | null,
  merchant_integration_failures: null as number | null,
};

/* The exact-match rate is computed only on cases where a match was
   expected, so its band must state that basis. */
export const matchableBenchmarkCases = (report.records ?? []).filter(
  (row) => row.expected_match !== "abstained",
).length;
