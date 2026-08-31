import { listIncidentDtos, requestContext } from "../../../../lib/incidents";
import {
  filterIncidentViews,
  parseIncidentQuery,
  sortIncidentViews,
} from "../../../../lib/incident-query";
import { toCsvRow } from "../../../../../../src/incident_commander/csv";

export const dynamic = "force-dynamic";

const HEADER = [
  "incident_id",
  "payment_id",
  "order_id",
  "incident_class",
  "status",
  "current_step",
  "amount_minor",
  "currency",
  "started_at",
  "updated_at",
  "age_seconds",
  "source_kind",
] as const;

export async function GET(request: Request) {
  const { tenantId } = requestContext(request);
  const parsed = parseIncidentQuery(new URL(request.url).searchParams);
  if (!parsed.success)
    return Response.json(
      {
        error: "invalid_query",
        reason:
          "Filters accept the known status, class, search, and paging values.",
      },
      { status: 400 },
    );
  const query = parsed.data;
  const views = await listIncidentDtos(tenantId);
  const rows = sortIncidentViews(filterIncidentViews(views, query), query);
  const csv =
    toCsvRow(HEADER) +
    rows
      .map((item) =>
        toCsvRow([
          item.incident_id,
          item.payment_id,
          item.order_id,
          item.incident_class,
          item.status,
          item.current_step,
          item.payment?.amount_minor ?? "",
          item.payment?.currency ?? "",
          item.started_at,
          item.updated_at,
          item.age_seconds,
          item.source_kind,
        ]),
      )
      .join("");
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="exceptions-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
