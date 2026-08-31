import { z } from "zod";
import { requestContext, withStore } from "../../../../../lib/incidents";

export const dynamic = "force-dynamic";

const actionSchema = z
  .object({ reason: z.string().min(1).max(500).optional() })
  .strict();

// Escalation writes an audit record and a terminal progress step; it changes
// no merchant state. PUT on the incident item URL used to duplicate this
// handler — escalate is a POST-only action.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { tenantId, actor } = requestContext(request);
  const body = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success)
    return Response.json(
      {
        error: "invalid_body",
        reason:
          "Send a JSON body with an optional reason of at most 500 characters.",
      },
      { status: 400 },
    );
  const result = await withStore(tenantId, async (store) => {
    const bundle = await store.incident(id);
    if (!bundle || (await store.incidentTenant(id)) !== tenantId) return null;
    await store.audit("operator_escalate", {
      tenant_id: tenantId,
      actor,
      incident_id: id,
      payment_id: bundle.payment_id,
      action: "escalate",
      approval_state: "escalated",
      reason: body.data.reason ?? "operator action",
    });
    await store.setProgress(id, "escalate", "completed", {
      actor,
      reason: body.data.reason ?? "operator escalation",
    });
    return { incident_id: id, action: "escalate", recorded: true };
  });
  return result
    ? Response.json(result)
    : Response.json({ error: "not_found" }, { status: 404 });
}
