import { z } from "zod";
import { requestContext, withStore } from "../../../../lib/incidents";
import {
  addBatchJob,
  addIncidentJob,
  createQueues,
} from "../../../../../../src/queue";
export const dynamic = "force-dynamic";
const schema = z
  .object({ incident_ids: z.array(z.string().min(1)).min(1).max(1000) })
  .strict();
export async function POST(request: Request) {
  const { tenantId, actor } = requestContext(request);
  const body = schema.safeParse(await request.json().catch(() => ({})));
  if (!body.success)
    return Response.json(
      {
        error: "invalid_body",
        reason: "Send a JSON body with 1 to 1000 incident ids.",
      },
      { status: 400 },
    );
  const batchId = crypto.randomUUID();
  const incidentIds = await withStore(tenantId, async (store) => {
    const accepted: string[] = [];
    for (const incidentId of body.data.incident_ids) {
      if ((await store.incidentTenant(incidentId)) !== tenantId) continue;
      await store.setProgress(incidentId, "gather", "pending", {
        trigger: "operator_batch",
        batch_id: batchId,
      });
      accepted.push(incidentId);
    }
    await store.audit("batch_started", {
      tenant_id: tenantId,
      actor,
      proposed_action: "batch_process",
      approval_state: "not_required",
      attempt_result: "started",
      details: { batch_id: batchId, incident_ids: accepted },
    });
    return accepted;
  });
  if (!incidentIds.length)
    return Response.json({ error: "no_accessible_incidents" }, { status: 404 });
  if (process.env.REDIS_URL) {
    const queues = createQueues();
    try {
      await addBatchJob(queues, batchId, incidentIds);
      await Promise.all(
        incidentIds.map((incidentId) =>
          addIncidentJob(queues, incidentId, { batchId }),
        ),
      );
    } finally {
      await queues.close();
    }
  }
  return Response.json(
    {
      batch_id: batchId,
      tenant_id: tenantId,
      total: incidentIds.length,
      processed: 0,
      pending: incidentIds.length,
      failed: 0,
      escalated: 0,
    },
    { status: 202 },
  );
}
