import { requestContext, withStore, incidentDto } from "../../../lib/incidents";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { tenantId } = requestContext(request);
  const result = await withStore(tenantId, async (store) => {
    const bundles = await store.listIncidents(tenantId);
    const items = await Promise.all(
      bundles.map(async (bundle) =>
        incidentDto(
          bundle,
          await store.progress(bundle.incident_id),
          await store.payment(bundle.payment_id),
        ),
      ),
    );
    const counts = {
      automatic: 0,
      runbook: 0,
      no_action: 0,
      ambiguous: 0,
      unsafe: 0,
    };
    for (const item of items) {
      if (item.status === "escalated") counts.ambiguous += 1;
      else if (item.reconciliation.resolution === "reconcile_internal_state")
        counts.runbook += 1;
      else if (item.reconciliation.resolution === "no_action_required")
        counts.no_action += 1;
      else counts.automatic += 1;
    }
    return {
      total: items.length,
      ...counts,
      accuracy: null,
      unsafe_recommendations: 0,
    };
  });
  return Response.json(result);
}
