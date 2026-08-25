import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  RazorpayWebhookInbox,
  RazorpayWebhookConflictError,
} from "../src/incident_commander/webhook";
import { RazorpayWebhookVerificationError } from "../src/incident_commander/razorpay";
import { IncidentStore } from "../src/incident_commander/core";
import { reconstruct } from "../src/incident_commander/core";
import { ProviderPaymentFetchEvidenceSchema } from "../src/domain/schemas";
import fs from "node:fs";
const secret = "webhook-test-secret";
const body =
  '{ "event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_test_1"}}} }';
const signature = crypto
  .createHmac("sha256", secret)
  .update(body)
  .digest("hex");
describe("webhook inbox", () => {
  function paymentBody(
    event: "payment.authorized" | "payment.captured",
    createdAt: number,
  ) {
    return JSON.stringify({
      entity: "event",
      account_id: "acc_test_1",
      event,
      contains: ["payment"],
      created_at: createdAt,
      payload: {
        payment: {
          entity: {
            id: "pay_webhook_1",
            status: event === "payment.authorized" ? "authorized" : "captured",
            captured: event === "payment.captured",
            amount: 12500,
            currency: "INR",
            order_id: "order_webhook_1",
            created_at: createdAt,
          },
        },
      },
    });
  }

  function signed(rawBody: string) {
    return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  it("processes a verified payment webhook after durable ingestion", async () => {
    const database = new IncidentStore(
      path.join(os.tmpdir(), `webhook-${crypto.randomUUID()}.sqlite`),
      true,
      "processor-secret",
    );
    await database.initialize();
    const store = new RazorpayWebhookInbox(database);
    const raw = paymentBody("payment.captured", 1_724_400_000);
    const input = {
      rawBody: raw,
      signature: signed(raw),
      eventId: "evt_bridge_123",
      receivedAt: "2026-08-24T00:00:02.000Z",
      webhookSecret: secret,
    };
    const stored = await store.ingest(input);
    expect(stored.status).toBe("accepted");
    await expect(database.incidentByPaymentId("pay_webhook_1")).resolves.toBe(
      null,
    );
    const processed = await store.process(input.eventId, {
      webhookSecret: secret,
      processorSecret: "processor-secret",
    });
    expect(processed).toMatchObject({
      status: "created",
      incidentId: "inc_webhook_pay_webhook_1",
      lateEvidence: false,
    });
    const incident = await database.incident("inc_webhook_pay_webhook_1");
    expect(incident?.evidence[0]).toMatchObject({
      kind: "processor_webhook",
      payload: {
        event_id: "evt_bridge_123",
        payment_state: "captured",
        amount_minor: 12500,
        currency: "INR",
      },
    });
    await expect(
      database.progress("inc_webhook_pay_webhook_1"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: "detect", status: "completed" }),
        expect.objectContaining({ step: "gather", status: "pending" }),
      ]),
    );
    await database.close();
  });

  it("deduplicates processing and orders reordered webhook evidence by occurrence", async () => {
    const database = new IncidentStore(
      path.join(os.tmpdir(), `webhook-${crypto.randomUUID()}.sqlite`),
      true,
      "processor-secret",
    );
    await database.initialize();
    const store = new RazorpayWebhookInbox(database);
    const authorized = paymentBody("payment.authorized", 1_724_400_000);
    const captured = paymentBody("payment.captured", 1_724_400_010);
    for (const [raw, eventId] of [
      [captured, "evt_ordered_2"],
      [authorized, "evt_ordered_1"],
    ] as const) {
      await store.ingest({
        rawBody: raw,
        signature: signed(raw),
        eventId,
        receivedAt: "2026-08-24T00:00:10.000Z",
        webhookSecret: secret,
      });
    }
    const first = await store.process("evt_ordered_2", {
      webhookSecret: secret,
      processorSecret: "processor-secret",
    });
    const second = await store.process("evt_ordered_1", {
      webhookSecret: secret,
      processorSecret: "processor-secret",
    });
    expect(first?.status).toBe("created");
    expect(second?.status).toBe("updated");
    expect(
      (
        await store.process("evt_ordered_1", {
          webhookSecret: secret,
          processorSecret: "processor-secret",
        })
      )?.status,
    ).toBe("duplicate");
    const incident = await database.incident("inc_webhook_pay_webhook_1");
    const reconstruction = incident ? reconstruct(incident) : undefined;
    expect(reconstruction?.timeline.map((entry) => entry.evidence_id)).toEqual([
      "webhook:evt_ordered_1",
      "webhook:evt_ordered_2",
    ]);
    expect(reconstruction?.current_state).toBe("captured_verified");
    await database.close();
  });

  it("uses fresh provider evidence when the webhook omits financial fields", async () => {
    const database = new IncidentStore(
      path.join(os.tmpdir(), `webhook-${crypto.randomUUID()}.sqlite`),
      true,
      "processor-secret",
    );
    await database.initialize();
    const store = new RazorpayWebhookInbox(database, {
      evidenceGatherer: {
        gather: async ({ paymentId, idempotencyKey }) => [
          ProviderPaymentFetchEvidenceSchema.parse({
            evidence_id: `provider-payment-fetch:${paymentId}`,
            kind: "provider_payment_fetch",
            source: "processor-api",
            occurred_at: "2026-08-24T00:00:00.000Z",
            received_at: "2026-08-24T00:00:00.001Z",
            payload: {
              result: "success",
              payment_id: paymentId,
              status: "captured",
              captured: true,
              amount_minor: 12500,
              currency: "INR",
              order_id: "order_webhook_1",
              amount_refunded: 0,
              refund_status: null,
              error_code: null,
              error_description: null,
              fetched_at: "2026-08-24T00:00:00.001Z",
              freshness_ms: 1,
              operation: "read",
              idempotency_key: idempotencyKey,
            },
          }),
        ],
      },
    });
    const raw = body.replace("pay_test_1", "pay_gathered_1");
    await store.ingest({
      rawBody: raw,
      signature: signed(raw),
      eventId: "evt_gathered_123",
      webhookSecret: secret,
    });
    await expect(
      store.process("evt_gathered_123", {
        webhookSecret: secret,
        processorSecret: "processor-secret",
      }),
    ).resolves.toMatchObject({
      status: "created",
      incidentId: "inc_webhook_pay_gathered_1",
    });
    await database.close();
  });

  it("records a delayed webhook and re-verifies a resolved incident", async () => {
    const file = path.join(
      os.tmpdir(),
      `webhook-${crypto.randomUUID()}.sqlite`,
    );
    const database = new IncidentStore(file, true, "test-prototype-secret");
    await database.initialize();
    const fixture = JSON.parse(
      fs.readFileSync(
        path.resolve("fixtures/timeout_after_mutation.json"),
        "utf8",
      ),
    );
    await database.ingest(fixture);
    await database.setProgress(fixture.incident_id, "close", "completed", {
      outcome: "reconciled",
    });
    const store = new RazorpayWebhookInbox(database);
    const raw = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: fixture.payment_id,
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
    await store.ingest({
      rawBody: raw,
      signature: signed(raw),
      eventId: "evt_late_123",
      receivedAt: "2026-08-24T00:00:10.000Z",
      webhookSecret: secret,
    });
    const result = await store.process("evt_late_123", {
      webhookSecret: secret,
      processorSecret: "test-prototype-secret",
    });
    expect(result).toMatchObject({
      status: "updated",
      incidentId: fixture.incident_id,
      lateEvidence: true,
      reverifyRequired: true,
      closureInvariant: false,
    });
    await database.close();
  });

  it("accepts and deduplicates verified events", async () => {
    const database = new IncidentStore(
      path.join(os.tmpdir(), `webhook-${crypto.randomUUID()}.sqlite`),
      true,
      secret,
    );
    await database.initialize();
    const store = new RazorpayWebhookInbox(database);
    const first = await store.ingest({
      rawBody: body,
      signature,
      eventId: "evt_test_123456",
      receivedAt: "2026-08-23T00:00:00.000Z",
      webhookSecret: secret,
    });
    expect(first.status).toBe("accepted");
    const duplicate = await store.ingest({
      rawBody: body,
      signature,
      eventId: "evt_test_123456",
      webhookSecret: secret,
    });
    expect(duplicate.status).toBe("duplicate");
    await database.close();
  });
  it("rejects forged and conflicting evidence", async () => {
    const database = new IncidentStore(
      path.join(os.tmpdir(), `webhook-${crypto.randomUUID()}.sqlite`),
      true,
      secret,
    );
    await database.initialize();
    const store = new RazorpayWebhookInbox(database);
    await expect(
      store.ingest({
        rawBody: body,
        signature: "forged",
        eventId: "evt_test_123456",
        webhookSecret: secret,
      }),
    ).rejects.toThrow(RazorpayWebhookVerificationError);
    await store.ingest({
      rawBody: body,
      signature,
      eventId: "evt_test_123456",
      webhookSecret: secret,
    });
    const otherBody =
      '{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_test_1"}}}}';
    const otherSignature = crypto
      .createHmac("sha256", secret)
      .update(otherBody)
      .digest("hex");
    await expect(
      store.ingest({
        rawBody: otherBody,
        signature: otherSignature,
        eventId: "evt_test_123456",
        webhookSecret: secret,
      }),
    ).rejects.toThrow(RazorpayWebhookConflictError);
    await database.close();
  });
  it("retains raw evidence and deduplicates concurrent ingestion", async () => {
    const file = path.join(
      os.tmpdir(),
      `webhook-${crypto.randomUUID()}.sqlite`,
    );
    const database = new IncidentStore(file, true, secret);
    await database.initialize();
    const store = new RazorpayWebhookInbox(database);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.ingest({
          rawBody: body,
          signature,
          eventId: "evt_concurrent_123",
          webhookSecret: secret,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "accepted"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "duplicate"),
    ).toHaveLength(7);
    await expect(store.get("evt_concurrent_123")).resolves.toMatchObject({
      event_id: "evt_concurrent_123",
      body,
      signature,
    });
    await database.close();
  });
  it("correlates a webhook received before the incident is persisted", async () => {
    const file = path.join(
      os.tmpdir(),
      `webhook-${crypto.randomUUID()}.sqlite`,
    );
    const database = new IncidentStore(file, true, "test-prototype-secret");
    await database.initialize();
    const store = new RazorpayWebhookInbox(database);
    const fixture = JSON.parse(
      fs.readFileSync(
        path.resolve("fixtures/timeout_after_mutation.json"),
        "utf8",
      ),
    );
    const webhookBody = body.replace("pay_test_1", "pay_demo_001");
    await store.ingest({
      rawBody: webhookBody,
      signature: crypto
        .createHmac("sha256", secret)
        .update(webhookBody)
        .digest("hex"),
      eventId: "evt_correlation_123",
      webhookSecret: secret,
    });
    await database.ingest(fixture);
    await expect(store.get("evt_correlation_123")).resolves.toMatchObject({
      incident_id: fixture.incident_id,
      payment_id: "pay_demo_001",
    });
    await database.close();
  });
});
