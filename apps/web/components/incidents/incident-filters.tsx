"use client";

import { useEffect, useState } from "react";
import { Download, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CLASS_FACETS, CLASS_LABELS, normalizeFacet } from "./queue-facets";
import { registerQueueSearch } from "./queue-shortcuts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SEARCH_DEBOUNCE_MS = 350;

export function IncidentFilters({ hasRows = true }: { hasRows?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const urlSearch = params.get("q") ?? "";

  // A facet value outside the queue's vocabulary is treated as no filter, so
  // the select never renders blank while the queue silently narrows.
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
            aria-label="Search exception, payment, or order ID"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            type="search"
            autoComplete="off"
            maxLength={120}
            placeholder="Search exception, payment, or order ID"
          />
        </div>
        {/* The j/k hint teaches row movement — with no rows on the page it
            describes a shortcut with nothing to act on. */}
        {hasRows ? (
          <p className="mt-1.5 hidden text-xs text-muted-foreground md:block">
            <span className="inline-flex items-center gap-1.5">
              <kbd className="rounded-md bg-surface-subtle px-1 py-px font-data">
                j
              </kbd>
              <kbd className="rounded-md bg-surface-subtle px-1 py-px font-data">
                k
              </kbd>
            </span>{" "}
            <span>move through rows</span> ·{" "}
            <kbd className="rounded-md bg-surface-subtle px-1 py-px font-data">
              /
            </kbd>{" "}
            <span>search</span> ·{" "}
            <kbd className="rounded-md bg-surface-subtle px-1 py-px font-data">
              Enter
            </kbd>{" "}
            <span>open</span>
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={classValue}
          onValueChange={(value) => update("class", value ?? "all")}
        >
          <SelectTrigger
            aria-label="Filter by exception type"
            className="w-full sm:w-72"
          >
            {/* The trigger renders the operator label, never the raw facet:
                Base UI cannot resolve item text during SSR, so the selected
                value would otherwise show "all" / "paid_missing". */}
            <SelectValue>
              {(value) => {
                const current = String(value ?? "");
                return current === "all"
                  ? "All types"
                  : (CLASS_LABELS[current] ?? current);
              }}
            </SelectValue>
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
