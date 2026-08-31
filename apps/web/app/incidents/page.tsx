import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { requestContext, listIncidentDtos } from "@/lib/incidents";
import { filterIncidentViews } from "@/lib/incident-query";
import { Button } from "@/components/ui/button";
import {
  CLASS_FACETS,
  STATUS_FACETS,
  normalizeFacet,
} from "@/components/incidents/queue-facets";
import { IncidentFilters } from "@/components/incidents/incident-filters";
import { IncidentQueue } from "@/components/incidents/incident-table";
import { IncidentSummaryLedger } from "@/components/incidents/incident-summary-ledger";
import { SourceBadge } from "@/components/shared/source-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import {
  ProviderEvidenceBand,
  ProviderEvidenceBandFallback,
} from "@/components/incidents/provider-evidence-band";
import { toIncidentRow } from "@/lib/incident-projection";

export const metadata: Metadata = { title: "Exceptions" };

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const item = params[key];
  return Array.isArray(item) ? item[0] : item;
}

// Query strings are operator input: clamp to sane bounds so a stray
// page_size=abc never silently empties the queue.
function boundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const headerList = await headers();
  const { tenantId } = requestContext(headerList);
  const rawStatus = value(params, "status");
  const rawClass = value(params, "class");
  const search = value(params, "q")?.trim().toLowerCase();
  const status = normalizeFacet(rawStatus, STATUS_FACETS);
  const incidentClass = normalizeFacet(rawClass, CLASS_FACETS);

  // A facet value outside the queue's vocabulary is a typo, not a filter.
  // Drop it from the URL so a control can never claim a state the queue is
  // not applying.
  if (
    (rawStatus !== undefined && !status) ||
    (rawClass !== undefined && !incidentClass)
  ) {
    const next = new URLSearchParams();
    for (const [key, raw] of Object.entries(params)) {
      if (key === "status" || key === "class") continue;
      const item = Array.isArray(raw) ? raw[0] : raw;
      if (item) next.set(key, item);
    }
    const query = next.toString();
    redirect(query ? `/incidents?${query}` : "/incidents");
  }

  const all = await listIncidentDtos(tenantId);
  const filtered = filterIncidentViews(all, {
    status,
    class: incidentClass,
    q: search,
  });
  // The ledger tallies are scoped to the same view the operator sees:
  // search and class filters apply, only the status facet is released so
  // each cell predicts what clicking it will show.
  const ledgerScope = filterIncidentViews(all, {
    status: undefined,
    class: incidentClass,
    q: search,
  });
  const summary = ledgerScope.reduce<Record<string, number>>((result, item) => {
    result[item.status] = (result[item.status] ?? 0) + 1;
    return result;
  }, {});
  const pageSize = boundedInteger(value(params, "page_size"), 25, 1, 100);
  const page = boundedInteger(value(params, "page"), 1, 1, 10_000);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageItems = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const pageHref = (nextPage: number) => {
    const next = new URLSearchParams();
    for (const [key, raw] of Object.entries(params)) {
      const item = Array.isArray(raw) ? raw[0] : raw;
      if (item) next.set(key, item);
    }
    next.set("page", String(nextPage));
    return `/incidents?${next.toString()}`;
  };
  const statusHrefs = Object.fromEntries(
    STATUS_FACETS.map((nextStatus) => {
      const next = new URLSearchParams();
      for (const [key, raw] of Object.entries(params)) {
        const item = Array.isArray(raw) ? raw[0] : raw;
        if (item && key !== "page" && key !== "status") next.set(key, item);
      }
      next.set("status", nextStatus);
      return [nextStatus, `/incidents?${next.toString()}`];
    }),
  );
  const notchCount = Math.min(pageCount, 20);
  const currentNotch =
    pageCount === 1
      ? 0
      : Math.round(((currentPage - 1) / (pageCount - 1)) * (notchCount - 1));
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-3">
            <SourceBadge source="fixture_rehearsal" />
          </div>
          <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
            <h1 className="font-display text-4xl font-medium leading-none sm:text-5xl">
              Exceptions
            </h1>
            <div className="flex items-baseline gap-2 pb-0.5 font-data">
              <span className="text-[1.65rem] font-medium leading-none tabular-nums">
                {filtered.length}
              </span>
              <span className="text-2xs uppercase tracking-[0.08em] text-muted-foreground">
                {filtered.length === 1 ? "exception" : "exceptions"} shown
              </span>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Payment and order records awaiting verification or escalation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveRefresh endpoint="/api/incidents/fingerprint" label="Queue" />
          <Button
            render={<Link href="/batches" />}
            data-icon="inline-end"
            className="max-sm:w-full max-sm:flex-1"
          >
            Manage batches <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <Suspense fallback={<ProviderEvidenceBandFallback />}>
        <ProviderEvidenceBand />
      </Suspense>
      <section aria-label="Exception summary" className="mt-8">
        <IncidentSummaryLedger
          summary={summary}
          hrefs={statusHrefs}
          activeStatus={status}
        />
      </section>
      <section className="mt-8 overflow-hidden rounded-lg border border-border bg-surface">
        <IncidentFilters />
        <IncidentQueue items={pageItems.map(toIncidentRow)} />
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-end sm:px-5">
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <Button
              render={<Link href={pageHref(Math.max(1, currentPage - 1))} />}
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <span className="order-first text-center font-data sm:order-none">
              Page {currentPage} of {pageCount}
            </span>
            <Button
              render={
                <Link href={pageHref(Math.min(pageCount, currentPage + 1))} />
              }
              variant="outline"
              size="sm"
              disabled={currentPage >= pageCount}
            >
              Next
            </Button>
          </div>
          <span
            aria-hidden="true"
            className="hidden items-center gap-1 overflow-hidden sm:flex sm:max-w-32"
          >
            {Array.from({ length: notchCount }, (_, index) => (
              <span
                key={index}
                className={`h-2 w-px shrink-0 ${index === currentNotch ? "bg-primary" : "bg-border"}`}
              />
            ))}
          </span>
        </div>
      </section>
    </main>
  );
}
