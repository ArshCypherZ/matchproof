import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  verifyBundle,
  processorSignature,
  reconstruct,
  evaluate,
  EvidenceError,
  IncidentStore,
  FixtureDiagnosisAdapter,
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
  it("classifies all bounded incident classes deterministically", () => {
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
  it("reconciles a verified authorized outcome without capture state", async () => {
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-authorized-"));
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
    const result = await runIncident(fixturePath, path.join(dir, "state"), {
      resetState: true,
      processorSecret: secret,
      diagnosisAdapter,
    });
    expect(result.outcome.after_state).toBe("authorized_verified");
    expect(result.payment_state.state).toBe("authorized_verified");
    expect(result.gate_decisions).toEqual([
      expect.objectContaining({
        action: "reconcile_internal_state",
        allowed: true,
      }),
    ]);
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-state-"));
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
  it("end to end reconciliation is durable and idempotent", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-ts-")),
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
    expect(a.outcome.status).toBe("reconciled");
    expect(a.payment_state.state).toBe("captured_verified");
    expect(a.audit_records).toContainEqual(
      expect.objectContaining({ eventType: "policy_evaluated" }),
    );
    expect(b.outcome.status).toBe("already_completed");
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
        "close",
      ]),
    );
  });
  it("does not repeat completed provider gathering after restart", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-resume-gather-"));
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-batch-"));
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
      "reconciled",
      "reconciled",
    ]);
  });
  it("does not duplicate a concurrent incident or progress marker", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-concurrent-"));
    const store = new IncidentStore(path.join(dir, "incident"), true, secret);
    await store.initialize();
    await Promise.all(Array.from({ length: 8 }, () => store.ingest(raw())));
    const progress = await store.progress("inc_timeout_after_capture_001");
    expect(progress.filter((entry) => entry.step === "detect")).toHaveLength(1);
    await store.close();
  });
  it("reverifies persisted evidence when it is read", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-ts-")),
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
