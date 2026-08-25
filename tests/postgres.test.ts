import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { IncidentStore } from "../src/incident_commander/core";
import { RazorpayWebhookInbox } from "../src/incident_commander/webhook";
import { createDatabase } from "../src/db/client";
import { merchantOrders } from "../src/db/schema";
import { PostgresMerchantPlatformAdapter } from "../src/db/postgres-merchant-platform-adapter";

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
      const webhookSecret = "postgres-webhook-secret";
      const body = JSON.stringify({
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_demo_001",
              status: "captured",
              captured: true,
              amount: 125000,
              currency: "INR",
              order_id: "order_demo_001",
              created_at: Math.floor(
                Date.parse("2026-08-21T10:00:04.000Z") / 1000,
              ),
            },
          },
        },
      });
      const inbox = new RazorpayWebhookInbox(store);
      await inbox.ingest({
        rawBody: body,
        signature: crypto
          .createHmac("sha256", webhookSecret)
          .update(body)
          .digest("hex"),
        eventId: "evt_postgres_bridge_123",
        receivedAt: "2026-08-24T00:00:00.000Z",
        webhookSecret,
      });
      await expect(
        inbox.process("evt_postgres_bridge_123", {
          webhookSecret,
          processorSecret: secret,
        }),
      ).resolves.toMatchObject({
        status: "updated",
        incidentId: "inc_timeout_after_capture_001",
      });
      await store.close();
    });

    it("updates merchant order state with idempotency and read-after-write", async () => {
      const store = new IncidentStore(postgresUrl, true, secret);
      await store.initialize();
      await store.close();
      const connection = createDatabase(postgresUrl);
      const now = new Date("2026-08-25T12:00:00.000Z");
      try {
        await connection.db.insert(merchantOrders).values({
          orderId: "merchant_postgres_001",
          paymentId: "pay_postgres_001",
          state: "pending",
          amountMinor: 125000,
          currency: "INR",
          createdAt: new Date("2026-08-25T09:00:00.000Z"),
          updatedAt: new Date("2026-08-25T09:00:00.000Z"),
        });
        const adapter = new PostgresMerchantPlatformAdapter(
          connection.db,
          () => now,
        );

        await expect(
          adapter.listPendingOrders(new Date("2026-08-25T10:00:00.000Z"), 10),
        ).resolves.toEqual([
          expect.objectContaining({ order_id: "merchant_postgres_001" }),
        ]);
        const updated = await adapter.updateOrderState(
          "merchant_postgres_001",
          "paid",
          "merchant:postgres:001",
        );
        const replay = await adapter.updateOrderState(
          "merchant_postgres_001",
          "paid",
          "merchant:postgres:001",
        );

        expect(updated).toMatchObject({
          acknowledgement: { status: "updated" },
          observation: { state: "paid" },
        });
        expect(replay).toMatchObject({
          acknowledgement: { status: "already_applied" },
          observation: { state: "paid" },
        });
      } finally {
        await connection.pool.end();
      }
    });
  },
);
