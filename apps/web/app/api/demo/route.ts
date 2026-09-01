import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { requestContext, withStore } from "../../../lib/incidents";
import { enforceRateLimit } from "../../../lib/rate-limit";
import { sharedDatabase } from "../../../../../src/db/client";
import {
  merchantOrders,
  merchantOrderUpdates,
} from "../../../../../src/db/schema";
import { PostgresMerchantPlatformAdapter } from "../../../../../src/db/postgres-merchant-platform-adapter";
import { EvidenceGatherer } from "../../../../../src/incident_commander/evidence-gatherer";
import { PlaybookDiagnosisAdapter } from "../../../../../src/incident_commander/playbooks";
import {
  RazorpayConfigurationError,
  RazorpayInputError,
  createTestModeClient,
  createTestModeOrder,
  fetchTestModeOrder,
  fetchTestModeOrderPayments,
  fetchTestModePayment,
  type RazorpayClient,
} from "../../../../../src/incident_commander/razorpay";
import { RazorpayProviderPostRepairStateAdapter } from "../../../../../src/incident_commander/post-repair-state-verifier";
import {
  demoMerchantEvidence,
  demoWebhookBody,
  publicOrderPayload,
  stageDemoIncident,
} from "../../../../../src/incident_commander/demo-flow";
import { runIncident } from "../../../../../src/incident_commander/workflow";

export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_order"),
    amount_minor: z.coerce.number().int().min(1),
    currency: z.string().trim().toUpperCase().length(3).default("INR"),
  }),
  z.object({
    action: z.literal("await_payment"),
    order_id: z.string().min(3),
    payment_id: z.string().min(3).optional(),
  }),
  z.object({
    action: z.literal("stage_discrepancy"),
    order_id: z.string().min(3),
  }),
  z.object({
    action: z.literal("run"),
    order_id: z.string().min(3),
  }),
]);

function client() {
  return createTestModeClient() as unknown as RazorpayClient;
}

/* The Razorpay SDK does not throw Error instances: every API failure
   surfaces as a thrown plain object `{ statusCode, error: { description } }`
   (a 404 carries no error object at all), and a network-level failure never
   reaches the API, so the SDK's own error normalizer throws a TypeError
   while reading the response status. Classify each shape into a response the
   stepper can quote: input mistakes the operator made read as 400s carrying
   the provider's message, provider-side failures read as 503s, and no
   failure leaves this route with an empty 500. */
function providerFailure(error: unknown) {
  if (error instanceof RazorpayConfigurationError)
    return Response.json(
      { error: "razorpay_not_configured", reason: error.message },
      { status: 503 },
    );
  if (error instanceof RazorpayInputError)
    return Response.json(
      { error: "invalid_input", reason: error.message },
      { status: 400 },
    );
  if (error instanceof z.ZodError)
    return Response.json(
      {
        error: "provider_unavailable",
        reason:
          "Razorpay answered with a record this system could not read. The step did not complete. Try again.",
      },
      { status: 503 },
    );
  if (error instanceof TypeError && error.message.includes("reading 'status'"))
    return Response.json(
      {
        error: "provider_unavailable",
        reason:
          "Razorpay could not be reached. The step did not complete. Try again.",
      },
      { status: 503 },
    );
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { statusCode?: unknown }).statusCode === "number"
  ) {
    const provider = error as {
      statusCode: number;
      error?: { description?: unknown };
    };
    const description =
      typeof provider.error?.description === "string"
        ? provider.error.description
        : null;
    if (provider.statusCode >= 400 && provider.statusCode < 500)
      return Response.json(
        {
          error: "provider_rejected_request",
          reason:
            description ??
            (provider.statusCode === 404
              ? "Razorpay has no Test-mode record with that id."
              : `Razorpay rejected the request (HTTP ${provider.statusCode}).`),
        },
        { status: 400 },
      );
    return Response.json(
      {
        error: "provider_unavailable",
        reason: `Razorpay answered HTTP ${provider.statusCode}. The step did not complete. Try again.`,
      },
      { status: 503 },
    );
  }
  // Anything left is a server-side failure this route cannot name; it still
  // answers with a body, and the cause stays in the server log.
  console.error("demo route step failed:", error);
  return Response.json(
    {
      error: "demo_step_failed",
      reason:
        "The server hit an error and the step did not complete. Check the exception record before trying again.",
    },
    { status: 500 },
  );
}

