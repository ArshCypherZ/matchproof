import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  evaluate,
  evaluateAndAudit,
  POLICY_VERSION,
} from "../src/incident_commander/policy";
import { RecommendationSchema } from "../src/domain/schemas";
import {
  reconstruct,
  reconcile,
  verifyBundle,
} from "../src/incident_commander/core";

const secret = "test-prototype-secret";
const bundle = verifyBundle(
  JSON.parse(
    fs.readFileSync(
      path.resolve("fixtures/timeout_after_mutation.json"),
      "utf8",
    ),
  ),
  secret,
);
const reconstruction = reconstruct(bundle);
const reconciliation = reconcile(bundle);
const agreedBundle = verifyBundle(
  JSON.parse(
    fs.readFileSync(path.resolve("fixtures/paid_pending.json"), "utf8"),
  ),
  secret,
);
const agreedEvidence = agreedBundle.evidence.map((entry) =>
  entry.kind === "merchant_order_state"
    ? { ...entry, payload: { ...entry.payload, order_state: "paid" as const } }
    : entry,
);
const noActionBundle = {
  ...agreedBundle,
  evidence: agreedEvidence,
} as typeof bundle;

const recommendation = (action: string, evidenceIds = ["EV-WEBHOOK-001"]) =>
  RecommendationSchema.parse({
    action,
    reasoning: "policy test",
    uncertainty: "policy test uncertainty",
    evidence_ids: evidenceIds,
  });

describe("rule-based action policy", () => {
  it.each([
    ["reconcile_internal_state", true],
    ["escalate", true],
    ["retry_safe_read", false],
    ["no_action_required", false],
    ["retry_capture", false],
    ["refund", false],
    ["payout", false],
    ["fulfil", false],
    ["arbitrary_write", false],
  ] as const)("evaluates %s explicitly", (action, allowed) => {
    const decision = evaluate(
      recommendation(action),
      bundle,
      reconstruction,
      undefined,
      reconciliation,
    );
    expect(decision).toMatchObject({ action, allowed });
    expect(decision.approval_required).toBe(
      allowed
        ? null
        : action === "retry_capture"
          ? "operator-approved capture runbook"
          : action === "refund"
            ? "operator-approved refund runbook"
            : action === "payout"
              ? "operator-approved payout runbook"
              : action === "fulfil"
                ? "operator-approved fulfilment runbook"
                : action === "arbitrary_write"
                  ? "explicitly scoped merchant adapter operation"
                  : null,
    );
  });

  it("requires a failed idempotent provider read before retrying it", () => {
    const decision = evaluate(
      recommendation("retry_safe_read"),
      bundle,
      reconstruction,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("failed idempotent read");
  });

  it("allows a failed idempotent provider read to be retried", () => {
    const failedReadBundle = verifyBundle(
      {
        ...bundle,
        evidence: [
          ...bundle.evidence,
          {
            evidence_id: "EV-FETCH-ERROR",
            kind: "provider_payment_fetch",
            occurred_at: "2026-08-21T10:00:09.000Z",
            received_at: "2026-08-21T10:00:09.000Z",
            source: "processor-api",
            payload: {
              payment_id: bundle.payment_id,
              result: "error",
              error_code: "ETIMEDOUT",
              error_message: "provider read timed out",
              timeout: true,
              operation: "read",
              idempotency_key: bundle.idempotency_key,
            },
          },
        ],
      },
      secret,
    );
    const decision = evaluate(
      recommendation("retry_safe_read", ["EV-FETCH-ERROR"]),
      failedReadBundle,
      reconstruct(failedReadBundle),
    );
    expect(decision.allowed).toBe(true);
  });

  it("rejects an action outside its explicit allowlist", () => {
    expect(() =>
      evaluate(
        {
          ...recommendation("escalate"),
          action: "unrecognized_action",
        } as never,
        bundle,
        reconstruction,
        undefined,
        reconciliation,
      ),
    ).toThrow("policy rejected an unknown action");
  });

  it("requires an agreed reconciliation for no-action", () => {
    const decision = evaluate(
      recommendation("no_action_required"),
      bundle,
      reconstruction,
      undefined,
      reconciliation,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("agreed reconciliation");
  });

  it("allows no-action when reconciliation proves agreement", () => {
    const agreed = reconcile(noActionBundle);
    const decision = evaluate(
      recommendation("no_action_required"),
      noActionBundle,
      reconstruction,
      undefined,
      agreed,
    );
    expect(decision.allowed).toBe(true);
  });

  it("blocks repair when any reconciliation invariant fails", () => {
    const invalid = {
      ...reconciliation,
      invariant_results: {
        ...reconciliation.invariant_results,
        amount: false,
      },
    };
    const decision = evaluate(
      recommendation("reconcile_internal_state"),
      bundle,
      reconstruction,
      undefined,
      invalid,
    );
    expect(decision.allowed).toBe(false);
  });

  it("logs every evaluation with policy provenance", async () => {
    const events: unknown[] = [];
    await evaluateAndAudit(
      recommendation("escalate"),
      bundle,
      reconstruction,
      undefined,
      reconciliation,
      (event) => void events.push(event),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: "policy_evaluated",
      payload: {
        policy_version: POLICY_VERSION,
        action: "escalate",
        allowed: true,
      },
    });
  });
});
