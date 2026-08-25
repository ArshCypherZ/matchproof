import "server-only";

import { IncidentStore } from "../../../src/incident_commander/store";
import { reconstruct, reconcile } from "../../../src/incident_commander/core";
import { IncidentBundleSchema } from "../../../src/domain/schemas";

const loopSteps = [
  "detect",
  "gather",
  "reconcile",
  "diagnose",
  "gate",
  "execute",
  "observe",
  "verify",
  "close",
  "escalate",
] as const;

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

function newestTimestamp(values: string[]) {
  return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function sourceKind(incidentId: string) {
  if (incidentId.startsWith("eval_")) return "synthetic_evaluation" as const;
  if (incidentId.startsWith("inc_")) return "fixture_rehearsal" as const;
  return "redacted_archetype" as const;
}

function currentProgress(
  progress: Awaited<ReturnType<IncidentStore["progress"]>>,
) {
  return (
    [...progress].sort((left, right) => right.sequence - left.sequence)[0] ??
    null
  );
}

export async function listIncidentDtos(tenantId: string) {
  return withStore(tenantId, async (store) => {
    const bundles = await store.listIncidents(tenantId);
    return Promise.all(
      bundles.map(async (bundle) =>
        incidentDto(
          bundle,
          await store.progress(bundle.incident_id),
          await store.payment(bundle.payment_id),
        ),
      ),
    );
  });
}

export async function getIncidentDto(tenantId: string, incidentId: string) {
  return withStore(tenantId, async (store) => {
    const bundle = await store.incident(incidentId);
    if (!bundle || (await store.incidentTenant(incidentId)) !== tenantId)
      return null;
    return incidentDto(
      bundle,
      await store.progress(incidentId),
      await store.payment(bundle.payment_id),
    );
  });
}

export async function listBatchDtos(tenantId: string) {
  return withStore(tenantId, async (store) => {
    const audits = await store.auditRecords();
    return audits
      .filter(
        (event) =>
          event.event_type === "batch_started" &&
          event.payload.tenant_id === tenantId,
      )
      .map((event) => {
        const details = event.payload.details as {
          batch_id?: string;
          incident_ids?: string[];
        };
        return {
          batch_id: details.batch_id ?? String(event.sequence),
          incident_ids: details.incident_ids ?? [],
          started_at: event.recorded_at,
        };
      })
      .reverse();
  });
}

export async function getBatchDto(tenantId: string, batchId: string) {
  return withStore(tenantId, async (store) => {
    const audits = await store.auditRecords();
    const event = audits.find(
      (item) =>
        item.event_type === "batch_started" &&
        item.payload.tenant_id === tenantId &&
        (item.payload.details as { batch_id?: string }).batch_id === batchId,
    );
    if (!event) return null;
    const detail = event.payload.details as { incident_ids?: string[] };
    const incidentIds = detail.incident_ids ?? [];
    const incidents = await Promise.all(
      incidentIds.map(async (incidentId) => {
        const bundle = await store.incident(incidentId);
        if (!bundle) return null;
        return incidentDto(
          bundle,
          await store.progress(incidentId),
          await store.payment(bundle.payment_id),
        );
      }),
    );
    return {
      batch_id: batchId,
      started_at: event.recorded_at,
      incidents: incidents.filter((item): item is NonNullable<typeof item> =>
        Boolean(item),
      ),
    };
  });
}

export function incidentDto(
  bundle: unknown,
  progress: Awaited<ReturnType<IncidentStore["progress"]>>,
  payment: Awaited<ReturnType<IncidentStore["payment"]>>,
) {
  const parsed = IncidentBundleSchema.parse(bundle);
  const reconstruction = reconstruct(parsed);
  const reconciliation = reconcile(parsed);
  const latestProgress = currentProgress(progress);
  const evidenceTimes = parsed.evidence.flatMap((entry) => [
    entry.occurred_at,
    entry.received_at,
  ]);
  const updatedAt = newestTimestamp([
    ...evidenceTimes,
    ...progress.map((item) => item.updated_at),
    ...(payment ? [payment.updated_at] : []),
  ]);
  const startedAt = [...evidenceTimes].sort(
    (left, right) => Date.parse(left) - Date.parse(right),
  )[0];
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
    source_kind: sourceKind(parsed.incident_id),
    current_step: latestProgress?.step ?? "detect",
    current_step_status: latestProgress?.status ?? "pending",
    updated_at: updatedAt,
    started_at: startedAt,
    age_seconds: Math.max(
      0,
      Math.floor((Date.now() - Date.parse(startedAt)) / 1000),
    ),
    order_id:
      reconciliation.target_order_id ??
      reconciliation.provider_order_id ??
      null,
    idempotency_key: parsed.idempotency_key,
    loop_steps: loopSteps,
    evidence: parsed.evidence,
    reconstruction,
    reconciliation,
    progress,
  };
}

export { actorHeader };
