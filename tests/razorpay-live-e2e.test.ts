import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";
import { createSqliteDatabase } from "../src/db/sqlite-client";
import { merchantOrders } from "../src/db/sqlite-schema";
import { SqliteMerchantPlatformAdapter } from "../src/db/sqlite-merchant-platform-adapter";
import {
  DiagnosisOutputSchema,
  type IncidentBundle,
  type Reconstruction,
  type ReconciliationResult,
} from "../src/domain/schemas";
import { EvidenceGatherer } from "../src/incident_commander/evidence-gatherer";
import {
  createTestModeClient,
  createTestModeOrder,
  fetchTestModeOrder,
  fetchTestModeOrderPayments,
  fetchTestModePayment,
  type RazorpayClient,
} from "../src/incident_commander/razorpay";
import { IncidentStore } from "../src/incident_commander/store";
import { RazorpayWebhookInbox } from "../src/incident_commander/webhook";
import { verifyBundle } from "../src/incident_commander/validation";
import { runIncident } from "../src/incident_commander/workflow";

const enabled = process.env.RUN_RAZORPAY_LIVE_E2E === "1";
const describeLive = enabled ? describe : describe.skip;

function webhookBody(
  payment: Awaited<ReturnType<typeof fetchTestModePayment>>,
) {
  return JSON.stringify({
    event: "payment.captured",
    created_at: payment.created_at ?? Math.floor(Date.now() / 1000),
    payload: {
      payment: {
        entity: {
          id: payment.id,
          status: payment.status,
          captured: payment.captured,
          amount: payment.amount,
          currency: payment.currency,
          order_id: payment.order_id,
          created_at: payment.created_at,
        },
      },
    },
  });
}

