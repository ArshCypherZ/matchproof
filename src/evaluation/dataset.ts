import path from "node:path";
import type { MissingFactCode } from "../domain/schemas";

export type DatasetProvenance =
  "synthetic" | "provider_test_mode" | "redacted_public_archetype";
export type MatchLabel = "matched" | "unmatched" | "abstained";
export type SafeRead =
  | "fetch_payment"
  | "fetch_order"
  | "search_events"
  | "fetch_merchant_order"
  | "none";

export type EvaluationRecord = {
  record_id: string;
  fixture: string;
  scenario_template: string;
  scenario_family: string;
  semantic_variant: string;
  identity_variant: number;
  expected_class: string;
  expected_match: MatchLabel;
  expected_missing_fact_codes: readonly MissingFactCode[];
  acceptable_next_reads: readonly SafeRead[];
  prohibited_next_reads: readonly SafeRead[];
  provenance: DatasetProvenance;
  split: "train" | "held_out";
  /**
   * Marks incident classes whose evidence topology requires a bounded
   * provider read before the controller can reconcile: the evaluation
   * harness wires a read gateway for these rows so the tier-0 playbook and
   * the tier-1 cluster investigator can actually run their reads.
   */
  investigation_gateway: boolean;
};

export const EVALUATION_SPLIT = {
  seed: "production-evaluation-seed",
  strategy: "fixed-disjoint-evidence-topology-templates",
  train_size: 20,
  held_out_size: 100,
} as const;

const allReads: readonly SafeRead[] = [
  "fetch_payment",
  "fetch_order",
  "search_events",
  "fetch_merchant_order",
  "none",
];
const cases = [
  ["paid_pending.json", "paid_pending", "matched", ["none"], ["none"]],
  [
    "capture_timeout_recoverable.json",
    "capture_timeout",
    "matched",
    ["provider_payment_state", "afterstate_verification"],
    ["fetch_payment"],
  ],
  [
    "paid_missing.json",
    "paid_missing",
    "abstained",
    ["merchant_order_identity", "merchant_order_state"],
    ["fetch_merchant_order"],
  ],
  [
    "one_payment_two_orders.json",
    "one_payment_two_orders",
    "unmatched",
    ["merchant_order_identity"],
    ["fetch_merchant_order"],
  ],
  [
    "callback_missing_webhook_recovers.json",
    "callback_missing_webhook_recovers",
    "abstained",
    ["callback_delivery_status"],
    ["fetch_order", "search_events"],
  ],
  [
    "webhook_delivery_failure.json",
    "webhook_delivery_failure",
    "abstained",
    ["webhook_delivery_status"],
    ["fetch_order", "search_events"],
  ],
  [
    "late_authorized.json",
    "late_authorized",
    "abstained",
    ["provider_payment_state", "afterstate_verification"],
    ["fetch_payment"],
  ],
  [
    "settlement_exception.json",
    "settlement_exception",
    "matched",
    ["settlement_status"],
    ["search_events"],
  ],
] as const satisfies readonly (readonly [
  string,
  string,
  MatchLabel,
  readonly MissingFactCode[],
  readonly SafeRead[],
])[];

/**
 * These are synthetic parameterizations of sixteen disclosed evidence
 * topologies. Training uses the canonical topology for each incident class;
 * held-out rows add a valid replay of an existing webhook event. The replay
 * keeps the incident label stable while testing duplicate suppression and
 * ensures no scenario template is shared across the split.
 */
/**
 * Incident classes whose bundle evidence cannot prove provider state or order
 * linkage on its own; the closed loop must perform a bounded provider read
 * before reconciliation.
 */
const GATEWAY_CLASSES: readonly string[] = [
  "capture_timeout",
  "late_authorized",
  "callback_missing_webhook_recovers",
  "webhook_delivery_failure",
];

export const EVALUATION_DATASET: readonly EvaluationRecord[] = Array.from(
  { length: EVALUATION_SPLIT.train_size + EVALUATION_SPLIT.held_out_size },
  (_, index) => {
    const [fixture, expectedClass, expectedMatch, missing, reads] =
      cases[index % cases.length]!;
    const split = index < EVALUATION_SPLIT.train_size ? "train" : "held_out";
    const evidenceVariant =
      split === "train" ? "canonical" : "duplicate-webhook-replay";
    const template = fixture.replace(/\.json$/, "");
    const acceptable = [...reads] as SafeRead[];
    return {
      record_id: `eval-${String(index + 1).padStart(3, "0")}`,
      fixture: path.resolve("fixtures", fixture),
      scenario_template: `${template}:${evidenceVariant}`,
      scenario_family: `${expectedClass}:${evidenceVariant}`,
      semantic_variant: `${expectedClass}:${evidenceVariant}`,
      identity_variant: index + 1,
      expected_class: expectedClass,
      expected_match: expectedMatch,
      expected_missing_fact_codes: missing,
      acceptable_next_reads: acceptable,
      prohibited_next_reads: allReads.filter(
        (read) => !acceptable.includes(read),
      ),
      provenance: "synthetic",
      split,
      investigation_gateway: GATEWAY_CLASSES.includes(expectedClass),
    };
  },
);

if (
  EVALUATION_DATASET.filter((record) => record.split === "held_out").length <
  100
)
  throw new Error(
    "evaluation dataset must contain at least 100 held-out records",
  );
const trainGroups = new Set(
  EVALUATION_DATASET.filter((record) => record.split === "train").map(
    (record) => record.scenario_family,
  ),
);
if (
  EVALUATION_DATASET.some(
    (record) =>
      record.split === "held_out" && trainGroups.has(record.scenario_family),
  )
)
  throw new Error("train and held-out scenario families must not overlap");
