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
    // Escalation is terminal, and so is reconciliation. Both states are read
    // from the same progress rows the incident page uses to derive status, so
    // the guard and the page can never disagree about what is finished. A
    // rejected attempt records nothing: no audit row, no progress row.
    const progress = await store.progress(id);
    if (
      progress.some(
        (row) => row.step === "escalate" && row.status === "completed",
      )
    )
      return { blocked: "already_escalated" as const };
    if (
      progress.some((row) => row.step === "close" && row.status === "completed")
    )
      return { blocked: "already_reconciled" as const };
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
  if (!result) return Response.json({ error: "not_found" }, { status: 404 });
  if ("blocked" in result)
    return Response.json(
      {
        error: result.blocked,
        reason:
          result.blocked === "already_escalated"
            ? "This exception is already escalated with its stopping reason."
            : "This exception is already reconciled; there is nothing left to escalate.",
      },
      { status: 409 },
    );
  return Response.json(result);
}
