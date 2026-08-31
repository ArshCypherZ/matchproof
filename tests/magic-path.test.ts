import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  verifyBundle,
  processorSignature,
  reconstruct,
  reconcile,
  evaluate,
  EvidenceError,
  IncidentStore,
  FixtureDiagnosisAdapter,
  LiveDiagnosisAdapter,
} from "../src/incident_commander/core";
import {
  runIncident,
  runIncidentBatch,
} from "../src/incident_commander/workflow";
import {
  parseDiagnosisOutput,
  RecommendationSchema,
  RecoveryOutcomeSchema,
  IncidentClassSchema,
} from "../src/domain/schemas";
import { classifyIncident } from "../src/incident_commander/validation";
import { metricsSnapshot, resetMetrics } from "../src/observability";
import type { MerchantPlatformAdapter } from "../src/db/merchant-platform-adapter";
import type { ProviderPostRepairStateAdapter } from "../src/incident_commander/post-repair-state-verifier";
const fixture = path.resolve("fixtures/timeout_after_mutation.json"),
  secret = "test-prototype-secret";
const raw = () => JSON.parse(fs.readFileSync(fixture, "utf8"));
describe("payment incident workflow", () => {
  it("verified evidence suppresses duplicate webhook and reconstructs timeout", () => {
    const r = reconstruct(verifyBundle(raw(), secret));
    expect(r.incident_class).toBe("capture_timeout");
    expect(r.duplicate_evidence_ids).toEqual(["EV-WEBHOOK-002"]);
    expect(r.observation_transitions.map((x: any) => x.state)).toEqual([
      "requested",
      "ambiguous_after_timeout",
      "captured_verified",
    ]);
  });
  it("classifies all bounded incident classes by rule", () => {
    const classes = [
      "paid_pending",
      "paid_missing",
      "one_payment_two_orders",
      "callback_missing_webhook_recovers",
      "webhook_delivery_failure",
      "late_authorized",
      "capture_timeout",
      "settlement_exception",
    ] as const;
    expect(classes.map((value) => IncidentClassSchema.parse(value))).toEqual(
      classes,
    );
    const payload = {
      event_id: "evt_class_001",
      event_type: "payment.captured",
      payment_id: "pay_class_001",
      payment_state: "captured",
      amount_minor: 1000,
      currency: "INR",
      idempotency_key: "class-order-001",
      signature_verified: true,
      operation: "capture",
    } as const;
    const signed = {
      evidence_id: "EV-CLASS-WEBHOOK",
      kind: "processor_webhook" as const,
      occurred_at: "2026-08-21T10:00:01.000Z",
      received_at: "2026-08-21T10:00:02.000Z",
      source: "processor-webhook" as const,
      processor_signature: processorSignature(payload, secret),
      payload,
    };
    const base = {
      incident_id: "inc_class_001",
      payment_id: payload.payment_id,
      idempotency_key: payload.idempotency_key,
    };
    const order = (orderId: string, state: "pending" | "paid" | "missing") => ({
      evidence_id: `EV-ORDER-${orderId}`,
      kind: "merchant_order_state" as const,
      occurred_at: "2026-08-21T10:00:03.000Z",
      received_at: "2026-08-21T10:00:03.000Z",
      source: "merchant-order-store" as const,
      payload: {
        payment_id: payload.payment_id,
        order_id: orderId,
        order_state: state,
        amount_minor: payload.amount_minor,
        currency: payload.currency,
        operation: "capture" as const,
        idempotency_key: payload.idempotency_key,
      },
    });
    const classify = (evidence: unknown[]) =>
      classifyIncident({ ...base, evidence } as any);
    expect(classify([signed, order("order_pending_001", "pending")])).toBe(
      "paid_pending",
    );
    expect(classify([signed])).toBe("paid_missing");
    expect(
      classify([
        signed,
        order("order_one_001", "missing"),
        order("order_two_001", "missing"),
      ]),
    ).toBe("one_payment_two_orders");
    expect(
      classify([
        signed,
        {
          evidence_id: "EV-CALLBACK",
          kind: "callback_observation",
          occurred_at: "2026-08-21T10:00:03.000Z",
          received_at: "2026-08-21T10:00:03.000Z",
          source: "merchant-payment-service",
          payload: {
            payment_id: payload.payment_id,
            callback_status: "missing",
            operation: "capture",
            idempotency_key: payload.idempotency_key,
          },
        },
      ]),
    ).toBe("callback_missing_webhook_recovers");
    expect(
      classify([
        signed,
        {
          evidence_id: "EV-DELIVERY",
          kind: "webhook_delivery",
          occurred_at: "2026-08-21T10:00:03.000Z",
          received_at: "2026-08-21T10:00:03.000Z",
          source: "controller-log",
          payload: {
            payment_id: payload.payment_id,
            delivery_status: "timeout",
            operation: "capture",
            idempotency_key: payload.idempotency_key,
          },
        },
      ]),
    ).toBe("webhook_delivery_failure");
    const latePayload = {
      ...payload,
      event_id: "evt_class_auth",
      event_type: "payment.authorized" as const,
      payment_state: "authorized" as const,
      operation: "authorize" as const,
    };
    expect(
      classify([
        {
          ...signed,
          payload: latePayload,
          processor_signature: processorSignature(latePayload, secret),
        },
      ]),
    ).toBe("late_authorized");
    expect(
      classify([
        signed,
        order("order_settlement_001", "paid"),
        {
          evidence_id: "EV-SETTLEMENT",
          kind: "settlement_observation",
          occurred_at: "2026-08-21T10:00:03.000Z",
          received_at: "2026-08-21T10:00:03.000Z",
          source: "processor-api",
          payload: {
            payment_id: payload.payment_id,
            settlement_status: "missing",
            amount_minor: payload.amount_minor,
            currency: payload.currency,
            operation: "read",
            idempotency_key: payload.idempotency_key,
          },
        },
      ]),
    ).toBe("settlement_exception");
  });
  it("unsafe and unknown actions fail closed", () => {
    const b = verifyBundle(raw(), secret),
      r = reconstruct(b);
    const retry = RecommendationSchema.parse({
      action: "retry_capture",
      reasoning: "test",
      uncertainty: "test",
      evidence_ids: ["EV-WEBHOOK-001"],
    });
    expect(evaluate(retry, b, r).allowed).toBe(false);
    expect(() =>
      RecommendationSchema.parse({
        action: "refund_payment",
        reasoning: "test",
        uncertainty: "test",
        evidence_ids: ["EV-WEBHOOK-001"],
      }),
    ).toThrow();
  });
  it("accepts provider evidence for non-capture incident classes", () => {
    const payload = {
      event_id: "evt_authorized_001",
      event_type: "payment.authorized",
      payment_id: "pay_demo_001",
      payment_state: "authorized",
      amount_minor: 125000,
      currency: "INR",
      idempotency_key: "authorize-order-001",
      signature_verified: true,
      operation: "authorize",
    } as const;
    const bundle = {
      incident_id: "inc_late_authorized_001",
      payment_id: "pay_demo_001",
      idempotency_key: payload.idempotency_key,
      evidence: [
        {
          evidence_id: "EV-AUTH-001",
          kind: "processor_webhook",
          occurred_at: "2026-08-21T10:00:01.000Z",
          received_at: "2026-08-21T10:00:02.000Z",
          source: "processor-webhook",
          processor_signature: processorSignature(payload, secret),
          payload,
        },
      ],
    };
    expect(reconstruct(verifyBundle(bundle, secret)).current_state).toBe(
      "authorized_verified",
    );
  });
  it("escalates a verified authorized outcome when merchant order identity is unavailable", async () => {
    const payload = {
      event_id: "evt_authorized_002",
      event_type: "payment.authorized",
      payment_id: "pay_authorized_002",
      payment_state: "authorized",
      amount_minor: 125000,
      currency: "INR",
      idempotency_key: "authorize-order-002",
      signature_verified: true,
      operation: "authorize",
    } as const;
    const bundle = {
      incident_id: "inc_late_authorized_002",
      payment_id: payload.payment_id,
      idempotency_key: payload.idempotency_key,
      evidence: [
        {
          evidence_id: "EV-AUTH-002",
          kind: "processor_webhook",
          occurred_at: "2026-08-21T10:00:01.000Z",
          received_at: "2026-08-21T10:00:02.000Z",
          source: "processor-webhook",
          processor_signature: processorSignature(payload, secret),
          payload,
        },
      ],
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-authorized-"));
    const fixturePath = path.join(dir, "authorized.json");
    fs.writeFileSync(fixturePath, JSON.stringify(bundle));
    const diagnosisAdapter = {
      provider: "fixture",
      model: "fixture-authorized-v1",
      diagnose: () => ({
        diagnosis: {
          hypotheses: [
            {
              rank: 1,
              summary: "Provider authorization was verified.",
              reasoning: "The signed provider event establishes authorization.",
              uncertainty: "Merchant state requires reconciliation.",
              confidence: 1,
              evidence_ids: ["EV-AUTH-002"],
            },
          ],
          recommendation: {
            action: "reconcile_internal_state",
            reasoning: "Apply the verified provider state.",
            uncertainty: "Escalate if invariants fail.",
            evidence_ids: ["EV-AUTH-002"],
          },
        },
        provenance: {
          provider: "fixture",
          requested_model: "fixture-authorized-v1",
          returned_model: "fixture-authorized-v1",
          request_id: "fixture-authorized-call",
          strict_schema: true,
        },
      }),
    } as FixtureDiagnosisAdapter;
    const merchantPlatformAdapter: MerchantPlatformAdapter = {
      fetchOrderState: vi.fn(),
      updateOrderState: vi.fn(),
      listPendingOrders: vi.fn(),
    };
    const result = await runIncident(fixturePath, path.join(dir, "state"), {
      resetState: true,
      processorSecret: secret,
      diagnosisAdapter,
      merchantPlatformAdapter,
    });
    expect(result.outcome.status).toBe("escalated");
    expect(result.outcome.after_state).toBe("authorized");
    expect(result.payment_state.state).toBe("authorized");
    expect(result.gate_decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "reconcile_internal_state",
          allowed: true,
        }),
        expect.objectContaining({ action: "escalate", allowed: true }),
      ]),
    );
    expect(merchantPlatformAdapter.fetchOrderState).not.toHaveBeenCalled();
    expect(merchantPlatformAdapter.updateOrderState).not.toHaveBeenCalled();
  });
  it("uses the latest same-source observation when seeding controller state", async () => {
    const bundle = raw();
    const internal = bundle.evidence.find(
      (entry: any) => entry.kind === "internal_state",
    );
    bundle.evidence.push({
      ...internal,
      evidence_id: "EV-STATE-002",
      occurred_at: "2026-08-21T10:00:06.000Z",
      received_at: "2026-08-21T10:00:06.000Z",
      payload: { ...internal.payload, payment_state: "captured" },
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-state-"));
    const store = new IncidentStore(path.join(dir, "incident"), true, secret);
    await store.initialize();
    await store.ingest(bundle);
    expect((await store.payment(bundle.payment_id))?.state).toBe("captured");
    await store.close();
  });
  it("rejects diagnosis references outside canonical evidence", () => {
    const output = new FixtureDiagnosisAdapter().diagnose();
    expect(() => parseDiagnosisOutput(output, new Set(["EV-REQ-001"]))).toThrow(
      "EV-TIMEOUT-001 is not canonical",
    );
  });
  it("parses the compact advisory and records provenance", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const reconciliation = reconcile(bundle);
    let providerPrompt = "";
    const adapter = new LiveDiagnosisAdapter({
      apiKey: "test-key",
      model: "test-model",
      transport: async (request) => {
        providerPrompt = String(request.messages.at(-1)?.content);
        return {
          id: "req-live-001",
          model: request.model,
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  hypothesis: "Captured payment was observed after timeout.",
                  missing_fact: "The merchant acknowledgement was lost.",
                  missing_fact_codes: ["post_repair_state_verification"],
                  next_safe_read: "fetch_merchant_order",
                  expected_fact: "The durable merchant order state.",
                  rationale:
                    "Signed evidence confirms the provider capture event.",
                  uncertainty: "The callback acknowledgement was lost.",
                  confidence: 0.9,
                  stopping_condition:
                    "Stop after the post-repair state is verified.",
                  operator_summary:
                    "Provider capture is verified while the merchant acknowledgement is missing.",
                  terminal_owner: "controller",
                  evidence_ids: ["EV-WEBHOOK-001"],
                }),
              },
            },
          ],
          created: 1,
          object: "chat.completion",
        };
      },
    });
    const result = await adapter.diagnose(
      bundle,
      reconstruction,
      reconciliation,
    );
    expect(result.provenance.provider).toBe("groq");
    expect(result.provenance.request_id).toBe("req-live-001");
    expect(providerPrompt).not.toContain('"reconciliation"');
    expect(providerPrompt).not.toContain('"current_state"');
    expect(providerPrompt).not.toContain('"ambiguity_reasons"');
    expect(result.provenance.raw_advisory).toMatchObject({
      format: "compact_json",
      citation_ids: ["EV-WEBHOOK-001"],
      invalid_citation_ids: [],
      citation_valid: true,
      correction_attempt: 0,
      corrections: [],
    });
    expect(result.diagnosis.investigation).toEqual(
      expect.objectContaining({
        missing_fact: "The merchant acknowledgement was lost.",
        next_safe_read: expect.objectContaining({
          tool: "fetch_merchant_order",
        }),
        operator_packet: expect.objectContaining({
          terminal_owner: "controller",
        }),
      }),
    );
  });
  it("maps the advisory action from rule-based reconciliation", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const reconciliation = reconcile(bundle);
    const id = reconstruction.timeline[0]!.evidence_id;
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      transport: async (request) => ({
        id: "req-state-token",
        model: request.model,
        choices: [
          {
            message: {
              content: JSON.stringify({
                hypothesis: "Captured payment observed.",
                missing_fact: "The merchant order post-repair state.",
                missing_fact_codes: ["post_repair_state_verification"],
                next_safe_read: "fetch_merchant_order",
                expected_fact: "The durable merchant order state.",
                rationale: "Provider evidence is present.",
                uncertainty: "Merchant acknowledgement is unresolved.",
                confidence: 0.7,
                stopping_condition:
                  "Stop after the post-repair state is verified.",
                operator_summary: "Provider capture requires merchant repair.",
                terminal_owner: "controller",
                evidence_ids: [id],
              }),
            },
          },
        ],
      }),
    }).diagnose(bundle, reconstruction, reconciliation);
    expect(result.diagnosis.recommendation.action).toBe(
      reconciliation.resolution,
    );
  });
  it("retains the compact advisory with structured missing-fact codes", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const evidenceId = reconstruction.timeline[0]!.evidence_id;
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      transport: async (request) => ({
        id: "req-compact-artifact",
        model: request.model,
        choices: [
          {
            message: {
              content: JSON.stringify({
                hypothesis: "Merchant state may trail provider evidence.",
                missing_fact: "The durable merchant order state is unknown.",
                missing_fact_codes: ["merchant_order_state"],
                next_safe_read: "fetch_merchant_order",
                expected_fact: "The durable merchant order state.",
                rationale: "One bounded read from the owning store.",
                uncertainty: "The write acknowledgement may have been lost.",
                confidence: 0.8,
                stopping_condition: "Escalate if the states still conflict.",
                operator_summary: "Provider evidence requires merchant review.",
                terminal_owner: "merchant-engineering",
                evidence_ids: [evidenceId],
              }),
            },
          },
        ],
      }),
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    expect(result.diagnosis.investigation?.missing_fact_codes).toEqual([
      "merchant_order_state",
    ]);
    expect(result.provenance.raw_advisory).toMatchObject({
      format: "compact_json",
      citation_valid: true,
      corrections: [],
    });
  });
  it("falls back safely when Groq is rate limited", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const reconciliation = reconcile(bundle);
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      fallbackOnError: true,
      transport: async () => {
        throw new Error("rate limited");
      },
    }).diagnose(bundle, reconstruction, reconciliation);
    expect(result.provenance.provider).toBe("rule-based-fallback");
    expect(result.provenance.failure_reason).toContain("rate limited");
  });
  it("rejects live diagnosis citations outside canonical evidence", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      fallbackOnError: true,
      transport: async () => ({
        id: "req-live-invalid-citation",
        model: "test-model",
        choices: [
          {
            message: {
              content: JSON.stringify({
                hypothesis: "Unknown evidence.",
                missing_fact: "The provider payment state.",
                missing_fact_codes: ["provider_payment_state"],
                next_safe_read: "fetch_payment",
                expected_fact: "A canonical provider payment observation.",
                rationale: "Operator review is required.",
                uncertainty: "Citation is invalid.",
                confidence: 0,
                stopping_condition: "Stop and escalate.",
                operator_summary: "Citation is invalid.",
                terminal_owner: "payment-operations",
                evidence_ids: ["EV-NOT-CANONICAL"],
              }),
            },
          },
        ],
      }),
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    expect(result.provenance.provider).toBe("rule-based-fallback");
    expect(result.provenance.failure_reason).toContain("not canonical");
    expect(result.provenance.raw_advisory).toMatchObject({
      citation_ids: ["EV-NOT-CANONICAL"],
      canonical_citation_ids: [],
      invalid_citation_ids: ["EV-NOT-CANONICAL"],
      citation_valid: false,
    });
  });
  it("fails closed on an advisory that violates the output contract", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const reconciliation = reconcile(bundle);
    const id = reconstruction.timeline[0]!.evidence_id;
    let calls = 0;
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      fallbackOnError: true,
      sleep: async () => undefined,
      transport: async () => ({
        id: `req-${++calls}`,
        model: "openai/gpt-oss-20b",
        choices: [
          {
            message: {
              // missing_fact_codes is required: the advisory is rejected
              // without a repair round-trip.
              content: JSON.stringify({
                hypothesis: "Observed state",
                missing_fact: "The merchant order state.",
                next_safe_read: "fetch_merchant_order",
                expected_fact: "The durable merchant order state.",
                rationale: "Evidence is consistent",
                uncertainty: "Bounded",
                confidence: 0.8,
                stopping_condition: "Stop after the read.",
                operator_summary: "Observed state",
                terminal_owner: "controller",
                evidence_ids: [id],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
      }),
    }).diagnose(bundle, reconstruction, reconciliation);
    expect(calls).toBe(1);
    expect(result.provenance.provider).toBe("rule-based-fallback");
    expect(result.provenance.failure_reason).toContain("missing_fact_codes");
    expect(result.provenance.raw_advisory).toMatchObject({
      citation_valid: true,
      corrections: [],
    });
  });
  it("retries a retry-after response and does not fallback", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const id = reconstruction.timeline[0]!.evidence_id;
    let calls = 0;
    const waits: number[] = [];
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      sleep: async (ms) => {
        waits.push(ms);
      },
      transport: async () => {
        calls += 1;
        if (calls === 1) {
          const error = new Error("rate limited");
          (error as any).headers = new Headers({ "retry-after-ms": "25" });
          throw error;
        }
        return {
          id: "req-ok",
          model: "openai/gpt-oss-20b",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  hypothesis: "ok",
                  missing_fact: "ok",
                  missing_fact_codes: ["provider_payment_state"],
                  next_safe_read: "fetch_payment",
                  expected_fact: "ok",
                  rationale: "ok",
                  uncertainty: "ok",
                  confidence: 1,
                  stopping_condition: "ok",
                  operator_summary: "ok",
                  terminal_owner: "controller",
                  evidence_ids: [id],
                }),
              },
            },
          ],
        };
      },
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    expect(calls).toBe(2);
    expect(waits).toContain(25);
    expect(result.provenance.provider).toBe("groq");
  });
  it("retries transient connection errors with bounded backoff", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const id = reconstruction.timeline[0]!.evidence_id;
    let calls = 0;
    const waits: number[] = [];
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      sleep: async (ms) => {
        waits.push(ms);
      },
      transport: async () => {
        calls += 1;
        if (calls < 3) throw new Error("Connection error");
        return {
          id: "req-ok",
          model: "test-model",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  hypothesis: "ok",
                  missing_fact: "ok",
                  missing_fact_codes: ["provider_payment_state"],
                  next_safe_read: "fetch_payment",
                  expected_fact: "ok",
                  rationale: "ok",
                  uncertainty: "ok",
                  confidence: 1,
                  stopping_condition: "ok",
                  operator_summary: "ok",
                  terminal_owner: "controller",
                  evidence_ids: [id],
                }),
              },
            },
          ],
        };
      },
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    expect(calls).toBe(3);
    expect(waits).toEqual([500, 1000]);
    expect(result.provenance.provider).toBe("groq");
  });
  it("records model call and token metrics", async () => {
    resetMetrics();
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const id = reconstruction.timeline[0]!.evidence_id;
    await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      transport: async () => ({
        id: "req-metrics",
        model: "test",
        choices: [
          {
            message: {
              content: JSON.stringify({
                hypothesis: "ok",
                missing_fact: "ok",
                missing_fact_codes: ["provider_payment_state"],
                next_safe_read: "fetch_payment",
                expected_fact: "ok",
                rationale: "ok",
                uncertainty: "ok",
                confidence: 1,
                stopping_condition: "ok",
                operator_summary: "ok",
                terminal_owner: "controller",
                evidence_ids: [id],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    expect(metricsSnapshot()).toMatchObject({
      model_calls: 1,
      model_attempts: 1,
      model_prompt_tokens: 3,
      model_completion_tokens: 4,
      model_total_tokens: 7,
    });
  });
  it("sends the incident class and read tool contract in the prompt", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const id = reconstruction.timeline[0]!.evidence_id;
    let request: any;
    await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      transport: async (value) => {
        request = value;
        return {
          id: "req-contract",
          model: value.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  hypothesis: "ok",
                  missing_fact: "ok",
                  missing_fact_codes: ["provider_payment_state"],
                  next_safe_read: "fetch_payment",
                  expected_fact: "ok",
                  rationale: "ok",
                  uncertainty: "ok",
                  confidence: 1,
                  stopping_condition: "ok",
                  operator_summary: "ok",
                  terminal_owner: "controller",
                  evidence_ids: [id],
                }),
              },
            },
          ],
        };
      },
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    const prompt = String(request.messages.at(-1).content);
    expect(prompt).toContain(`"incident_class":"capture_timeout"`);
    expect(prompt).toContain("read_tool_contract");
    expect(prompt).toContain("few_shot");
    expect(prompt).not.toContain("reconciliation");
  });
  it("fails closed on a transport that exceeds the adapter deadline", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      fallbackOnError: true,
      timeoutMs: 5,
      sleep: async () => undefined,
      transport: async () => new Promise(() => undefined),
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    expect(result.provenance.provider).toBe("rule-based-fallback");
    expect(result.provenance.failure_reason).toContain("timed out");
  });
  it("fails closed on malformed JSON when fallback is enabled", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    let calls = 0;
    const result = await new LiveDiagnosisAdapter({
      apiKey: "test-key",
      fallbackOnError: true,
      transport: async () => ({
        id: `req-json-${++calls}`,
        model: "test-model",
        choices: [{ message: { content: "{bad json" } }],
      }),
    }).diagnose(bundle, reconstruction, reconcile(bundle));
    expect(calls).toBe(1);
    expect(result.provenance.provider).toBe("rule-based-fallback");
    expect(result.provenance.raw_advisory).toMatchObject({
      format: "invalid",
    });
  });
  it("throws on an invalid advisory when fallback is disabled", async () => {
    const bundle = verifyBundle(raw(), secret);
    const reconstruction = reconstruct(bundle);
    await expect(
      new LiveDiagnosisAdapter({
        apiKey: "test-key",
        transport: async () => ({
          id: "req-bad",
          model: "test-model",
          choices: [{ message: { content: "{}" } }],
        }),
      }).diagnose(bundle, reconstruction, reconcile(bundle)),
    ).rejects.toThrow("Groq diagnosis exhausted retries");
  });
  it("requires governance fields when an outcome escalates", () => {
    expect(() =>
      RecoveryOutcomeSchema.parse({
        status: "escalated",
        action: "escalate",
        idempotency_key: "escalate-order-001",
        before_state: "unknown",
        after_state: "unknown",
        reason: "manual review required",
      }),
    ).toThrow();
  });
  it("tampered signed payload is rejected", () => {
    const b = raw();
    b.evidence.find(
      (x: any) => x.kind === "processor_webhook",
    ).payload.amount_minor = 1;
    expect(() => verifyBundle(b, secret)).toThrow(EvidenceError);
  });
  it("boolean, string and negative amount are rejected", () => {
    for (const value of [true, "1", -1]) {
      const b = raw(),
        w = b.evidence.find((x: any) => x.kind === "processor_webhook");
      w.payload.amount_minor = value;
      w.processor_signature = processorSignature(w.payload, secret);
      expect(() => verifyBundle(b, secret)).toThrow(EvidenceError);
    }
  });
  it("persists and replays escalation when merchant post-repair state is unavailable", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-ts-")),
      state = path.join(dir, "incident");
    const a = await runIncident(fixture, state, {
        resetState: true,
        processorSecret: secret,
        diagnosisAdapter: new FixtureDiagnosisAdapter(),
      }),
      b = await runIncident(fixture, state, {
        resetState: false,
        processorSecret: secret,
        diagnosisAdapter: new FixtureDiagnosisAdapter(),
      });
    expect(a.outcome.status).toBe("escalated");
    expect(a.payment_state.state).toBe("capture_pending");
    expect(a.audit_records).toContainEqual(
      expect.objectContaining({ eventType: "policy_evaluated" }),
    );
    expect(b.outcome.status).toBe("escalated");
    const resumedStore = new IncidentStore(state, false, secret);
    await resumedStore.initialize();
    const progress = await resumedStore.progress(
      "inc_timeout_after_capture_001",
    );
    await resumedStore.close();
    expect(progress.map((entry) => entry.step)).toEqual(
      expect.arrayContaining([
        "detect",
        "gather",
        "reconcile",
        "diagnose",
        "gate",
        "execute",
        "observe",
        "verify",
        "escalate",
      ]),
    );
  });
  it("closes merchant reconciliation after a verified post-repair state and replays it without another write", async () => {
    const fixturePath = path.resolve("fixtures/paid_pending.json");
    const dir = fs.mkdtempSync(
      path.join(os.tmpdir(), "app-post-repair-state-"),
    );
    const state = path.join(dir, "incident");
    const timestamp = "2026-08-21T10:00:03.000Z";
    let merchantState: "pending" | "paid" = "pending";
    const merchantRecord = () => ({
      order_id: "order_paid_pending_001",
      payment_id: "pay_paid_pending_001",
      state: merchantState,
      amount_minor: 1000,
      currency: "INR",
      created_at: timestamp,
      updated_at: timestamp,
      observed_at: timestamp,
    });
    const updateOrderState = vi.fn<MerchantPlatformAdapter["updateOrderState"]>(
      async (orderId, requestedState, idempotencyKey) => {
        const beforeState = merchantState;
        merchantState = requestedState;
        return {
          acknowledgement: {
            status: "updated",
            order_id: orderId,
            idempotency_key: idempotencyKey,
            before_state: beforeState,
            requested_state: requestedState,
            acknowledged_at: timestamp,
          },
          observation: merchantRecord(),
        };
      },
    );
    const merchantPlatformAdapter: MerchantPlatformAdapter = {
      fetchOrderState: vi.fn(async () => merchantRecord()),
      updateOrderState,
      listPendingOrders: vi.fn(async () => []),
    };
    const fetchPayment = vi.fn<ProviderPostRepairStateAdapter["fetchPayment"]>(
      async () => ({
        entity: "payment",
        id: "pay_paid_pending_001",
        status: "captured",
        captured: true,
        amount: 1000,
        currency: "INR",
        order_id: "order_paid_pending_001",
        amount_refunded: 0,
        refund_status: null,
        error_code: null,
        error_description: null,
      }),
    );
    const options = {
      processorSecret: secret,
      diagnosisAdapter: new FixtureDiagnosisAdapter(),
      merchantPlatformAdapter,
      providerPostRepairStateAdapter: { fetchPayment },
    };
    const first = await runIncident(fixturePath, state, {
      ...options,
      resetState: true,
    });
    const replay = await runIncident(fixturePath, state, {
      ...options,
      resetState: false,
    });
    expect(first.outcome.status).toBe("reconciled");
    expect(first.post_repair_state_verification?.status).toBe("verified");
    expect(replay.outcome.status).toBe("already_completed");
    expect(replay.post_repair_state_verification).toMatchObject({
      status: "verified",
      replayed: true,
    });
    expect(updateOrderState).toHaveBeenCalledOnce();
    expect(fetchPayment).toHaveBeenCalledOnce();
  });
  it("does not repeat completed provider gathering after restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-resume-gather-"));
    const state = path.join(dir, "incident");
    const gather = vi.fn(async () => []);
    const options = {
      processorSecret: secret,
      diagnosisAdapter: new FixtureDiagnosisAdapter(),
      evidenceGatherer: { gather },
    };
    await runIncident(fixture, state, { ...options, resetState: true });
    await runIncident(fixture, state, { ...options, resetState: false });
    expect(gather).toHaveBeenCalledOnce();
  });
  it("processes incident batches sequentially", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-batch-"));
    const results = await runIncidentBatch(
      ["first", "second"].map((name) => ({
        fixture,
        state: path.join(dir, name),
        options: {
          resetState: true,
          processorSecret: secret,
          diagnosisAdapter: new FixtureDiagnosisAdapter(),
        },
      })),
    );
    expect(results.map((result) => result.outcome.status)).toEqual([
      "escalated",
      "escalated",
    ]);
  });
  it("does not duplicate a concurrent incident or progress marker", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-concurrent-"));
    const store = new IncidentStore(path.join(dir, "incident"), true, secret);
    await store.initialize();
    await Promise.all(Array.from({ length: 8 }, () => store.ingest(raw())));
    const progress = await store.progress("inc_timeout_after_capture_001");
    expect(progress.filter((entry) => entry.step === "detect")).toHaveLength(1);
    await store.close();
  });
  it("reverifies persisted evidence when it is read", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "app-ts-")),
      s = new IncidentStore(path.join(dir, "x"), true, secret);
    await s.initialize();
    await s.ingest(raw());
    await s.close();
    const reopened = new IncidentStore(
      path.join(dir, "x"),
      false,
      "wrong-secret",
    );
    await reopened.initialize();
    await expect(
      reopened.incident("inc_timeout_after_capture_001"),
    ).rejects.toThrow(EvidenceError);
    await reopened.close();
  });
});
