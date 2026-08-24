import type { Action, IncidentBundle, PaymentState } from "../domain/schemas";

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

export type RecoveryInput = Omit<RecoveryRecord, "execution_key">;

export interface IncidentRepository {
  initialize(reset: boolean): Promise<void>;
  close(): Promise<void>;
  ingest(bundle: IncidentBundle, secret?: string): Promise<void>;
  incident(id: string, secret?: string): Promise<IncidentBundle | null>;
  payment(id: string): Promise<PaymentRecord | undefined>;
  updatePayment(id: string, state: string): Promise<void>;
  recovery(key: string): Promise<RecoveryRecord | undefined>;
  completeRecovery(key: string, value: RecoveryInput): Promise<void>;
  audit(type: string, payload: unknown): Promise<number | undefined>;
  auditRecords(): Promise<unknown[]>;
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
}
