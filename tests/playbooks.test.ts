import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  reconcile,
  reconstruct,
  verifyBundle,
} from "../src/incident_commander/core";
import {
  PlaybookDiagnosisAdapter,
  TIER0_READ_PLANS,
  tier0Applies,
} from "../src/incident_commander/playbooks";
import { NarrativeGenerator } from "../src/incident_commander/narrative";
import { runIncident } from "../src/incident_commander/workflow";
import { RazorpayMcpReadGateway } from "../src/incident_commander/razorpay-mcp";
import { resetMetrics, metricsSnapshot } from "../src/observability";

const secret = "test-prototype-secret";
const readFixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.resolve("fixtures", name), "utf8"));

const context = (name: string) => {
  const bundle = verifyBundle(readFixture(name), secret);
  return {
    bundle,
    reconstruction: reconstruct(bundle),
    reconciliation: reconcile({ bundle }),
  };
};

describe("tier 0 rule-based playbooks", () => {
  it("closes a rule-resolvable incident with no model call", () => {
    resetMetrics();
    const current = context("paid_pending.json");
    const output = new PlaybookDiagnosisAdapter().diagnose(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );
    expect(output.provenance.provider).toBe("rule-based-playbook");
    expect(output.diagnosis.recommendation.action).toBe(
      "reconcile_internal_state",
    );
    expect(output.diagnosis.investigation?.next_safe_read.tool).toBe("none");
    expect(metricsSnapshot().tier0_playbook_closures).toBe(1);
    expect(metricsSnapshot().model_calls).toBeUndefined();
  });

  it("runs the class read plan before closing a capture timeout", () => {
    const current = context("capture_timeout_recoverable.json");
    const adapter = new PlaybookDiagnosisAdapter();
    const first = adapter.diagnose(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );
    expect(first.diagnosis.recommendation.action).toBe("retry_safe_read");
    expect(first.diagnosis.investigation?.next_safe_read.tool).toBe(
      "fetch_payment",
    );
    expect(TIER0_READ_PLANS.capture_timeout).toContain("fetch_payment");
  });

  it("escalates residual classes with no rule-based path", () => {
    const current = context("webhook_delivery_failure.json");
    const output = new PlaybookDiagnosisAdapter().diagnose(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );
    expect(output.diagnosis.recommendation.action).toBe("escalate");
    expect(tier0Applies(current.reconstruction, current.reconciliation)).toBe(
      false,
    );
  });

  it("replays a cluster advisory with member-canonical citations", () => {
    const current = context("webhook_delivery_failure.json");
    const memberEvidence = current.reconstruction.timeline[0]!.evidence_id;
    const replay = new PlaybookDiagnosisAdapter({
      readPlan: ["search_events"],
      advisory: {
        hypothesis: "Delivery evidence is missing at the provider.",
        missing_fact: "The provider webhook delivery outcome.",
        missing_fact_codes: ["webhook_delivery_status"],
        expected_fact: "The provider event delivery records.",
        rationale: "Cluster investigation selected the event listing read.",
        uncertainty: "Cluster members vary in identity parameters.",
        confidence: 0.9,
        stopping_condition: "Stop after the delivery outcome is verified.",
        operator_summary: "Webhook delivery failed for a captured payment.",
        terminal_owner: "payment-operations",
      },
    });
    const output = replay.diagnose(
      current.bundle,
      current.reconstruction,
      current.reconciliation,
    );
    expect(output.provenance.provider).toBe("cluster-replay");
    expect(output.diagnosis.investigation?.missing_fact_codes).toEqual([
      "webhook_delivery_status",
    ]);
    expect(output.diagnosis.recommendation.action).toBe("retry_safe_read");
    expect(output.diagnosis.investigation?.next_safe_read.evidence_ids).toEqual(
      expect.arrayContaining([memberEvidence]),
    );
  });

  it("closes a recoverable capture timeout end to end without a model", async () => {
    const dir = fs.mkdtempSync(path.join("/tmp", "app-tier0-"));
    const fixturePath = path.resolve(
      "fixtures/capture_timeout_recoverable.json",
    );
    const evidence = () => {
      const bundle = readFixture("capture_timeout_recoverable.json");
      return {
        evidence: [
          {
            evidence_id: "EV-TIER0-PAYMENT",
            kind: "provider_payment_fetch",
            occurred_at: "2026-08-21T10:00:10.000Z",
            received_at: "2026-08-21T10:00:10.000Z",
            source: "processor-api",
            payload: {
              result: "success",
              payment_id: bundle.payment_id,
              status: "captured",
              captured: true,
              amount_minor: 7000,
              currency: "INR",
              order_id: "order_capture_timeout_recoverable_001",
              amount_refunded: 0,
              refund_status: null,
              error_code: null,
              error_description: null,
              fetched_at: "2026-08-21T10:00:10.000Z",
              freshness_ms: 0,
              operation: "read",
              idempotency_key: bundle.idempotency_key,
            },
          },
        ],
      };
    };
    const gateway = new RazorpayMcpReadGateway(async () => evidence());
    let merchantState: "pending" | "paid" = "pending";
    const merchantRecord = (orderId: string, state: "pending" | "paid") => ({
      order_id: orderId,
      payment_id: "pay_capture_timeout_recoverable_001",
      state,
      amount_minor: 7000,
      currency: "INR",
      created_at: "2026-08-21T10:00:05.200Z",
      updated_at: "2026-08-21T10:00:07.000Z",
      observed_at: "2026-08-21T10:00:07.000Z",
    });
    const merchant = {
      fetchOrderState: async (orderId: string) =>
        merchantRecord(orderId, merchantState),
      updateOrderState: async (orderId: string, state: "paid") => {
        merchantState = state;
        return {
          acknowledgement: {
            status: "updated" as const,
            order_id: orderId,
            idempotency_key: "tier0-recovery",
            before_state: "pending" as const,
            requested_state: state,
            acknowledged_at: "2026-08-21T10:00:07.000Z",
          },
          observation: merchantRecord(orderId, state),
        };
      },
      listPendingOrders: async () => [],
    };
    const providerPostRepairState = {
      fetchPayment: async () => ({
        entity: "payment",
        id: "pay_capture_timeout_recoverable_001",
        status: "captured",
        captured: true,
        amount: 7000,
        currency: "INR",
        order_id: "order_capture_timeout_recoverable_001",
        amount_refunded: 0,
        refund_status: null,
        error_code: null,
        error_description: null,
      }),
    };
    const result = await runIncident(fixturePath, path.join(dir, "state"), {
      resetState: true,
      processorSecret: secret,
      mode: "fixture",
      mcpGateway: gateway,
      merchantPlatformAdapter: merchant as never,
      providerPostRepairStateAdapter: providerPostRepairState as never,
      applyInvestigationObservation: (
        value: Parameters<
          NonNullable<
            import("../src/incident_commander/workflow").RunIncidentOptions["applyInvestigationObservation"]
          >
        >[0],
        observation: Parameters<
          NonNullable<
            import("../src/incident_commander/workflow").RunIncidentOptions["applyInvestigationObservation"]
          >
        >[1],
      ) => {
        const output = (observation as { output?: { evidence?: unknown[] } })
          .output;
        const incoming = Array.isArray(output?.evidence) ? output.evidence : [];
        if (!incoming.length) return value;
        const additions = incoming.map((item) =>
          JSON.parse(JSON.stringify(item)),
        );
        const bundle = verifyBundle(
          {
            ...value.bundle,
            evidence: [...value.bundle.evidence, ...additions],
          },
          secret,
        );
        return {
          bundle,
          reconstruction: reconstruct(bundle),
          reconciliation: reconcile({ bundle }),
        };
      },
    });
    expect(result.model_provenance.provider).toBe("rule-based-playbook");
    expect(result.outcome.status).toBe("reconciled");
    expect(result.post_repair_state_verification?.status).toBe("verified");
    expect(result.investigation_trace?.[0]?.requested_read?.tool).toBe(
      "fetch_payment",
    );
  });
});

