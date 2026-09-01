import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "../src/db/sqlite-client";
import { merchantOrders, merchantOrderUpdates } from "../src/db/sqlite-schema";
import { SqliteMerchantPlatformAdapter } from "../src/db/sqlite-merchant-platform-adapter";
import { IncidentStore } from "../src/incident_commander/store";
import {
  demoMerchantEvidence,
  demoWebhookBody,
  publicOrderPayload,
  stageDemoIncident,
} from "../src/incident_commander/demo-flow";
import { EvidenceGatherer } from "../src/incident_commander/evidence-gatherer";
import { PlaybookDiagnosisAdapter } from "../src/incident_commander/playbooks";
import { RazorpayProviderPostRepairStateAdapter } from "../src/incident_commander/post-repair-state-verifier";
import type { RazorpayClient } from "../src/incident_commander/razorpay";
import { runIncident } from "../src/incident_commander/workflow";

const webhookSecret = "demo-webhook-secret";
const processorSecret = "demo-processor-secret";
const tenantId = "demo-flow-test";

const orderId = "order_DEMOFlowTest01";
const paymentId = "pay_DEMOFlowTest01";

const payment = {
  id: paymentId,
  status: "captured" as const,
  captured: true,
  amount: 29900,
  currency: "INR",
  order_id: orderId,
  amount_refunded: 0,
  refund_status: null,
  error_code: null,
  error_description: null,
  error_source: null,
  error_step: null,
  error_reason: null,
  created_at: Math.floor(Date.now() / 1000),
};

const providerOrder = {
  id: orderId,
  status: "paid" as const,
  amount: 29900,
  amount_paid: 29900,
  amount_due: 0,
  currency: "INR",
  attempts: 1,
  receipt: "demo-flow",
  offer_id: null,
  notes: { source: "Razorpay Test mode" },
};

const fakeClient: RazorpayClient = {
  orders: {
    create: async () => providerOrder,
    fetch: async (id: string) => ({ ...providerOrder, id }),
    fetchPayments: async () => ({
      count: 1,
      items: [{ id: paymentId, order_id: orderId }],
    }),
  },
  payments: {
    fetch: async (id: string) => ({ ...payment, id }),
    all: async () => ({ count: 1, items: [payment] }),
  },
};

describe("publicOrderPayload", () => {
  it("exposes the key id and never the key secret", () => {
    const payload = publicOrderPayload({ id: orderId }, "rzp_test_demo_key");
    expect(payload).toEqual({ order_id: orderId, key_id: "rzp_test_demo_key" });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("secret");
  });
});

