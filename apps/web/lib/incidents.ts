import "server-only";

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { IncidentStore } from "../../../src/incident_commander/store";
import { reconstruct, reconcile } from "../../../src/incident_commander/core";
import {
  IncidentBundleSchema,
  type IncidentBundle,
} from "../../../src/domain/schemas";

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

export function requestContext(request: Request | Headers) {
  const headers = request instanceof Headers ? request : request.headers;
  return {
    tenantId: headers.get(tenantHeader) || "default-merchant",
    actor: headers.get(actorHeader) || "operator",
  };
}

const stores = new Map<string, IncidentStore>();
const initializing = new Map<string, Promise<void>>();

function incidentStatePath() {
  const configuredPath = process.env.INCIDENT_STATE_PATH?.trim();
  if (configuredPath) return configuredPath;
  if (process.env.DATABASE_URL?.trim()) return "postgresql";

  const cwd = process.cwd();
  const projectRoot = cwd.endsWith(path.join("apps", "web"))
    ? path.resolve(cwd, "../..")
    : cwd;
  const runtimeDirectory = path.join(projectRoot, ".runtime");
  mkdirSync(runtimeDirectory, { recursive: true });
  return path.join(runtimeDirectory, "incident-state.sqlite3");
}

export function storeFor(tenantId: string) {
  const existing = stores.get(tenantId);
  if (existing) return existing;
  const store = new IncidentStore(
    incidentStatePath(),
    false,
    process.env.PROCESSOR_WEBHOOK_SECRET || "test-prototype-secret",
    tenantId,
  );
  stores.set(tenantId, store);
  const ready = store.initialize().catch((error) => {
    stores.delete(tenantId);
    initializing.delete(tenantId);
    throw error;
  });
  initializing.set(tenantId, ready);
  return store;
}

export async function withStore<T>(
  tenantId: string,
  fn: (store: IncidentStore) => Promise<T>,
) {
  const store = storeFor(tenantId);
  await (initializing.get(tenantId) ?? Promise.resolve());
  return fn(store);
}

function newestTimestamp(values: string[]) {
  return values.sort(
    (left, right) => Date.parse(right) - Date.parse(left),
  )[0] as string;
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

// Builds DTOs for a whole list of bundles with two queries total (progress +
// payments), not two per incident.
export async function incidentDtosForBundles(
  store: IncidentStore,
  bundles: IncidentBundle[],
) {
  const [progressRows, paymentRows] = await Promise.all([
    store.progressFor(bundles.map((bundle) => bundle.incident_id)),
    store.paymentsFor(bundles.map((bundle) => bundle.payment_id)),
  ]);
  const progressByIncident = new Map<
    string,
    Awaited<ReturnType<IncidentStore["progress"]>>
  >();
  for (const row of progressRows) {
    const existing = progressByIncident.get(row.incident_id);
    if (existing) existing.push(row);
    else progressByIncident.set(row.incident_id, [row]);
  }
  const paymentById = new Map(
    paymentRows.map((row) => [row.payment_id, row] as const),
  );
  return bundles.map((bundle) =>
    incidentDto(
      bundle,
      progressByIncident.get(bundle.incident_id) ?? [],
      paymentById.get(bundle.payment_id),
    ),
  );
}

export async function listIncidentDtos(tenantId: string) {
  return withStore(tenantId, async (store) =>
    incidentDtosForBundles(store, await store.listIncidents(tenantId)),
  );
}

// A change token over the same store rows the DTOs read. Live refresh polls
// this token and avoids pulling every record with its evidence on each
// tick; when the digest moves, the client refetches the page.
export async function incidentListFingerprint(tenantId: string) {
  return withStore(tenantId, async (store) => {
    const bundles = await store.listIncidents(tenantId);
    const [progressRows, paymentRows] = await Promise.all([
      store.progressFor(bundles.map((bundle) => bundle.incident_id)),
      store.paymentsFor(bundles.map((bundle) => bundle.payment_id)),
    ]);
    // Row order from the database is not guaranteed to repeat, so sort the
    // serialized rows before hashing: same data in, same digest out.
    const rows = [...bundles, ...progressRows, ...paymentRows]
      .map((row) => JSON.stringify(row))
      .sort();
    const digest = createHash("sha256");
    for (const row of rows) digest.update(row, "utf8");
    return digest.digest("hex");
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

// The audit repository nests each event's original payload under
// `payload.details`, so a batch_started event from the batch route carries
// its batch_id and incident_ids one level down, at `payload.details.details`.
// Older events carry them directly on `payload.details`; resolve both.
export function batchEventFields(payload: { details: unknown }) {
  const record =
    payload.details && typeof payload.details === "object"
      ? (payload.details as Record<string, unknown>)
      : {};
  const nested =
    record.details && typeof record.details === "object"
      ? (record.details as Record<string, unknown>)
      : {};
  const batchId =
    typeof record.batch_id === "string"
      ? record.batch_id
      : typeof nested.batch_id === "string"
        ? nested.batch_id
        : undefined;
  const incidentIds = Array.isArray(record.incident_ids)
    ? (record.incident_ids as string[])
    : Array.isArray(nested.incident_ids)
      ? (nested.incident_ids as string[])
      : [];
  return { batchId, incidentIds };
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
        const { batchId, incidentIds } = batchEventFields(event.payload);
        return {
          batch_id: batchId ?? String(event.sequence),
          incident_ids: incidentIds,
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
        batchEventFields(item.payload).batchId === batchId,
    );
    if (!event) return null;
    const incidentIds = batchEventFields(event.payload).incidentIds;
    const bundles = await Promise.all(
      incidentIds.map(async (incidentId) => store.incident(incidentId)),
    );
    const present: IncidentBundle[] = [];
    for (const bundle of bundles) if (bundle) present.push(bundle);
    // Both count sources ride the DTO: `incident_ids` is the roster the
    // batch accepted (the list counts it), `incidents` the rows still
    // present to render. Consumers derive every count from `incident_ids`
    // so the list and the detail cannot disagree about the same batch.
    return {
      batch_id: batchId,
      started_at: event.recorded_at,
      incident_ids: incidentIds,
      incidents: await incidentDtosForBundles(store, present),
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
  )[0] as string;
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
