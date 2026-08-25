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
  ingest(input: unknown) {
    return this.repository.ingest(verifyBundle(input, this.secret));
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
  recovery(key: string) {
    return this.repository.recovery(key);
  }
  completeRecovery(
    ...args: Parameters<IncidentRepository["completeRecovery"]>
  ) {
    return this.repository.completeRecovery(...args);
  }
  updatePayment(...args: Parameters<IncidentRepository["updatePayment"]>) {
    return this.repository.updatePayment(...args);
  }
  audit(...args: Parameters<IncidentRepository["audit"]>) {
    return this.repository.audit(...args);
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
}
