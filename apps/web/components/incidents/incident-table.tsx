"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { facetQuery } from "./queue-facets";
import { focusQueueSearch, shortcutsInert } from "./queue-shortcuts";
import { StartBatchButton } from "@/components/batches/start-batch-button";
import { SourceBadge } from "@/components/shared/source-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { CopyId } from "@/components/shared/copy-id";
import { stepLabel } from "@/components/shared/step-labels";
import { formatAge, formatMoney } from "@/components/shared/format";

// The exact fields the queue renders. The server projects each incident
// down to this shape before it crosses into the client payload.
export type IncidentItem = {
  incident_id: string;
  incident_class: string;
  status: string;
  payment_id: string;
  order_id: string | null;
  payment: { amount_minor: number; currency: string } | null;
  age_seconds: number;
  current_step: string;
  current_step_status: string;
  source_kind: string;
  updated_at: string;
};

function classLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

// Step statuses arrive from the pipeline as "completed", "running:3",
// "retrying:2", "failed:1", "blocked", or "pending". The iteration count
// matters to the operator, so it stays; the prefix becomes a word.
function stepStatusLabel(value: string) {
  const [word, iteration] = value.split(":");
  const noun =
    {
      completed: "done",
      running: "running",
      retrying: "retrying",
      failed: "failed",
      blocked: "blocked",
      pending: "waiting",
    }[word] ?? word.replaceAll("_", " ");
  return iteration ? `${noun} · try ${iteration}` : noun;
}

