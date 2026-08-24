import http from "node:http";
import fs from "node:fs";
import path from "node:path";
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
  private readonly events = new Map<string, Record<string, string>>();
  constructor(readonly file = ".runtime/razorpay-webhooks.json") {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) for (const event of JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>[]) { const eventId = event.event_id; if (eventId) this.events.set(eventId, event); }
  }

  ingest(input: RazorpayWebhookIngestInput): RazorpayWebhookIngestResult {
    assertEventId(input.eventId);
    const body = rawText(input.rawBody);
    const event = parseVerifiedRazorpayWebhook(body, input.signature, input.webhookSecret);
    const eventType = String(event.event);
    const receivedAt = input.receivedAt ?? new Date().toISOString();
    const existing = this.events.get(input.eventId);
    if (existing) {
      if (existing.body !== body || existing.signature !== input.signature)
        throw new RazorpayWebhookConflictError(
          "Razorpay event ID was already stored with different evidence",
        );
      return {
        status: "duplicate",
        eventId: input.eventId,
        eventType: existing["event_type"] ?? "",
        receivedAt: existing["received_at"] ?? "",
      };
    }
    this.events.set(input.eventId, { event_id: input.eventId, event_type: eventType, signature: input.signature, body, received_at: receivedAt, accepted_at: new Date().toISOString() });
    fs.writeFileSync(this.file, JSON.stringify([...this.events.values()]));
    return {
      status: "accepted",
      eventId: input.eventId,
      eventType,
      receivedAt,
    };
  }

  get(eventId: string) {
    assertEventId(eventId);
    return this.events.get(eventId);
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
        const result = inbox.ingest(input);
        response.writeHead(result.status === "accepted" ? 200 : 200, {
          "content-type": "application/json",
        });
        response.end(JSON.stringify(result));
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
