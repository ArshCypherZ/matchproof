import {
  batchEventFields,
  requestContext,
  withStore,
} from "../../../../../../lib/incidents";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { tenantId } = requestContext(request);
  const result = await withStore(tenantId, async (store) => {
    const audits = await store.auditRecords();
    const batch = audits.find(
      (event) =>
        event.event_type === "batch_started" &&
        event.payload.tenant_id === tenantId &&
        batchEventFields(event.payload).batchId === id,
    );
    if (!batch) return null;
    const incidentIds = batchEventFields(batch.payload).incidentIds;
    const states = await Promise.all(
      incidentIds.map(async (incidentId) => {
        const progress = await store.progress(incidentId);
        if (
          progress.some(
            (entry) =>
              entry.step === "escalate" && entry.status === "completed",
          )
        )
          return "escalated" as const;
        if (
          progress.some(
            (entry) => entry.step === "close" && entry.status === "completed",
          )
        )
          return "processed" as const;
        const latest = [...progress].sort(
          (left, right) => right.sequence - left.sequence,
        )[0];
        if (latest?.status.startsWith("failed:")) return "failed" as const;
        return "pending" as const;
      }),
    );
    const processed = states.filter((state) => state === "processed").length;
    const escalated = states.filter((state) => state === "escalated").length;
    const failed = states.filter((state) => state === "failed").length;
    return {
      batch_id: id,
      total: states.length,
      processed,
      pending: states.length - processed - escalated - failed,
      failed,
      escalated,
      resumable: processed + escalated < states.length,
    };
  });
  return result
    ? Response.json(result)
    : Response.json({ error: "not_found" }, { status: 404 });
}
