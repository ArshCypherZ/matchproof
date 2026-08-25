import "server-only";

import { IncidentStore } from "../../../src/incident_commander/store";
import { reconstruct, reconcile } from "../../../src/incident_commander/core";
import { IncidentBundleSchema } from "../../../src/domain/schemas";

const tenantHeader = "x-tenant-id";
const actorHeader = "x-operator-id";

export function requestContext(request: Request) {
  return {
    tenantId: request.headers.get(tenantHeader) || "default-merchant",
    actor: request.headers.get(actorHeader) || "operator",
  };
}

export function storeFor(tenantId: string) {
  return new IncidentStore(
    process.env.INCIDENT_STATE_PATH || "postgresql",
    false,
    process.env.PROCESSOR_WEBHOOK_SECRET || "test-prototype-secret",
    tenantId,
  );
}

export async function withStore<T>(
  tenantId: string,
  fn: (store: IncidentStore) => Promise<T>,
) {
  const store = storeFor(tenantId);
  await store.initialize();
  try {
    return await fn(store);
  } finally {
    await store.close();
  }
}

export function incidentDto(
  bundle: unknown,
  progress: Awaited<ReturnType<IncidentStore["progress"]>>,
  payment: Awaited<ReturnType<IncidentStore["payment"]>>,
) {
  const parsed = IncidentBundleSchema.parse(bundle);
  const reconstruction = reconstruct(parsed);
  const reconciliation = reconcile(parsed);
  return {
    incident_id: parsed.incident_id,
    payment_id: parsed.payment_id,
    incident_class: reconstruction.incident_class,
    status: progress.some(
      (item) => item.step === "escalate" && item.status === "completed",
    )
      ? "escalated"
      : progress.some(
            (item) => item.step === "close" && item.status === "completed",
          )
        ? "reconciled"
        : "pending",
    payment: payment
      ? {
          state: payment.state,
          amount_minor: payment.amount_minor,
          currency: payment.currency,
        }
      : null,
    evidence: parsed.evidence,
    reconstruction,
    reconciliation,
    progress,
  };
}

export { actorHeader };
