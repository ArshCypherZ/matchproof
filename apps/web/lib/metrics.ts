import report from "../../../evaluation/deterministic-baseline.json";

export const syntheticEvaluationMetrics = {
  source: "Synthetic evaluation",
  denominator: report.record_count,
  generated_at: report.generated_at,
  exact_payment_order_matching_accuracy:
    report.metrics.exact_payment_order_matching_accuracy,
  incident_classification_accuracy:
    report.metrics.incident_classification_accuracy,
  incident_classification_macro_f1:
    report.metrics.incident_classification_macro_f1,
  automatic_count: report.metrics.automatic_count,
  runbook_count: report.metrics.runbook_count,
  no_action_count: report.metrics.no_action_count,
  ambiguous_count: report.metrics.ambiguous_count,
  afterstate_verification_coverage:
    report.metrics.afterstate_verification_coverage,
  unsafe_recommendations: report.metrics.unsafe_recommendation_count,
  unsafe_side_effects: report.metrics.unsafe_side_effect_count,
  duplicate_action_prevention_count:
    report.metrics.duplicate_action_prevention_count,
  operator_review_time_seconds: null as number | null,
  provider_integration_failures: null as number | null,
  merchant_integration_failures: null as number | null,
};
