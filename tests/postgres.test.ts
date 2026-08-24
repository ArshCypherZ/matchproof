import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IncidentStore } from "../src/incident_commander/core";

const fixture = path.resolve("fixtures/timeout_after_mutation.json");
const secret = "test-prototype-secret";
const postgresUrl =
  process.env.DATABASE_URL ??
  "postgres://incident:incident@localhost:9998/incident_commander";

describe.skipIf(process.env.RUN_POSTGRES_TESTS !== "1")(
  "postgres incident repository",
  () => {
    it("persists durable progress, idempotent ingestion, and audit records", async () => {
      const store = new IncidentStore(postgresUrl, true, secret);
      await store.initialize();
      const bundle = JSON.parse(fs.readFileSync(fixture, "utf8")) as unknown;
      await Promise.all(Array.from({ length: 4 }, () => store.ingest(bundle)));
      await store.setProgress(
        "inc_timeout_after_capture_001",
        "gather",
        "completed",
        { evidence_count: 5 },
      );
      await store.setProgress(
        "inc_timeout_after_capture_001",
        "reconcile",
        "completed",
        { current_state: "captured_verified" },
      );
      const progress = await store.progress("inc_timeout_after_capture_001");
      expect(progress.map((entry) => entry.step)).toEqual([
        "detect",
        "gather",
        "reconcile",
      ]);
      expect(await store.payment("pay_demo_001")).toMatchObject({
        state: "capture_pending",
      });
      await store.updatePayment("pay_demo_001", "captured_verified");
      await store.completeRecovery("recovery:postgres:001", {
        action: "reconcile_internal_state",
        status: "reconciled",
        before_state: "capture_pending",
        after_state: "captured_verified",
        completed_at: "2026-08-24T00:00:00.000Z",
      });
      expect(await store.recovery("recovery:postgres:001")).toMatchObject({
        status: "reconciled",
        after_state: "captured_verified",
      });
      await store.audit("postgres_test", { checked: true });
      expect((await store.auditRecords()).length).toBe(1);
      const first = await store.ingestWebhook({
        eventId: "evt_postgres_123",
        eventType: "payment.captured",
        signature: "signature",
        body: "{}",
        receivedAt: "2026-08-24T00:00:00.000Z",
        paymentId: "pay_demo_001",
      });
      const second = await store.ingestWebhook({
        eventId: "evt_postgres_123",
        eventType: "payment.captured",
        signature: "signature",
        body: "{}",
        receivedAt: "2026-08-24T00:00:00.000Z",
        paymentId: "pay_demo_001",
      });
      expect(first.status).toBe("accepted");
      expect(second.status).toBe("duplicate");
      await store.close();
    });
  },
);
