import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IncidentStore } from "../src/incident_commander/store";
import { processorSignature } from "../src/incident_commander/signatures";
import { tenantMetrics } from "../src/incident_commander/tenant-metrics";
import { verifyBundle } from "../src/incident_commander/validation";
import type { IncidentBundle } from "../src/domain/schemas";

const secret = "test-prototype-secret";
const tenantId = "metrics-test";
let directory: string;
let store: IncidentStore;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "tenant-metrics-"));
  store = new IncidentStore(
    path.join(directory, "incident.sqlite"),
    true,
    secret,
    tenantId,
  );
  await store.initialize();
});

afterEach(async () => {
  await store.close();
  await fs.rm(directory, { recursive: true, force: true });
});

const fixture = JSON.parse(
  await fs.readFile("fixtures/paid_pending.json", "utf8"),
);

async function seedIncident(
  index: number,
  receivedAt: string,
): Promise<IncidentBundle> {
  const paymentId = `pay_metrics_${index}`;
  const clone = JSON.parse(
    JSON.stringify(fixture).replaceAll("pay_paid_pending_001", paymentId),
  ) as IncidentBundle;
  clone.incident_id = `inc_metrics_${index}`;
  clone.idempotency_key = `metrics-${index}`;
  for (const evidence of clone.evidence) {
    evidence.evidence_id = `${evidence.evidence_id}-${index}`;
    evidence.occurred_at = receivedAt;
    evidence.received_at = receivedAt;
    const payload = evidence.payload as Record<string, unknown>;
    if ("payment_id" in payload) payload.payment_id = paymentId;
    if ("idempotency_key" in payload)
      payload.idempotency_key = clone.idempotency_key;
    if (evidence.kind === "processor_webhook") {
      evidence.processor_signature = processorSignature(
        evidence.payload,
        secret,
      );
    }
  }
  const bundle = verifyBundle(clone, secret);
  await store.ingest(bundle);
  return bundle;
}

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

describe("tenantMetrics", () => {
  it("computes measured outcomes and median time to close from the store", async () => {
    await seedIncident(1, minutesAgo(60));
    await seedIncident(2, minutesAgo(30));
    await seedIncident(3, minutesAgo(90));
    await seedIncident(4, minutesAgo(10));

    const close = async (index: number, step: "close" | "escalate") => {
      await store.setProgress(`inc_metrics_${index}`, step, "completed", {});
      return store.progress(`inc_metrics_${index}`);
    };
    const [first, second, third] = await Promise.all([
      close(1, "close"),
      close(2, "close"),
      close(3, "escalate"),
    ]);
    const durationOf = (
      receivedMinutesAgo: number,
      progress: Awaited<ReturnType<typeof store.progress>>,
    ) =>
      Math.max(
        0,
        Math.round(
          (Date.parse(progress.at(-1)!.updated_at) -
            Date.parse(minutesAgo(receivedMinutesAgo))) /
            1000,
        ),
      );
    const expectedMedian = (() => {
      const durations = [
        durationOf(60, first),
        durationOf(30, second),
        durationOf(90, third),
      ].sort((left, right) => left - right);
      return durations[1];
    })();

    await store.audit("post_repair_state_observed", { status: "verified" });
    await store.audit("post_repair_state_observed", { status: "verified" });
    await store.audit("post_repair_state_observed", { status: "held" });
    await store.audit("recovery_completed", { status: "reconciled" });
    await store.audit("recovery_completed", { status: "already_completed" });
    await store.audit("recovery_completed", { status: "reconciled" });
    await store.audit("policy_evaluated", { allowed: false });
    await store.audit("policy_evaluated", { allowed: true });

    const metrics = await tenantMetrics(store, tenantId);
    expect(metrics).toEqual({
      total: 4,
      pending: 1,
      reconciled: 2,
      escalated: 1,
      repair_success_rate: 2 / 3,
      post_repair_state_verified_share: 2 / 3,
      duplicates_prevented: 1,
      blocked_actions: 1,
      median_time_to_close_seconds: expectedMedian,
    });
  });

  it("returns null rates for an empty store", async () => {
    const metrics = await tenantMetrics(store, tenantId);
    expect(metrics).toEqual({
      total: 0,
      pending: 0,
      reconciled: 0,
      escalated: 0,
      repair_success_rate: null,
      post_repair_state_verified_share: null,
      duplicates_prevented: 0,
      blocked_actions: 0,
      median_time_to_close_seconds: null,
    });
  });
});
