import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DiagnosisOutputSchema,
  type DiagnosisOutput,
} from "../src/domain/schemas";
import {
  AgentInvestigator,
  type InvestigationAgentState,
  type InvestigationStateStore,
} from "../src/incident_commander/agent-investigator";
import {
  reconcile,
  reconstruct,
  verifyBundle,
} from "../src/incident_commander/core";
import { RazorpayMcpReadGateway } from "../src/incident_commander/razorpay-mcp";

const secret = "test-prototype-secret";
const bundle = () =>
  verifyBundle(
    JSON.parse(
      fs.readFileSync(
        path.resolve("fixtures/timeout_after_mutation.json"),
        "utf8",
      ),
    ),
    secret,
  );

const diagnosis = (
  evidenceId: string,
  tool:
    | "fetch_payment"
    | "fetch_order"
    | "search_events"
    | "fetch_merchant_order"
    | "none",
  action:
    | "retry_safe_read"
    | "reconcile_internal_state"
    | "escalate"
    | "refund" = "retry_safe_read",
): DiagnosisOutput =>
  DiagnosisOutputSchema.parse({
    diagnosis: {
      hypotheses: [
        {
          rank: 1,
          summary: "Provider evidence needs one bounded verification.",
          reasoning: "The cited timeline leaves a residual fact unresolved.",
          uncertainty:
            "The fresh provider post-repair state is not yet observed.",
          confidence: 0.8,
          evidence_ids: [evidenceId],
        },
      ],
      recommendation: {
        action,
        reasoning: "Gather one safe read or stop with cited evidence.",
        uncertainty: "No model output authorizes a mutation.",
        evidence_ids: [evidenceId],
      },
      investigation: {
        missing_fact: "The current provider payment state.",
        next_safe_read: {
          tool,
          reason: "Verify the current provider post-repair state.",
          expected_fact: "A fresh provider payment state.",
          evidence_ids: [evidenceId],
        },
        runbook: {
          name:
            action === "escalate"
              ? "evidence_complete_escalation"
              : "safe_read_retry",
          rationale: "Use a bounded read before rule-based policy evaluation.",
          stopping_condition: "Stop after verified evidence or escalation.",
        },
        operator_packet: {
          summary: "A residual provider fact is cited and bounded.",
          decision_needed: "Review the rule-based policy result.",
          terminal_owner: "payment-operations",
          evidence_ids: [evidenceId],
        },
      },
    },
    provenance: {
      provider: "test",
      requested_model: "test",
      returned_model: "test",
      request_id: `request-${tool}-${action}`,
      strict_schema: true,
    },
  });

class MemoryStateStore implements InvestigationStateStore {
  state: InvestigationAgentState | undefined;
  saves: InvestigationAgentState[] = [];
  async load() {
    return this.state;
  }
  async save(state: InvestigationAgentState) {
    this.state = structuredClone(state);
    this.saves.push(structuredClone(state));
  }
}

const context = () => {
  const value = bundle();
  return {
    bundle: value,
    reconstruction: reconstruct(value),
    reconciliation: reconcile(value),
  };
};

