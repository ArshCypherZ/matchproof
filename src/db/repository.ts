import {
  PaymentOperationSchema,
  PaymentStateSchema,
  type Action,
  type AfterstateObservation,
  type Evidence,
  type IncidentBundle,
  type PaymentOperation,
  type PaymentState,
  type ProcessorWebhookEvidence,
} from "../domain/schemas";

export type PaymentSeed = {
  state: PaymentState;
  amount_minor: number;
  currency: string;
  operation: PaymentOperation;
};

function latest<T extends { received_at: string }>(entries: T[]) {
  return [...entries].sort(
    (left, right) =>
      Date.parse(right.received_at) - Date.parse(left.received_at),
  )[0];
}

export function derivePaymentSeed(bundle: IncidentBundle): PaymentSeed | null {
  const financialEvidence = bundle.evidence.filter(
    (
      entry,
    ): entry is Extract<
      Evidence,
      { payload: { amount_minor: number; currency: string } }
    > => "amount_minor" in entry.payload && "currency" in entry.payload,
  );
  if (!financialEvidence.length) return null;
  const amounts = new Set(
    financialEvidence.map((entry) => entry.payload.amount_minor),
  );
  const currencies = new Set(
    financialEvidence.map((entry) => entry.payload.currency),
  );
  if (amounts.size !== 1 || currencies.size !== 1)
    throw new Error(
      "payment observations contain conflicting amount or currency",
    );

  const internal = bundle.evidence.filter(
    (entry) => entry.kind === "internal_state",
  );
  const processor = bundle.evidence.filter(
    (entry) => entry.kind === "processor_webhook",
  );
  const reference = latest(financialEvidence);
  if (!reference) return null;
  const latestInternal = latest(internal);
  const latestProcessor = latest(processor);
  const state =
    latestInternal?.payload.payment_state ??
    latestProcessor?.payload.payment_state ??
    "unknown";
  return {
    state: PaymentStateSchema.parse(state),
    amount_minor: reference.payload.amount_minor,
    currency: reference.payload.currency,
    operation: PaymentOperationSchema.parse(
      "operation" in reference.payload ? reference.payload.operation : "read",
    ),
  };
}

export type PaymentRecord = {
  /** Controller-owned observed state; provider and merchant states remain separate evidence. */
  payment_id: string;
  state: PaymentState;
  amount_minor: number;
  currency: string;
  operation: string;
  operation_key: string;
  updated_at: string;
};

export type RecoveryRecord = {
  execution_key: string;
  action: Action;
  status: "reconciled" | "escalated" | "already_completed";
  before_state: PaymentState;
  after_state: PaymentState;
  completed_at: string;
};

export type ProgressRecord = {
  sequence: number;
  incident_id: string;
  step: string;
  status: string;
  updated_at: string;
  details: unknown;
};

export type WebhookRecord = {
  event_id: string;
  event_type: string;
  signature: string;
  body: string;
  payment_id: string | null;
  received_at: string;
  accepted_at: string;
  incident_id: string | null;
};

export type WebhookInput = {
  eventId: string;
  eventType: string;
  signature: string;
  body: string;
  receivedAt: string;
  paymentId?: string;
};

export type WebhookProcessingInput = {
  eventId: string;
  paymentId: string;
  evidence: ProcessorWebhookEvidence;
  createIncident: {
    incidentId: string;
    idempotencyKey: string;
  };
};

export type WebhookProcessingResult = {
  status: "created" | "updated" | "duplicate";
  incidentId: string;
  eventId: string;
  lateEvidence: boolean;
  reverifyRequired: boolean;
  closureInvariant?: boolean;
};

export type IncidentBundleValidator = (input: unknown) => IncidentBundle;

export type RecoveryInput = Omit<RecoveryRecord, "execution_key">;

export type RecoveryAttempt = {
  execution_key: string;
  action: Action;
  status: "started" | "succeeded" | "failed";
  before_state: PaymentState;
  after_state?: PaymentState;
  error?: string;
  started_at: string;
  completed_at?: string;
};

export interface IncidentRepository {
  initialize(reset: boolean): Promise<void>;
  close(): Promise<void>;
  ingest(
    bundle: IncidentBundle,
    secret?: string,
    tenantId?: string,
  ): Promise<void>;
  updateIncident(bundle: IncidentBundle): Promise<void>;
  incident(id: string, secret?: string): Promise<IncidentBundle | null>;
  incidentByPaymentId(paymentId: string): Promise<IncidentBundle | null>;
  payment(id: string): Promise<PaymentRecord | undefined>;
  updatePayment(id: string, state: string): Promise<void>;
  recovery(key: string): Promise<RecoveryRecord | undefined>;
  recoveryAttempt(key: string): Promise<RecoveryAttempt | undefined>;
  startRecoveryAttempt(input: RecoveryAttempt): Promise<boolean>;
  completeRecoveryAttempt(
    key: string,
    input: Pick<
      RecoveryAttempt,
      "status" | "after_state" | "error" | "completed_at"
    >,
  ): Promise<void>;
  completeRecovery(key: string, value: RecoveryInput): Promise<void>;
  saveAfterstateObservation(
    executionKey: string,
    observation: AfterstateObservation,
  ): Promise<boolean>;
  afterstateObservation(
    executionKey: string,
  ): Promise<AfterstateObservation | undefined>;
  audit(type: string, payload: unknown): Promise<number | undefined>;
  auditRecords(): Promise<import("../domain/schemas").AuditEvent[]>;
  setProgress(
    incidentId: string,
    step: string,
    status: string,
    details: unknown,
  ): Promise<void>;
  progress(incidentId: string): Promise<ProgressRecord[]>;
  latestProgress(incidentId: string): Promise<ProgressRecord | undefined>;
  ingestWebhook(
    event: WebhookInput,
    incidentId?: string,
  ): Promise<{
    status: "accepted" | "duplicate";
    eventId: string;
    eventType: string;
    receivedAt: string;
  }>;
  webhookEvent(eventId: string): Promise<WebhookRecord | undefined>;
  processWebhookEvidence(
    input: WebhookProcessingInput,
    validateBundle: IncidentBundleValidator,
  ): Promise<WebhookProcessingResult>;
  listIncidents(tenantId: string): Promise<IncidentBundle[]>;
  incidentTenant(id: string): Promise<string | undefined>;
}
