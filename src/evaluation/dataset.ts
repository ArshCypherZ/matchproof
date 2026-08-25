import path from "node:path";

export type DatasetProvenance =
  "synthetic" | "provider_test_mode" | "redacted_public_archetype";

export type EvaluationRecord = {
  record_id: string;
  fixture: string;
  expected_class: string;
  provenance: DatasetProvenance;
};

const cases = [
  ["paid_pending.json", "paid_pending"],
  ["paid_missing.json", "paid_missing"],
  ["one_payment_two_orders.json", "one_payment_two_orders"],
  [
    "callback_missing_webhook_recovers.json",
    "callback_missing_webhook_recovers",
  ],
  ["webhook_delivery_failure.json", "webhook_delivery_failure"],
  ["late_authorized.json", "late_authorized"],
  ["timeout_after_mutation.json", "capture_timeout"],
  ["settlement_exception.json", "settlement_exception"],
] as const;

export const EVALUATION_DATASET: readonly EvaluationRecord[] = Array.from(
  { length: 100 },
  (_, index) => {
    const [fixture, expectedClass] = cases[index % cases.length]!;
    return {
      record_id: `eval-${String(index + 1).padStart(3, "0")}`,
      fixture: path.resolve("fixtures", fixture),
      expected_class: expectedClass,
      provenance: "synthetic",
    };
  },
);

if (EVALUATION_DATASET.length < 100)
  throw new Error("evaluation dataset must contain at least 100 records");
