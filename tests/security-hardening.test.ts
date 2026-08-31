import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IncidentStore } from "../src/incident_commander/store";
import { verifyBundle } from "../src/incident_commander/validation";
import {
  isHexSignature,
  processorSignature,
  verifyProcessorSignature,
} from "../src/incident_commander/signatures";
import {
  RazorpayWebhookVerificationError,
  parseVerifiedRazorpayWebhook,
} from "../src/incident_commander/razorpay";
import { RazorpayWebhookInbox } from "../src/incident_commander/webhook";
import { rateLimit } from "../apps/web/lib/rate-limit";
import { GET as getIncident } from "../apps/web/app/api/incidents/[id]/route";

const webhookSecret = "security-webhook-secret";
const processorSecret = "security-processor-secret";

function signedBody(createdAt?: number) {
  const body = JSON.stringify({
    event: "payment.captured",
    ...(createdAt !== undefined ? { created_at: createdAt } : {}),
    payload: { payment: { entity: { id: "pay_security_1" } } },
  });
  return {
    body,
    signature: crypto
      .createHmac("sha256", webhookSecret)
      .update(body)
      .digest("hex"),
  };
}

describe("webhook signature and replay protection", () => {
  it("rejects a forged signature", () => {
    const { body } = signedBody();
    expect(() =>
      parseVerifiedRazorpayWebhook(body, "0".repeat(64), webhookSecret),
    ).toThrow(RazorpayWebhookVerificationError);
  });

  it("rejects a validly signed but stale event within the tolerance window", () => {
    const { body, signature } = signedBody(1_000_000_000);
    const now = 1_000_000_000 + 3600;
    expect(() =>
      parseVerifiedRazorpayWebhook(body, signature, webhookSecret, {
        toleranceSeconds: 300,
        now: () => now,
      }),
    ).toThrow(/acceptance window/);
  });

  it("accepts a fresh event and honors a zero tolerance", () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = signedBody(now - 10);
    expect(
      parseVerifiedRazorpayWebhook(fresh.body, fresh.signature, webhookSecret, {
        toleranceSeconds: 300,
        now: () => now,
      }).event,
    ).toBe("payment.captured");
    const stale = signedBody(1_000_000_000);
    expect(
      parseVerifiedRazorpayWebhook(stale.body, stale.signature, webhookSecret, {
        toleranceSeconds: 0,
        now: () => now,
      }).event,
    ).toBe("payment.captured");
  });

  it("deduplicates an exact duplicate event id", async () => {
    const store = new IncidentStore(
      path.join(os.tmpdir(), `security-${crypto.randomUUID()}.sqlite`),
      true,
      processorSecret,
    );
    await store.initialize();
    try {
      const inbox = new RazorpayWebhookInbox(store);
      const { body, signature } = signedBody(Math.floor(Date.now() / 1000));
      const input = {
        rawBody: body,
        signature,
        eventId: "evt_security_1",
        webhookSecret,
      };
      const first = await inbox.ingest(input);
      const duplicate = await inbox.ingest(input);
      expect(first.status).toBe("accepted");
      expect(duplicate.status).toBe("duplicate");
    } finally {
      await store.close();
    }
  });
});

describe("processor signature format", () => {
  const payload = {
    event_id: "evt_1",
    payment_id: "pay_1",
    payment_state: "captured",
    amount_minor: 100,
    currency: "INR",
    idempotency_key: "k",
    signature_verified: true,
    operation: "capture",
  };

  it("rejects signatures that are not 64-character lowercase hex", () => {
    const signature = processorSignature(payload, processorSecret);
    expect(verifyProcessorSignature(payload, signature, processorSecret)).toBe(
      true,
    );
    expect(isHexSignature(signature)).toBe(true);
    expect(
      verifyProcessorSignature(
        payload,
        signature.toUpperCase(),
        processorSecret,
      ),
    ).toBe(false);
    expect(verifyProcessorSignature(payload, "zzzz", processorSecret)).toBe(
      false,
    );
    expect(verifyProcessorSignature(payload, "", processorSecret)).toBe(false);
    expect(
      verifyProcessorSignature(payload, `${signature}00`, processorSecret),
    ).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows the budgeted requests and blocks the next within the window", () => {
    let clock = 0;
    const options = { limit: 3, windowSeconds: 60 };
    expect(rateLimit("tenant:route", options, () => clock).allowed).toBe(true);
    expect(rateLimit("tenant:route", options, () => clock).allowed).toBe(true);
    expect(rateLimit("tenant:route", options, () => clock).allowed).toBe(true);
    expect(rateLimit("tenant:route", options, () => clock).allowed).toBe(false);
    clock = 61_000;
    expect(rateLimit("tenant:route", options, () => clock).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const options = { limit: 1, windowSeconds: 60 };
    const now = () => 0;
    expect(rateLimit("a:route", options, now).allowed).toBe(true);
    expect(rateLimit("a:route", options, now).allowed).toBe(false);
    expect(rateLimit("b:route", options, now).allowed).toBe(true);
  });
});

describe("tenant isolation", () => {
  const tenantA = "tenant-a";
  const tenantB = "tenant-b";
  let directory: string;
  let store: IncidentStore;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "tenant-isolation-"));
    process.env.INCIDENT_STATE_PATH = path.join(directory, "incident.sqlite");
    store = new IncidentStore(
      process.env.INCIDENT_STATE_PATH,
      true,
      "test-prototype-secret",
      tenantA,
    );
    await store.initialize();
    const bundle = verifyBundle(
      JSON.parse(await fs.readFile("fixtures/paid_pending.json", "utf8")),
      "test-prototype-secret",
    );
    await store.ingest(bundle);
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(directory, { recursive: true, force: true });
    process.env.INCIDENT_STATE_PATH = "";
  });

  it("returns the incident for its own tenant and 404 for another tenant", async () => {
    const url = "http://localhost/api/incidents/inc_paid_pending_001";
    const own = await getIncident(
      new Request(url, { headers: { "x-tenant-id": tenantA } }),
      { params: Promise.resolve({ id: "inc_paid_pending_001" }) },
    );
    expect(own.status).toBe(200);
    const foreign = await getIncident(
      new Request(url, { headers: { "x-tenant-id": tenantB } }),
      { params: Promise.resolve({ id: "inc_paid_pending_001" }) },
    );
    expect(foreign.status).toBe(404);
  });

  it("returns 404 for an unknown incident id", async () => {
    const response = await getIncident(
      new Request("http://localhost/api/incidents/inc_missing", {
        headers: { "x-tenant-id": tenantA },
      }),
      { params: Promise.resolve({ id: "inc_missing" }) },
    );
    expect(response.status).toBe(404);
  });

  it("scopes audit-derived metrics to the requesting tenant", async () => {
    const other = new IncidentStore(
      process.env.INCIDENT_STATE_PATH ?? "",
      false,
      "test-prototype-secret",
      tenantB,
    );
    await other.initialize();
    try {
      await other.audit("policy_evaluated", { allowed: false });
      await store.audit("policy_evaluated", { allowed: false });
      const { tenantMetrics } =
        await import("../src/incident_commander/tenant-metrics");
      const metrics = await tenantMetrics(store, tenantA);
      const otherMetrics = await tenantMetrics(other, tenantB);
      expect(metrics.blocked_actions).toBe(1);
      expect(otherMetrics.blocked_actions).toBe(1);
      const tenants = (await store.auditRecords()).map(
        (record) => record.payload.tenant_id,
      );
      expect(tenants).toContain(tenantA);
      expect(tenants).toContain(tenantB);
    } finally {
      await other.close();
    }
  });
});
