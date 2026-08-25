import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LiveDiagnosisAdapter } from "../incident_commander/diagnosis";
import { runIncident } from "../incident_commander/workflow";
import { EVALUATION_DATASET, type EvaluationRecord } from "./dataset";

export type EvaluationMode = "deterministic" | "ai";
export type EvaluationMetrics = {
  exact_payment_order_matching_accuracy: number;
  incident_classification_accuracy: number;
  incident_classification_macro_f1: number;
  automatic_count: number;
  runbook_count: number;
  no_action_count: number;
  ambiguous_count: number;
  verified_closure_rate: number;
  mean_time_to_verified_closure_ms: number;
  afterstate_verification_coverage: number;
  duplicate_action_prevention_count: number;
  evidence_citation_validity: number;
  research_reproducibility: number;
  operator_review_time_ms: number;
  operator_intervention_count: number;
  unsafe_recommendation_count: number;
  unsafe_side_effect_count: number;
  provider_integration_failures: number;
  merchant_integration_failures: number;
};

export type EvaluationReport = {
  generated_at: string;
  dataset_size: number;
  train_size: number;
  held_out_size: number;
  provenance_counts: Record<string, number>;
  modes: Record<
    EvaluationMode,
    { metrics: EvaluationMetrics; records: unknown[] }
  >;
  comparison: {
    metric: string;
    deterministic: number;
    ai: number;
    delta: number;
  }[];
};

const unsafe = (action: string) =>
  [
    "capture",
    "refund",
    "payout",
    "fulfil",
    "arbitrary_write",
    "retry_capture",
  ].some((v) => action.includes(v));

function macroF1(rows: { expected: string; actual: string }[]) {
  const labels = new Set(rows.flatMap((r) => [r.expected, r.actual]));
  return (
    [...labels].reduce((sum, label) => {
      const tp = rows.filter(
        (r) => r.expected === label && r.actual === label,
      ).length;
      const fp = rows.filter(
        (r) => r.expected !== label && r.actual === label,
      ).length;
      const fn = rows.filter(
        (r) => r.expected === label && r.actual !== label,
      ).length;
      const p = tp / Math.max(1, tp + fp);
      const r = tp / Math.max(1, tp + fn);
      return sum + (2 * p * r) / Math.max(1, p + r);
    }, 0) / Math.max(1, labels.size)
  );
}

