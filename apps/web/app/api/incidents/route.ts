import { z } from "zod";
import { incidentDto, requestContext, withStore } from "../../../lib/incidents";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  status: z
    .enum(["pending", "reconciled", "escalated", "ambiguous"])
    .optional(),
  class: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

export async function GET(request: Request) {
  const context = requestContext(request);
  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success)
    return Response.json(
      { error: "invalid_query", issues: parsed.error.issues },
      { status: 400 },
    );
  const result = await withStore(context.tenantId, async (store) => {
    const bundles = await store.listIncidents(context.tenantId);
    const views = await Promise.all(
      bundles.map(async (bundle) =>
        incidentDto(
          bundle,
          await store.progress(bundle.incident_id),
          await store.payment(bundle.payment_id),
        ),
      ),
    );
    const filtered = views.filter(
      (item) =>
        (!parsed.data.status || item.status === parsed.data.status) &&
        (!parsed.data.class || item.incident_class === parsed.data.class) &&
        (!parsed.data.from ||
          item.evidence.some(
            (entry) => entry.received_at >= parsed.data.from!,
          )) &&
        (!parsed.data.to ||
          item.evidence.some((entry) => entry.received_at <= parsed.data.to!)),
    );
    const start = (parsed.data.page - 1) * parsed.data.page_size;
    const summary = { pending: 0, reconciled: 0, escalated: 0, ambiguous: 0 };
    for (const item of filtered) {
      if (item.status in summary)
        summary[item.status as keyof typeof summary] += 1;
    }
    return {
      items: filtered.slice(start, start + parsed.data.page_size),
      total: filtered.length,
      summary,
      page: parsed.data.page,
      page_size: parsed.data.page_size,
    };
  });
  return Response.json(result);
}