describe("AgentInvestigator", () => {
  it("runs one read-only tool per iteration and stops on no next read", async () => {
    const current = context();
    const id = current.reconstruction.timeline[0]!.evidence_id;
    const diagnose = vi
      .fn()
      .mockResolvedValueOnce(diagnosis(id, "fetch_payment"))
      .mockResolvedValueOnce(diagnosis(id, "none", "reconcile_internal_state"));
    const transport = vi.fn().mockResolvedValue({ status: "captured" });
    const store = new MemoryStateStore();
    const result = await new AgentInvestigator({
      diagnosisAdapter: { diagnose },
      mcpGateway: new RazorpayMcpReadGateway(transport),
      stateStore: store,
      maxSteps: 3,
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );

    expect(result.stop_reason).toBe("no_next_read");
    expect(result.trace).toHaveLength(2);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith({
      tool: "fetch_payment",
      input: { payment_id: current.bundle.payment_id },
    });
    expect(store.state).toEqual(
      expect.objectContaining({
        status: "completed",
        final_output: result.output,
      }),
    );
  });

  it("resumes from persisted observations without repeating completed reads", async () => {
    const current = context();
    const id = current.reconstruction.timeline[0]!.evidence_id;
    const store = new MemoryStateStore();
    const firstTransport = vi.fn().mockResolvedValue({ status: "captured" });
    await new AgentInvestigator({
      diagnosisAdapter: {
        diagnose: async () => diagnosis(id, "fetch_payment"),
      },
      mcpGateway: new RazorpayMcpReadGateway(firstTransport),
      stateStore: store,
      maxSteps: 1,
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );
    store.state = { ...store.saves[0]!, status: "running" };
    const secondTransport = vi.fn();
    const result = await new AgentInvestigator({
      diagnosisAdapter: {
        diagnose: async (
          _bundle,
          _reconstruction,
          _reconciliation,
          history,
        ) => {
          expect(history).toHaveLength(1);
          return diagnosis(id, "none", "reconcile_internal_state");
        },
      },
      mcpGateway: new RazorpayMcpReadGateway(secondTransport),
      stateStore: store,
      maxSteps: 2,
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );

    expect(result.resumed).toBe(true);
    expect(result.trace).toHaveLength(2);
    expect(secondTransport).not.toHaveBeenCalled();
  });

  it("fails closed when the model selects an unsupported read", async () => {
    const current = context();
    const id = current.reconstruction.timeline[0]!.evidence_id;
    const transport = vi
      .fn()
      .mockRejectedValue(new Error("provider unavailable"));
    const result = await new AgentInvestigator({
      diagnosisAdapter: {
        diagnose: async () => diagnosis(id, "fetch_merchant_order"),
      },
      mcpGateway: new RazorpayMcpReadGateway(transport),
      stateStore: new MemoryStateStore(),
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );

    expect(result.stop_reason).toBe("unsupported_read");
    expect(result.output.diagnosis.recommendation.action).toBe("escalate");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects policy-controlled financial recommendations", async () => {
    const current = context();
    const id = current.reconstruction.timeline[0]!.evidence_id;
    const transport = vi.fn();
    const result = await new AgentInvestigator({
      diagnosisAdapter: {
        diagnose: async () => diagnosis(id, "none", "refund"),
      },
      mcpGateway: new RazorpayMcpReadGateway(transport),
      stateStore: new MemoryStateStore(),
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );

    expect(result.stop_reason).toBe("unsafe_recommendation");
    expect(result.output.diagnosis.recommendation.action).toBe("escalate");
    expect(transport).not.toHaveBeenCalled();
  });

  it("fails closed after a provider read error", async () => {
    const current = context();
    const id = current.reconstruction.timeline[0]!.evidence_id;
    const result = await new AgentInvestigator({
      diagnosisAdapter: {
        diagnose: async () => diagnosis(id, "fetch_payment"),
      },
      mcpGateway: new RazorpayMcpReadGateway(async () => {
        throw new Error("429 rate limited");
      }),
      stateStore: new MemoryStateStore(),
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );

    expect(result.stop_reason).toBe("read_failed");
    expect(result.trace[0]?.observation?.result).toBe("rate_limited");
    expect(result.output.provenance.provider).toBe(
      "rule-based-investigation-fallback",
    );
  });

  it("stops at the configured step budget", async () => {
    const current = context();
    const id = current.reconstruction.timeline[0]!.evidence_id;
    const transport = vi.fn().mockResolvedValue({ status: "captured" });
    const result = await new AgentInvestigator({
      diagnosisAdapter: {
        diagnose: async () => diagnosis(id, "fetch_payment"),
      },
      mcpGateway: new RazorpayMcpReadGateway(transport),
      stateStore: new MemoryStateStore(),
      maxSteps: 2,
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );

    expect(result.stop_reason).toBe("step_budget_exhausted");
    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.output.diagnosis.recommendation.action).toBe("escalate");
  });

  it("closes a recoverable timeout after the model-selected provider read", async () => {
    const current = context();
    const id = current.reconstruction.timeline[0]!.evidence_id;
    const diagnose = vi
      .fn()
      .mockResolvedValueOnce(diagnosis(id, "fetch_payment"))
      .mockResolvedValueOnce(diagnosis(id, "none", "reconcile_internal_state"));
    const observation = {
      tool: "fetch_payment",
      input: { payment_id: current.bundle.payment_id },
      started_at: "2026-08-21T10:00:10.000Z",
      completed_at: "2026-08-21T10:00:10.050Z",
      result: "success" as const,
      output: { status: "captured" },
    };
    const result = await new AgentInvestigator({
      diagnosisAdapter: { diagnose },
      mcpGateway: new RazorpayMcpReadGateway(async () => observation.output),
      stateStore: new MemoryStateStore(),
      maxSteps: 2,
      applyObservation: (value) => ({
        ...value,
        reconciliation: {
          ...value.reconciliation,
          rule_based_resolution: true,
          resolution: "reconcile_internal_state" as const,
        },
      }),
    }).investigate(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );

    expect(result.stop_reason).toBe("completed");
    expect(result.trace).toHaveLength(2);
    expect(result.trace[0]?.requested_read?.tool).toBe("fetch_payment");
    expect(result.context.reconciliation.rule_based_resolution).toBe(true);
    expect(diagnose).toHaveBeenCalledTimes(2);
  });
});
