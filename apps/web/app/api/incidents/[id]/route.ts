import { z } from "zod";
import {
  requestContext,
  withStore,
  incidentDto,
} from "../../../../lib/incidents";
import { executeApprovedRecovery } from "../../../../../../src/incident_commander/approved-recovery";
import { sharedDatabase } from "../../../../../../src/db/client";
import { PostgresMerchantPlatformAdapter } from "../../../../../../src/db/postgres-merchant-platform-adapter";
import { RazorpayProviderPostRepairStateAdapter } from "../../../../../../src/incident_commander/post-repair-state-verifier";

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

// Approve executes one bounded merchant repair through the rule-based
// policy gate and records the durable outcome for the incident.
async function approveIncident(
  id: string,
  tenantId: string,
  actor: string,
  reason: string | undefined,
) {
  const result = await withStore(tenantId, async (store) => {
    const bundle = await store.incident(id);
    if (!bundle || (await store.incidentTenant(id)) !== tenantId) return null;
    const connection = sharedDatabase();
    return await executeApprovedRecovery({
      store,
      incidentId: id,
      tenantId,
      actor,
      ...(reason ? { reason } : {}),
      merchant: new PostgresMerchantPlatformAdapter(connection.db),
      provider: new RazorpayProviderPostRepairStateAdapter(),
    });
  });
  if (!result) return Response.json({ error: "not_found" }, { status: 404 });
  switch (result.status) {
    case "not_found":
      return Response.json({ error: "not_found" }, { status: 404 });
    case "nothing_to_approve":
      return Response.json(
        {
          error: "nothing_to_approve",
          reason: result.reason,
          resolution: result.resolution,
          ambiguity_reasons: result.ambiguity_reasons,
        },
        { status: 409 },
      );
    case "blocked":
      return Response.json(
        { error: "blocked", reason: result.reason },
        { status: 409 },
      );
    case "executed":
      return Response.json({
        incident_id: id,
        action: "approve",
        outcome: result.outcome.status,
        post_repair_state: result.post_repair_state.status,
      });
  }
}

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
  return approveIncident(id, tenantId, actor, body.data.reason);
}
