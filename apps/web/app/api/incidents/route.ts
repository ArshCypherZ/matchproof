import { listIncidentDtos, requestContext } from "../../../lib/incidents";
import {
  filterIncidentViews,
  parseIncidentQuery,
  sortIncidentViews,
} from "../../../lib/incident-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = requestContext(request);
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
  const views = await listIncidentDtos(context.tenantId);
  const filtered = sortIncidentViews(filterIncidentViews(views, query), query);
  const start = (query.page - 1) * query.page_size;
  const summary = { pending: 0, reconciled: 0, escalated: 0, ambiguous: 0 };
  for (const item of filtered) {
    if (item.status in summary)
      summary[item.status as keyof typeof summary] += 1;
  }
  const result = {
    items: filtered.slice(start, start + query.page_size),
    total: filtered.length,
    summary,
    page: query.page,
    page_size: query.page_size,
  };
  return Response.json(result);
}
