"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type OutcomeTone = "success" | "provider" | "muted" | "warning";

type OutcomeItem = {
  label: string;
  value: number;
  tone: OutcomeTone;
};

// Built once: benchmark counts can cross a grouping threshold and the list
// formats one number per row.
const countFormat = new Intl.NumberFormat("en-IN");

/* One vocabulary: each outcome maps to a shared semantic token here, so the
   page names a meaning, never a color. The bar is a decorative proportion
   (aria-hidden); the definition list beside it is the readable record. */
const segmentClass: Record<OutcomeTone, string> = {
  success: "bg-success",
  provider: "bg-provider",
  muted: "bg-ink-tertiary",
  warning: "bg-warning",
};

export function OutcomeDistribution({
  items,
  className,
}: {
  items: OutcomeItem[];
  className?: string;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  /* The one authored focal moment of the page: each segment grows in from
     the left, once per mount. The SSR markup already paints the bar full
     size, so nothing is gated behind the motion, and reduced-motion skips
     it entirely. The effect's [] deps mean a LiveRefresh re-render never
     replays it — only a real navigation remounts the bar. */
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (query.matches) return;
    const segments = Array.from(
      barRef.current?.querySelectorAll<HTMLElement>("[data-outcome-segment]") ??
        [],
    );
    const animations = segments.map((segment, index) =>
      segment.animate(
        [
          { opacity: 0.35, transform: "scaleX(0.01)" },
          { opacity: 1, transform: "scaleX(1)" },
        ],
        {
          duration: 420,
          delay: index * 70,
          // Literal form of --motion-ease-emphasized; WAAPI cannot read CSS vars.
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "backwards",
        },
      ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, []);

  return (
    <section
      aria-labelledby="outcome-heading"
      /* Sub-section cadence: h3 groups sit mt-8 under their h2, the same
         step "Closure and safety" uses, so the benchmark's three groups
         read as peers of one section rather than chapters of their own. */
      className={cn("mt-8", className)}
    >
      <h3 id="outcome-heading" className="text-base font-semibold">
        Outcome distribution
      </h3>
      {/* Kept inside this section (advise 21 considered): the overlap is a
         property of these four category counts — the rates above are not
         category sums — so the caveat qualifies the distribution, not the
         KPI strips. */}
      <p className="mt-1 text-xs text-muted-foreground">
        One benchmark case can appear in more than one outcome category.
      </p>
      <div
        className="mt-5 flex h-4 overflow-hidden rounded-md bg-surface-subtle"
        aria-hidden="true"
      >
        {items
          .filter((item) => item.value > 0)
          .map((item) => (
            <span
              key={item.label}
              data-outcome-segment
              className={`${segmentClass[item.tone]} origin-left`}
              style={{ flexGrow: item.value }}
            />
          ))}
      </div>
      {/* Column ladder matches the KPI grids above: one per row on small
          screens (the labels keep their value on one line), two from sm,
          and four at lg so the hairline rows stop stretching across the
          full workspace rail. */}
      <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-baseline justify-between gap-4 border-b border-border pb-2"
          >
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${segmentClass[item.tone]}`}
              />
              {item.label}
            </dt>
            <dd className="font-data text-sm font-medium tabular-nums">
              {countFormat.format(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