describe("demo staged discrepancy", () => {
  it("classifies as paid_pending, repairs the merchant order, and verifies the post-repair state offline", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "demo-flow-"));
    const incidentStatePath = path.join(directory, "incident.sqlite");
    const merchant = createSqliteDatabase(
      path.join(directory, "merchant.sqlite"),
    );
    migrate(merchant.db, { migrationsFolder: "drizzle-sqlite" });
    const store = new IncidentStore(
      incidentStatePath,
      true,
      processorSecret,
      tenantId,
    );
    await store.initialize();
    try {
      const receivedAt = new Date().toISOString();
      merchant.db
        .insert(merchantOrders)
        .values({
          orderId,
          paymentId,
          state: "pending",
          amountMinor: providerOrder.amount,
          currency: providerOrder.currency,
          createdAt: receivedAt,
          updatedAt: receivedAt,
        })
        .run();

      const staged = await stageDemoIncident(store, {
        webhookBody: demoWebhookBody(payment),
        webhookSecret,
        processorSecret,
        eventId: `evt_demo_${paymentId}`,
        merchantEvidence: demoMerchantEvidence({
          orderId,
          payment,
          providerOrder,
          receivedAt,
          idempotencyKey: `webhook:${paymentId}`,
        }),
      });
      expect(staged).toEqual({
        incidentId: `inc_webhook_${paymentId}`,
        paymentId,
      });

      const bundle = await store.incident(staged.incidentId);
      if (!bundle) throw new Error("staged incident was not persisted");
      expect(
        bundle.evidence.some(
          (entry) =>
            entry.kind === "merchant_order_state" &&
            entry.payload.order_state === "pending",
        ),
      ).toBe(true);

      const fixturePath = path.join(directory, "incident.json");
      await fs.writeFile(fixturePath, JSON.stringify(bundle));
      const result = await runIncident(fixturePath, incidentStatePath, {
        mode: "live",
        resetState: false,
        processorSecret,
        evidenceGatherer: new EvidenceGatherer({ client: fakeClient }),
        merchantPlatformAdapter: new SqliteMerchantPlatformAdapter(merchant.db),
        providerPostRepairStateAdapter:
          new RazorpayProviderPostRepairStateAdapter(fakeClient),
        diagnosisAdapter: new PlaybookDiagnosisAdapter(),
        tenantId,
      });

      expect(result.reconciliation.incident_class).toBe("paid_pending");
      const repair = result.gate_decisions.find(
        (decision) => decision.action === "reconcile_internal_state",
      );
      expect(repair?.allowed).toBe(true);
      expect(result.outcome.status).toBe("reconciled");
      expect(result.post_repair_state_verification?.status).toBe("verified");
      expect(result.payment_state.state).toBe("paid");
      await expect(
        new SqliteMerchantPlatformAdapter(merchant.db).fetchOrderState(orderId),
      ).resolves.toMatchObject({ state: "paid", payment_id: paymentId });
    } finally {
      await store.close();
      merchant.client.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("re-stages the same payment as a fresh run that repairs the order again", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "demo-flow-"));
    const incidentStatePath = path.join(directory, "incident.sqlite");
    const merchant = createSqliteDatabase(
      path.join(directory, "merchant.sqlite"),
    );
    migrate(merchant.db, { migrationsFolder: "drizzle-sqlite" });
    const store = new IncidentStore(
      incidentStatePath,
      true,
      processorSecret,
      tenantId,
    );
    await store.initialize();
    try {
      const stage = async (eventId: string) => {
        const receivedAt = new Date().toISOString();
        merchant.db
          .insert(merchantOrders)
          .values({
            orderId,
            paymentId,
            state: "pending",
            amountMinor: providerOrder.amount,
            currency: providerOrder.currency,
            createdAt: receivedAt,
            updatedAt: receivedAt,
          })
          .onConflictDoUpdate({
            target: merchantOrders.orderId,
            set: {
              paymentId,
              state: "pending",
              amountMinor: providerOrder.amount,
              currency: providerOrder.currency,
              updatedAt: receivedAt,
            },
          })
          .run();
        return stageDemoIncident(store, {
          webhookBody: demoWebhookBody(payment),
          webhookSecret,
          processorSecret,
          eventId,
          merchantEvidence: demoMerchantEvidence({
            orderId,
            payment,
            providerOrder,
            receivedAt,
            idempotencyKey: `webhook:${paymentId}`,
          }),
          clearMerchantUpdateAcknowledgements: async (executionKeys) => {
            merchant.db
              .delete(merchantOrderUpdates)
              .where(
                inArray(merchantOrderUpdates.idempotencyKey, executionKeys),
              )
              .run();
          },
        });
      };
      const run = async () => {
        const bundle = await store.incident(`inc_webhook_${paymentId}`);
        if (!bundle) throw new Error("staged incident was not persisted");
        const fixturePath = path.join(directory, "incident.json");
        await fs.writeFile(fixturePath, JSON.stringify(bundle));
        return runIncident(fixturePath, incidentStatePath, {
          mode: "live",
          resetState: false,
          processorSecret,
          evidenceGatherer: new EvidenceGatherer({ client: fakeClient }),
          merchantPlatformAdapter: new SqliteMerchantPlatformAdapter(
            merchant.db,
          ),
          providerPostRepairStateAdapter:
            new RazorpayProviderPostRepairStateAdapter(fakeClient),
          diagnosisAdapter: new PlaybookDiagnosisAdapter(),
          tenantId,
        });
      };

      // First rehearsal: the discrepancy is repaired and verified.
      await stage(`evt_demo_${paymentId}_first`);
      const first = await run();
      expect(first.outcome.status).toBe("reconciled");
      expect(first.post_repair_state_verification?.status).toBe("verified");

      // Second rehearsal for the same payment: the freshly staged discrepancy
      // must be repaired again, not replayed as a terminal outcome.
      await stage(`evt_demo_${paymentId}_second`);
      const restagedProgress = await store.progress(`inc_webhook_${paymentId}`);
      expect(restagedProgress).toEqual([
        expect.objectContaining({ step: "detect", status: "completed" }),
      ]);
      const second = await run();
      expect(second.reconciliation.incident_class).toBe("paid_pending");
      expect(second.outcome.status).toBe("reconciled");
      expect(second.post_repair_state_verification?.status).toBe("verified");
      expect(second.payment_state.state).toBe("paid");
      await expect(
        new SqliteMerchantPlatformAdapter(merchant.db).fetchOrderState(orderId),
      ).resolves.toMatchObject({ state: "paid", payment_id: paymentId });
    } finally {
      await store.close();
      merchant.client.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
