import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";
import { requestContext, listIncidentDtos } from "@/lib/incidents";
import { Button } from "@/components/ui/button";
import { IncidentFilters } from "@/components/incidents/incident-filters";
import { IncidentQueue } from "@/components/incidents/incident-table";
import { IncidentSummaryLedger } from "@/components/incidents/incident-summary-ledger";
import { SourceBadge } from "@/components/shared/source-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";
import { ProviderEvidenceBand } from "@/components/incidents/provider-evidence-band";
import { getRazorpayTestModeSummary } from "@/lib/razorpay";

export const metadata: Metadata = { title: "Incidents" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const item = params[key];
  return Array.isArray(item) ? item[0] : item;
}

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const { tenantId } = requestContext(new Request("http://o2.local"));
  const [all, providerSummary] = await Promise.all([
    listIncidentDtos(tenantId),
    getRazorpayTestModeSummary(),
  ]);
  const status = value(params, "status");
  const incidentClass = value(params, "class");
  const search = value(params, "q")?.toLowerCase();
  const filtered = all.filter(
    (item) =>
      (!status || item.status === status) &&
      (!incidentClass || item.incident_class === incidentClass) &&
      (!search ||
        [item.incident_id, item.payment_id, item.order_id ?? ""].some((entry) =>
          entry.toLowerCase().includes(search),
        )),
  );
  const summary = all.reduce<Record<string, number>>((result, item) => {
    result[item.status] = (result[item.status] ?? 0) + 1;
    return result;
  }, {});
  const pageSize = Number(value(params, "page_size") ?? 25);
  const page = Math.max(1, Number(value(params, "page") ?? 1));
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
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3">
            <SourceBadge source="fixture_rehearsal" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Payment and order exceptions requiring verification.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LiveRefresh endpoint="/api/incidents?page_size=100" label="Queue" />
          <Button
            render={<Link href="/incidents" />}
            variant="outline"
            size="icon"
            aria-label="Refresh incidents"
          >
            <RefreshCw aria-hidden="true" />
          </Button>
          <Button render={<Link href="/batches" />} data-icon="inline-end">
            Start batch <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <ProviderEvidenceBand summary={providerSummary} />
      <section aria-label="Incident summary" className="mt-5">
        <IncidentSummaryLedger summary={summary} />
      </section>
      <section className="mt-5 overflow-hidden rounded-lg border border-border bg-surface">
        <IncidentFilters />
        <IncidentQueue items={pageItems} />
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <span>
            {filtered.length} exception{filtered.length === 1 ? "" : "s"} in
            this source
          </span>
          <div className="flex items-center gap-2">
            <Button
              render={<Link href={pageHref(Math.max(1, currentPage - 1))} />}
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
            >
              Previous
            </Button>
            <span>
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
        </div>
      </section>
    </main>
  );
}
