import { describe, expect, it } from "vitest";
import { EVALUATION_DATASET } from "../src/evaluation/dataset";
import { runDeterministicBaseline } from "../src/evaluation/deterministic-baseline";

describe("deterministic baseline", () => {
  it("contains a labeled 100-record batch spanning all fixture classes", () => {
    expect(EVALUATION_DATASET).toHaveLength(100);
    expect(
      new Set(EVALUATION_DATASET.map((record) => record.expected_class)).size,
    ).toBe(8);
    expect(
      new Set(EVALUATION_DATASET.map((record) => record.provenance)),
    ).toEqual(new Set(["synthetic"]));
  });

  it("reports reproducible deterministic safety metrics", async () => {
    const report = await runDeterministicBaseline(
      EVALUATION_DATASET.slice(0, 8),
    );
    expect(report.record_count).toBe(8);
    expect(report.metrics.unsafe_recommendation_count).toBe(0);
    expect(report.metrics.unsafe_side_effect_count).toBe(0);
    expect(report.records).toHaveLength(8);
  });
});
