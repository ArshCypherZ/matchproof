import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { requestContext, listIncidentDtos } from "@/lib/incidents";
import { filterIncidentViews, sortIncidentViews } from "@/lib/incident-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CLASS_FACETS,
  STATUS_FACETS,
  normalizeFacet,
} from "@/components/incidents/queue-facets";
import { IncidentFilters } from "@/components/incidents/incident-filters";
import { IncidentQueue } from "@/components/incidents/incident-table";
import { IncidentSummaryLedger } from "@/components/incidents/incident-summary-ledger";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { CountChip } from "@/components/shared/count-chip";
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
  // Query strings are operator input: a pasted search must not balloon the
  // URL or scan every field against a megabyte of text. Match the input's
  // maxLength so a direct URL can never filter on a longer needle.
  const search = value(params, "q")?.trim().toLowerCase().slice(0, 120);
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
  // The store guarantees no row order, so the queue states its own triage
  // opinion instead: oldest exceptions first — nothing stale can sink below
  // fresh arrivals, and a live refresh never reshuffles the rows. (In
  // sortIncidentViews the age comparator is mirrored: "asc" is oldest-first.)
  const filtered = sortIncidentViews(
    filterIncidentViews(all, {
      status,
      class: incidentClass,
      q: search,
    }),
    { sort: "age", direction: "asc" },
  );
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
  // Provenance: when the whole queue shares one source, a per-row Source
  // column would repeat the same value on every line — the column appears
  // only when sources are mixed.
  const sources = new Set(filtered.map((item) => item.source_kind));
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
  // The ledger is the status facet's only control (the filter row carries no
  // duplicate status select). Clicking the active cell releases the facet back
  // to "all" — a toggle, so a status filter never strands the operator without
  // a one-click way out.
  const statusHrefs = Object.fromEntries(
    STATUS_FACETS.map((nextStatus) => {
      const next = new URLSearchParams();
      for (const [key, raw] of Object.entries(params)) {
        const item = Array.isArray(raw) ? raw[0] : raw;
        if (item && key !== "page" && key !== "status") next.set(key, item);
      }
      if (nextStatus !== status) next.set("status", nextStatus);
      const query = next.toString();
      return [nextStatus, query ? `/incidents?${query}` : "/incidents"];
    }),
  );
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-6 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Exceptions
            </h1>
            {/* Boxed on a tonal surface: a bare number beside the
                h1 reads as a stray figure thrown in the open. The chip makes
                count + noun one unit; its number shares this row's baseline
                because the chip is itself an items-baseline flex line. */}
            <CountChip value={filtered.length}>
              {filtered.length === 1 ? "exception" : "exceptions"}
              {status || incidentClass || search ? " shown" : ""}
            </CountChip>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Payment and order mismatches that need attention.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveRefresh endpoint="/api/incidents/fingerprint" label="Queue" />
          <Button
            render={<Link href="/batches" />}
            variant="outline"
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
      <Card className="mt-6">
        <IncidentFilters hasRows={pageItems.length > 0} />
        <IncidentQueue
          items={pageItems.map(toIncidentRow)}
          showSource={sources.size > 1}
        />
        {pageCount > 1 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex-nowrap sm:justify-end sm:px-5">
            <Button
              render={
                currentPage <= 1 ? undefined : (
                  <Link href={pageHref(Math.max(1, currentPage - 1))} />
                )
              }
              variant="outline"
              size="sm"
              className="grow sm:grow-0"
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <span className="order-last w-full text-center font-data sm:order-none sm:w-auto">
              Page {currentPage} of {pageCount}
            </span>
            <Button
              render={
                currentPage >= pageCount ? undefined : (
                  <Link href={pageHref(Math.min(pageCount, currentPage + 1))} />
                )
              }
              variant="outline"
              size="sm"
              className="grow sm:grow-0"
              disabled={currentPage >= pageCount}
            >
              Next
            </Button>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
