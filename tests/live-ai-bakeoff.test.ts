import { describe, expect, it } from "vitest";
import {
  DiagnosisOutputSchema,
  type ReconciliationResult,
  type Reconstruction,
} from "../src/domain/schemas";
import { EVALUATION_DATASET, type SafeRead } from "../src/evaluation/dataset";
import {
  runLiveAiBakeoff,
  type BakeoffDiagnosisAdapter,
} from "../src/evaluation/live-ai-bakeoff";

const expectedReadsByClass = new Map<string, readonly SafeRead[]>();
for (const record of EVALUATION_DATASET) {
  if (expectedReadsByClass.has(record.expected_class)) continue;
  expectedReadsByClass.set(record.expected_class, record.acceptable_next_reads);
}
const safeRead = (incidentClass: string): SafeRead =>
  expectedReadsByClass.get(incidentClass)?.[0] ?? "none";

const validOutput = (
  reconstruction: Reconstruction,
  reconciliation: ReconciliationResult,
  options: { provider?: string; failureReason?: string } = {},
) => {
  const evidenceIds = reconstruction.timeline.map((entry) => entry.evidence_id);
  const missingFacts = [
    ...reconstruction.ambiguity_reasons,
    ...reconciliation.ambiguity_reasons,
  ];
  const missingFact = missingFacts.join("; ") || "No missing fact.";
  return DiagnosisOutputSchema.parse({
    diagnosis: {
      hypotheses: [
        {
          rank: 1,
          summary: missingFact,
          reasoning: `Investigate ${missingFact}`,
          uncertainty: "The result requires a fresh read.",
          confidence: 0.9,
          evidence_ids: evidenceIds,
        },
      ],
      recommendation: {
        action: "retry_safe_read",
        reasoning: `Resolve ${missingFact}`,
        uncertainty: "Escalate when the read remains inconclusive.",
        evidence_ids: evidenceIds,
      },
      investigation: {
        missing_fact: missingFact,
        next_safe_read: {
          tool: safeRead(reconstruction.incident_class),
          reason: "Read the system that owns the unresolved fact.",
          expected_fact: missingFact,
          evidence_ids: evidenceIds,
        },
        runbook: {
          name: "safe_read_retry",
          rationale: "A read-only investigation can resolve the residual.",
          stopping_condition: "Stop after verified closure or escalation.",
        },
        operator_packet: {
          summary: missingFact,
          decision_needed: "Review the cited residual when it persists.",
          terminal_owner: "payment-operations",
          evidence_ids: evidenceIds,
        },
      },
    },
    provenance: {
      provider: options.provider ?? "groq",
      requested_model: "test-model",
      returned_model: "test-model",
      request_id: "test-request",
      strict_schema: true,
      ...(options.failureReason
        ? { failure_reason: options.failureReason }
        : {}),
    },
  });
};

describe("live AI bakeoff", () => {
  it("runs representative cases sequentially and scores valid packets", async () => {
    let active = 0;
    let maxActive = 0;
    const adapter: BakeoffDiagnosisAdapter = {
      provider: "groq",
      model: "test-model",
      async diagnose(_bundle, reconstruction, reconciliation) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return validOutput(reconstruction, reconciliation);
      },
    };

    const report = await runLiveAiBakeoff({
      dataset: EVALUATION_DATASET,
      sampleSize: 4,
      providers: ["groq"],
      adapterFactory: () => adapter,
      retryDelayMs: 0,
    });

    const result = report.providers[0]!;
    expect(report.concurrency).toBe(1);
    expect(report.sample_size).toBe(4);
    expect(maxActive).toBe(1);
    expect(
      new Set(result.cases.map((entry) => entry.expected_class)).size,
    ).toBe(4);
    expect(result.completed).toBe(4);
    expect(result.packet_validity_rate).toBe(1);
    expect(result.missing_fact_accuracy).toBe(1);
    expect(result.next_safe_read_accuracy).toBe(1);
    expect(result.unsafe_recommendation_count).toBe(0);
  });

  it("retries bounded transient Gemini failures and records the retry", async () => {
    let calls = 0;
    const report = await runLiveAiBakeoff({
      sampleSize: 1,
      providers: ["gemini"],
      maxAttempts: 2,
      retryDelayMs: 0,
      adapterFactory: () => ({
        provider: "gemini",
        model: "test-model",
        diagnose(_bundle, reconstruction, reconciliation) {
          calls += 1;
          if (calls === 1) throw new Error("Gemini 429: rate limit");
          return validOutput(reconstruction, reconciliation, {
            provider: "gemini",
          });
        },
      }),
    });

    expect(calls).toBe(2);
    expect(report.providers[0]).toMatchObject({
      completed: 1,
      error_count: 0,
      retry_count: 1,
      rate_limit_count: 1,
    });
  });

  it("reports exhausted provider fallback and rate-limit evidence", async () => {
    const report = await runLiveAiBakeoff({
      sampleSize: 1,
      providers: ["gemini"],
      adapterFactory: () => ({
        provider: "gemini",
        model: "test-model",
        diagnose(_bundle, reconstruction, reconciliation) {
          return validOutput(reconstruction, reconciliation, {
            provider: "deterministic-fallback",
            failureReason: "Gemini 429: quota exhausted",
          });
        },
      }),
    });

    expect(report.providers[0]).toMatchObject({
      completed: 0,
      fallback_count: 1,
      rate_limit_count: 1,
      retry_count: 0,
    });
  });
});
