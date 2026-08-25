import {
  fetchTestModeOrderStatus,
  fetchTestModePaymentStatus,
  RazorpayConfigurationError,
  RazorpayInputError,
  type RazorpayClient,
} from "./razorpay";
import {
  ProviderOrderFetchEvidenceSchema,
  ProviderPaymentFetchEvidenceSchema,
  type Evidence,
} from "../domain/schemas";

export type EvidenceGatherRequest = {
  paymentId?: string;
  orderId?: string;
  idempotencyKey: string;
};

export type EvidenceGathererOptions = {
  client?: RazorpayClient;
  timeoutMs?: number;
  now?: () => Date;
};

const DEFAULT_TIMEOUT_MS = 5_000;

function errorDetails(error: unknown, timedOut: boolean, timeoutMs: number) {
  if (timedOut)
    return {
      result: "error" as const,
      error_code: "provider_timeout",
      error_message: `provider read exceeded the ${timeoutMs}ms timeout`,
      timeout: true,
    };
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return {
    result: "error" as const,
    error_code:
      lower.includes("rate") || lower.includes("429")
        ? "provider_rate_limited"
        : "provider_error",
    error_message: message || "provider read failed",
    timeout: false,
  };
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number) {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new EvidenceGatherTimeout()),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

class EvidenceGatherTimeout extends Error {
  constructor() {
    super("provider read timed out");
  }
}

export class EvidenceGatherer {
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: EvidenceGathererOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1)
      throw new RangeError("timeoutMs must be a positive integer");
    this.now = options.now ?? (() => new Date());
  }

  async gather(request: EvidenceGatherRequest): Promise<Evidence[]> {
    if (!request.paymentId && !request.orderId)
      throw new Error("paymentId or orderId is required for provider evidence");

    const evidence: Evidence[] = [];
    let paymentOrderId = request.orderId;
    if (request.paymentId) {
      const paymentEvidence = await this.gatherPayment(
        request.paymentId,
        request.idempotencyKey,
      );
      evidence.push(paymentEvidence);
      if (
        !paymentOrderId &&
        paymentEvidence.kind === "provider_payment_fetch" &&
        "result" in paymentEvidence.payload &&
        paymentEvidence.payload.result === "success"
      )
        paymentOrderId = paymentEvidence.payload.order_id ?? undefined;
    }
    if (paymentOrderId)
      evidence.push(
        await this.gatherOrder(paymentOrderId, request.idempotencyKey),
      );
    return evidence;
  }

  private async gatherPayment(
    paymentId: string,
    idempotencyKey: string,
  ): Promise<Evidence> {
    const occurredAt = this.now().toISOString();
    try {
      const payment = await bounded(
        fetchTestModePaymentStatus(paymentId, this.options.client),
        this.timeoutMs,
      );
      const receivedAt = this.now().toISOString();
      return ProviderPaymentFetchEvidenceSchema.parse({
        evidence_id: `provider-payment-fetch:${paymentId}`,
        kind: "provider_payment_fetch",
        source: "processor-api",
        occurred_at: occurredAt,
        received_at: receivedAt,
        payload: {
          result: "success",
          payment_id: payment.id,
          status: payment.status,
          captured: payment.captured,
          amount_minor: payment.amount,
          currency: payment.currency,
          order_id: payment.order_id,
          amount_refunded: payment.amount_refunded,
          refund_status: payment.refund_status,
          error_code: payment.error_code,
          error_description: payment.error_description,
          fetched_at: receivedAt,
          freshness_ms: Math.max(
            0,
            Date.parse(receivedAt) - Date.parse(occurredAt),
          ),
          operation: "read",
          idempotency_key: idempotencyKey,
        },
      });
    } catch (error) {
      if (
        error instanceof RazorpayConfigurationError ||
        error instanceof RazorpayInputError
      )
        throw error;
      const receivedAt = this.now().toISOString();
      const details = errorDetails(
        error,
        error instanceof EvidenceGatherTimeout,
        this.timeoutMs,
      );
      return ProviderPaymentFetchEvidenceSchema.parse({
        evidence_id: `provider-payment-fetch:${paymentId}`,
        kind: "provider_payment_fetch",
        source: "processor-api",
        occurred_at: occurredAt,
        received_at: receivedAt,
        payload: {
          payment_id: paymentId,
          ...details,
          operation: "read",
          idempotency_key: idempotencyKey,
        },
      });
    }
  }

  private async gatherOrder(
    orderId: string,
    idempotencyKey: string,
  ): Promise<Evidence> {
    const occurredAt = this.now().toISOString();
    try {
      const order = await bounded(
        fetchTestModeOrderStatus(orderId, this.options.client),
        this.timeoutMs,
      );
      const receivedAt = this.now().toISOString();
      return ProviderOrderFetchEvidenceSchema.parse({
        evidence_id: `provider-order-fetch:${orderId}`,
        kind: "provider_order_fetch",
        source: "processor-api",
        occurred_at: occurredAt,
        received_at: receivedAt,
        payload: {
          result: "success",
          order_id: order.id,
          status: order.status,
          amount_minor: order.amount,
          amount_paid: order.amount_paid,
          amount_due: order.amount_due,
          currency: order.currency,
          attempts: order.attempts,
          fetched_at: receivedAt,
          freshness_ms: Math.max(
            0,
            Date.parse(receivedAt) - Date.parse(occurredAt),
          ),
          operation: "read",
          idempotency_key: idempotencyKey,
        },
      });
    } catch (error) {
      if (
        error instanceof RazorpayConfigurationError ||
        error instanceof RazorpayInputError
      )
        throw error;
      const receivedAt = this.now().toISOString();
      const details = errorDetails(
        error,
        error instanceof EvidenceGatherTimeout,
        this.timeoutMs,
      );
      return ProviderOrderFetchEvidenceSchema.parse({
        evidence_id: `provider-order-fetch:${orderId}`,
        kind: "provider_order_fetch",
        source: "processor-api",
        occurred_at: occurredAt,
        received_at: receivedAt,
        payload: {
          order_id: orderId,
          ...details,
          operation: "read",
          idempotency_key: idempotencyKey,
        },
      });
    }
  }
}

export async function gatherProviderEvidence(
  request: EvidenceGatherRequest,
  options?: EvidenceGathererOptions,
) {
  return new EvidenceGatherer(options).gather(request);
}
