import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// The queue's table skeleton (PageSkeleton) is the wrong shape for this
// route: this page is a record header, the recovery rail, and a
// two-column card workbench. The operator steps record-to-record with the
// pager keys, so this state is seen constantly — it must preview the
// destination's own frame, not a table that then restructures.

// One card frame at the workbench cadence: tonal surface, header row with
// the one permitted hairline — the same anatomy the loaded cards carry.
function PanelSkeleton({
  titleWidth,
  hintWidth,
  control,
  children,
}: {
  titleWidth: string;
  hintWidth?: string;
  control?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <Skeleton className={`h-4 ${titleWidth}`} />
          {hintWidth ? (
            <Skeleton className={`mt-1.5 h-3 ${hintWidth}`} />
          ) : null}
        </div>
        {control ? <Skeleton className="h-8 w-28 shrink-0" /> : null}
      </div>
      {children}
    </div>
  );
}

export default function Loading() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      aria-busy="true"
      className="workspace-rail py-10 sm:py-14"
    >
      <span role="status" className="sr-only">
        Loading the exception…
      </span>

      {/* The record header: back link, display title, identity line, and
          the always-present refresh/action end. */}
      <div className="border-b border-border pb-8 sm:flex sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-4 h-9 w-72 max-w-full" />
          <Skeleton className="mt-2 h-3.5 w-full max-w-md" />
        </div>
        <div className="mt-6 flex shrink-0 items-center gap-2 sm:mt-0">
          <Skeleton className="size-6 rounded-md" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* The recovery rail: the full-width band between hairlines, one
          placeholder per pipeline step — the same nine the loaded rail
          draws, so the band's shape is the destination's. It clips rather
          than scrolls — a placeholder only has to hold the band's shape.
          Widths are unique so each step keeps its own key across
          hydration. */}
      <div className="mt-8 overflow-hidden border-y border-border py-3">
        <div className="flex items-center gap-6 px-1">
          {[
            "w-14",
            "w-20",
            "w-16",
            "w-24",
            "w-28",
            "w-[3.75rem]",
            "w-[4.25rem]",
            "w-[3.5rem]",
            "w-12",
          ].map((width) => (
            <div key={width} className="flex items-center gap-1.5">
              <Skeleton className="size-5 rounded-full" />
              <Skeleton className={`h-3 ${width}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Below md the workbench is a tab strip plus the active panel; the
          frame matches so the real tabs replace these in place. */}
      <div className="mt-6 grid grid-cols-3 border-b border-border md:hidden">
        {["w-14", "w-16", "w-20"].map((width) => (
          <div key={width} className="flex justify-center py-3.5">
            <Skeleton className={`h-3 ${width}`} />
          </div>
        ))}
      </div>

      {/* The workbench frame itself: evidence left, findings / decision /
          verification right — same grid, same 32px gutter, same card
          count as the loaded page, so the panels drop in without the
          frame reflowing. */}
      <div className="mt-5 grid min-w-0 gap-8 md:mt-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <PanelSkeleton titleWidth="w-20" hintWidth="w-56" control>
          <div className="px-5 pb-5">
            <div className="mt-5 space-y-6">
              {["w-28", "w-20", "w-24", "w-16"].map((width) => (
                <div key={width} className="space-y-2">
                  <Skeleton className={`h-3 ${width}`} />
                  <Skeleton className="h-4 w-full max-w-sm" />
                  <Skeleton className="h-3 w-44" />
                </div>
              ))}
            </div>
          </div>
        </PanelSkeleton>
        <div className="hidden min-w-0 gap-8 md:grid">
          <PanelSkeleton titleWidth="w-28" hintWidth="w-64">
            <div className="divide-y divide-border px-5">
              {["w-32", "w-24"].map((width) => (
                <div key={width} className="py-4">
                  <Skeleton className={`h-4 ${width}`} />
                </div>
              ))}
            </div>
          </PanelSkeleton>
          <PanelSkeleton titleWidth="w-32" hintWidth="w-48">
            <div className="space-y-2 px-5 py-4">
              <Skeleton className="h-4 w-3/4" />
            </div>
            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-16" />
            </div>
          </PanelSkeleton>
          <PanelSkeleton titleWidth="w-28" hintWidth="w-64">
            <div className="divide-y divide-border px-5 py-2">
              {["w-24", "w-32", "w-20"].map((width) => (
                <div key={width} className="py-3">
                  <Skeleton className={`h-4 ${width}`} />
                </div>
              ))}
            </div>
          </PanelSkeleton>
        </div>
      </div>
    </main>
  );
}
