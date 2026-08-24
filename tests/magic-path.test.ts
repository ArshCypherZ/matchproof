import { describe, expect, it } from "vitest";
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
import { runIncident } from "../src/incident_commander/workflow";
import {
  parseDiagnosisOutput,
  RecommendationSchema,
  RecoveryOutcomeSchema,
} from "../src/domain/schemas";
const fixture = path.resolve("fixtures/timeout_after_mutation.json"),
  secret = "test-prototype-secret";
const raw = () => JSON.parse(fs.readFileSync(fixture, "utf8"));
describe("payment incident workflow", () => {
  it("verified evidence suppresses duplicate webhook and reconstructs timeout", () => {
    const r = reconstruct(verifyBundle(raw(), secret));
    expect(r.duplicate_evidence_ids).toEqual(["EV-WEBHOOK-002"]);
    expect(r.observation_transitions.map((x: any) => x.state)).toEqual([
      "requested",
      "ambiguous_after_timeout",
      "captured_verified",
    ]);
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
    expect(b.outcome.status).toBe("already_completed");
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
