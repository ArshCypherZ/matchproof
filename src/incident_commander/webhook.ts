import http from "node:http";
import {
  parseVerifiedRazorpayWebhook,
  RazorpayWebhookVerificationError,
} from "./razorpay";
import { processorSignature } from "./signatures";
import type { WebhookProcessingResult } from "../db/repository";
import { reconstruct } from "./reconstruction";
import { VerifiedPaymentStateSchema } from "../domain/schemas";
import type { EvidenceGatherer } from "./evidence-gatherer";
import { metricsSnapshot, recordEvent } from "../observability";

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type RazorpayWebhookIngestInput = {
  rawBody: string | Buffer;
  signature: string;
  eventId: string;
  receivedAt?: string;
  webhookSecret?: string;
};

export type RazorpayWebhookIngestResult = {
  status: "accepted" | "duplicate";
  eventId: string;
  eventType: string;
  receivedAt: string;
};

export type IncidentJobDispatcher = {
  enqueueIncident: (eventId: string) => Promise<unknown>;
};

export class RazorpayWebhookConflictError extends Error {}

function assertEventId(eventId: string) {
  if (!EVENT_ID.test(eventId))
    throw new RazorpayWebhookVerificationError(
      "Razorpay event ID is missing or has an invalid format",
    );
}

function rawText(rawBody: string | Buffer) {
  return typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
}

export class RazorpayWebhookInbox {
  constructor(
    readonly store: import("./core").IncidentStore,
    private readonly options: {
      evidenceGatherer?: Pick<EvidenceGatherer, "gather">;
    } = {},
  ) {}

