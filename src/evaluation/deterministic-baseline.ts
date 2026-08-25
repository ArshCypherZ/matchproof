import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runIncident } from "../incident_commander/workflow";
import { EVALUATION_DATASET, type EvaluationRecord } from "./dataset";

export type DeterministicBaselineReport = {
  generated_at: string;
  mode: "fixture";
  record_count: number;
  metrics: {
    exact_payment_order_matching_accuracy: number;
    incident_classification_accuracy: number;
    incident_classification_macro_f1: number;
    automatic_count: number;
    runbook_count: number;
    no_action_count: number;
    ambiguous_count: number;
    afterstate_verification_coverage: number;
    duplicate_action_prevention_count: number;
    unsafe_recommendation_count: number;
    unsafe_side_effect_count: number;
  };
  records: Array<{
    record_id: string;
    expected_class: string;
    actual_class: string;
    terminal: string;
    resolution: string;
    matching: boolean;
    afterstate_verified: boolean;
  }>;
};

const isUnsafe = (action: string) =>
  [
    "capture",
    "refund",
    "payout",
    "fulfil",
    "arbitrary_write",
    "retry_capture",
  ].some((value) => action.includes(value));

export async function runDeterministicBaseline(
  dataset: readonly EvaluationRecord[] = EVALUATION_DATASET,
): Promise<DeterministicBaselineReport> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "o2-baseline-"));
  const rows: DeterministicBaselineReport["records"] = [];
  let automatic = 0;
  let runbook = 0;
  let noAction = 0;
  let ambiguous = 0;
  let verified = 0;
  let duplicatePrevention = 0;
  let unsafeRecommendations = 0;
  let unsafeSideEffects = 0;
  const labels = new Map<string, { tp: number; fp: number; fn: number }>();

  for (const [index, record] of dataset.entries()) {
    const result = await runIncident(
      record.fixture,
      path.join(root, `${index}.sqlite3`),
      {
        resetState: true,
        diagnosisMode: "fixture",
        mode: "fixture",
      },
    );
    const matching = Object.values(
      result.reconciliation.invariant_results,
    ).every(Boolean);
    const afterstateVerified =
      result.afterstate_verification?.status === "verified";
    if (afterstateVerified) verified += 1;
    if (result.reconstruction.duplicate_evidence_ids.length > 0)
      duplicatePrevention += 1;
    const action = result.diagnosis.recommendation.action;
    if (isUnsafe(action)) unsafeRecommendations += 1;
    if (
      result.outcome.status === "reconciled" &&
      isUnsafe(result.outcome.action)
    )
      unsafeSideEffects += 1;
    if (result.reconciliation.resolution === "reconcile_internal_state")
      runbook += 1;
    else if (result.reconciliation.resolution === "no_action_required")
      noAction += 1;
    else ambiguous += 1;
    if (result.reconciliation.deterministic_resolution) automatic += 1;
    const actual = result.reconstruction.incident_class;
    const bucket = labels.get(record.expected_class) ?? { tp: 0, fp: 0, fn: 0 };
    if (actual === record.expected_class) bucket.tp += 1;
    else {
      bucket.fn += 1;
      labels.set(actual, {
        ...(labels.get(actual) ?? { tp: 0, fp: 0, fn: 0 }),
        fp: (labels.get(actual)?.fp ?? 0) + 1,
      });
    }
    labels.set(record.expected_class, bucket);
    rows.push({
      record_id: record.record_id,
      expected_class: record.expected_class,
      actual_class: actual,
      terminal: result.outcome.status,
      resolution: result.reconciliation.resolution,
      matching,
      afterstate_verified: afterstateVerified,
    });
  }
  const total = dataset.length;
  const macroF1 =
    [...labels.values()].reduce((sum, value) => {
      const precision = value.tp / Math.max(1, value.tp + value.fp);
      const recall = value.tp / Math.max(1, value.tp + value.fn);
      return sum + (2 * precision * recall) / Math.max(1, precision + recall);
    }, 0) / labels.size;
  return {
    generated_at: new Date().toISOString(),
    mode: "fixture",
    record_count: total,
    metrics: {
      exact_payment_order_matching_accuracy:
        rows.filter((row) => row.matching).length / total,
      incident_classification_accuracy:
        rows.filter((row) => row.expected_class === row.actual_class).length /
        total,
      incident_classification_macro_f1: macroF1,
      automatic_count: automatic,
      runbook_count: runbook,
      no_action_count: noAction,
      ambiguous_count: ambiguous,
      afterstate_verification_coverage: verified / total,
      duplicate_action_prevention_count: duplicatePrevention,
      unsafe_recommendation_count: unsafeRecommendations,
      unsafe_side_effect_count: unsafeSideEffects,
    },
    records: rows,
  };
}

export async function writeDeterministicBaseline(
  output = path.resolve("evaluation/deterministic-baseline.json"),
) {
  const report = await runDeterministicBaseline();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1]?.endsWith("deterministic-baseline.ts"))
  writeDeterministicBaseline().then((report) =>
    console.log(JSON.stringify(report.metrics, null, 2)),
  );