describeLive("Razorpay Test-mode end-to-end loop", () => {
  it("creates an order, ingests a signed webhook, repairs merchant state, and verifies fresh post-repair state", async () => {
    const client = createTestModeClient() as unknown as RazorpayClient;
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const processorSecret = process.env.PROCESSOR_WEBHOOK_SECRET;
    if (!webhookSecret || !processorSecret)
      throw new Error(
        "RAZORPAY_WEBHOOK_SECRET and PROCESSOR_WEBHOOK_SECRET are required",
      );

    const configuredOrderId = process.env.RAZORPAY_E2E_ORDER_ID;
    const order = configuredOrderId
      ? { id: configuredOrderId }
      : await createTestModeOrder(
          {
            amount: 100,
            currency: "INR",
            receipt: `t024-${Date.now()}`,
            notes: { test: "T-024 live end-to-end" },
          },
          client,
        );
    const orderId = String((order as { id: string }).id);
    const providerOrder = await fetchTestModeOrder(orderId, client);
    const payments = await fetchTestModeOrderPayments(orderId, client);
    const paymentRecords = await Promise.all(
      payments.items.map((payment) => fetchTestModePayment(payment.id, client)),
    );
    const captured = paymentRecords.find(
      (payment) => payment.status === "captured" && payment.captured,
    );
    if (!captured) {
      throw new Error(
        `Order ${orderId} was created, but it has no captured payment. Complete a Test-mode payment for this order, then rerun RUN_RAZORPAY_LIVE_E2E=1 pnpm test -- tests/razorpay-live-e2e.test.ts. No capture/refund/payout was attempted.`,
      );
    }
    const payment = await fetchTestModePayment(captured.id, client);
    const eventId = `evt_t024_${Date.now()}`;
    const rawBody = webhookBody(payment);
    const signature = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    const idempotencyKey = `webhook:${payment.id}`;
    const incidentId = `inc_webhook_${payment.id}`;
    const temporaryDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "razorpay-t024-"),
    );
    const incidentStatePath = path.join(temporaryDirectory, "incident.sqlite");
    const merchantStatePath = path.join(temporaryDirectory, "merchant.sqlite");
    const merchantConnection = createSqliteDatabase(merchantStatePath);
    migrate(merchantConnection.db, { migrationsFolder: "drizzle-sqlite" });
    const timestamp = new Date().toISOString();
    merchantConnection.db
      .insert(merchantOrders)
      .values({
        orderId,
        paymentId: payment.id,
        state: "pending",
        amountMinor: payment.amount,
        currency: payment.currency,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    const store = new IncidentStore(
      incidentStatePath,
      true,
      processorSecret,
      "t024-live",
    );
    await store.initialize();
    try {
      const inbox = new RazorpayWebhookInbox(store);
      const ingested = await inbox.ingest({
        eventId,
        rawBody,
        signature,
        webhookSecret,
        receivedAt: timestamp,
      });
      expect(ingested.status).toBe("accepted");
      const processed = await inbox.process(eventId, {
        webhookSecret,
        processorSecret,
      });
      expect(processed?.incidentId).toBe(incidentId);

      const webhookBundle = await store.incident(incidentId);
      if (!webhookBundle) throw new Error("webhook incident was not persisted");
      const merchantEvidence: IncidentBundle["evidence"][number] = {
        evidence_id: `merchant-order:${orderId}`,
        kind: "merchant_order_state",
        occurred_at: timestamp,
        received_at: timestamp,
        source: "merchant-order-store",
        payload: {
          payment_id: payment.id,
          order_id: orderId,
          order_state: "pending",
          amount_minor: providerOrder.amount,
          currency: providerOrder.currency,
          operation: "capture",
          idempotency_key: idempotencyKey,
        },
      };
      const fullBundle = verifyBundle(
        {
          ...webhookBundle,
          evidence: [...webhookBundle.evidence, merchantEvidence],
        },
        processorSecret,
      );
      await store.updateIncident(fullBundle);

      const diagnosisAdapter = {
        provider: "t024-live",
        model: "rule-based-live-test",
        diagnose: (
          bundle: IncidentBundle,
          reconstruction: Reconstruction,
          _reconciliation: ReconciliationResult,
        ) => {
          const evidenceIds = reconstruction.timeline.map(
            (entry) => entry.evidence_id,
          );
          return DiagnosisOutputSchema.parse({
            diagnosis: {
              hypotheses: [
                {
                  rank: 1,
                  summary:
                    "Razorpay captured the payment while the merchant order remained pending.",
                  reasoning:
                    "Fresh provider evidence and the signed webhook identify a captured payment for the pending merchant order.",
                  uncertainty:
                    "The merchant repair is limited to the approved pending-to-paid transition.",
                  confidence: 1,
                  evidence_ids: evidenceIds,
                },
              ],
              recommendation: {
                action: "reconcile_internal_state",
                reasoning:
                  "Apply the verified captured state to the merchant order.",
                uncertainty:
                  "Fresh post-repair state must confirm provider and merchant agreement.",
                evidence_ids: evidenceIds,
              },
            },
            provenance: {
              provider: "t024-live",
              requested_model: "rule-based-live-test",
              returned_model: "rule-based-live-test",
              request_id: `t024-${bundle.incident_id}`,
              strict_schema: true,
            },
          });
        },
      };
      const fixturePath = await fullBundlePath(temporaryDirectory, fullBundle);
      const result = await runIncident(fixturePath, incidentStatePath, {
        mode: "live",
        resetState: false,
        processorSecret,
        evidenceGatherer: new EvidenceGatherer({ client }),
        merchantPlatformAdapter: new SqliteMerchantPlatformAdapter(
          merchantConnection.db,
        ),
        diagnosisAdapter,
        tenantId: "t024-live",
      });

      expect(result.reconciliation.incident_class).toBe("paid_pending");
      expect(result.outcome.status).toBe("reconciled");
      expect(result.post_repair_state_verification?.status).toBe("verified");
      if (result.post_repair_state_verification?.status !== "verified")
        throw new Error("live post-repair state was not verified");
      expect(
        result.post_repair_state_verification.observation.invariant_holds,
      ).toBe(true);
      expect(result.payment_state.state).toBe("paid");
      await expect(
        new SqliteMerchantPlatformAdapter(
          merchantConnection.db,
        ).fetchOrderState(orderId),
      ).resolves.toMatchObject({ state: "paid", payment_id: payment.id });
      expect(result.audit_records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event_type: "post_repair_state_observed" }),
        ]),
      );
    } finally {
      await store.close();
      merchantConnection.client.close();
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 120_000);
});

function fullBundlePath(directory: string, bundle: IncidentBundle) {
  const file = path.join(directory, "incident.json");
  return fs.writeFile(file, JSON.stringify(bundle)).then(() => file);
}
