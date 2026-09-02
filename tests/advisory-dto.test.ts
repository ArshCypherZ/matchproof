import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { incidentDto } from "../apps/web/lib/incidents";
import type { ProgressRecord } from "../src/db/repository";
import type { IncidentBundle } from "../src/domain/schemas";

const bundle = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../fixtures/paid_pending.json"),
    "utf8",
  ),
) as IncidentBundle;

const modelOutput = (provider: string) => ({
  diagnosis: {
    hypotheses: [
      {
        rank: 1,
        summary: "The capture landed after the order stopped waiting.",
        reasoning: "The payment is captured and signature-verified.",
        uncertainty: "Merchant-side application state is unreadable.",
        confidence: 0.9,
        evidence_ids: [bundle.evidence[0]!.evidence_id],
      },
    ],
    recommendation: {
      action: "escalate",
      reasoning: "The deciding fact is not in the provider records.",
      uncertainty: "Closing would assume state no record shows.",
      evidence_ids: [bundle.evidence[0]!.evidence_id],
    },
    investigation: {
      missing_fact: "Whether the merchant backend applied the payment.",
      next_safe_read: {
        tool: "fetch_merchant_order",
        reason: "The merchant order state decides the repair.",
        expected_fact: "The merchant order's current payment state.",
        evidence_ids: [bundle.evidence[0]!.evidence_id],
      },
      runbook: {
        name: "merchant_state_reconciliation",
        rationale: "The provider cannot settle this alone.",
        stopping_condition: "An operator resolves the exception.",
      },
      operator_packet: {
        summary: "The agent stopped without a financial side effect.",
        decision_needed: "Confirm the merchant order state.",
        terminal_owner: "payment-operations",
        evidence_ids: [bundle.evidence[0]!.evidence_id],
      },
    },
  },
  provenance: {
    provider,
    requested_model: "qwen/qwen3.8-27b",
    returned_model: provider === "groq" ? "qwen/qwen3.8-27b" : "tier0-playbook-v1",
    request_id: "req_test_1",
    strict_schema: true,
  },
});

const investigationState = (tool: string) => ({
  version: 1,
  incident_id: bundle.incident_id,
  status: "completed",
  trace: [
    {
      step: 1,
      diagnosis: modelOutput("groq"),
      requested_read: { tool, input: {} },
      observation: {
        tool,
        input: {},
        started_at: "2026-09-01T00:00:00.000Z",
        completed_at: "2026-09-01T00:00:01.000Z",
        result: "success",
      },
      stop_reason: "max_steps",
    },
  ],
  final_output: modelOutput("groq"),
  stop_reason: "max_steps",
});

function progressRow(
  step: string,
  status: string,
  details: unknown,
  sequence: number,
): ProgressRecord {
  return {
    sequence,
    incident_id: bundle.incident_id,
    step,
    status,
    updated_at: "2026-09-01T00:00:02.000Z",
    details,
  };
}

describe("incidentDto advisory extraction", () => {
  it("surfaces the model advisory with its reads from stored progress", () => {
    const dto = incidentDto(
      bundle,
      [
        progressRow("diagnose", "completed", modelOutput("groq"), 3),
        progressRow(
          "agent_investigation",
          "completed",
          investigationState("fetch_merchant_order"),
          2,
        ),
      ],
      undefined,
    );

    expect(dto.advisory).not.toBeNull();
    expect(dto.advisory?.action).toBe("escalate");
    expect(dto.advisory?.reasoning).toContain("deciding fact");
    expect(dto.advisory?.missing_fact).toContain("merchant backend");
    expect(dto.advisory?.next_read?.tool).toBe("fetch_merchant_order");
    expect(dto.advisory?.next_read?.expected_fact).toContain("payment state");
    expect(dto.advisory?.decision_needed).toContain("merchant order state");
    expect(dto.advisory?.owner).toBe("payment-operations");
    expect(dto.advisory?.model).toBe("qwen/qwen3.8-27b");
    expect(dto.advisory?.reads).toEqual([
      { tool: "fetch_merchant_order", result: "success" },
    ]);
    expect(dto.advisory?.hypotheses).toHaveLength(1);
    expect(dto.advisory?.hypotheses?.[0]?.summary).toContain("capture");
  });

  it("omits the advisory when the diagnosis came from the tier-0 playbook", () => {
    const dto = incidentDto(
      bundle,
      [progressRow("diagnose", "completed", modelOutput("rule-based-playbook"), 2)],
      undefined,
    );
    expect(dto.advisory).toBeNull();
  });

  it("omits the advisory when no diagnosis is recorded", () => {
    const dto = incidentDto(
      bundle,
      [progressRow("detect", "completed", {}, 1)],
      undefined,
    );
    expect(dto.advisory).toBeNull();
  });
});
