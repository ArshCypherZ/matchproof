import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requestContext, listIncidentDtos } from "@/lib/incidents";
import { filterIncidentViews } from "@/lib/incident-query";
import {
  CLASS_FACETS,
  STATUS_FACETS,
  facetQuery,
  normalizeFacet,
} from "@/components/incidents/queue-facets";
import { IncidentPager } from "@/components/incidents/incident-pager";
import { CloseStamp } from "@/components/shared/close-stamp";
import { SourceBadge } from "@/components/shared/source-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMoney } from "@/components/shared/format";
import { LoopRail } from "@/components/workbench/loop-rail";
import { EvidenceTimeline } from "@/components/workbench/evidence-timeline";
import { JudgmentPanel } from "@/components/workbench/judgment-panel";
import { PolicyDecision } from "@/components/workbench/policy-decision";
import { PostRepairStateComparison } from "@/components/workbench/post-repair-state-comparison";
import { IncidentActions } from "@/components/workbench/incident-actions";
import { WorkbenchSections } from "@/components/workbench/workbench-sections";
import { SectionRail } from "@/components/workbench/section-rail";
import { LiveRefresh } from "@/components/shared/live-refresh";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  return { title: `Incident ${(await params).id}` };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const item = params[key];
  return Array.isArray(item) ? item[0] : item;
}

export default async function IncidentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const pageParams = await searchParams;
  const headerList = await headers();
  const { tenantId } = requestContext(headerList);

  // The pager steps through the queue in the same order the operator saw it:
  // same source list, same facets. The record itself comes from that list so
  // the workbench does not fetch the incident a second time.
  const all = await listIncidentDtos(tenantId);
  const incident = all.find((item) => item.incident_id === id);
  if (!incident) notFound();

  const facetParams = new URLSearchParams();
  for (const [key, raw] of Object.entries(pageParams)) {
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (item) facetParams.set(key, item);
  }
  const workingSet = filterIncidentViews(all, {
    status: normalizeFacet(value(pageParams, "status"), STATUS_FACETS),
    class: normalizeFacet(value(pageParams, "class"), CLASS_FACETS),
    q: value(pageParams, "q")?.trim(),
  });
  const currentIndex = workingSet.findIndex((item) => item.incident_id === id);
  const pagerQuery = facetQuery(facetParams);
  const backHref = `/incidents${pagerQuery}`;
  const previousHref =
    currentIndex > 0
      ? `/incidents/${workingSet[currentIndex - 1]!.incident_id}${pagerQuery}`
      : null;
  const nextHref =
    currentIndex >= 0 && currentIndex < workingSet.length - 1
      ? `/incidents/${workingSet[currentIndex + 1]!.incident_id}${pagerQuery}`
      : null;

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
      className="workspace-rail relative reserve-section-rail py-10 sm:py-14"
    >
      <SectionRail />
      <div
        id="workbench-overview"
        className="scroll-mt-24 border-b border-border pb-8 sm:flex sm:items-end sm:justify-between sm:gap-8"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href={backHref}
              className="focus-ring inline-flex items-center gap-1.5 rounded text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Exceptions
            </Link>
            <IncidentPager previousHref={previousHref} nextHref={nextHref} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <StatusBadge status={incident.status} />
            <SourceBadge source={incident.source_kind} />
          </div>
          <h1 className="mt-3 font-display text-4xl font-medium leading-none capitalize sm:text-5xl">
            {incident.incident_class.replaceAll("_", " ")}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="font-data [overflow-wrap:anywhere]">
              {incident.incident_id}
            </span>
            <span className="font-data [overflow-wrap:anywhere]">
              {incident.payment_id}
            </span>
            <span className="font-data">
              {formatMoney(
                incident.payment?.amount_minor,
                incident.payment?.currency,
              )}
            </span>
            <span>Updated {formatDate(incident.updated_at)}</span>
          </div>
        </div>
        <div className="mt-6 flex shrink-0 justify-start sm:mt-0 sm:justify-end">
          <IncidentActions
            incidentId={incident.incident_id}
            canApprove={canApprove}
            targetOrderId={incident.reconciliation.target_order_id}
            targetState={incident.reconciliation.target_state}
            idempotencyKey={incident.idempotency_key}
          />
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <LoopRail
            currentStep={incident.current_step}
            currentStatus={incident.current_step_status}
            terminal={terminal}
          />
        </div>
        <LiveRefresh
          endpoint={`/api/incidents/${incident.incident_id}`}
          label="Exception"
        />
      </div>
      <WorkbenchSections
        evidence={<EvidenceTimeline evidence={incident.evidence} />}
        judgment={<JudgmentPanel incident={incident} />}
        control={
          <div className="space-y-8">
            <div className="grid gap-8">
              <PolicyDecision
                reconciliation={incident.reconciliation}
                idempotencyKey={incident.idempotency_key}
              />
              <PostRepairStateComparison
                reconciliation={incident.reconciliation}
                verified={verified}
              />
            </div>
            <section
              id="workbench-closure"
              className="scroll-mt-24 border-t border-border pt-6"
            >
              <p className="font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground">
                Closure checks
              </p>
              <div className="mt-1 flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold">Closure</h2>
                {incident.status === "reconciled" ? (
                  <CloseStamp label="Closed" />
                ) : incident.status === "escalated" ? (
                  <CloseStamp label="Escalated" tone="ink" />
                ) : null}
              </div>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {incident.status === "reconciled"
                  ? "Merchant state was reconciled and the required checks passed."
                  : incident.status === "escalated"
                    ? "This exception was escalated with its evidence bundle and stopping reason."
                    : "Keep this exception open until the approved action completes and a fresh check confirms both systems agree."}
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
