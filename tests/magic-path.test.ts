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
  it("persisted evidence is reverified", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "o2-ts-")),
      s = new IncidentStore(path.join(dir, "x"), true, secret);
    await s.initialize();
    const b = raw();
    b.evidence.find(
      (x: any) => x.kind === "processor_webhook",
    ).processor_signature = "forged";
    await s.ingest(raw());
    expect(() => verifyBundle(b, secret)).toThrow(EvidenceError);
    await s.close();
  });
});
