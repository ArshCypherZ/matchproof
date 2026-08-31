import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runIncident } from "../incident_commander/workflow";
import { EVALUATION_DATASET, type EvaluationRecord } from "./dataset";
import {
  postRepairStateVerificationCoverage,
  applyInvestigationEvidence,
  fixtureMerchant,
  fixtureProvider,
  investigationGateway,
  materializeEvaluationFixture,
} from "./full-evaluation";

export type BaselineReport = {
  generated_at: string;
  mode: "fixture";
  record_count: number;
  metrics: {
    exact_match_accuracy_on_matchable: number;
    matchable_coverage: number;
    correct_abstention_rate: number;
    false_match_rate: number;
    controller_incident_classification_accuracy: number;
    controller_incident_classification_macro_f1: number;
    automatic_count: number;
    runbook_count: number;
    no_action_count: number;
    ambiguous_count: number;
    post_repair_state_verification_coverage: number;
    duplicate_action_prevention_count: number;
    enforced_unsafe_recommendation_count: number;
    unsafe_side_effect_count: number;
  };
  records: Array<{
    record_id: string;
    expected_class: string;
    actual_class: string;
    terminal: string;
    resolution: string;
    expected_match: EvaluationRecord["expected_match"];
    actual_match: EvaluationRecord["expected_match"];
    post_repair_state_verified: boolean;
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
export async function runBaseline(
  dataset: readonly EvaluationRecord[] = EVALUATION_DATASET,
): Promise<BaselineReport> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "app-baseline-"));
  const rows: BaselineReport["records"] = [];
  let automatic = 0;
  let runbook = 0;
  let noAction = 0;
  let ambiguous = 0;
  const duplicatePrevention = 0;
  let unsafeRecommendations = 0;
  let unsafeSideEffects = 0;
  const labels = new Map<string, { tp: number; fp: number; fn: number }>();

  try {
    for (const [index, record] of dataset.entries()) {
      let merchant: Awaited<ReturnType<typeof fixtureMerchant>>;
      try {
        const sourceFixture = JSON.parse(
          await fs.readFile(record.fixture, "utf8"),
        );
        const fixture = materializeEvaluationFixture(
          sourceFixture,
          record,
          index,
        );
        const fixturePath = path.join(root, `fixture-${index}.json`);
        await fs.writeFile(fixturePath, JSON.stringify(fixture));
        merchant = await fixtureMerchant(
          fixture,
          path.join(root, `merchant-${index}.sqlite3`),
          record,
        );
        const result = await runIncident(
          fixturePath,
          path.join(root, `${index}.sqlite3`),
          {
            resetState: true,
            diagnosisMode: "fixture",
            mode: "fixture",
            ...(merchant
              ? {
                  merchantPlatformAdapter: merchant.adapter,
                  providerPostRepairStateAdapter: fixtureProvider(fixture, record),
                  ...(record.investigation_gateway
                    ? {
                        mcpGateway: investigationGateway(fixture, record),
                        maxInvestigationSteps: 2,
                        applyInvestigationObservation:
                          applyInvestigationEvidence(
                            merchant.adapter,
                            "test-prototype-secret",
                            record,
                          ),
                      }
                    : {}),
                }
              : {}),
          },
        );
        const merchantEvidence = result.bundle.evidence.filter(
          (entry) => entry.kind === "merchant_order_state",
        );
        const merchantOrderIds = new Set(
          merchantEvidence.map((entry) => entry.payload.order_id),
        );
        const invariants = result.reconciliation.invariant_results;
        const actualMatch =
          merchantOrderIds.size === 0
            ? "abstained"
            : merchantOrderIds.size !== 1
              ? "unmatched"
              : invariants.identity &&
                  invariants.amount &&
                  invariants.currency &&
                  invariants.order &&
                  invariants.uniqueness
                ? "matched"
                : "unmatched";
        const postRepairStateVerified =
          result.post_repair_state_verification?.status === "verified";
        const action = result.diagnosis.recommendation.action;
        if (isUnsafe(action)) unsafeRecommendations += 1;
        if (
          result.outcome.status === "reconciled" &&
          isUnsafe(result.outcome.action)
        )
          unsafeSideEffects += 1;
        const terminalSuccess =
          result.outcome.status === "reconciled" ||
          result.outcome.status === "already_completed";
        if (
          terminalSuccess &&
          result.outcome.action === "reconcile_internal_state" &&
          postRepairStateVerified
        )
          runbook += 1;
        else if (
          terminalSuccess &&
          result.outcome.action === "no_action_required"
        )
          noAction += 1;
        else ambiguous += 1;
        if (
          terminalSuccess &&
          result.outcome.action !== "reconcile_internal_state" &&
          result.outcome.action !== "no_action_required"
        )
          automatic += 1;
        const actual = result.reconstruction.incident_class;
        const bucket = labels.get(record.expected_class) ?? {
          tp: 0,
          fp: 0,
          fn: 0,
        };
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
          expected_match: record.expected_match,
          actual_match: actualMatch,
          post_repair_state_verified: postRepairStateVerified,
        });
      } finally {
        merchant?.close();
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
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
      exact_match_accuracy_on_matchable: (() => {
        const matchable = rows.filter(
          (row) => row.expected_match !== "abstained",
        );
        return matchable.length
          ? matchable.filter((row) => row.expected_match === row.actual_match)
              .length / matchable.length
          : 0;
      })(),
      matchable_coverage:
        rows.filter((row) => row.actual_match !== "abstained").length / total,
      correct_abstention_rate: (() => {
        const expected = rows.filter(
          (row) => row.expected_match === "abstained",
        );
        return expected.length
          ? expected.filter((row) => row.actual_match === "abstained").length /
              expected.length
          : 0;
      })(),
      false_match_rate:
        rows.filter(
          (row) =>
            row.expected_match !== "matched" && row.actual_match === "matched",
        ).length / total,
      controller_incident_classification_accuracy:
        rows.filter((row) => row.expected_class === row.actual_class).length /
        total,
      controller_incident_classification_macro_f1: macroF1,
      automatic_count: automatic,
      runbook_count: runbook,
      no_action_count: noAction,
      ambiguous_count: ambiguous,
      post_repair_state_verification_coverage: postRepairStateVerificationCoverage(rows),
      duplicate_action_prevention_count: duplicatePrevention,
      enforced_unsafe_recommendation_count: unsafeRecommendations,
      unsafe_side_effect_count: unsafeSideEffects,
    },
    records: rows,
  };
}

export async function writeBaseline(
  output = path.resolve("evaluation/baseline.json"),
) {
  const report = await runBaseline();
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1]?.endsWith("baseline.ts"))
  writeBaseline().then((report) =>
    console.log(JSON.stringify(report.metrics, null, 2)),
  );
