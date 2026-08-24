import {
  DiagnosisOutputSchema,
  type IncidentBundle,
  type Reconstruction,
} from "../domain/schemas";

export class FixtureDiagnosisAdapter {
  provider = "fixture";
  model = "fixture-diagnosis-v1";
  diagnose(_bundle?: IncidentBundle, _reconstruction?: Reconstruction) {
    return DiagnosisOutputSchema.parse({
      diagnosis: {
        hypotheses: [
          {
            rank: 1,
            summary:
              "The processor completed capture before the caller timed out.",
            reasoning:
              "The verified capture event occurred before the timeout response.",
            uncertainty: "The synchronous acknowledgement was lost.",
            confidence: 0.98,
            evidence_ids: ["EV-REQ-001", "EV-TIMEOUT-001", "EV-WEBHOOK-001"],
          },
        ],
        recommendation: {
          action: "reconcile_internal_state",
          reasoning:
            "Apply the verified capture to the merchant record without mutation.",
          uncertainty: "Escalate if deterministic invariants do not agree.",
          evidence_ids: ["EV-STATE-001", "EV-WEBHOOK-001"],
        },
      },
      provenance: {
        provider: this.provider,
        requested_model: this.model,
        returned_model: this.model,
        request_id: "fixture-call",
        strict_schema: true,
      },
    });
  }
}
