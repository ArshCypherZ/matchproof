import { z } from "zod";
import type { MerchantPlatformAdapter } from "../db/merchant-platform-adapter";
import type { IncidentRepository } from "../db/repository";
import {
  AfterstateObservationSchema,
  RazorpayPaymentSchema,
  type AfterstateObservation,
  type RazorpayPayment,
} from "../domain/schemas";
import { fetchTestModePaymentStatus, type RazorpayClient } from "./razorpay";

const VerificationContextSchema = z
  .object({
    executionKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/),
    paymentId: z.string().regex(/^pay_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/),
    orderId: z.string().regex(/^order_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/),
    amountMinor: z.number().int().safe().positive(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    providerStatus: z.enum(["captured", "authorized"]).optional(),
  })
  .strict();

export type AfterstateVerificationContext = z.infer<
  typeof VerificationContextSchema
>;

export interface ProviderAfterstateAdapter {
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
}

export class RazorpayProviderAfterstateAdapter implements ProviderAfterstateAdapter {
  constructor(private readonly client?: RazorpayClient) {}

  fetchPayment(paymentId: string) {
    return fetchTestModePaymentStatus(paymentId, this.client);
  }
}

type AfterstateRepository = Pick<
  IncidentRepository,
  "afterstateObservation" | "saveAfterstateObservation"
>;

export type AfterstateVerificationResult =
  | {
      status: "verified" | "escalated";
      observation: AfterstateObservation;
      reasons: string[];
      replayed: boolean;
    }
  | {
      status: "held";
      reasons: string[];
      replayed: false;
    };

function reasonsFor(
  context: AfterstateVerificationContext,
  provider: RazorpayPayment,
  merchant: Awaited<ReturnType<MerchantPlatformAdapter["fetchOrderState"]>>,
) {
  const reasons: string[] = [];
  if (provider.id !== context.paymentId)
    reasons.push("provider payment identity does not match");
  if (provider.order_id !== context.orderId)
    reasons.push("provider order identity does not match");
  // The verified afterstate is the provider state the deterministic repair
  // was based on: a repair justified by a late authorization verifies against
  // an authorized (or later captured) payment, every other repair against a
  // captured one.
  const expectedStatus = context.providerStatus ?? "captured";
  const statusAccepted =
    expectedStatus === "authorized"
      ? provider.status === "authorized" || provider.status === "captured"
      : provider.status === "captured";
  if (!statusAccepted)
    reasons.push(`provider payment is not ${expectedStatus}`);
  if (provider.captured !== (provider.status === "captured"))
    reasons.push("provider captured flag conflicts with the reported status");
  if (provider.amount !== context.amountMinor)
    reasons.push("provider amount does not match");
  if (provider.currency !== context.currency)
    reasons.push("provider currency does not match");
  if (!merchant) {
    reasons.push("merchant order does not exist");
    return reasons;
  }
  if (merchant.order_id !== context.orderId)
    reasons.push("merchant order identity does not match");
  if (merchant.payment_id !== context.paymentId)
    reasons.push("merchant payment identity does not match");
  if (merchant.state !== "paid") reasons.push("merchant order is not paid");
  if (
    merchant.amount_minor !== context.amountMinor ||
    merchant.amount_minor !== provider.amount
  )
    reasons.push("merchant amount does not match");
  if (
    merchant.currency !== context.currency ||
    merchant.currency !== provider.currency
  )
    reasons.push("merchant currency does not match");
  return reasons;
}

function resultFromObservation(
  observation: AfterstateObservation,
  replayed: boolean,
): AfterstateVerificationResult {
  return observation.invariant_holds
    ? { status: "verified", observation, reasons: [], replayed }
    : {
        status: "escalated",
        observation,
        reasons: ["afterstate invariant does not hold"],
        replayed,
      };
}

export class AfterstateVerifier {
  constructor(
    private readonly repository: AfterstateRepository,
    private readonly provider: ProviderAfterstateAdapter,
    private readonly merchant: MerchantPlatformAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verify(
    input: AfterstateVerificationContext,
  ): Promise<AfterstateVerificationResult> {
    const context = VerificationContextSchema.parse(input);
    const prior = await this.repository.afterstateObservation(
      context.executionKey,
    );
    if (prior) return resultFromObservation(prior, true);

    const [providerResult, merchantResult] = await Promise.allSettled([
      this.provider.fetchPayment(context.paymentId),
      this.merchant.fetchOrderState(context.orderId),
    ]);
    const readFailures: string[] = [];
    if (providerResult.status === "rejected")
      readFailures.push("provider afterstate read failed");
    if (merchantResult.status === "rejected")
      readFailures.push("merchant afterstate read failed");
    if (
      readFailures.length ||
      providerResult.status === "rejected" ||
      merchantResult.status === "rejected"
    )
      return { status: "held", reasons: readFailures, replayed: false };

    const provider = RazorpayPaymentSchema.parse(providerResult.value);
    const merchant = merchantResult.value;
    const reasons = reasonsFor(context, provider, merchant);
    const observation = AfterstateObservationSchema.parse({
      provider_object: { kind: "payment", object: provider },
      merchant_record: merchant
        ? {
            exists: true,
            payment_id: merchant.payment_id ?? undefined,
            order_id: merchant.order_id,
            state: merchant.state,
            amount_minor: merchant.amount_minor,
            currency: merchant.currency,
          }
        : { exists: false },
      invariant_holds: reasons.length === 0,
      observed_at: this.now().toISOString(),
    });
    await this.repository.saveAfterstateObservation(
      context.executionKey,
      observation,
    );
    return observation.invariant_holds
      ? { status: "verified", observation, reasons, replayed: false }
      : { status: "escalated", observation, reasons, replayed: false };
  }
}
