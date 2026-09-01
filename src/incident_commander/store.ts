import { PostgresIncidentRepository } from "../db/postgres-repository";
import { SqliteIncidentRepository } from "../db/sqlite-repository";
import type { IncidentRepository } from "../db/repository";
import { verifyBundle } from "./validation";

export class IncidentStore {
  private readonly repository: IncidentRepository;
  constructor(
    readonly statePath: string,
    private readonly reset = false,
    readonly secret?: string,
    readonly tenantId = "default-merchant",
  ) {
    const postgres =
      statePath === "postgresql" ||
      statePath === "postgres" ||
      statePath.startsWith("postgres://") ||
      statePath.startsWith("postgresql://");
    this.repository = postgres
      ? new PostgresIncidentRepository(
          /^(postgres|postgresql):\/\//.test(statePath) ? statePath : undefined,
        )
      : new SqliteIncidentRepository(statePath);
  }
  initialize() {
    return this.repository.initialize(this.reset);
  }
  close() {
    return this.repository.close();
  }
  async ingest(input: unknown) {
    let bundle;
    try {
      bundle = verifyBundle(input, this.secret);
    } catch (error) {
      await this.repository.audit("evidence_rejected", {
        tenant_id: this.tenantId,
        actor: "system",
        credential_scope: "none",
        proposed_action: "reject_evidence",
        approval_state: "not_required",
        attempt_result: "rejected",
        stopping_reason: "evidence validation failed",
        terminal_owner: "payment-operations",
        details: {
          input_persisted: false,
          error_type: error instanceof Error ? error.name : "UnknownError",
        },
      });
      throw error;
    }
    return this.repository.ingest(bundle, this.secret, this.tenantId);
  }
  updateIncident(input: unknown) {
    return this.repository.updateIncident(verifyBundle(input, this.secret));
  }
  incident(id: string) {
    return this.repository
      .incident(id, this.secret)
      .then((bundle) => (bundle ? verifyBundle(bundle, this.secret) : null));
  }
  incidentByPaymentId(paymentId: string) {
    return this.repository
      .incidentByPaymentId(paymentId)
      .then((bundle) => (bundle ? verifyBundle(bundle, this.secret) : null));
  }
  payment(id: string) {
    return this.repository.payment(id);
  }
  paymentsFor(paymentIds: string[]) {
    return this.repository.paymentsFor(paymentIds);
  }
  recovery(key: string) {
    return this.repository.recovery(key);
  }
  recoveryAttempt(key: string) {
    return this.repository.recoveryAttempt(key);
  }
  startRecoveryAttempt(
    ...args: Parameters<IncidentRepository["startRecoveryAttempt"]>
  ) {
    return this.repository.startRecoveryAttempt(...args);
  }
  completeRecoveryAttempt(
    ...args: Parameters<IncidentRepository["completeRecoveryAttempt"]>
  ) {
    return this.repository.completeRecoveryAttempt(...args);
  }
  completeRecovery(
    ...args: Parameters<IncidentRepository["completeRecovery"]>
  ) {
    return this.repository.completeRecovery(...args);
  }
  savePostRepairStateObservation(
    ...args: Parameters<IncidentRepository["savePostRepairStateObservation"]>
  ) {
    return this.repository.savePostRepairStateObservation(...args);
  }
  resetIncidentExecution(
    ...args: Parameters<IncidentRepository["resetIncidentExecution"]>
  ) {
    return this.repository.resetIncidentExecution(...args);
  }
  postRepairStateObservation(
    ...args: Parameters<IncidentRepository["postRepairStateObservation"]>
  ) {
    return this.repository.postRepairStateObservation(...args);
  }
  updatePayment(...args: Parameters<IncidentRepository["updatePayment"]>) {
    return this.repository.updatePayment(...args);
  }
  async audit(eventType: string, payload: unknown) {
    // Every audit record carries the store tenant so governance rows and
    // derived metrics can be scoped per tenant.
    const enriched =
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).tenant_id === undefined
        ? { ...(payload as Record<string, unknown>), tenant_id: this.tenantId }
        : payload;
    return this.repository.audit(eventType, enriched);
  }
  auditRecords() {
    return this.repository.auditRecords();
  }
  setProgress(...args: Parameters<IncidentRepository["setProgress"]>) {
    return this.repository.setProgress(...args);
  }
  progress(...args: Parameters<IncidentRepository["progress"]>) {
    return this.repository.progress(...args);
  }
  progressFor(...args: Parameters<IncidentRepository["progressFor"]>) {
    return this.repository.progressFor(...args);
  }
  latestProgress(...args: Parameters<IncidentRepository["latestProgress"]>) {
    return this.repository.latestProgress(...args);
  }
  ingestWebhook(...args: Parameters<IncidentRepository["ingestWebhook"]>) {
    return this.repository.ingestWebhook(...args);
  }
  webhookEvent(...args: Parameters<IncidentRepository["webhookEvent"]>) {
    return this.repository.webhookEvent(...args);
  }
  processWebhookEvidence(
    input: Parameters<IncidentRepository["processWebhookEvidence"]>[0],
  ) {
    return this.repository.processWebhookEvidence(input, (bundle) =>
      verifyBundle(bundle, this.secret),
    );
  }
  listIncidents(...args: Parameters<IncidentRepository["listIncidents"]>) {
    return this.repository.listIncidents(...args);
  }
  incidentTenant(...args: Parameters<IncidentRepository["incidentTenant"]>) {
    return this.repository.incidentTenant(...args);
  }
}
