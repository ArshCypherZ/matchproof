import { requestContext, listIncidentDtos } from "../../../lib/incidents";
import { liveTenantMetrics } from "../../../lib/metrics";
import { syntheticEvaluationMetrics } from "../../../lib/benchmark";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { tenantId } = requestContext(request);
  const [measured, items] = await Promise.all([
    liveTenantMetrics(tenantId),
    listIncidentDtos(tenantId),
  ]);
  // Outcome categories mirror the offline benchmark's counts. Escalated and
  // ambiguous are distinct outcomes — the queue's ledger and badges show them
  // as separate columns — so they are counted separately here too.
  const summary = {
    automatic: 0,
    runbook: 0,
    no_action: 0,
    ambiguous: 0,
    escalated: 0,
  };
  for (const item of items) {
    if (item.status === "escalated") summary.escalated += 1;
    else if (item.status === "ambiguous") summary.ambiguous += 1;
    else if (item.reconciliation.resolution === "reconcile_internal_state")
      summary.runbook += 1;
    else if (item.reconciliation.resolution === "no_action_required")
      summary.no_action += 1;
    else summary.automatic += 1;
  }
  return Response.json({
    evaluation: syntheticEvaluationMetrics,
    generated_at: syntheticEvaluationMetrics.generated_at,
    evaluation_source: syntheticEvaluationMetrics.source,
    operational_source: "Current tenant incident store",
    measured,
    total: items.length,
    ...summary,
  });
}