/** Find the staged incident for a demo order inside the tenant store. */
async function incidentForOrder(tenantId: string, orderId: string) {
  return withStore(tenantId, async (store) => {
    const bundles = await store.listIncidents(tenantId);
    const matches = bundles.filter((bundle) =>
      bundle.evidence.some(
        (entry) =>
          entry.kind === "merchant_order_state" &&
          entry.payload.order_id === orderId,
      ),
    );
    return matches.at(-1) ?? null;
  });
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "demo", {
    limit: 20,
    windowSeconds: 60,
  });
  if (limited) return limited;
  const { tenantId } = requestContext(request);
  const body = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success)
    return Response.json(
      {
        error: "invalid_body",
        reason: "Send a JSON body matching the step this action needs.",
      },
      { status: 400 },
    );

  if (body.data.action === "create_order") {
    try {
      const order = (await createTestModeOrder(
        {
          amount: body.data.amount_minor,
          currency: body.data.currency,
          receipt: `demo-${Date.now()}`,
          notes: { source: "Razorpay Test mode", flow: "controller demo" },
        },
        client(),
      )) as { id: string };
      return Response.json({
        ...publicOrderPayload(order, process.env.RAZORPAY_API_KEY ?? ""),
        amount_minor: body.data.amount_minor,
        currency: body.data.currency,
      });
    } catch (error) {
      return providerFailure(error);
    }
  }

  if (body.data.action === "await_payment") {
    try {
      if (body.data.payment_id) {
        const payment = await fetchTestModePayment(
          body.data.payment_id,
          client(),
        );
        return Response.json({
          captured: payment.status === "captured" && payment.captured,
          payment_id: payment.id,
          payment_status: payment.status,
        });
      }
      // The order-payments collection lists ids only; each candidate is
      // fetched so capture truth comes from the authoritative payment record.
      const payments = await fetchTestModeOrderPayments(
        body.data.order_id,
        client(),
      );
      const records = await Promise.all(
        payments.items.map((item) => fetchTestModePayment(item.id, client())),
      );
      const captured = records.find(
        (payment) => payment.status === "captured" && payment.captured,
      );
      return Response.json({
        captured: Boolean(captured),
        payment_id: captured?.id ?? null,
        payment_status: captured?.status ?? records.at(-1)?.status ?? null,
      });
    } catch (error) {
      return providerFailure(error);
    }
  }

  if (body.data.action === "stage_discrepancy") {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const processorSecret =
      process.env.PROCESSOR_WEBHOOK_SECRET || "test-prototype-secret";
    if (!webhookSecret)
      return Response.json(
        {
          error: "razorpay_not_configured",
          reason: "RAZORPAY_WEBHOOK_SECRET must be configured",
        },
        { status: 503 },
      );
    try {
      const razorpay = client();
      const providerOrder = await fetchTestModeOrder(
        body.data.order_id,
        razorpay,
      );
      const payments = await fetchTestModeOrderPayments(
        body.data.order_id,
        razorpay,
      );
      const paymentRecords = await Promise.all(
        payments.items.map((item) => fetchTestModePayment(item.id, razorpay)),
      );
      const capturedId = paymentRecords.find(
        (payment) => payment.status === "captured" && payment.captured,
      )?.id;
      if (!capturedId)
        return Response.json(
          {
            error: "payment_not_captured",
            reason: "complete a Test-mode payment for this order first",
          },
          { status: 409 },
        );
      const payment = await fetchTestModePayment(capturedId, razorpay);
      const connection = sharedDatabase();
      const receivedAt = new Date().toISOString();
      // The merchant order is deliberately recorded pending: that gap is the
      // incident the controller is asked to resolve.
      await connection.db
        .insert(merchantOrders)
        .values({
          orderId: providerOrder.id,
          paymentId: payment.id,
          state: "pending",
          amountMinor: providerOrder.amount,
          currency: providerOrder.currency,
          createdAt: new Date(receivedAt),
          updatedAt: new Date(receivedAt),
        })
        .onConflictDoUpdate({
          target: merchantOrders.orderId,
          set: {
            paymentId: payment.id,
            state: "pending",
            amountMinor: providerOrder.amount,
            currency: providerOrder.currency,
            updatedAt: new Date(receivedAt),
          },
        });
      const staged = await withStore(tenantId, async (store) => {
        const result = await stageDemoIncident(store, {
          webhookBody: demoWebhookBody(payment),
          webhookSecret,
          processorSecret,
          eventId: `evt_demo_${payment.id}_${Date.now()}`,
          merchantEvidence: demoMerchantEvidence({
            orderId: providerOrder.id,
            payment,
            providerOrder,
            receivedAt,
            idempotencyKey: `webhook:${payment.id}`,
          }),
          // A re-staged rehearsal re-executes the repair, so the merchant
          // platform's idempotent acknowledgements for the prior run must go.
          clearMerchantUpdateAcknowledgements: async (executionKeys) => {
            await connection.db
              .delete(merchantOrderUpdates)
              .where(
                inArray(merchantOrderUpdates.idempotencyKey, executionKeys),
              );
          },
        });
        await store.audit("demo_staged", {
          tenant_id: tenantId,
          order_id: providerOrder.id,
          payment_id: payment.id,
          incident_id: result.incidentId,
        });
        return result;
      });
      return Response.json({
        incident_id: staged.incidentId,
        payment_id: staged.paymentId,
        order_id: providerOrder.id,
      });
    } catch (error) {
      return providerFailure(error);
    }
  }

  // action === "run"
  try {
    const bundle = await incidentForOrder(tenantId, body.data.order_id);
    if (!bundle)
      return Response.json(
        {
          error: "not_staged",
          reason: "stage the discrepancy for this order first",
        },
        { status: 409 },
      );
    const fixture = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "demo-run-")),
      "incident.json",
    );
    await fs.writeFile(fixture, JSON.stringify(bundle));
    const connection = sharedDatabase();
    const razorpay = client();
    try {
      const result = await runIncident(
        fixture,
        process.env.INCIDENT_STATE_PATH || "postgresql",
        {
          mode: "live",
          resetState: false,
          processorSecret:
            process.env.PROCESSOR_WEBHOOK_SECRET || "test-prototype-secret",
          evidenceGatherer: new EvidenceGatherer({ client: razorpay }),
          merchantPlatformAdapter: new PostgresMerchantPlatformAdapter(
            connection.db,
          ),
          providerPostRepairStateAdapter:
            new RazorpayProviderPostRepairStateAdapter(razorpay),
          diagnosisAdapter: new PlaybookDiagnosisAdapter(),
          tenantId,
        },
      );
      const orderState = await new PostgresMerchantPlatformAdapter(
        connection.db,
      ).fetchOrderState(body.data.order_id);
      return Response.json({
        incident_id: bundle.incident_id,
        incident_class: result.reconciliation.incident_class,
        outcome: result.outcome.status,
        post_repair_state_verification:
          result.post_repair_state_verification?.status ?? "not_required",
        payment_state: result.payment_state.state,
        order_state: orderState?.state ?? null,
        gate_decisions: result.gate_decisions,
      });
    } finally {
      await fs.rm(path.dirname(fixture), { recursive: true, force: true });
    }
  } catch (error) {
    return providerFailure(error);
  }
}
