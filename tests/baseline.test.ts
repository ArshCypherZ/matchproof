import { describe, expect, it } from "vitest";
import { EVALUATION_DATASET } from "../src/evaluation/dataset";
import { runBaseline } from "../src/evaluation/baseline";

describe("baseline", () => {
  it("contains a labeled batch with 100 held-out records spanning all fixture classes", () => {
    expect(EVALUATION_DATASET).toHaveLength(120);
    expect(
      EVALUATION_DATASET.filter((record) => record.split === "held_out"),
    ).toHaveLength(100);
    expect(
      new Set(EVALUATION_DATASET.map((record) => record.expected_class)).size,
    ).toBe(8);
    expect(
      new Set(EVALUATION_DATASET.map((record) => record.provenance)),
    ).toEqual(new Set(["synthetic"]));
    expect(new Set(EVALUATION_DATASET.map((record) => record.split))).toEqual(
      new Set(["train", "held_out"]),
    );
    const trainFamilies = new Set(
      EVALUATION_DATASET.filter((record) => record.split === "train").map(
        (record) => record.scenario_family,
      ),
    );
    expect(
      EVALUATION_DATASET.filter((record) => record.split === "held_out").some(
        (record) => trainFamilies.has(record.scenario_family),
      ),
    ).toBe(false);
    expect(
      new Set(EVALUATION_DATASET.map((record) => record.scenario_template))
        .size,
    ).toBe(16);
    const trainTemplates = new Set(
      EVALUATION_DATASET.filter((record) => record.split === "train").map(
        (record) => record.scenario_template,
      ),
    );
    expect(
      EVALUATION_DATASET.filter((record) => record.split === "held_out").some(
        (record) => trainTemplates.has(record.scenario_template),
      ),
    ).toBe(false);
  });

  it("reports reproducible baseline safety metrics", async () => {
    const report = await runBaseline(
      EVALUATION_DATASET.slice(0, 8),
    );
    expect(report.record_count).toBe(8);
    expect(report.metrics.enforced_unsafe_recommendation_count).toBe(0);
    expect(report.metrics.false_match_rate).toBe(0);
    expect(report.metrics.unsafe_side_effect_count).toBe(0);
    expect(report.records).toHaveLength(8);
  });
});
