import { z } from "zod";

const id = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$`));
const key = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
const amountMinor = z.number().int().safe().positive();
const nonNegativePaise = z.number().int().safe().nonnegative();
const currency = z.string().regex(/^[A-Z]{3}$/);
const timestamp = z.string().datetime({ offset: true });
const jsonValue: z.ZodType<unknown> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValue), z.record(z.string(), jsonValue)]));

export const PaymentStatusSchema = z.enum(["created", "authorized", "captured", "refunded", "failed"]);
export const OrderStatusSchema = z.enum(["created", "attempted", "paid"]);
export const RazorpayPaymentSchema = z.object({
  id: id("pay"), status: PaymentStatusSchema, captured: z.boolean(), amount: amountMinor,
  currency, order_id: z.string().nullable(), amount_refunded: nonNegativePaise,
  refund_status: z.string().nullable(), error_code: z.string().nullable(), error_description: z.string().nullable(),
}).strict();
export const RazorpayOrderSchema = z.object({
  id: id("order"), status: OrderStatusSchema, amount: amountMinor, amount_paid: z.number().int().nonnegative(),
  amount_due: z.number().int().nonnegative(), currency, attempts: z.number().int().nonnegative(),
}).strict();
export const RazorpayOrderPaymentSchema = z.object({ id: id("pay"), order_id: id("order") }).strict();
export const RazorpayPaymentCollectionSchema = z.object({ count: z.number().int().nonnegative(), items: z.array(RazorpayOrderPaymentSchema) }).strict();
const RazorpayWebhookBodySchema = z.object({ event: z.enum(["payment.captured", "payment.failed", "payment.refunded"]), payload: z.union([
  z.object({ payment: z.object({ entity: z.object({ id: id("pay") }).strict() }).strict() }).strict(),
  z.object({ id: z.number() }).strict(),
]) }).strict();
export const RazorpayWebhookEventSchema = RazorpayWebhookBodySchema.extend({ event_id: id("evt") }).strict();
export const RazorpayWebhookBodyEnvelopeSchema = RazorpayWebhookBodySchema;

const paymentIdentity = z.object({ payment_id: id("pay"), operation: z.literal("capture"), amount_minor: amountMinor, currency, idempotency_key: key }).strict();
export const PaymentRequestEvidenceSchema = z.object({
  evidence_id: z.string().min(1), kind: z.literal("payment_request"), occurred_at: timestamp, received_at: timestamp,
  source: z.literal("merchant-payment-service"), payload: paymentIdentity,
}).strict();
export const ProcessorTimeoutEvidenceSchema = z.object({
  evidence_id: z.string().min(1), kind: z.literal("processor_timeout"), occurred_at: timestamp, received_at: timestamp,
  source: z.literal("merchant-payment-service"), payload: z.object({ payment_id: id("pay"), operation: z.literal("capture"), timeout_ms: z.number().int().positive(), idempotency_key: key }).strict(),
}).strict();
export const InternalStateEvidenceSchema = z.object({
  evidence_id: z.string().min(1), kind: z.literal("internal_state"), occurred_at: timestamp, received_at: timestamp,
  source: z.literal("merchant-order-store"), payload: z.object({ payment_id: id("pay"), payment_state: z.literal("capture_pending"), amount_minor: amountMinor, currency, operation: z.literal("capture"), last_operation_key: key }).strict(),
}).strict();
export const ProcessorWebhookEvidenceSchema = z.object({
  evidence_id: z.string().min(1), kind: z.literal("processor_webhook"), occurred_at: timestamp, received_at: timestamp,
  source: z.literal("processor-webhook"), processor_signature: z.string().min(1),
  payload: z.object({ event_id: id("evt"), event_type: z.enum(["payment.captured", "payment.failed", "payment.refunded"]), payment_id: id("pay"), payment_state: z.enum(["captured", "failed", "refunded"]), amount_minor: amountMinor, currency, idempotency_key: key, signature_verified: z.literal(true), operation: z.literal("capture") }).strict(),
}).strict();
export const EvidenceKindSchema = z.enum(["payment_request", "processor_timeout", "internal_state", "processor_webhook"]);
export const EvidenceSchema = z.discriminatedUnion("kind", [PaymentRequestEvidenceSchema, ProcessorTimeoutEvidenceSchema, InternalStateEvidenceSchema, ProcessorWebhookEvidenceSchema]);
export type Evidence = z.infer<typeof EvidenceSchema>;
export type PaymentRequestEvidence = z.infer<typeof PaymentRequestEvidenceSchema>;
export type ProcessorTimeoutEvidence = z.infer<typeof ProcessorTimeoutEvidenceSchema>;
export type InternalStateEvidence = z.infer<typeof InternalStateEvidenceSchema>;
export type ProcessorWebhookEvidence = z.infer<typeof ProcessorWebhookEvidenceSchema>;

export const IncidentBundleSchema = z.object({ incident_id: z.string().min(1), payment_id: id("pay"), idempotency_key: key, evidence: z.array(EvidenceSchema).min(1) }).strict();
export type IncidentBundle = z.infer<typeof IncidentBundleSchema>;
export const TimelineEntrySchema = z.object({ evidence_id: z.string().min(1), kind: EvidenceKindSchema, occurred_at: timestamp, received_at: timestamp }).strict();
export const ObservationTransitionSchema = z.object({ observed_at: timestamp, state: z.string().min(1), reason: z.string().min(1), evidence_ids: z.array(z.string().min(1)).min(1) }).strict();
export const ReconstructionSchema = z.object({
  timeline: z.array(TimelineEntrySchema), observation_transitions: z.array(ObservationTransitionSchema), duplicate_evidence_ids: z.array(z.string().min(1)), current_state: z.string().min(1), ambiguity_reasons: z.array(z.string()),
  impact_summary: z.object({ payments_affected: z.number().int().positive(), payment_id: id("pay"), amount_minor: amountMinor, currency, duplicate_events_suppressed: z.number().int().nonnegative(), money_movement_executed_by_recovery: z.literal(false) }).strict(),
}).strict();
export type Reconstruction = z.infer<typeof ReconstructionSchema>;

export const DiagnosisHypothesisSchema = z.object({ rank: z.number().int().positive(), summary: z.string().min(1), reasoning: z.string().min(1), uncertainty: z.string().min(1), confidence: z.number().min(0).max(1), evidence_ids: z.array(z.string().min(1)).min(1) }).strict();
export const RecommendationSchema = z.object({ action: z.enum(["reconcile_internal_state", "retry_capture", "escalate"]), reasoning: z.string().min(1), uncertainty: z.string().min(1), evidence_ids: z.array(z.string().min(1)).min(1) }).strict();
export const DiagnosisSchema = z.object({ hypotheses: z.array(DiagnosisHypothesisSchema).min(1), recommendation: RecommendationSchema }).strict();
export const DiagnosisProvenanceSchema = z.object({ provider: z.string().min(1), requested_model: z.string().min(1), returned_model: z.string().min(1), request_id: z.string().min(1), strict_schema: z.literal(true) }).strict();
export const DiagnosisOutputSchema = z.object({ diagnosis: DiagnosisSchema, provenance: DiagnosisProvenanceSchema }).strict();
export type DiagnosisOutput = z.infer<typeof DiagnosisOutputSchema>;
export function parseDiagnosisOutput(value: unknown, canonicalEvidenceIds: ReadonlySet<string>): DiagnosisOutput {
  return DiagnosisOutputSchema.superRefine((output, ctx) => {
        const ids = [...output.diagnosis.hypotheses.flatMap((hypothesis) => hypothesis.evidence_ids), ...output.diagnosis.recommendation.evidence_ids];
        ids.forEach((evidenceId) => { if (!canonicalEvidenceIds.has(evidenceId)) ctx.addIssue({ code: "custom", path: ["diagnosis"], message: `evidence_id ${evidenceId} is not canonical` }); });
      }).parse(value);
}

export const PolicyGateDecisionSchema = z.object({ action: z.string().min(1), allowed: z.boolean(), reason: z.string().min(1) }).strict();
export const RecoveryOutcomeSchema = z.object({ status: z.enum(["reconciled", "escalated", "already_completed"]), action: z.string().min(1), idempotency_key: z.string().min(1), before_state: z.string().min(1), after_state: z.string().min(1), reason: z.string().min(1) }).strict();
export const AfterstateObservationSchema = z.object({ provider_object: jsonValue, merchant_record: jsonValue, invariant_holds: z.boolean(), observed_at: timestamp }).strict();
export const AuditEventSchema = z.object({ sequence: z.number().int().positive(), recorded_at: timestamp, event_type: z.string().min(1), payload: jsonValue }).strict();

export type RazorpayPayment = z.infer<typeof RazorpayPaymentSchema>;
export type RazorpayOrder = z.infer<typeof RazorpayOrderSchema>;
export type RazorpayPaymentCollection = z.infer<typeof RazorpayPaymentCollectionSchema>;
export type PolicyGateDecision = z.infer<typeof PolicyGateDecisionSchema>;
export type RecoveryOutcome = z.infer<typeof RecoveryOutcomeSchema>;
