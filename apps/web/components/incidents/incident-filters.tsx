"use client";

import { useEffect, useState } from "react";
import { Download, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CLASS_FACETS, STATUS_FACETS, normalizeFacet } from "./queue-facets";
import { registerQueueSearch } from "./queue-shortcuts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SEARCH_DEBOUNCE_MS = 350;

// Operator-facing labels for the facet vocabularies. The select items are
// generated from the same facet arrays the server validates against, so the
// offered values can never drift from the accepted ones.
const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  reconciled: "Verified",
  escalated: "Escalated",
  ambiguous: "Ambiguous",
};

const CLASS_LABELS: Record<string, string> = {
  paid_pending: "Paid, order pending",
  paid_missing: "Paid, order missing",
  one_payment_two_orders: "One payment, two orders",
  capture_timeout: "Capture timeout",
  callback_missing_webhook_recovers: "Callback missing, webhook recovers",
  webhook_delivery_failure: "Webhook delivery failure",
  late_authorized: "Late authorization",
  settlement_exception: "Settlement exception",
};

export function IncidentFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const urlSearch = params.get("q") ?? "";

  // A facet value outside the queue's vocabulary is treated as no filter, so
  // the select never renders blank while the queue silently narrows.
  const statusValue =
    normalizeFacet(params.get("status") ?? undefined, STATUS_FACETS) ?? "all";
  const classValue =
    normalizeFacet(params.get("class") ?? undefined, CLASS_FACETS) ?? "all";

  // Keep the field in sync when the URL changes (clear filters, back/forward)
  // by adjusting state during render, which avoids cascading updates through
  // an effect.
  const [syncedSearch, setSyncedSearch] = useState(urlSearch);
  if (syncedSearch !== urlSearch) {
    setSyncedSearch(urlSearch);
    setSearch(urlSearch);
  }

  // A keystroke should not be a navigation; wait for a pause before pushing.
  useEffect(() => {
    if (search === urlSearch) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (search) next.set("q", search);
      else next.delete("q");
      next.delete("page");
      router.push(`${pathname}?${next.toString()}`);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, urlSearch, params, pathname, router]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    next.delete("page");
    router.push(`${pathname}?${next.toString()}`);
  };
  const exportParams = new URLSearchParams(params.toString());
  exportParams.delete("page");
  exportParams.delete("page_size");
  const exportQuery = exportParams.toString();
  const exportHref = exportQuery
    ? `/api/incidents/export?${exportQuery}`
    : "/api/incidents/export";
  // Any active filter or search makes "clear" an escape hatch, so it must
  // stay reachable on every viewport — hidden below sm it is a dead end.
  const filtersActive =
    [...params.keys()].some((key) => key !== "page" && key !== "page_size") ||
    search.length > 0;
  return (
    <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={(node) => registerQueueSearch(node)}
            aria-label="Search incident, payment, or order ID"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
            placeholder="Search incident, payment, or order ID"
          />
        </div>
        <p className="mt-1.5 hidden font-data text-2xs tracking-[0.08em] text-muted-foreground md:block">
          <kbd className="rounded-sm border border-border bg-surface-subtle px-1 py-px">
            j
          </kbd>{" "}
          <kbd className="rounded-sm border border-border bg-surface-subtle px-1 py-px">
            k
          </kbd>{" "}
          <span className="uppercase">move</span> ·{" "}
          <kbd className="rounded-sm border border-border bg-surface-subtle px-1 py-px">
            /
          </kbd>{" "}
          <span className="uppercase">search</span> ·{" "}
          <kbd className="rounded-sm border border-border bg-surface-subtle px-1 py-px">
            Enter
          </kbd>{" "}
          <span className="uppercase">open</span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Select
          value={statusValue}
          onValueChange={(value) => update("status", value ?? "all")}
        >
          <SelectTrigger
            aria-label="Filter by status"
            className="w-full sm:w-32"
          >
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            {STATUS_FACETS.map((facet) => (
              <SelectItem key={facet} value={facet}>
                {STATUS_LABELS[facet] ?? facet}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={classValue}
          onValueChange={(value) => update("class", value ?? "all")}
        >
          <SelectTrigger
            aria-label="Filter by exception type"
            className="w-full sm:w-60"
          >
            <SelectValue placeholder="Exception type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {CLASS_FACETS.map((facet) => (
              <SelectItem key={facet} value={facet}>
                {CLASS_LABELS[facet] ?? facet}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          data-icon="inline-start"
          render={(props) => (
            <Link
              {...props}
              href={exportHref}
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
            />
          )}
        >
          <Download aria-hidden="true" />
          Export CSV
        </Button>
        {filtersActive ? (
          <Button
            variant="outline"
            onClick={() => router.push(pathname)}
            data-icon="inline-start"
            aria-label="Clear all filters"
            title="Clear all filters"
          >
            <SlidersHorizontal aria-hidden="true" />
            <span className="hidden sm:inline">Clear filters</span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
