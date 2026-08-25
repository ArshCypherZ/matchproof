import { z } from "zod";
import {
  requestContext,
  withStore,
  incidentDto,
} from "../../../../lib/incidents";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { tenantId } = requestContext(request);
  const result = await withStore(tenantId, async (store) => {
    const bundle = await store.incident(id);
    if (!bundle || (await store.incidentTenant(id)) !== tenantId) return null;
    return incidentDto(
      bundle,
      await store.progress(id),
      await store.payment(bundle.payment_id),
    );
  });
  return result
    ? Response.json(result)
    : Response.json({ error: "not_found" }, { status: 404 });
}

const actionSchema = z
  .object({ reason: z.string().min(1).max(500).optional() })
  .strict();

async function operatorAction(
  request: Request,
  id: string,
  action: "approve" | "escalate",
) {
  const { tenantId, actor } = requestContext(request);
  const body = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success)
    return Response.json(
      { error: "invalid_body", issues: body.error.issues },
      { status: 400 },
    );
  const result = await withStore(tenantId, async (store) => {
    const bundle = await store.incident(id);
    if (!bundle || (await store.incidentTenant(id)) !== tenantId) return null;
    await store.audit(`operator_${action}`, {
      tenant_id: tenantId,
      actor,
      incident_id: id,
      payment_id: bundle.payment_id,
      action,
      approval_state: action === "approve" ? "approved" : "escalated",
      reason: body.data.reason ?? "operator action",
    });
    if (action === "escalate")
      await store.setProgress(id, "escalate", "completed", {
        actor,
        reason: body.data.reason ?? "operator escalation",
      });
    return { incident_id: id, action, recorded: true };
  });
  return result
    ? Response.json(result)
    : Response.json({ error: "not_found" }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return operatorAction(request, id, "approve");
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return operatorAction(request, id, "escalate");
}
