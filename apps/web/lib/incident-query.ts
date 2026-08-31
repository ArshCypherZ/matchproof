import { z } from "zod";
import type { listIncidentDtos } from "./incidents";

export type IncidentView = Awaited<ReturnType<typeof listIncidentDtos>>[number];

export const incidentQuerySchema = z.object({
  status: z
    .enum(["pending", "reconciled", "escalated", "ambiguous"])
    .optional(),
  class: z.string().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  sort: z.enum(["age", "amount", "updated", "status", "class"]).default("age"),
  direction: z.enum(["asc", "desc"]).default("desc"),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(25),
});

export type IncidentQuery = z.infer<typeof incidentQuerySchema>;

export function parseIncidentQuery(searchParams: URLSearchParams) {
  return incidentQuerySchema.safeParse(
    Object.fromEntries(searchParams.entries()),
  );
}

export function filterIncidentViews(
  views: readonly IncidentView[],
  query: Pick<IncidentQuery, "status" | "class" | "q" | "from" | "to">,
) {
  return views.filter(
    (item) =>
      (!query.status || item.status === query.status) &&
      (!query.class || item.incident_class === query.class) &&
      (!query.q ||
        [item.incident_id, item.payment_id, item.order_id ?? ""].some((value) =>
          value.toLowerCase().includes(query.q!.toLowerCase()),
        )) &&
      (!query.from ||
        item.evidence.some((entry) => entry.received_at >= query.from!)) &&
      (!query.to ||
        item.evidence.some((entry) => entry.received_at <= query.to!)),
  );
}

export function sortIncidentViews(
  views: IncidentView[],
  query: Pick<IncidentQuery, "sort" | "direction">,
) {
  const direction = query.direction === "asc" ? 1 : -1;
  return views.sort((left, right) => {
    if (query.sort === "amount")
      return (
        ((left.payment?.amount_minor ?? 0) -
          (right.payment?.amount_minor ?? 0)) *
        direction
      );
    if (query.sort === "updated")
      return (
        (Date.parse(left.updated_at ?? "") -
          Date.parse(right.updated_at ?? "")) *
        direction
      );
    if (query.sort === "status")
      return left.status.localeCompare(right.status) * direction;
    if (query.sort === "class")
      return (
        left.incident_class.localeCompare(right.incident_class) * direction
      );
    return (right.age_seconds - left.age_seconds) * direction;
  });
}
