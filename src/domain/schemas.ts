import { z } from "zod";

const identifier = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`));
const idempotencyKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const amountPaise = z.number().int().safe().positive();
const nonNegativePaise = z.number().int().safe().nonnegative();
const currency = z.string().regex(/^[A-Z]{3}$/);
const timestamp = z.string().datetime({ offset: true });

export const PaymentOperationSchema = z.enum([
  "authorize",
  "capture",
  "refund",
  "payout",
  "fulfil",
  "read",
]);
export type PaymentOperation = z.infer<typeof PaymentOperationSchema>;

export const PaymentStateSchema = z.enum([
  "unknown",
  "created",
  "pending",
  "authorized",
  "capture_pending",
  "captured",
  "captured_verified",
  "authorized_verified",
  "failed_verified",
  "failed",
  "refunded",
  "refunded_verified",
  "paid",
  "paid_verified",
  "paid_pending",
]);
export type PaymentState = z.infer<typeof PaymentStateSchema>;

export const IncidentClassSchema = z.enum([
  "paid_pending",
  "paid_missing",
  "one_payment_two_orders",
  "callback_missing_webhook_recovers",
  "webhook_delivery_failure",
  "late_authorized",
  "capture_timeout",
  "settlement_exception",
]);
export type IncidentClass = z.infer<typeof IncidentClassSchema>;

export const VerifiedPaymentStateSchema = z.enum([
  "authorized_verified",
  "captured_verified",
  "failed_verified",
  "refunded_verified",
  "paid_verified",
]);
export type VerifiedPaymentState = z.infer<typeof VerifiedPaymentStateSchema>;

export const PaymentStatusSchema = z.enum([
  "created",
  "authorized",
  "captured",
  "refunded",
  "failed",
]);
export const OrderStatusSchema = z.enum(["created", "attempted", "paid"]);

const nullableString = z.string().nullable().optional();
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const notes = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

export const RazorpayPaymentSchema = z
  .object({
    entity: z.literal("payment").optional(),
    id: identifier("pay"),
    status: PaymentStatusSchema,
    captured: z.boolean(),
    amount: amountPaise,
    currency,
    order_id: z.string().nullable(),
    invoice_id: nullableString,
    international: z.boolean().optional(),
    method: z.string().optional(),
    amount_refunded: nonNegativePaise,
    refund_status: z.string().nullable(),
    description: nullableString,
    card_id: nullableString,
    bank: nullableString,
    wallet: nullableString,
    vpa: nullableString,
    email: nullableString,
    contact: nullableString,
    notes: notes.optional(),
    fee: nonNegativePaise.optional(),
    tax: nonNegativePaise.optional(),
    error_code: z.string().nullable(),
    error_description: z.string().nullable(),
    error_source: nullableString,
    error_step: nullableString,
    error_reason: nullableString,
    acquirer_data: z.record(z.string(), jsonValue).optional(),
    created_at: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Provider responses may contain additional fields; normalize them to the internal shape. */
export const RazorpayPaymentResponseSchema = RazorpayPaymentSchema.strip();

export const RazorpayOrderSchema = z
  .object({
    entity: z.literal("order").optional(),
    id: identifier("order"),
    status: OrderStatusSchema,
    amount: amountPaise,
    amount_paid: nonNegativePaise,
    amount_due: nonNegativePaise,
    currency,
    attempts: z.number().int().nonnegative(),
    receipt: nullableString,
    offer_id: nullableString,
    notes: notes.optional(),
    created_at: z.number().int().nonnegative().optional(),
  })
  .strict();
export const RazorpayOrderResponseSchema = RazorpayOrderSchema.strip();

export const RazorpayOrderPaymentSchema = z
  .object({ id: identifier("pay"), order_id: identifier("order") })
  .strict();
export const RazorpayPaymentCollectionSchema = z
  .object({
    count: z.number().int().nonnegative(),
    items: z.array(RazorpayOrderPaymentSchema),
  })
  .strict();

export const RazorpayWebhookEventTypeSchema = z.enum([
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment.refunded",
  "order.paid",
  "refund.created",
  "refund.processed",
  "refund.failed",
]);
export type RazorpayWebhookEventType = z.infer<
  typeof RazorpayWebhookEventTypeSchema
>;

const paymentWebhookPayload = z
  .object({
    payment: z
      .object({ entity: z.object({ id: identifier("pay") }).strict() })
      .strict(),
  })
  .strict();
const orderWebhookPayload = z
  .object({
    order: z
      .object({ entity: z.object({ id: identifier("order") }).strict() })
      .strict(),
  })
  .strict();
export const RazorpayWebhookBodyEnvelopeSchema = z
  .object({
    event: RazorpayWebhookEventTypeSchema,
    payload: z.union([paymentWebhookPayload, orderWebhookPayload]),
  })
  .strict();
const razorpayWebhookPaymentEntityResponse = z
  .object({
    id: identifier("pay"),
    status: PaymentStatusSchema.optional(),
    captured: z.boolean().optional(),
    amount: amountPaise.optional(),
    currency: currency.optional(),
    order_id: identifier("order").nullable().optional(),
    created_at: z.number().int().nonnegative().optional(),
  })
  .strip();
const razorpayWebhookOrderEntityResponse = z
  .object({
    id: identifier("order"),
    status: OrderStatusSchema.optional(),
    amount: amountPaise.optional(),
    amount_paid: nonNegativePaise.optional(),
    amount_due: nonNegativePaise.optional(),
    currency: currency.optional(),
    attempts: z.number().int().nonnegative().optional(),
    created_at: z.number().int().nonnegative().optional(),
  })
  .strip();
export const RazorpayWebhookBodyEnvelopeResponseSchema = z
  .object({
    event: RazorpayWebhookEventTypeSchema,
    created_at: z.number().int().nonnegative().optional(),
    payload: z.union([
      z
        .object({
          payment: z
            .object({ entity: razorpayWebhookPaymentEntityResponse })
            .strip(),
        })
        .strip(),
      z
        .object({
          order: z
            .object({ entity: razorpayWebhookOrderEntityResponse })
            .strip(),
        })
        .strip(),
    ]),
  })
  .strip();
export const RazorpayWebhookEventSchema =
  RazorpayWebhookBodyEnvelopeSchema.extend({
    event_id: identifier("evt"),
  }).strict();

export const EvidenceSourceSchema = z.enum([
  "merchant-payment-service",
  "merchant-order-store",
  "merchant-fulfilment-service",
  "processor-webhook",
  "processor-api",
  "controller-log",
]);
export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;
export const EvidenceSource = {
  paymentService: "merchant-payment-service",
  orderStore: "merchant-order-store",
  fulfilmentService: "merchant-fulfilment-service",
  processorWebhook: "processor-webhook",
  processorApi: "processor-api",
  controllerLog: "controller-log",
} as const satisfies Record<string, EvidenceSource>;

const evidenceBase = {
  evidence_id: z.string().min(1),
  occurred_at: timestamp,
  received_at: timestamp,
};
const paymentIdentity = z
  .object({
    payment_id: identifier("pay"),
    operation: PaymentOperationSchema,
    amount_minor: amountPaise,
    currency,
    idempotency_key: idempotencyKey,
  })
  .strict();

export const PaymentRequestEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("payment_request"),
    source: z.enum([EvidenceSource.paymentService, EvidenceSource.orderStore]),
    payload: paymentIdentity,
  })
  .strict();
export const ProcessorTimeoutEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("processor_timeout"),
    source: z.enum([
      EvidenceSource.paymentService,
      EvidenceSource.controllerLog,
    ]),
    payload: z
      .object({
        payment_id: identifier("pay"),
        operation: PaymentOperationSchema,
        timeout_ms: z.number().int().positive(),
        idempotency_key: idempotencyKey,
      })
      .strict(),
  })
  .strict();
export const InternalStateEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("internal_state"),
    source: z.enum([
      EvidenceSource.paymentService,
      EvidenceSource.orderStore,
      EvidenceSource.fulfilmentService,
    ]),
    payload: z
      .object({
        payment_id: identifier("pay"),
        payment_state: PaymentStateSchema,
        amount_minor: amountPaise,
        currency,
        operation: PaymentOperationSchema,
        last_operation_key: idempotencyKey,
      })
      .strict(),
  })
  .strict();
export const ProcessorWebhookEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("processor_webhook"),
    source: z.literal(EvidenceSource.processorWebhook),
    processor_signature: z.string().min(1),
    payload: z
      .object({
        event_id: identifier("evt"),
        event_type: RazorpayWebhookEventTypeSchema,
        payment_id: identifier("pay"),
        payment_state: PaymentStateSchema,
        amount_minor: amountPaise,
        currency,
        idempotency_key: idempotencyKey,
        signature_verified: z.literal(true),
        operation: PaymentOperationSchema,
      })
      .strict(),
  })
  .strict();

export const MerchantOrderStateEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("merchant_order_state"),
    source: z.enum([
      EvidenceSource.orderStore,
      EvidenceSource.fulfilmentService,
    ]),
    payload: z
      .object({
        payment_id: identifier("pay"),
        order_id: identifier("order"),
        order_state: z.enum(["pending", "paid", "fulfilled", "missing"]),
        amount_minor: amountPaise,
        currency,
        operation: PaymentOperationSchema,
        idempotency_key: idempotencyKey,
      })
      .strict(),
  })
  .strict();

export const CallbackObservationEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("callback_observation"),
    source: z.enum([
      EvidenceSource.paymentService,
      EvidenceSource.controllerLog,
    ]),
    payload: z
      .object({
        payment_id: identifier("pay"),
        callback_status: z.enum(["missing", "received"]),
        operation: PaymentOperationSchema,
        idempotency_key: idempotencyKey,
      })
      .strict(),
  })
  .strict();

export const WebhookDeliveryEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("webhook_delivery"),
    source: z.enum([
      EvidenceSource.controllerLog,
      EvidenceSource.processorWebhook,
    ]),
    payload: z
      .object({
        payment_id: identifier("pay"),
        delivery_status: z.enum([
          "failed",
          "rejected",
          "timeout",
          "duplicate",
          "delayed",
          "reordered",
          "disabled",
          "received",
        ]),
        event_id: identifier("evt").optional(),
        operation: PaymentOperationSchema,
        idempotency_key: idempotencyKey,
      })
      .strict(),
  })
  .strict();

export const SettlementObservationEvidenceSchema = z
  .object({
    ...evidenceBase,
    kind: z.literal("settlement_observation"),
    source: z.enum([
      EvidenceSource.processorApi,
      EvidenceSource.paymentService,
    ]),
    payload: z
      .object({
        payment_id: identifier("pay"),
        settlement_status: z.enum(["pending", "failed", "missing", "settled"]),
        amount_minor: amountPaise,
        currency,
        operation: z.literal("read"),
        idempotency_key: idempotencyKey,
      })
      .strict(),
  })
  .strict();

const providerFetchBase = {
  ...evidenceBase,
  source: z.literal(EvidenceSource.processorApi),
};
export const ProviderPaymentFetchEvidenceSchema = z
  .object({
    ...providerFetchBase,
    kind: z.literal("provider_payment_fetch"),
    payload: z.union([
      z
        .object({
          result: z.literal("success"),
          payment_id: identifier("pay"),
          status: PaymentStatusSchema,
          captured: z.boolean(),
          amount_minor: amountPaise,
          currency,
          order_id: identifier("order").nullable(),
          amount_refunded: nonNegativePaise,
          refund_status: z.string().nullable(),
          error_code: z.string().nullable(),
          error_description: z.string().nullable(),
          fetched_at: timestamp,
          freshness_ms: z.number().int().nonnegative(),
          operation: z.literal("read"),
          idempotency_key: idempotencyKey,
        })
        .strict(),
      z
        .object({
          payment_id: identifier("pay"),
          result: z.literal("error"),
          error_code: z.string().min(1),
          error_message: z.string().min(1),
          timeout: z.boolean(),
          operation: z.literal("read"),
          idempotency_key: idempotencyKey,
        })
        .strict(),
    ]),
  })
  .strict();

export const ProviderOrderFetchEvidenceSchema = z
  .object({
    ...providerFetchBase,
    kind: z.literal("provider_order_fetch"),
    payload: z.union([
      z
        .object({
          result: z.literal("success"),
          order_id: identifier("order"),
          status: OrderStatusSchema,
          amount_minor: amountPaise,
          amount_paid: nonNegativePaise,
          amount_due: nonNegativePaise,
          currency,
          attempts: z.number().int().nonnegative(),
          fetched_at: timestamp,
          freshness_ms: z.number().int().nonnegative(),
          operation: z.literal("read"),
          idempotency_key: idempotencyKey,
        })
        .strict(),
      z
        .object({
          order_id: identifier("order"),
          result: z.literal("error"),
          error_code: z.string().min(1),
          error_message: z.string().min(1),
          timeout: z.boolean(),
          operation: z.literal("read"),
          idempotency_key: idempotencyKey,
        })
        .strict(),
    ]),
  })
  .strict();

export const EvidenceKindSchema = z.enum([
  "payment_request",
  "processor_timeout",
  "internal_state",
  "processor_webhook",
  "merchant_order_state",
  "callback_observation",
  "webhook_delivery",
  "settlement_observation",
  "provider_payment_fetch",
  "provider_order_fetch",
]);
export const EvidenceSchema = z.discriminatedUnion("kind", [
  PaymentRequestEvidenceSchema,
  ProcessorTimeoutEvidenceSchema,
  InternalStateEvidenceSchema,
  ProcessorWebhookEvidenceSchema,
  MerchantOrderStateEvidenceSchema,
  CallbackObservationEvidenceSchema,
  WebhookDeliveryEvidenceSchema,
  SettlementObservationEvidenceSchema,
  ProviderPaymentFetchEvidenceSchema,
  ProviderOrderFetchEvidenceSchema,
]);
export type Evidence = z.infer<typeof EvidenceSchema>;
export type PaymentRequestEvidence = z.infer<
  typeof PaymentRequestEvidenceSchema
>;
export type ProcessorTimeoutEvidence = z.infer<
  typeof ProcessorTimeoutEvidenceSchema
>;
export type InternalStateEvidence = z.infer<typeof InternalStateEvidenceSchema>;
export type ProcessorWebhookEvidence = z.infer<
  typeof ProcessorWebhookEvidenceSchema
>;
export type MerchantOrderStateEvidence = z.infer<
  typeof MerchantOrderStateEvidenceSchema
>;
export type CallbackObservationEvidence = z.infer<
  typeof CallbackObservationEvidenceSchema
>;
export type WebhookDeliveryEvidence = z.infer<
  typeof WebhookDeliveryEvidenceSchema
>;
export type SettlementObservationEvidence = z.infer<
  typeof SettlementObservationEvidenceSchema
>;
export type ProviderPaymentFetchEvidence = z.infer<
  typeof ProviderPaymentFetchEvidenceSchema
>;
export type ProviderOrderFetchEvidence = z.infer<
  typeof ProviderOrderFetchEvidenceSchema
>;

export const IncidentBundleSchema = z
  .object({
    incident_id: z.string().min(1),
    payment_id: identifier("pay"),
    idempotency_key: idempotencyKey,
    evidence: z.array(EvidenceSchema).min(1),
  })
  .strict();
export type IncidentBundle = z.infer<typeof IncidentBundleSchema>;

export const TimelineEntrySchema = z
  .object({
    evidence_id: z.string().min(1),
    kind: EvidenceKindSchema,
    occurred_at: timestamp,
    received_at: timestamp,
  })
  .strict();
export const ObservationTransitionSchema = z
  .object({
    observed_at: timestamp,
    state: z.string().min(1),
    reason: z.string().min(1),
    evidence_ids: z.array(z.string().min(1)).min(1),
  })
  .strict();
export const ReconstructionSchema = z
  .object({
    incident_class: IncidentClassSchema,
    timeline: z.array(TimelineEntrySchema),
    observation_transitions: z.array(ObservationTransitionSchema),
    duplicate_evidence_ids: z.array(z.string().min(1)),
    current_state: z.string().min(1),
    ambiguity_reasons: z.array(z.string()),
    impact_summary: z
      .object({
        payments_affected: z.number().int().positive(),
        payment_id: identifier("pay"),
        amount_minor: amountPaise,
        currency,
        duplicate_events_suppressed: z.number().int().nonnegative(),
        money_movement_executed_by_recovery: z.literal(false),
      })
      .strict(),
  })
  .strict();
export type Reconstruction = z.infer<typeof ReconstructionSchema>;

export const ReconciliationStatusSchema = z.enum([
  "agreed",
  "discrepancy",
  "ambiguous",
]);
export type ReconciliationStatus = z.infer<typeof ReconciliationStatusSchema>;

export const ReconciliationIncidentClassSchema = z.union([
  IncidentClassSchema,
  z.literal("none"),
]);
export type ReconciliationIncidentClass = z.infer<
  typeof ReconciliationIncidentClassSchema
>;

export const ReconciliationMerchantStateSchema = z.enum([
  "missing",
  "pending",
  "paid",
  "fulfilled",
  "multiple",
  "unknown",
]);
export type ReconciliationMerchantState = z.infer<
  typeof ReconciliationMerchantStateSchema
>;

export const ReconciliationDiscrepancySchema = z.enum([
  "provider_paid_merchant_pending",
  "provider_paid_merchant_missing",
  "one_payment_two_orders",
  "callback_missing",
  "webhook_delivery_failure",
  "late_authorized",
  "capture_outcome_unknown",
  "settlement_mismatch",
  "provider_failed_merchant_fulfilled",
  "amount_mismatch",
  "currency_mismatch",
  "payment_identity_mismatch",
  "order_mapping_mismatch",
  "multiple_payments_one_order",
  "contradictory_provider_state",
  "invalid_chronology",
  "stale_evidence",
  "idempotency_mismatch",
  "unverified_provider",
]);
export type ReconciliationDiscrepancy = z.infer<
  typeof ReconciliationDiscrepancySchema
>;

export const ReconciliationResolutionSchema = z.enum([
  "no_action_required",
  "reconcile_internal_state",
  "escalate",
]);
export type ReconciliationResolution = z.infer<
  typeof ReconciliationResolutionSchema
>;

export const ReconciliationInvariantResultsSchema = z
  .object({
    identity: z.boolean(),
    amount: z.boolean(),
    currency: z.boolean(),
    order: z.boolean(),
    status: z.boolean(),
    chronology: z.boolean(),
    freshness: z.boolean(),
    uniqueness: z.boolean(),
    idempotency: z.boolean(),
    authenticity: z.boolean(),
  })
  .strict();
export type ReconciliationInvariantResults = z.infer<
  typeof ReconciliationInvariantResultsSchema
>;

export const ReconciliationResultSchema = z
  .object({
    incident_class: ReconciliationIncidentClassSchema,
    status: ReconciliationStatusSchema,
    provider_state: PaymentStateSchema,
    provider_amount_minor: amountPaise.nullable(),
    provider_currency: currency.nullable(),
    provider_order_id: identifier("order").nullable(),
    provider_evidence_ids: z.array(z.string().min(1)),
    merchant_state: ReconciliationMerchantStateSchema,
    merchant_order_ids: z.array(z.string().min(1)),
    merchant_payment_ids: z.array(z.string().min(1)),
    discrepancy: ReconciliationDiscrepancySchema.nullable(),
    discrepancies: z.array(ReconciliationDiscrepancySchema),
    invariant_results: ReconciliationInvariantResultsSchema,
    ambiguity_reasons: z.array(z.string().min(1)),
    deterministic_resolution: z.boolean(),
    resolution: ReconciliationResolutionSchema,
    target_order_id: identifier("order").nullable(),
    target_state: z.literal("paid").nullable(),
    evidence_ids: z.array(z.string().min(1)),
  })
  .strict();
export type ReconciliationResult = z.infer<typeof ReconciliationResultSchema>;

export const ActionSchema = z.enum([
  "reconcile_internal_state",
  "retry_safe_read",
  "no_action_required",
  "retry_capture",
  "refund",
  "payout",
  "fulfil",
  "arbitrary_write",
  "escalate",
]);
export type Action = z.infer<typeof ActionSchema>;
export const DiagnosisHypothesisSchema = z
  .object({
    rank: z.number().int().positive(),
    summary: z.string().min(1),
    reasoning: z.string().min(1),
    uncertainty: z.string().min(1),
    confidence: z.number().min(0).max(1),
    evidence_ids: z.array(z.string().min(1)).min(1),
  })
  .strict();
export const RecommendationSchema = z
  .object({
    action: ActionSchema,
    reasoning: z.string().min(1),
    uncertainty: z.string().min(1),
    evidence_ids: z.array(z.string().min(1)).min(1),
  })
  .strict();
export const DiagnosisSchema = z
  .object({
    hypotheses: z.array(DiagnosisHypothesisSchema).min(1),
    recommendation: RecommendationSchema,
  })
  .strict();
export const DiagnosisProvenanceSchema = z
  .object({
    provider: z.string().min(1),
    requested_model: z.string().min(1),
    returned_model: z.string().min(1),
    request_id: z.string().min(1),
    strict_schema: z.literal(true),
    token_usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    failure_reason: z.string().min(1).optional(),
  })
  .strict();
export const DiagnosisOutputSchema = z
  .object({ diagnosis: DiagnosisSchema, provenance: DiagnosisProvenanceSchema })
  .strict();
export type DiagnosisOutput = z.infer<typeof DiagnosisOutputSchema>;
export function parseDiagnosisOutput(
  value: unknown,
  canonicalEvidenceIds: ReadonlySet<string>,
): DiagnosisOutput {
  const output = DiagnosisOutputSchema.parse(value);
  const evidenceIds = [
    ...output.diagnosis.hypotheses.flatMap(
      (hypothesis) => hypothesis.evidence_ids,
    ),
    ...output.diagnosis.recommendation.evidence_ids,
  ];
  const invalidEvidenceId = evidenceIds.find(
    (evidenceId) => !canonicalEvidenceIds.has(evidenceId),
  );
  if (invalidEvidenceId)
    throw new Error(`evidence_id ${invalidEvidenceId} is not canonical`);
  return output;
}

export const PolicyGateDecisionSchema = z
  .object({
    action: ActionSchema,
    allowed: z.boolean(),
    reason: z.string().min(1),
    approval_required: z.string().min(1).nullable(),
  })
  .strict();
export const RecoveryOutcomeSchema = z
  .object({
    status: z.enum(["reconciled", "escalated", "already_completed"]),
    action: ActionSchema,
    idempotency_key: idempotencyKey,
    before_state: PaymentStateSchema,
    after_state: PaymentStateSchema,
    reason: z.string().min(1),
    escalation_reason: z.string().min(1).optional(),
    terminal_owner: z.string().min(1).optional(),
    policy_version: z.string().min(1).optional(),
    credential_scope: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((outcome, context) => {
    if (outcome.status === "escalated") {
      for (const field of [
        "escalation_reason",
        "terminal_owner",
        "policy_version",
        "credential_scope",
      ] as const) {
        if (!outcome[field]) {
          context.addIssue({
            code: "custom",
            path: [field],
            message: `${field} is required for escalated outcomes`,
          });
        }
      }
    }
  });

export const ProviderAfterstateSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("payment"), object: RazorpayPaymentSchema })
    .strict(),
  z.object({ kind: z.literal("order"), object: RazorpayOrderSchema }).strict(),
  z
    .object({ kind: z.literal("webhook"), object: RazorpayWebhookEventSchema })
    .strict(),
]);
export const MerchantRecordSchema = z
  .object({
    exists: z.boolean(),
    payment_id: identifier("pay").optional(),
    order_id: identifier("order").optional(),
    state: PaymentStateSchema.optional(),
    amount_minor: amountPaise.optional(),
    currency: currency.optional(),
  })
  .strict();
export const AfterstateObservationSchema = z
  .object({
    provider_object: ProviderAfterstateSchema,
    merchant_record: MerchantRecordSchema,
    invariant_holds: z.boolean(),
    observed_at: timestamp,
  })
  .strict();
export const AuditEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    recorded_at: timestamp,
    event_type: z.string().min(1),
    payload: jsonValue,
  })
  .strict();

export type RazorpayPayment = z.infer<typeof RazorpayPaymentSchema>;
export type RazorpayOrder = z.infer<typeof RazorpayOrderSchema>;
export type RazorpayPaymentCollection = z.infer<
  typeof RazorpayPaymentCollectionSchema
>;
export type PolicyGateDecision = z.infer<typeof PolicyGateDecisionSchema>;
export type RecoveryOutcome = z.infer<typeof RecoveryOutcomeSchema>;
export type AfterstateObservation = z.infer<typeof AfterstateObservationSchema>;