describe("tier 2 narrative", () => {
  const input = {
    dataset_size: 100,
    verified_closures: 87,
    escalations: 13,
    by_incident_class: {
      paid_pending: { total: 12, closed: 12, escalated: 0 },
      capture_timeout: { total: 12, closed: 12, escalated: 0 },
      webhook_delivery_failure: { total: 13, closed: 0, escalated: 13 },
    },
    tier_counts: {
      tier0: 74,
      "tier1-cluster-representative": 5,
      "tier1-cluster-replay": 21,
    },
    exceptions: [
      {
        record_id: "eval-001",
        incident_class: "webhook_delivery_failure",
        reason: "merchant post-repair state adapter is required",
        terminal_owner: "payment-operations",
        stopping_reason: "held safely",
      },
    ],
  };

  it("renders a rule-based narrative without a model", async () => {
    const report = await new NarrativeGenerator().generate(input);
    expect(report.provenance.provider).toBe("rule-based-narrative");
    expect(report.batch_summary).toContain("87 of 100");
    expect(report.operator_packet).toContain("exception");
    expect(report.exception_synthesis).toContain("eval-001");
  });

  it("uses the model narrative when configured and keeps it bounded", async () => {
    const transport = vi.fn(async () => ({
      model: "test-model",
      content: JSON.stringify({
        batch_summary: "87 of 100 records closed autonomously.",
        operator_packet: "Review the 13 webhook exceptions <script>.",
        exception_synthesis: "held safely — 13 records.",
      }),
    }));
    const report = await new NarrativeGenerator({
      apiKey: "test-key",
      transport,
    }).generate(input);
    expect(report.provenance.provider).toBe("groq");
    expect(report.batch_summary).toContain("87 of 100");
    expect(report.operator_packet).not.toContain("<script>");
    expect(transport).toHaveBeenCalledOnce();
  });

  it("falls back to the rule-based narrative when the model fails", async () => {
    const report = await new NarrativeGenerator({
      apiKey: "test-key",
      transport: async () => {
        throw new Error("rate limited");
      },
    }).generate(input);
    expect(report.provenance.provider).toBe("rule-based-narrative");
  });
});
