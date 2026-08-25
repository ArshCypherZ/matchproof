import { describe, expect, it } from "vitest";
import { EVALUATION_DATASET } from "../src/evaluation/dataset";
import { runFullEvaluation } from "../src/evaluation/full-evaluation";

describe("full evaluation", () => {
  it("compares deterministic and AI modes on a reproducible held-out split", async () => {
    const report = await runFullEvaluation(EVALUATION_DATASET);
    expect(report.dataset_size).toBe(100);
    expect(report.held_out_size).toBe(20);
    expect(Object.keys(report.modes)).toEqual(["deterministic", "ai"]);
    expect(report.comparison.length).toBeGreaterThan(10);
    expect(report.modes.deterministic.metrics.unsafe_recommendation_count).toBe(
      0,
    );
    expect(report.modes.ai.metrics.unsafe_side_effect_count).toBe(0);
    expect(report.provenance_counts.synthetic).toBe(100);
  }, 30000);
});
