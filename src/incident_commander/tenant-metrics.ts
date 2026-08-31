import type { IncidentStore } from "./store";
import type { IncidentBundle } from "../domain/schemas";

export type TenantMetrics = {
  total: number;
  pending: number;
  reconciled: number;
  escalated: number;
  repair_success_rate: number | null;
  afterstate_verified_share: number | null;
  duplicates_prevented: number;
  blocked_actions: number;
  median_time_to_close_seconds: number | null;
};

type AuditRecord = Awaited<ReturnType<IncidentStore["auditRecords"]>>[number];

export function incidentStatusFromProgress(
  progress: ReadonlyArray<{ step: string; status: string }>,
) {
  if (
    progress.some(
      (item) => item.step === "escalate" && item.status === "completed",
    )
  )
    return "escalated" as const;
  if (
    progress.some(
      (item) => item.step === "close" && item.status === "completed",
    )
  )
    return "reconciled" as const;
  return "pending" as const;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle];
  const low = sorted[middle - 1];
  if (high === undefined) return null;
  return sorted.length % 2 || low === undefined
    ? high
    : Math.round((low + high) / 2);
}

function earliestReceivedAt(bundle: IncidentBundle) {
  const times = bundle.evidence
    .map((entry) => Date.parse(entry.received_at))
    .filter((value) => Number.isFinite(value));
  return times.length ? Math.min(...times) : null;
}

function secondsToClose(
  bundle: IncidentBundle,
  progress: ReadonlyArray<{ step: string; status: string; updated_at: string }>,
) {
  const terminal = progress
    .filter(
      (item) =>
        (item.step === "close" || item.step === "escalate") &&
        item.status === "completed",
    )
    .sort(
      (left, right) =>
        Date.parse(right.updated_at) - Date.parse(left.updated_at),
    )[0];
  const started = earliestReceivedAt(bundle);
  if (!terminal || started === null) return null;
  return Math.max(
    0,
    Math.round((Date.parse(terminal.updated_at) - started) / 1000),
  );
}

// Audit payloads are stored as governance records; the event-specific fields
// live under `details`.
function detailsOf(record: AuditRecord): Record<string, unknown> {
  const payload = record.payload as { details?: unknown };
  return payload.details && typeof payload.details === "object"
    ? (payload.details as Record<string, unknown>)
    : {};
}

/**
 * Measured tenant outcomes computed from the live incident store: incident
 * statuses, verified repair share, and the time from first evidence to a
 * terminal step.
 */
export async function tenantMetrics(
  store: IncidentStore,
  tenantId: string,
): Promise<TenantMetrics> {
  const bundles = await store.listIncidents(tenantId);
  const perIncident = await Promise.all(
    bundles.map(async (bundle) => ({
      bundle,
      progress: await store.progress(bundle.incident_id),
    })),
  );
  const counts = { pending: 0, reconciled: 0, escalated: 0 };
  const timesToClose: number[] = [];
  for (const { bundle, progress } of perIncident) {
    const status = incidentStatusFromProgress(progress);
    counts[status] = (counts[status] ?? 0) + 1;
    const seconds = secondsToClose(bundle, progress);
    if (seconds !== null) timesToClose.push(seconds);
  }
  // Audit records are store-global; the governance payload tags each one with
  // the tenant that wrote it.
  const audits = (await store.auditRecords()).filter(
    (record) =>
      (record.payload as { tenant_id?: unknown }).tenant_id === tenantId,
  );
  const afterstateObservations = audits.filter(
    (record) => record.event_type === "afterstate_observed",
  ).length;
  const afterstateVerified = audits.filter(
    (record) =>
      record.event_type === "afterstate_observed" &&
      detailsOf(record).status === "verified",
  ).length;
  const terminalRepairs = counts.reconciled + counts.escalated;
  return {
    total: bundles.length,
    pending: counts.pending,
    reconciled: counts.reconciled,
    escalated: counts.escalated,
    repair_success_rate:
      terminalRepairs > 0 ? counts.reconciled / terminalRepairs : null,
    afterstate_verified_share:
      afterstateObservations > 0
        ? afterstateVerified / afterstateObservations
        : null,
    duplicates_prevented: audits.filter(
      (record) =>
        record.event_type === "recovery_completed" &&
        detailsOf(record).status === "already_completed",
    ).length,
    blocked_actions: audits.filter(
      (record) =>
        record.event_type === "policy_evaluated" &&
        detailsOf(record).allowed === false,
    ).length,
    median_time_to_close_seconds: median(timesToClose),
  };
}
