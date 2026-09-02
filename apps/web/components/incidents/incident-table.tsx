"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CLASS_LABELS, facetQuery } from "./queue-facets";
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
  return (
    CLASS_LABELS[value] ??
    value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase())
  );
}

// Step statuses arrive from the pipeline as "completed", "running:3",
// "retrying:2", "failed:1", "blocked", or "pending". The iteration count
// matters to the operator, so it stays; the prefix becomes a word.
function stepStatusLabel(value: string) {
  const [word, iteration] = value.split(":");
  const noun =
    {
      completed: "complete",
      running: "running",
      retrying: "retrying",
      failed: "failed",
      blocked: "blocked",
      pending: "waiting",
    }[word] ?? word.replaceAll("_", " ");
  return iteration ? `${noun} · attempt ${iteration}` : noun;
}

export function IncidentQueue({
  items,
  showSource = false,
}: {
  items: IncidentItem[];
  showSource?: boolean;
}) {
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
  // Selection is global (it survives a live refresh that swaps the page's
  // rows), so the header checkbox must judge the on-page rows only — a
  // stale off-page id must not light the box as fully checked.
  const onPageSelectedCount = items.reduce(
    (count, item) => count + (selected.includes(item.incident_id) ? 1 : 0),
    0,
  );
  const allSelected = items.length > 0 && onPageSelectedCount === items.length;
  const someSelected =
    onPageSelectedCount > 0 && onPageSelectedCount < items.length;
  // The fixed capsule animates out (not just unmounts) when a selection
  // clears: dismissal is a state change the motion system explains. The
  // fade is faster than the entrance, per the motion law. The transition
  // is detected during render (the same pattern the search field sync
  // uses) so no effect sets state synchronously; the effect only times
  // the exit.
  const [closing, setClosing] = useState(false);
  const [previousCount, setPreviousCount] = useState(selected.length);
  if (previousCount !== selected.length) {
    setPreviousCount(selected.length);
    setClosing(previousCount > 0 && selected.length === 0);
  }
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => setClosing(false), 160);
    return () => clearTimeout(timer);
  }, [closing]);
  const capsuleOpen = selected.length > 0 || closing;
  // An empty queue means one of two things: filters hid everything
  // (recoverable) or the queue is genuinely clear (nothing to do).
  const filtersActive = [...params.keys()].some(
    (key) => key !== "page" && key !== "page_size",
  );
  return (
    <>
      {!items.length ? (
        <div className="bg-surface-subtle px-5 py-16 text-center text-sm text-muted-foreground">
          {filtersActive
            ? "No exceptions match these filters. Clear them to see the full queue."
            : "The queue is clear. Nothing needs attention right now."}
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
            showSource={showSource}
            allSelected={allSelected}
            indeterminate={someSelected}
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
            showSource={showSource}
          />
        </>
      )}
      <span className="sr-only" aria-live="polite">
        {selectionAnnouncement}
      </span>
      {capsuleOpen ? (
        <div
          role="region"
          aria-label="Batch selection actions"
          className={`fixed inset-x-4 bottom-4 z-40 mx-auto flex w-[min(calc(100%-2rem),34rem)] items-center justify-between gap-3 rounded-xl bg-surface px-3 py-2 shadow-lg motion-reduce:animate-none [margin-bottom:max(1rem,env(safe-area-inset-bottom))] ${
            closing ? "animate-capsule-fade" : "animate-capsule-pop"
          }`}
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
              aria-label="Clear selected exceptions"
              title="Clear selected exceptions"
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
      {/* The selection capsule is fixed to the viewport bottom; hold
          space for it so it never covers the pagination row. */}
      {capsuleOpen ? <div aria-hidden="true" className="h-24" /> : null}
    </>
  );
}

function IncidentTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  facetSearch,
  showSource,
  allSelected,
  indeterminate,
  registerRowLink,
}: {
  items: IncidentItem[];
  selected: string[];
  onToggle: (incidentId: string) => void;
  onToggleAll: () => void;
  facetSearch: string;
  showSource: boolean;
  allSelected: boolean;
  indeterminate: boolean;
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
                  aria-label={
                    allSelected
                      ? "Deselect all exceptions on this page"
                      : "Select all exceptions on this page"
                  }
                  checked={allSelected}
                  ref={(node) => {
                    if (node) node.indeterminate = indeterminate;
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
              Exception
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
            {showSource ? (
              <th scope="col" className="px-3 py-3 font-medium">
                Source
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.incident_id}
              data-incident-id={item.incident_id}
              className="group/row border-b border-border transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] last:border-0 hover:bg-surface-subtle"
            >
              <td className="px-5 py-3">
                <label className="check-hit">
                  {/* The human label (the exception type) comes first, the
                      raw id second — same order the row itself reads. */}
                  <input
                    type="checkbox"
                    aria-label={`Select ${classLabel(item.incident_class)} ${item.incident_id}`}
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
                    className="block truncate font-medium group-hover/row:underline group-hover/row:underline-offset-4"
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
                  title={item.order_id ?? "No order linked"}
                >
                  {item.order_id ?? "No order linked"}
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
              {showSource ? (
                <td className="px-3 py-3">
                  <SourceBadge source={item.source_kind} />
                </td>
              ) : null}
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
  showSource,
}: {
  items: IncidentItem[];
  selected: string[];
  onToggle: (incidentId: string) => void;
  facetSearch: string;
  showSource: boolean;
}) {
  return (
    <div className="divide-y divide-border md:hidden">
      {items.map((item) => (
        <article
          key={item.incident_id}
          className="px-4 py-4 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] hover:bg-surface-subtle"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="check-hit">
                {/* Same label anatomy as the desktop row: exception type
                    first, raw id second. */}
                <input
                  type="checkbox"
                  aria-label={`Select ${classLabel(item.incident_class)} ${item.incident_id}`}
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
          {/* The id sits inside the link, exactly as the desktop row's title
              cell does: the card's title link then carries a full, unique
              accessible name instead of repeating the bare class label on
              every card. */}
          <Link
            href={`/incidents/${item.incident_id}${facetSearch}`}
            className="focus-ring mt-3 block rounded-md pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:flex-col pointer-coarse:items-start pointer-coarse:justify-center"
          >
            <p className="text-sm font-medium">
              {classLabel(item.incident_class)}
            </p>
            <p className="mt-1 font-data text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {item.incident_id}
            </p>
          </Link>
          <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-3 text-xs">
            <CopyId value={item.payment_id} />
            <span className="font-data">
              {formatMoney(item.payment?.amount_minor, item.payment?.currency)}
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {stepLabel(item.current_step)}
            </span>
            <Link
              href={`/incidents/${item.incident_id}${facetSearch}`}
              aria-label={`Open ${classLabel(item.incident_class)} ${item.incident_id}`}
              className="focus-ring inline-flex items-center gap-1 rounded-md text-foreground underline-offset-4 hover:underline pointer-coarse:min-h-11 pointer-coarse:px-1"
            >
              Open <ChevronRight aria-hidden="true" className="size-3.5" />
            </Link>
          </div>
          {showSource ? (
            <div className="mt-3">
              <SourceBadge source={item.source_kind} />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
