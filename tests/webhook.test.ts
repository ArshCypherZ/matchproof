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
import fs from "node:fs";
const secret = "webhook-test-secret";
const body =
  '{ "event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_test_1"}}} }';
const signature = crypto
  .createHmac("sha256", secret)
  .update(body)
  .digest("hex");
describe("webhook inbox", () => {
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
