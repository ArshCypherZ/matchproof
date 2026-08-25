import Razorpay from "razorpay";
import {
  RazorpayOrderResponseSchema,
  RazorpayPaymentCollectionSchema,
  RazorpayPaymentResponseSchema,
  RazorpayWebhookBodyEnvelopeResponseSchema,
  type RazorpayOrder as ParsedRazorpayOrder,
  type RazorpayPayment as ParsedRazorpayPayment,
  type RazorpayPaymentCollection as ParsedRazorpayPaymentCollection,
} from "../domain/schemas";

export class RazorpayConfigurationError extends Error {}
export class RazorpayInputError extends Error {}
export class RazorpayWebhookVerificationError extends Error {}

export type RazorpayOrder = ParsedRazorpayOrder;
export type RazorpayPayment = ParsedRazorpayPayment;
export type RazorpayPaymentCollection = ParsedRazorpayPaymentCollection;

export type RazorpayClient = {
  orders: {
    create(input: Record<string, unknown>): Promise<unknown>;
    fetch(orderId: string): Promise<unknown>;
    fetchPayments(orderId: string): Promise<unknown>;
  };
  payments: {
    fetch(paymentId: string): Promise<unknown>;
    all(input?: Record<string, unknown>): Promise<{ items: unknown[] }>;
  };
};

export type TestModeOrderInput = {
  amount: number;
  currency: string;
  receipt?: string;
  notes?: Record<string, string | number>;
  partial_payment?: boolean;
  first_payment_min_amount?: number;
};

function clientOrDefault(client?: RazorpayClient) {
  return client ?? (createTestModeClient() as unknown as RazorpayClient);
}

function assertAmount(amount: number, field = "amount") {
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new RazorpayInputError(
      `${field} must be a positive integer in paise`,
    );
}

function assertCurrency(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new RazorpayInputError("currency must be a three-letter ISO code");
}

function assertId(id: string, prefix: "order" | "pay") {
  if (!new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`).test(id))
    throw new RazorpayInputError(`${prefix} id has an invalid format`);
}

export function createTestModeClient(env: NodeJS.ProcessEnv = process.env) {
  const keyId = env.RAZORPAY_API_KEY;
  const keySecret = env.RAZORPAY_API_SECRET;

  if (!keyId || !keySecret) {
    throw new RazorpayConfigurationError(
      "RAZORPAY_API_KEY and RAZORPAY_API_SECRET must be configured",
    );
  }
  if (!keyId.startsWith("rzp_test_")) {
    throw new RazorpayConfigurationError(
      "Razorpay Test Mode credentials are required",
    );
  }

  return new Razorpay({ key_id: keyId, key_secret: keySecret });
}

export async function verifyTestModeConnection(
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createTestModeClient(env) as unknown as RazorpayClient;
  const result = await client.payments.all({ count: 1 });

  return {
    mode: "test" as const,
    connected: true as const,
    paymentRecordsObserved: result.items.length,
  };
}

/** Create a regular Razorpay Test-mode order (amount is in paise). */
export async function createTestModeOrder(
  input: TestModeOrderInput,
  client?: RazorpayClient,
) {
  assertAmount(input.amount);
  assertCurrency(input.currency);
  if (input.first_payment_min_amount !== undefined)
    assertAmount(input.first_payment_min_amount, "first_payment_min_amount");
  if (input.partial_payment && input.first_payment_min_amount === undefined)
    throw new RazorpayInputError(
      "first_payment_min_amount is required for partial payments",
    );
  return await clientOrDefault(client).orders.create({ ...input });
}

/** Fetch an authoritative Test-mode order state. */
export async function fetchTestModeOrder(
  orderId: string,
  client?: RazorpayClient,
) {
  assertId(orderId, "order");
  return RazorpayOrderResponseSchema.parse(
    await clientOrDefault(client).orders.fetch(orderId),
  );
}

/** Fetch the fields used for deterministic order reconciliation. */
export async function fetchTestModeOrderStatus(
  orderId: string,
  client?: RazorpayClient,
) {
  const order = await fetchTestModeOrder(orderId, client);
  return {
    id: order.id,
    status: order.status,
    amount: order.amount,
    amount_paid: order.amount_paid,
    amount_due: order.amount_due,
    currency: order.currency,
    attempts: order.attempts,
  };
}

/** Fetch every payment currently associated with a Test-mode order. */
export async function fetchTestModeOrderPayments(
  orderId: string,
  client?: RazorpayClient,
) {
  assertId(orderId, "order");
  return RazorpayPaymentCollectionSchema.parse(
    await clientOrDefault(client).orders.fetchPayments(orderId),
  );
}

/** Fetch an authoritative Test-mode payment state. */
export async function fetchTestModePayment(
  paymentId: string,
  client?: RazorpayClient,
) {
  assertId(paymentId, "pay");
  return RazorpayPaymentResponseSchema.parse(
    await clientOrDefault(client).payments.fetch(paymentId),
  );
}

/** Fetch the fields used for deterministic payment/order reconciliation. */
export async function fetchTestModePaymentStatus(
  paymentId: string,
  client?: RazorpayClient,
) {
  const payment = await fetchTestModePayment(paymentId, client);
  return {
    id: payment.id,
    status: payment.status,
    captured: payment.captured,
    amount: payment.amount,
    currency: payment.currency,
    order_id: payment.order_id,
    amount_refunded: payment.amount_refunded,
    refund_status: payment.refund_status,
    error_code: payment.error_code,
    error_description: payment.error_description,
  };
}

/** Verify a Razorpay webhook using the raw request body and webhook secret. */
export function verifyRazorpayWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET,
) {
  if (!webhookSecret)
    throw new RazorpayConfigurationError(
      "RAZORPAY_WEBHOOK_SECRET must be configured",
    );
  if (typeof signature !== "string" || !signature) return false;
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  return Razorpay.validateWebhookSignature(body, signature, webhookSecret);
}

// Short alias for web frameworks and existing integrations.
export const verifyWebhookSignature = verifyRazorpayWebhookSignature;

/** Authenticate first, then parse a Razorpay webhook event. */
export function parseVerifiedRazorpayWebhook(
  rawBody: string | Buffer,
  signature: string,
  webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET,
) {
  if (!verifyRazorpayWebhookSignature(rawBody, signature, webhookSecret))
    throw new RazorpayWebhookVerificationError(
      "Razorpay webhook signature verification failed",
    );
  const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    throw new RazorpayWebhookVerificationError(
      "Razorpay webhook body is not valid JSON",
    );
  }
  if (
    !event ||
    typeof event !== "object" ||
    typeof (event as Record<string, unknown>).event !== "string" ||
    typeof (event as Record<string, unknown>).payload !== "object"
  )
    throw new RazorpayWebhookVerificationError(
      "Razorpay webhook event has an invalid shape",
    );
  return RazorpayWebhookBodyEnvelopeResponseSchema.parse(event);
}
