import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { getIncidentDto } from "@/lib/incidents";
import { SourceBadge } from "@/components/shared/source-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMoney } from "@/components/shared/format";
import { LoopRail } from "@/components/workbench/loop-rail";
import { EvidenceTimeline } from "@/components/workbench/evidence-timeline";
import { JudgmentPanel } from "@/components/workbench/judgment-panel";
import { PolicyDecision } from "@/components/workbench/policy-decision";
import { AfterstateComparison } from "@/components/workbench/afterstate-comparison";
import { IncidentActions } from "@/components/workbench/incident-actions";
import { WorkbenchSections } from "@/components/workbench/workbench-sections";
import { LiveRefresh } from "@/components/shared/live-refresh";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return { title: `Incident ${(await params).id}` };
}

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const incident = await getIncidentDto("default-merchant", id);
  if (!incident) notFound();
  const terminal =
    incident.status === "reconciled" || incident.status === "escalated";
  const canApprove =
    incident.reconciliation.resolution === "reconcile_internal_state" &&
    incident.status === "pending";
  const verified =
    incident.status === "reconciled" &&
    incident.reconciliation.invariant_results.status;
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <Link
            href="/incidents"
            className="focus-ring inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Incidents
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={incident.status} />
            <SourceBadge source={incident.source_kind} />
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight capitalize">
            {incident.incident_class.replaceAll("_", " ")}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="font-data">{incident.incident_id}</span>
            <span className="font-data">{incident.payment_id}</span>
            <span>
              {formatMoney(
                incident.payment?.amount_minor,
                incident.payment?.currency,
              )}
            </span>
            <span>Updated {formatDate(incident.updated_at)}</span>
          </div>
        </div>
        <IncidentActions
          incidentId={incident.incident_id}
          canApprove={canApprove}
          targetOrderId={incident.reconciliation.target_order_id}
          targetState={incident.reconciliation.target_state}
          idempotencyKey={incident.idempotency_key}
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <LoopRail
            currentStep={incident.current_step}
            currentStatus={incident.current_step_status}
            terminal={terminal}
          />
        </div>
        <LiveRefresh
          endpoint={`/api/incidents/${incident.incident_id}`}
          label="Incident"
        />
      </div>
      <WorkbenchSections
        evidence={<EvidenceTimeline evidence={incident.evidence} />}
        judgment={<JudgmentPanel incident={incident} />}
        control={
          <div className="space-y-8">
            <div className="grid gap-8 lg:grid-cols-2">
              <PolicyDecision
                reconciliation={incident.reconciliation}
                idempotencyKey={incident.idempotency_key}
              />
              <AfterstateComparison
                reconciliation={incident.reconciliation}
                verified={verified}
              />
            </div>
            <section className="border-t border-border pt-6">
              <h2 className="text-base font-semibold">Closure</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {incident.status === "reconciled"
                  ? "Merchant state was reconciled and the invariant was verified."
                  : incident.status === "escalated"
                    ? "This incident was escalated with its evidence bundle and stopping reason."
                    : "Closure remains open until the approved action and afterstate are observed."}
              </p>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Provider observation
                  </dt>
                  <dd className="mt-1 font-data text-xs">
                    {incident.reconciliation.provider_state}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Merchant observation
                  </dt>
                  <dd className="mt-1 font-data text-xs">
                    {incident.reconciliation.merchant_state}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Order mapping
                  </dt>
                  <dd className="mt-1 font-data text-xs">
                    {incident.order_id ?? "Not unique"}
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        }
      />
    </main>
  );
}