export function IncidentQueue({ items }: { items: IncidentItem[] }) {
  const params = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionAnnouncement, setSelectionAnnouncement] = useState("");
  const selectionTouched = useRef(false);
  const rowLinks = useRef(new Map<string, HTMLAnchorElement>());
  const activeRow = useRef(-1);

  // Keep a record row and its neighbors inside the filtered view the
  // operator is working, so the workbench pager stays on the same set.
  const facetSearch = facetQuery(params);

  // Queue shortcuts: j/k step focus through rows in visual order, / jumps to
  // the search field. A focused row is a real link, so Enter opens it with
  // the browser's own anchor activation — no extra handler to fight.
  useEffect(() => {
    // A new page of rows arrives (pagination or a live refresh); if focus is
    // not already on a row link, row movement starts from the top again.
    activeRow.current = -1;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutsInert(event)) return;
      if (event.key === "/") {
        event.preventDefault();
        focusQueueSearch();
        return;
      }
      const table = document.querySelector<HTMLElement>("[data-queue-table]");
      if (!table || table.getClientRects().length === 0) return;
      const down = event.key === "j";
      const up = event.key === "k";
      if (!down && !up) return;
      // j/k are queue shortcuts; the browser's arrow keys keep scrolling the
      // page, so they stay untouched here.
      event.preventDefault();
      let base = activeRow.current;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        if (active instanceof HTMLAnchorElement) {
          for (const [id, element] of rowLinks.current) {
            if (element === active) {
              const index = items.findIndex((item) => item.incident_id === id);
              if (index >= 0) base = index;
              break;
            }
          }
        } else {
          const row = active.closest("tr[data-incident-id]");
          const rowId =
            row instanceof HTMLElement ? row.dataset.incidentId : undefined;
          if (rowId) {
            const index = items.findIndex((item) => item.incident_id === rowId);
            if (index >= 0) base = index;
          }
        }
      }
      const next = down
        ? Math.min(items.length - 1, base + 1)
        : Math.max(0, base - 1);
      const target = rowLinks.current.get(items[next]?.incident_id ?? "");
      if (target) {
        activeRow.current = next;
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [items]);

  useEffect(() => {
    // The first effect run is the initial render, not an operator action —
    // announcing "Selection cleared" on page load would be noise.
    if (!selectionTouched.current) {
      selectionTouched.current = true;
      return;
    }
    setSelectionAnnouncement(
      selected.length
        ? `${selected.length} ${selected.length === 1 ? "exception" : "exceptions"} selected`
        : "Selection cleared",
    );
  }, [selected.length]);
  const toggle = (incidentId: string) =>
    setSelected((current) =>
      current.includes(incidentId)
        ? current.filter((item) => item !== incidentId)
        : [...current, incidentId],
    );
  const allSelected = items.length > 0 && selected.length === items.length;
  // An empty queue means one of two things: filters hid everything
  // (recoverable) or the queue is genuinely clear (nothing to do).
  const filtersActive = [...params.keys()].some(
    (key) => key !== "page" && key !== "page_size",
  );
  return (
    <>
      {!items.length ? (
        <div className="px-5 py-16 text-center text-sm text-muted-foreground">
          {filtersActive
            ? "No exceptions match these filters. Clear them to see the full queue."
            : "The queue is clear. Every exception is verified or escalated."}
        </div>
      ) : (
        <>
          <IncidentTable
            items={items}
            selected={selected}
            onToggle={toggle}
            onToggleAll={() =>
              setSelected(
                allSelected ? [] : items.map((item) => item.incident_id),
              )
            }
            facetSearch={facetSearch}
            registerRowLink={(incidentId) => (node) => {
              if (node) rowLinks.current.set(incidentId, node);
              else rowLinks.current.delete(incidentId);
            }}
          />
          <IncidentMobileList
            items={items}
            selected={selected}
            onToggle={toggle}
            facetSearch={facetSearch}
          />
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {selectionAnnouncement}
      </span>
      {selected.length ? (
        <div
          role="region"
          aria-label="Batch selection actions"
          className="animate-capsule-pop fixed inset-x-4 bottom-4 z-40 mx-auto flex w-[min(calc(100%-2rem),34rem)] items-center justify-between gap-3 rounded-full border border-border bg-surface-raised px-3 py-2 motion-reduce:animate-none [margin-bottom:max(1rem,env(safe-area-inset-bottom))]"
        >
          <span className="whitespace-nowrap pl-2 font-data text-xs">
            {selected.length} selected
          </span>
          <div className="flex min-w-0 items-center gap-1.5">
            <StartBatchButton incidentIds={selected} />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelected([])}
              aria-label="Clear selected incidents"
              title="Clear selected incidents"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
      {/* The selection capsule is fixed to the viewport bottom; hold
          space for it so it never covers the pagination row. */}
      {selected.length ? <div aria-hidden="true" className="h-24" /> : null}
    </>
  );
}

function IncidentTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  facetSearch,
  registerRowLink,
}: {
  items: IncidentItem[];
  selected: string[];
  onToggle: (incidentId: string) => void;
  onToggleAll: () => void;
  facetSearch: string;
  registerRowLink: (
    incidentId: string,
  ) => (node: HTMLAnchorElement | null) => void;
}) {
  return (
    <div data-queue-table className="hidden overflow-x-auto md:block">
      <table className="w-full caption-bottom text-sm">
        <caption className="sr-only">Payment and order exception queue</caption>
        <thead className="border-b border-border bg-surface-subtle text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="w-12 px-5 py-3 font-medium">
              <label className="check-hit">
                <input
                  type="checkbox"
                  aria-label="Select all exceptions on this page"
                  checked={items.length > 0 && selected.length === items.length}
                  ref={(node) => {
                    if (node)
                      node.indeterminate =
                        selected.length > 0 && selected.length < items.length;
                  }}
                  onChange={onToggleAll}
                  className="check-target"
                />
              </label>
            </th>
            <th scope="col" className="px-5 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Incident
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Payment
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Age
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Current step
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              Source
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={item.incident_id}
              data-incident-id={item.incident_id}
              style={
                {
                  animationDelay: `${Math.min(index, 10) * 40}ms`,
                } as CSSProperties
              }
              className="animate-enter-rise relative border-b border-border transition-colors before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary before:opacity-0 last:border-0 hover:bg-surface-subtle hover:before:opacity-100 motion-reduce:animate-none"
            >
              <td className="px-5 py-3">
                <label className="check-hit">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.incident_id}`}
                    checked={selected.includes(item.incident_id)}
                    onChange={() => onToggle(item.incident_id)}
                    className="check-target"
                  />
                </label>
              </td>
              <td className="px-5 py-3">
                <StatusBadge status={item.status} />
              </td>
              <td className="max-w-64 px-3 py-3 lg:max-w-80">
                <Link
                  href={`/incidents/${item.incident_id}${facetSearch}`}
                  ref={registerRowLink(item.incident_id)}
                  className="focus-ring block rounded-md"
                >
                  <span
                    className="block truncate font-medium"
                    title={classLabel(item.incident_class)}
                  >
                    {classLabel(item.incident_class)}
                  </span>
                  <span
                    className="mt-1 block truncate font-data text-xs text-muted-foreground"
                    title={item.incident_id}
                  >
                    {item.incident_id}
                  </span>
                </Link>
              </td>
              <td className="max-w-56 px-3 py-3 lg:max-w-72">
                <CopyId value={item.payment_id} />
                <span
                  className="mt-1 block truncate font-data text-xs text-muted-foreground"
                  title={item.order_id ?? "Order not uniquely mapped"}
                >
                  {item.order_id ?? "Order not uniquely mapped"}
                </span>
              </td>
              <td className="px-3 py-3 text-right font-data text-xs">
                {formatMoney(
                  item.payment?.amount_minor,
                  item.payment?.currency,
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-3 font-data text-xs text-muted-foreground">
                {formatAge(item.age_seconds)}
              </td>
              <td className="px-3 py-3">
                <span className="font-medium">
                  {stepLabel(item.current_step)}
                </span>
                <span className="mt-1 block font-data text-xs text-muted-foreground">
                  {stepStatusLabel(item.current_step_status)}
                </span>
              </td>
              <td className="px-3 py-3">
                <SourceBadge source={item.source_kind} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IncidentMobileList({
  items,
  selected,
  onToggle,
  facetSearch,
}: {
  items: IncidentItem[];
  selected: string[];
  onToggle: (incidentId: string) => void;
  facetSearch: string;
}) {
  return (
    <div className="divide-y divide-border md:hidden">
      {items.map((item, index) => (
        <article
          key={item.incident_id}
          style={
            {
              animationDelay: `${Math.min(index, 10) * 40}ms`,
            } as CSSProperties
          }
          className="animate-enter-rise px-4 py-4 hover:bg-surface-subtle motion-reduce:animate-none"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="check-hit">
                <input
                  type="checkbox"
                  aria-label={`Select ${item.incident_id}`}
                  checked={selected.includes(item.incident_id)}
                  onChange={() => onToggle(item.incident_id)}
                  className="check-target"
                />
              </label>
              <StatusBadge status={item.status} />
            </div>
            <span className="font-data text-xs text-muted-foreground">
              {formatAge(item.age_seconds)}
            </span>
          </div>
          <Link
            href={`/incidents/${item.incident_id}${facetSearch}`}
            className="focus-ring mt-3 block rounded"
          >
            <p className="font-medium">{classLabel(item.incident_class)}</p>
          </Link>
          <p className="mt-1 font-data text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {item.incident_id}
          </p>
          <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
            <CopyId value={item.payment_id} />
            <span className="font-data">
              {formatMoney(item.payment?.amount_minor, item.payment?.currency)}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>
              Stage:{" "}
              <span className="font-medium text-foreground">
                {stepLabel(item.current_step)}
              </span>
            </span>
            <Link
              href={`/incidents/${item.incident_id}${facetSearch}`}
              aria-label={`Open ${item.incident_id}`}
              className="focus-ring inline-flex items-center gap-1 rounded-sm text-foreground underline-offset-4 hover:underline"
            >
              Open <ChevronRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
        </article>
      ))}
    </div>
  );
}
