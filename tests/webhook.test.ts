import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { RazorpayWebhookInbox, RazorpayWebhookConflictError } from "../src/incident_commander/webhook";
import { RazorpayWebhookVerificationError } from "../src/incident_commander/razorpay";
const secret = "webhook-test-secret";
const body = '{ "event": "payment.captured", "payload": {"payment": {"entity": {"id": "pay_test_1"}}} }';
const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
describe("webhook inbox", () => {
  it("accepts and deduplicates verified events", () => { const store = new RazorpayWebhookInbox(path.join(os.tmpdir(), `webhook-${crypto.randomUUID()}.json`)); const first = store.ingest({ rawBody: body, signature, eventId: "evt_test_123456", receivedAt: "2026-08-23T00:00:00.000Z", webhookSecret: secret }); expect(first.status).toBe("accepted"); const duplicate = store.ingest({ rawBody: body, signature, eventId: "evt_test_123456", webhookSecret: secret }); expect(duplicate.status).toBe("duplicate"); });
  it("rejects forged and conflicting evidence", () => { const store = new RazorpayWebhookInbox(path.join(os.tmpdir(), `webhook-${crypto.randomUUID()}.json`)); expect(() => store.ingest({ rawBody: body, signature: "forged", eventId: "evt_test_123456", webhookSecret: secret })).toThrow(RazorpayWebhookVerificationError); store.ingest({ rawBody: body, signature, eventId: "evt_test_123456", webhookSecret: secret }); const otherBody = '{"event":"payment.failed","payload":{"payment":{"entity":{"id":"pay_test_1"}}}}'; const otherSignature = crypto.createHmac("sha256", secret).update(otherBody).digest("hex"); expect(() => store.ingest({ rawBody: otherBody, signature: otherSignature, eventId: "evt_test_123456", webhookSecret: secret })).toThrow(RazorpayWebhookConflictError); });
});
