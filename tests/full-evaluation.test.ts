import { describe, expect, it } from "vitest";
import { EVALUATION_DATASET } from "../src/evaluation/dataset";
import {
  runFullEvaluation,
  writeFullEvaluation,
} from "../src/evaluation/full-evaluation";
import { DiagnosisOutputSchema } from "../src/domain/schemas";
import type {
  IncidentBundle,
  ReconciliationResult,
  Reconstruction,
} from "../src/domain/schemas";

describe("full evaluation", () => {
  it("compares baseline and AI modes on a reproducible held-out split", async () => {
    let aiCalls = 0;
    const report = await runFullEvaluation(EVALUATION_DATASET, {
      aiDiagnosisAdapter: {
        provider: "groq",
        model: "offline-evaluation-double",
        diagnose: (
          _bundle: IncidentBundle,
          reconstruction: Reconstruction,
          reconciliation: ReconciliationResult,
        ) => {
          aiCalls += 1;
          const evidenceIds = reconstruction.timeline.map(
            (entry) => entry.evidence_id,
          );
          const missingFacts = [
            ...reconstruction.ambiguity_reasons,
            ...reconciliation.ambiguity_reasons,
          ];
          const missingFactCodes = {
            paid_pending: ["none"],
            paid_missing: ["merchant_order_identity", "merchant_order_state"],
            one_payment_two_orders: ["merchant_order_identity"],
            callback_missing_webhook_recovers: ["callback_delivery_status"],
            webhook_delivery_failure: ["webhook_delivery_status"],
            late_authorized: [
              "provider_payment_state",
              "post_repair_state_verification",
            ],
            capture_timeout: [
              "provider_payment_state",
              "post_repair_state_verification",
            ],
            settlement_exception: ["settlement_status"],
          }[reconstruction.incident_class];
          const action = reconciliation.rule_based_resolution
            ? reconciliation.resolution === "no_action_required"
              ? "no_action_required"
              : "reconcile_internal_state"
            : "retry_safe_read";
          return DiagnosisOutputSchema.parse({
            diagnosis: {
              hypotheses: [
                {
                  rank: 1,
                  summary: missingFacts.length
                    ? `Missing or conflicting fact: ${missingFacts.join("; ")}`
                    : "Canonical evidence supports the rule-based result.",
                  reasoning: missingFacts.length
                    ? `A safe read should resolve: ${missingFacts.join("; ")}`
                    : "The rule-based invariants are complete.",
                  uncertainty:
                    "Live model quality is measured by the CLI evaluation.",
                  confidence: 1,
                  evidence_ids: evidenceIds,
                },
              ],
              recommendation: {
                action,
                reasoning: missingFacts.length
                  ? `Retry a read for: ${missingFacts.join("; ")}`
                  : "Follow the rule-based resolution.",
                uncertainty: "This is an offline test adapter.",
                evidence_ids: evidenceIds,
              },
              investigation: {
                missing_fact: missingFacts.join("; ") || "No missing fact.",
                missing_fact_codes: missingFactCodes,
                next_safe_read: {
                  tool: /merchant|paid_pending|paid_missing|one_payment_two_orders/i.test(
                    `${missingFacts.join(" ")} ${reconstruction.incident_class}`,
                  )
                    ? "fetch_merchant_order"
                    : /callback|webhook|settlement/i.test(
                          `${missingFacts.join(" ")} ${reconstruction.incident_class}`,
                        )
                      ? "search_events"
                      : /provider|payment state|capture|authorized/i.test(
                            `${missingFacts.join(" ")} ${reconstruction.incident_class}`,
                          )
                        ? "fetch_payment"
                        : "none",
                  reason: "Read the source that owns the unresolved fact.",
                  expected_fact: missingFacts.join("; ") || "No new fact.",
                  evidence_ids: evidenceIds,
                },
                runbook: {
                  name: missingFacts.length ? "safe_read_retry" : "no_action",
                  rationale: "Use one bounded read before operator review.",
                  stopping_condition:
                    "Stop after the fact is verified or assign an owner.",
                },
                operator_packet: {
                  summary: missingFacts.join("; ") || "Evidence is complete.",
                  decision_needed: missingFacts.length
                    ? "Review the newly verified fact."
                    : "No discretionary decision is required.",
                  terminal_owner: "payment-operations",
                  evidence_ids: evidenceIds,
                },
              },
            },
            provenance: {
              provider: "groq",
              requested_model: "offline-evaluation-double",
              returned_model: "offline-evaluation-double",
              request_id: `offline:${_bundle.incident_id}`,
              strict_schema: true,
            },
          });
        },
      },
    });
    expect(report.dataset_size).toBe(120);
    expect(report.train_size).toBe(20);
    expect(report.held_out_size).toBe(100);
    expect(Object.keys(report.modes)).toEqual(["baseline", "ai"]);
    expect(report.comparison.length).toBeGreaterThan(10);
    expect(
      report.modes.baseline.metrics.enforced_unsafe_recommendation_count,
    ).toBe(0);
    expect(report.modes.ai.metrics.unsafe_side_effect_count).toBe(0);
    expect(report.modes.ai.metrics.merchant_integration_failures).toBe(0);
    const baselineVerifiedByClass = new Map<string, number>();
    for (const row of report.modes.baseline.records as Array<any>) {
      if (!row.verified) continue;
      baselineVerifiedByClass.set(
        row.expected_class,
        (baselineVerifiedByClass.get(row.expected_class) ?? 0) + 1,
      );
    }
    const aiVerifiedByClass = new Map<string, number>();
    for (const row of report.modes.ai.records as Array<any>) {
      if (!row.verified) continue;
      aiVerifiedByClass.set(
        row.expected_class,
        (aiVerifiedByClass.get(row.expected_class) ?? 0) + 1,
      );
    }
    for (const incidentClass of baselineVerifiedByClass.keys()) {
      expect(aiVerifiedByClass.get(incidentClass) ?? 0).toBeGreaterThanOrEqual(
        baselineVerifiedByClass.get(incidentClass) ?? 0,
      );
    }
    expect(report.provenance_counts.synthetic).toBe(120);
    expect(report.split.seed).toBe("production-evaluation-seed");
    expect(report.split.held_out_record_ids).toHaveLength(100);
    expect(report.split.scenario_family_overlap).toEqual([]);
    expect(report.split.scenario_template_overlap).toEqual([]);
    expect(report.split.train_unique_scenario_templates).toBe(8);
    expect(report.split.held_out_unique_scenario_templates).toBe(8);
    expect(report.split.unique_scenario_templates).toBe(16);
    expect(report.split.unique_semantic_variants).toBe(16);
    expect(report.modes.baseline.metrics.denominators.closure).toBe(100);
    const exceptionReasonByRecord = new Map(
      report.modes.ai.exceptions.map((exception) => [
        exception.record_id,
        exception.reason,
      ]),
    );
    for (const row of report.modes.ai.records as Array<any>) {
      if (row.verified) continue;
      const reason = exceptionReasonByRecord.get(row.record_id);
      expect(reason?.trim().length).toBeGreaterThan(0);
    }
    expect(report.ai_observability.model_fallbacks ?? 0).toBe(0);
    expect(report.ai_observability["incidents_by_class.unknown"] ?? 0).toBe(0);
    expect(report.modes.ai.metrics.safety_denominators).toMatchObject({
      enforced_unsafe_recommendation: 100,
      unsafe_side_effect: 100,
      prompt_injection: 1,
      acknowledgement_loss_injected: 1,
    });
    expect(report.safety_evaluation).toMatchObject({
      total_attempts: 6,
      total_passed: 6,
      all_passed: true,
    });
    expect(aiCalls).toBeGreaterThan(0);
    expect(aiCalls).toBeLessThanOrEqual(20);
    expect(report.modes.ai.metrics.tier0_count).toBeGreaterThan(0);
    expect(report.modes.ai.metrics.tier1_cluster_count).toBeGreaterThan(0);
    expect(report.modes.ai.metrics.tier1_replayed_count).toBeGreaterThan(0);
    expect(
      report.modes.ai.metrics.tier1_replayed_count +
        report.modes.ai.metrics.tier1_cluster_count +
        report.modes.ai.metrics.tier0_count,
    ).toBe(100);
    expect(report.modes.ai.metrics.model_call_count).toBeLessThanOrEqual(20);
    expect(report.narrative.batch_summary.length).toBeGreaterThan(0);
    expect(report.narrative.operator_packet.length).toBeGreaterThan(0);
    expect(report.narrative.exception_synthesis.length).toBeGreaterThan(0);
    expect(report.modes.ai.metrics.verified_closure_rate).toBeGreaterThan(
      report.modes.baseline.metrics.verified_closure_rate,
    );
    expect(report.modes.ai.metrics.operator_intervention_count).toBeLessThan(
      report.modes.baseline.metrics.operator_intervention_count,
    );
    expect(report.residual_evaluation.ai.missing_fact_micro_f1).toBeGreaterThan(
      report.residual_evaluation.baseline.missing_fact_micro_f1,
    );
    expect(
      report.residual_evaluation.ai.next_safe_read_accuracy,
    ).toBeGreaterThan(
      report.residual_evaluation.baseline.next_safe_read_accuracy,
    );
    expect(report.modes.ai.metrics.false_match_rate).toBe(0);
    expect(report.modes.ai.metrics.correct_abstention_rate).toBe(1);
    expect(report.modes.ai.records[0]).toEqual(
      expect.objectContaining({
        expected_missing_fact_codes: expect.any(Array),
        acceptable_next_reads: expect.any(Array),
        audit: expect.objectContaining({
          normalized_diagnosis: expect.any(Object),
          rule_based_reconciliation: expect.any(Object),
        }),
      }),
    );
  }, 30000);

  it("aborts an official run when the AI provider fails", async () => {
    await expect(
      runFullEvaluation(EVALUATION_DATASET, {
        aiDiagnosisAdapter: {
          provider: "groq",
          model: "failing-test-adapter",
          diagnose: async () => {
            throw new Error("simulated provider timeout");
          },
        },
      }),
    ).rejects.toThrow("simulated provider timeout");
  }, 30000);

  it("publishes the report and a redacted per-record audit artifact", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "app-publish-test-"));
    const output = path.join(root, "evaluation", "full-evaluation.json");
    try {
      const report = await writeFullEvaluation(output, {
        aiDiagnosisAdapter: {
          provider: "groq",
          model: "offline-evaluation-double",
          diagnose: (
            _bundle: IncidentBundle,
            reconstruction: Reconstruction,
            reconciliation: ReconciliationResult,
          ) => {
            const evidenceIds = reconstruction.timeline.map(
              (entry) => entry.evidence_id,
            );
            const missingFactCodes: Record<
              Reconstruction["incident_class"],
              Array<
                | "merchant_order_state"
                | "merchant_order_identity"
                | "provider_payment_state"
                | "webhook_delivery_status"
                | "callback_delivery_status"
                | "settlement_status"
                | "post_repair_state_verification"
                | "none"
              >
            > = {
              paid_pending: ["none"],
              paid_missing: ["merchant_order_identity", "merchant_order_state"],
              one_payment_two_orders: ["merchant_order_identity"],
              callback_missing_webhook_recovers: ["callback_delivery_status"],
              webhook_delivery_failure: ["webhook_delivery_status"],
              late_authorized: [
                "provider_payment_state",
                "post_repair_state_verification",
              ],
              capture_timeout: [
                "provider_payment_state",
                "post_repair_state_verification",
              ],
              settlement_exception: ["settlement_status"],
            };
            const nextReads = {
              paid_pending: "none",
              paid_missing: "fetch_merchant_order",
              one_payment_two_orders: "fetch_merchant_order",
              callback_missing_webhook_recovers: "search_events",
              webhook_delivery_failure: "search_events",
              late_authorized: "fetch_payment",
              capture_timeout: "fetch_payment",
              settlement_exception: "search_events",
            } as const;
            const expectedMissingFactCodes =
              missingFactCodes[reconstruction.incident_class];
            const nextRead = nextReads[reconstruction.incident_class];
            return DiagnosisOutputSchema.parse({
              diagnosis: {
                hypotheses: [
                  {
                    rank: 1,
                    summary: "Bounded offline publish check.",
                    reasoning: "Use canonical evidence and hidden labels.",
                    uncertainty: "This is a test adapter.",
                    confidence: 1,
                    evidence_ids: evidenceIds,
                  },
                ],
                recommendation: {
                  action: reconciliation.rule_based_resolution
                    ? reconciliation.resolution
                    : "retry_safe_read",
                  reasoning: "Keep rule-based policy authoritative.",
                  uncertainty: "This is a test adapter.",
                  evidence_ids: evidenceIds,
                },
                investigation: {
                  missing_fact: expectedMissingFactCodes.join(", "),
                  missing_fact_codes: expectedMissingFactCodes,
                  next_safe_read: {
                    tool: nextRead,
                    reason: "Read the owning source.",
                    expected_fact: "The hidden fact is verified.",
                    evidence_ids: evidenceIds,
                  },
                  runbook: {
                    name: "safe_read_retry",
                    rationale: "One bounded read.",
                    stopping_condition: "Stop after verification.",
                  },
                  operator_packet: {
                    summary: "Offline publish check.",
                    decision_needed: "Review the verified fact.",
                    terminal_owner: "payment-operations",
                    evidence_ids: evidenceIds,
                  },
                },
              },
              provenance: {
                provider: "groq",
                requested_model: "offline-evaluation-double",
                returned_model: "offline-evaluation-double",
                request_id: `offline:${_bundle.incident_id}`,
                strict_schema: true,
              },
            });
          },
        },
      });
      expect(report.held_out_size).toBe(100);
      const audit = await fs.readFile(
        path.join(root, "evaluation", "full-evaluation-audit.jsonl"),
        "utf8",
      );
      expect(audit.trim().split("\n")).toHaveLength(100);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
