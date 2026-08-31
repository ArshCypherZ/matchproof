import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyIncident } from "../src/incident_commander/validation";
import { verifyBundle } from "../src/incident_commander/validation";
import { reconcile } from "../src/incident_commander/reconciliation";
import { reconstruct } from "../src/incident_commander/reconstruction";
import { EVALUATION_DATASET } from "../src/evaluation/dataset";
import { materializeEvaluationFixture } from "../src/evaluation/full-evaluation";

const secret = "test-prototype-secret";

const bundleFrom = (fixture: unknown) =>
  verifyBundle(fixture as object, secret);

describe("incident classification consistency", () => {
  it("the evidence validator and reconciliation classify every fixture identically", () => {
    for (const name of fs.readdirSync(path.resolve("fixtures"))) {
      if (!name.endsWith(".json") || name === "red-team-attacks.json") continue;
      const bundle = bundleFrom(
        JSON.parse(fs.readFileSync(path.resolve("fixtures", name), "utf8")),
      );
      const reconstruction = reconstruct(bundle);
      const reconciliation = reconcile({ bundle });
      expect(
        {
          fixture: name,
          validation: classifyIncident(bundle),
          reconstruction: reconstruction.incident_class,
          reconciliation: reconciliation.incident_class,
        },
        `${name} must carry one incident class across validation, reconstruction, and reconciliation`,
      ).toMatchObject({
        fixture: name,
        validation: reconciliation.incident_class,
        reconstruction: reconciliation.incident_class,
      });
    }
  });

  it("the classifiers agree on every materialized evaluation row", () => {
    for (const [index, record] of EVALUATION_DATASET.entries()) {
      const source = JSON.parse(fs.readFileSync(record.fixture, "utf8"));
      const bundle = bundleFrom(
        materializeEvaluationFixture(source, record, index),
      );
      expect(classifyIncident(bundle), record.record_id).toBe(
        reconcile({ bundle }).incident_class,
      );
    }
  });
});
