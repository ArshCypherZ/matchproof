import http from "node:http";
import {
  parseVerifiedRazorpayWebhook,
  RazorpayWebhookVerificationError,
} from "./razorpay";

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
  constructor(readonly store: import("./core").IncidentStore) {}

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
    const parsed = event as {
      payload?: { payment?: { entity?: { id?: string } } };
    };
    const paymentId = parsed.payload?.payment?.entity?.id;
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

  get(eventId: string) {
    assertEventId(eventId);
    return this.store.webhookEvent(eventId);
  }
}

export function createRazorpayWebhookServer(
  inbox: RazorpayWebhookInbox,
  options: { webhookSecret?: string; maxBodyBytes?: number } = {},
) {
  const maxBodyBytes = options.maxBodyBytes ?? 1_000_000;
  return http.createServer((request, response) => {
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
          .then((result) => {
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify(result));
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
