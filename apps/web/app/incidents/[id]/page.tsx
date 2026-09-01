import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import {
  requestContext,
  listIncidentDtos,
  getIncidentDto,
} from "@/lib/incidents";
import { filterIncidentViews } from "@/lib/incident-query";
import {
  CLASS_FACETS,
  CLASS_LABELS,
  STATUS_FACETS,
  facetQuery,
  normalizeFacet,
} from "@/components/incidents/queue-facets";
import { IncidentPager } from "@/components/incidents/incident-pager";
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
import { LiveRefresh } from "@/components/shared/live-refresh";

export const dynamic = "force-dynamic";

// The operator's words for the class, with the raw machine value as the
// fallback — never a guessed label.
function classLabel(value: string) {
  return CLASS_LABELS[value] ?? value.replaceAll("_", " ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { tenantId } = requestContext(await headers());
  const incident = await getIncidentDto(tenantId, id);
  // Called here — before the streaming shell flushes — so an unknown id
  // answers with a real 404 instead of a 200 that streams the not-found UI.
  if (!incident) notFound();
  // The tab title leads with the class label — the operator works several
  // exceptions at once — and keeps the id secondary, as everywhere else.
  return { title: `Exception ${classLabel(incident.incident_class)} · ${id}` };
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
  // The verification card answers one question: did this record leave the
  // loop proven? The verify step's recorded outcome is the durable answer.
  // The bundle's own invariants describe the state BEFORE any repair, so
  // they must not answer it — a repaired record still shows its pre-repair
  // mismatch in evidence.
  const verifyRow = incident.progress.find(
    (row) => row.step === "verify" && row.status === "completed",
  );
  const verifyDetails =
    verifyRow && typeof verifyRow.details === "object" && verifyRow.details
      ? (verifyRow.details as { post_repair_state_status?: unknown })
          .post_repair_state_status
      : undefined;
  const verification =
    incident.status === "escalated"
      ? ("escalated" as const)
      : verifyDetails === "verified"
        ? ("verified" as const)
        : incident.status === "reconciled"
          ? ("closed" as const)
          : ("open" as const);
  // The escalate dialog promises the stopping reason will be readable; show it
  // where the next reader lands — on the exception itself.
  const escalateRow = incident.progress.find(
    (row) => row.step === "escalate" && row.status === "completed",
  );
  const escalateDetail =
    escalateRow &&
    typeof escalateRow.details === "object" &&
    escalateRow.details
      ? (escalateRow.details as { reason?: unknown }).reason
      : undefined;
  const stoppingReason =
    incident.status === "escalated" &&
    typeof escalateDetail === "string" &&
    escalateDetail !== "operator action" &&
    escalateDetail !== "operator escalation"
      ? escalateDetail
      : null;
  return (
    <main id="main-content" className="workspace-rail py-10 sm:py-14">
      <div className="border-b border-border pb-8 sm:flex sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              href={backHref}
              className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:px-1.5"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              Exceptions
            </Link>
            <IncidentPager previousHref={previousHref} nextHref={nextHref} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {classLabel(incident.incident_class)}
            </h1>
            <StatusBadge status={incident.status} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span translate="no" className="font-data [overflow-wrap:anywhere]">
              {incident.incident_id}
            </span>
            <span translate="no" className="font-data [overflow-wrap:anywhere]">
              {incident.payment_id}
            </span>
            <span className="font-data">
              {formatMoney(
                incident.payment?.amount_minor,
                incident.payment?.currency,
              )}
            </span>
            <span>Updated {formatDate(incident.updated_at)}</span>
            <SourceBadge source={incident.source_kind} />
          </div>
          {stoppingReason ? (
            <p className="mt-2 max-w-xl text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">
                Stopping reason
              </span>
              <span aria-hidden="true" className="mx-1.5 text-ink-tertiary">
                ·
              </span>
              {stoppingReason}
            </p>
          ) : null}
        </div>
        <div className="mt-6 flex shrink-0 flex-wrap items-center justify-start gap-2 sm:mt-0 sm:justify-end">
          <LiveRefresh
            endpoint={`/api/incidents/${incident.incident_id}`}
            label="Exception"
            stopOnNotFound
          />
          <IncidentActions
            incidentId={incident.incident_id}
            canApprove={canApprove}
            canEscalate={!terminal}
            targetOrderId={incident.reconciliation.target_order_id}
            targetState={incident.reconciliation.target_state}
            idempotencyKey={incident.idempotency_key}
          />
        </div>
      </div>
      {/* The rail runs the full content width as one band; the pause control
          lives with the actions in the header, per the console's page-header
          pattern. */}
      <div className="mt-8">
        <LoopRail
          currentStep={incident.current_step}
          currentStatus={incident.current_step_status}
          progress={incident.progress}
        />
      </div>
      <WorkbenchSections
        evidence={<EvidenceTimeline evidence={incident.evidence} />}
        judgment={<JudgmentPanel incident={incident} />}
        control={
          <div className="grid gap-8">
            <PolicyDecision
              reconciliation={incident.reconciliation}
              idempotencyKey={incident.idempotency_key}
            />
            <PostRepairStateComparison
              evidence={incident.evidence}
              reconciliation={incident.reconciliation}
              payment={incident.payment}
              verification={verification}
            />
          </div>
        }
      />
    </main>
  );
}
