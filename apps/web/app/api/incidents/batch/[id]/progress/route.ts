import { requestContext, withStore } from "../../../../../../lib/incidents";
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
        (event.payload.details as { batch_id?: string }).batch_id === id,
    );
    if (!batch) return null;
    const detail = batch.payload.details as { incident_ids: string[] };
    const states = await Promise.all(
      detail.incident_ids.map(async (incidentId) => {
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
        return "pending" as const;
      }),
    );
    const processed = states.filter((state) => state === "processed").length;
    const escalated = states.filter((state) => state === "escalated").length;
    return {
      batch_id: id,
      total: states.length,
      processed,
      pending: states.length - processed - escalated,
      failed: 0,
      escalated,
      resumable: true,
    };
  });
  return result
    ? Response.json(result)
    : Response.json({ error: "not_found" }, { status: 404 });
}