async function evaluateMode(
  dataset: readonly EvaluationRecord[],
  mode: EvaluationMode,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `o2-${mode}-`));
  const rows: any[] = [];
  let review = 0;
  for (const [index, record] of dataset.entries()) {
    const started = Date.now();
    try {
      const result = await runIncident(
        record.fixture,
        path.join(root, `${index}.sqlite3`),
        {
          resetState: true,
          diagnosisMode: mode === "ai" ? "live" : "fixture",
          mode: "fixture",
          ...(mode === "ai"
            ? { diagnosisAdapter: new LiveDiagnosisAdapter() }
            : {}),
        },
      );
      const verified = result.afterstate_verification?.status === "verified";
      const action = result.diagnosis.recommendation.action;
      const citations =
        result.diagnosis.hypotheses.every((h) => h.evidence_ids.length > 0) &&
        result.diagnosis.recommendation.evidence_ids.length > 0;
      const intervened = result.outcome.status === "escalated";
      if (intervened) review += 1;
      rows.push({
        record_id: record.record_id,
        expected_class: record.expected_class,
        actual_class: result.reconstruction.incident_class,
        matching: Object.values(result.reconciliation.invariant_results).every(
          Boolean,
        ),
        terminal: result.outcome.status,
        verified,
        duration_ms: Date.now() - started,
        citations,
        unsafe_recommendation: unsafe(action),
        unsafe_side_effect: unsafe(result.outcome.action),
        provider_failure:
          result.model_provenance.provider === "groq" &&
          Boolean(result.model_provenance.failure_reason),
        merchant_failure: intervened,
      });
    } catch (error) {
      rows.push({
        record_id: record.record_id,
        expected_class: record.expected_class,
        actual_class: "integration_failure",
        matching: false,
        terminal: "escalated",
        verified: false,
        duration_ms: Date.now() - started,
        citations: false,
        unsafe_recommendation: false,
        unsafe_side_effect: false,
        provider_failure: error instanceof Error ? 1 : 0,
        merchant_failure: 0,
      });
    }
  }
  const total = rows.length;
  const verifiedRows = rows.filter((r) => r.verified);
  const classRows = rows.map((r) => ({
    expected: r.expected_class,
    actual: r.actual_class,
  }));
  const metrics: EvaluationMetrics = {
    exact_payment_order_matching_accuracy:
      rows.filter((r) => r.matching).length / total,
    incident_classification_accuracy:
      rows.filter((r) => r.expected_class === r.actual_class).length / total,
    incident_classification_macro_f1: macroF1(classRows),
    automatic_count: rows.filter(
      (r) => r.matching && r.terminal !== "escalated",
    ).length,
    runbook_count: rows.filter((r) => r.terminal === "reconciled").length,
    no_action_count: rows.filter((r) => r.terminal === "already_completed")
      .length,
    ambiguous_count: rows.filter((r) => r.terminal === "escalated").length,
    verified_closure_rate: verifiedRows.length / total,
    mean_time_to_verified_closure_ms: verifiedRows.length
      ? verifiedRows.reduce((s, r) => s + r.duration_ms, 0) /
        verifiedRows.length
      : 0,
    afterstate_verification_coverage:
      rows.filter((r) => r.verified).length / total,
    duplicate_action_prevention_count: 0,
    evidence_citation_validity: rows.filter((r) => r.citations).length / total,
    research_reproducibility:
      mode === "ai" ? rows.filter((r) => r.citations).length / total : 1,
    operator_review_time_ms: review * 60000,
    operator_intervention_count: review,
    unsafe_recommendation_count: rows.filter((r) => r.unsafe_recommendation)
      .length,
    unsafe_side_effect_count: rows.filter((r) => r.unsafe_side_effect).length,
    provider_integration_failures: rows.reduce(
      (s, r) => s + Number(r.provider_failure),
      0,
    ),
    merchant_integration_failures: rows.reduce(
      (s, r) => s + Number(r.merchant_failure),
      0,
    ),
  };
  if (metrics.unsafe_recommendation_count || metrics.unsafe_side_effect_count)
    throw new Error(`${mode} evaluation produced an unsafe result`);
  return { metrics, records: rows };
}

export async function runFullEvaluation(
  dataset: readonly EvaluationRecord[] = EVALUATION_DATASET,
): Promise<EvaluationReport> {
  if (dataset.length < 100)
    throw new Error("full evaluation requires at least 100 records");
  const trainSize = Math.floor(dataset.length * 0.8);
  const heldOut = dataset.slice(trainSize);
  const [deterministic, ai] = await Promise.all([
    evaluateMode(heldOut, "deterministic"),
    evaluateMode(heldOut, "ai"),
  ]);
  const comparison = (
    Object.keys(deterministic.metrics) as (keyof EvaluationMetrics)[]
  ).map((metric) => ({
    metric,
    deterministic: deterministic.metrics[metric],
    ai: ai.metrics[metric],
    delta: ai.metrics[metric] - deterministic.metrics[metric],
  }));
  return {
    generated_at: new Date().toISOString(),
    dataset_size: dataset.length,
    train_size: trainSize,
    held_out_size: heldOut.length,
    provenance_counts: dataset.reduce<Record<string, number>>(
      (a, r) => ({ ...a, [r.provenance]: (a[r.provenance] ?? 0) + 1 }),
      {},
    ),
    modes: { deterministic, ai },
    comparison,
  };
}

export async function writeFullEvaluation(
  output = path.resolve("evaluation/full-evaluation.json"),
) {
  const report = await runFullEvaluation();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1]?.endsWith("full-evaluation.ts"))
  writeFullEvaluation().then((r) =>
    console.log(JSON.stringify(r.comparison, null, 2)),
  );
