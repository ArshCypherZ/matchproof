import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { cache } from "react";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { requestContext, listIncidentDtos } from "@/lib/incidents";
import { filterIncidentViews } from "@/lib/incident-query";
import {
  CLASS_FACETS,
  CLASS_LABELS,
  STATUS_FACETS,
  facetQuery,
  normalizeFacet,
} from "@/components/incidents/queue-facets";
import { IncidentPager } from "@/components/incidents/incident-pager";
import { RecordFocus } from "@/components/incidents/record-focus";
import { SourceBadge } from "@/components/shared/source-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate, formatMoney } from "@/components/shared/format";
import { LoopRail } from "@/components/workbench/loop-rail";
import { EvidenceTimeline } from "@/components/workbench/evidence-timeline";
import { JudgmentPanel } from "@/components/workbench/judgment-panel";
import { AdvisoryPanel } from "@/components/workbench/advisory-panel";
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

// One queue read per request: the title and the page share this cached list,
// so generating the tab title does not fetch every record a second time. The
// page needs the list anyway — the pager steps through it.
const loadQueue = cache((tenantId: string) => listIncidentDtos(tenantId));

// The verification card answers "did this record leave the loop proven?" The
// durable answer is the recorded post-repair state status, and the pipeline
// writes it on whichever step carried the closing observation — usually
// verify, but a webhook-driven record can carry it on observe or close
// instead. All three are read, in pipeline order, so a verified record never
// shows "not observed" because its result rode a different step.
function recordedPostRepairStatus(
  progress: { step: string; status: string; details?: unknown }[],
): string | undefined {
  for (const step of ["verify", "observe", "close"]) {
    const row = progress.find(
      (item) => item.step === step && item.status === "completed",
    );
    const details =
      row && typeof row.details === "object" && row.details
        ? (row.details as { post_repair_state_status?: unknown })
        : null;
    const status = details?.post_repair_state_status;
    if (typeof status === "string") return status;
  }
  return undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const { tenantId } = requestContext(await headers());
  const incident = (await loadQueue(tenantId)).find(
    (item) => item.incident_id === id,
  );
  // An unknown id still gets a titled tab: the page render below answers
  // with this segment's own not-found, and the tab names what it shows.
  if (!incident) return { title: "Exception not found" };
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
  // same source list, same facets. The list is the cached read the title
  // already used, so the workbench does not fetch the queue a second time.
  const all = await loadQueue(tenantId);
  const incident = all.find((item) => item.incident_id === id);
  // Thrown from the render path, inside this segment's loading boundary, so
  // the segment's own not-found renders — its copy and its rail width —
  // instead of the app-wide record page. The streamed response answers 200
  // with noindex; the API route keeps the hard 404 for programs.
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
  // The operator's own action can drop this record out of the filtered view
  // that brought them here — approve under a "pending" facet and the record
  // is no longer pending. The pager must not vanish at that exact moment:
  // when the facet no longer admits this record, it steps through the
  // unfiltered queue, so the serial loop survives the status change the
  // operator just caused.
  const stepSet = currentIndex >= 0 ? workingSet : all;
  const stepIndex = stepSet.findIndex((item) => item.incident_id === id);
  const previousHref =
    stepIndex > 0
      ? `/incidents/${stepSet[stepIndex - 1]!.incident_id}${pagerQuery}`
      : null;
  const nextHref =
    stepIndex >= 0 && stepIndex < stepSet.length - 1
      ? `/incidents/${stepSet[stepIndex + 1]!.incident_id}${pagerQuery}`
      : null;

  const terminal =
    incident.status === "reconciled" || incident.status === "escalated";
  const canApprove =
    incident.reconciliation.resolution === "reconcile_internal_state" &&
    incident.status === "pending";
  // The verification card answers one question: did this record leave the
  // loop proven? The recorded post-repair status is the durable answer — from
  // whichever closing step carries it. The bundle's own invariants describe
  // the state BEFORE any repair, so they must not answer it — a repaired
  // record still shows its pre-repair mismatch in evidence.
  const verification =
    incident.status === "escalated"
      ? ("escalated" as const)
      : recordedPostRepairStatus(incident.progress) === "verified"
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
      <RecordFocus />
      <div className="border-b border-border pb-8 sm:flex sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
          {/* The header answers "what is this record"; the way to the next
              one belongs at the end of the work, not above the work. */}
          <Link
            href={backHref}
            className="focus-ring inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:px-1.5"
          >
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            Exceptions
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {/* Focus lands here after a pager step (see RecordFocus): the
                whole record changed under the operator, and the heading is
                what a screen reader must announce next. */}
            <h1
              id="record-heading"
              tabIndex={-1}
              className="focus-ring rounded-md font-display text-3xl font-semibold tracking-tight text-balance scroll-mt-24 sm:text-4xl"
            >
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
        judgment={
          <div className="grid gap-8">
            <JudgmentPanel
              incident={incident}
              repaired={incident.status === "reconciled"}
            />
            {/* The advisory card renders only for records the live model
                reviewed; a record that closed on rules alone has nothing
                for it to say. */}
            {incident.advisory ? (
              <AdvisoryPanel advisory={incident.advisory} />
            ) : null}
          </div>
        }
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
      {/* The queue stepper lands after the workbench: it is the way to the
          next record, and the operator reaches for it once this one is
          read. It draws its own hairline divider and stays quiet. */}
      <IncidentPager previousHref={previousHref} nextHref={nextHref} />
    </main>
  );
}
