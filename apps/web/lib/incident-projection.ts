// Projections applied where incident records cross from the server into a
// client component. A full incident carries its evidence, reconstruction,
// reconciliation, and step history; a queue row needs none of that, and
// shipping it bloats the client payload on every render.
import type { IncidentItem } from "@/components/incidents/incident-table";
import type { BatchIncident } from "@/components/batches/batch-view";
import type { incidentDto } from "./incidents";

type IncidentDto = ReturnType<typeof incidentDto>;

export function toIncidentRow(dto: IncidentDto): IncidentItem {
  return {
    incident_id: dto.incident_id,
    incident_class: dto.incident_class,
    status: dto.status,
    payment_id: dto.payment_id,
    order_id: dto.order_id,
    payment: dto.payment
      ? {
          amount_minor: dto.payment.amount_minor,
          currency: dto.payment.currency,
        }
      : null,
    age_seconds: dto.age_seconds,
    current_step: dto.current_step,
    current_step_status: dto.current_step_status,
    source_kind: dto.source_kind,
    updated_at: dto.updated_at,
  };
}

export function toBatchIncidentRow(dto: IncidentDto): BatchIncident {
  return {
    incident_id: dto.incident_id,
    incident_class: dto.incident_class,
    status: dto.status,
    current_step: dto.current_step,
  };
}