  async ingest(
    input: RazorpayWebhookIngestInput,
  ): Promise<RazorpayWebhookIngestResult> {
    assertEventId(input.eventId);
    const body = rawText(input.rawBody);
    const event = parseVerifiedRazorpayWebhook(
      body,
      input.signature,
      input.webhookSecret,
    );
    const eventType = String(event.event);
    const receivedAt = input.receivedAt ?? new Date().toISOString();
    const parsed = event.payload;
    const paymentEntity =
      "payment" in parsed ? parsed.payment.entity : undefined;
    const paymentId = paymentEntity?.id;
    recordEvent("webhook_received", {
      event_id: input.eventId,
      event_type: eventType,
      payment_id: paymentId,
    });
    try {
      return await this.store.ingestWebhook({
        eventId: input.eventId,
        eventType,
        signature: input.signature,
        body,
        receivedAt,
        ...(paymentId ? { paymentId } : {}),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("different evidence")
      )
        throw new RazorpayWebhookConflictError(error.message);
      throw error;
    }
  }

  async process(
    eventId: string,
    options: { webhookSecret?: string; processorSecret?: string } = {},
  ): Promise<WebhookProcessingResult | null> {
    assertEventId(eventId);
    const stored = await this.store.webhookEvent(eventId);
    if (!stored) throw new Error("webhook event must be ingested first");
    const event = parseVerifiedRazorpayWebhook(
      stored.body,
      stored.signature,
      options.webhookSecret,
    );
    const paymentEntity =
      "payment" in event.payload ? event.payload.payment.entity : undefined;
    const paymentId = paymentEntity?.id;
    if (!paymentEntity || !paymentId) return null;
    const processorSecret =
      options.processorSecret ??
      this.store.secret ??
      process.env.PROCESSOR_WEBHOOK_SECRET;
    if (!processorSecret)
      throw new Error("PROCESSOR_WEBHOOK_SECRET must be configured");
    const existing = await this.store.incidentByPaymentId(paymentId);
    const paymentState =
      event.event === "payment.authorized"
        ? "authorized"
        : event.event === "payment.captured"
          ? "captured"
          : event.event === "payment.failed"
            ? "failed"
            : event.event === "payment.refunded"
              ? "refunded"
              : undefined;
    if (
      !paymentState ||
      (!existing && !["authorized", "captured"].includes(paymentState))
    )
      return null;
    const financialReference = existing?.evidence.find(
      (entry) => "amount_minor" in entry.payload && "currency" in entry.payload,
    );
    let amountMinor = paymentEntity.amount;
    let currency = paymentEntity.currency;
    if (
      !amountMinor &&
      financialReference &&
      "amount_minor" in financialReference.payload
    )
      amountMinor = financialReference.payload.amount_minor;
    if (
      !currency &&
      financialReference &&
      "currency" in financialReference.payload
    )
      currency = financialReference.payload.currency;
    const operation =
      paymentState === "authorized"
        ? "authorize"
        : paymentState === "captured"
          ? "capture"
          : paymentState === "refunded"
            ? "refund"
            : "authorize";
    const idempotencyKey = existing?.idempotency_key ?? `webhook:${paymentId}`;
    if ((!amountMinor || !currency) && this.options.evidenceGatherer) {
      const gathered = await this.options.evidenceGatherer.gather({
        paymentId,
        idempotencyKey,
      });
      const fetched = gathered.find(
        (entry) =>
          entry.kind === "provider_payment_fetch" &&
          entry.payload.result === "success",
      );
      if (
        fetched?.kind === "provider_payment_fetch" &&
        fetched.payload.result === "success"
      ) {
        amountMinor = fetched.payload.amount_minor;
        currency = fetched.payload.currency;
      }
    }
    if (!amountMinor || !currency)
      throw new Error("webhook financial evidence is incomplete");
    const payload = {
      event_id: eventId,
      event_type: event.event as
        | "payment.authorized"
        | "payment.captured"
        | "payment.failed"
        | "payment.refunded",
      payment_id: paymentId,
      payment_state: paymentState as
        "authorized" | "captured" | "failed" | "refunded",
      amount_minor: amountMinor,
      currency,
      idempotency_key: idempotencyKey,
      signature_verified: true as const,
      operation: operation as "authorize" | "capture" | "refund",
    };
    const occurredAt = event.created_at ?? paymentEntity.created_at;
    const evidence = {
      evidence_id: `webhook:${eventId}`,
      kind: "processor_webhook" as const,
      occurred_at: occurredAt
        ? new Date(occurredAt * 1000).toISOString()
        : stored.received_at,
      received_at: stored.received_at,
      source: "processor-webhook" as const,
      processor_signature: processorSignature(payload, processorSecret),
      payload,
    };
    const result = await this.store.processWebhookEvidence({
      eventId,
      paymentId,
      evidence,
      createIncident: {
        incidentId: `inc_webhook_${paymentId}`,
        idempotencyKey,
      },
    });
    await this.store.audit(`webhook_incident_${result.status}`, {
      event_id: eventId,
      incident_id: result.incidentId,
      late_evidence: result.lateEvidence,
    });
    recordEvent("evidence_ingested", {
      event_id: eventId,
      incident_id: result.incidentId,
      status: result.status,
    });
    if (!result.reverifyRequired) return result;
    const bundle = await this.store.incident(result.incidentId);
    const payment = await this.store.payment(paymentId);
    if (!bundle || !payment)
      throw new Error("late webhook afterstate could not be loaded");
    const reconstruction = reconstruct(bundle);
    const closureInvariant =
      VerifiedPaymentStateSchema.safeParse(reconstruction.current_state)
        .success && payment.state === reconstruction.current_state;
    await this.store.setProgress(
      result.incidentId,
      "verify",
      closureInvariant ? "reverified" : "reverification_required",
      {
        event_id: eventId,
        provider_state: reconstruction.current_state,
        controller_state: payment.state,
        closure_invariant: closureInvariant,
      },
    );
    await this.store.audit("webhook_late_evidence_reverified", {
      event_id: eventId,
      incident_id: result.incidentId,
      closure_invariant: closureInvariant,
    });
    return { ...result, closureInvariant };
  }

  get(eventId: string) {
    assertEventId(eventId);
    return this.store.webhookEvent(eventId);
  }
}

export function createRazorpayWebhookServer(
  inbox: RazorpayWebhookInbox,
  options: {
    webhookSecret?: string;
    processorSecret?: string;
    maxBodyBytes?: number;
    dispatcher?: IncidentJobDispatcher;
  } = {},
) {
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  return http.createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ status: "ok", service: "razorpay-webhook-server" }),
      );
      return;
    }
    if (request.method === "GET" && request.url === "/metrics") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(metricsSnapshot()));
      return;
    }
    if (request.method !== "POST" || request.url !== "/webhooks/razorpay") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size <= maxBodyBytes) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > maxBodyBytes) {
        response.writeHead(413, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "payload_too_large" }));
        return;
      }
      try {
        const input = {
          rawBody: Buffer.concat(chunks),
          signature: String(request.headers["x-razorpay-signature"] ?? ""),
          eventId: String(request.headers["x-razorpay-event-id"] ?? ""),
          ...(options.webhookSecret
            ? { webhookSecret: options.webhookSecret }
            : {}),
        };
        void inbox
          .ingest(input)
          .then(async (result) => {
            if (options.dispatcher) {
              await options.dispatcher.enqueueIncident(result.eventId);
              response.writeHead(202, { "content-type": "application/json" });
              response.end(
                JSON.stringify({ ...result, pipeline: { status: "queued" } }),
              );
              return;
            }
            let pipeline:
              | WebhookProcessingResult
              | { status: "stored_unmatched" | "pending"; reason?: string };
            try {
              pipeline = (await inbox.process(result.eventId, {
                ...(options.webhookSecret
                  ? { webhookSecret: options.webhookSecret }
                  : {}),
                ...(options.processorSecret
                  ? { processorSecret: options.processorSecret }
                  : {}),
              })) ?? { status: "stored_unmatched" };
            } catch (error) {
              const reason =
                error instanceof Error
                  ? error.message
                  : "webhook processing failed";
              await inbox.store
                .audit("webhook_processing_failed", {
                  event_id: result.eventId,
                  reason,
                })
                .catch(() => undefined);
              pipeline = { status: "pending", reason };
            }
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ ...result, pipeline }));
          })
          .catch((error) => {
            const status =
              error instanceof RazorpayWebhookConflictError ? 409 : 400;
            response.writeHead(status, { "content-type": "application/json" });
            response.end(
              JSON.stringify({
                error:
                  error instanceof Error ? error.message : "webhook_rejected",
              }),
            );
          });
      } catch (error) {
        const status =
          error instanceof RazorpayWebhookConflictError ? 409 : 400;
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "webhook_rejected",
          }),
        );
      }
    });
  });
}
