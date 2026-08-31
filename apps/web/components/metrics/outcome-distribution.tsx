"use client";

import { useEffect, useRef } from "react";

type OutcomeItem = {
  label: string;
  value: number;
  className: string;
};

export function OutcomeDistribution({ items }: { items: OutcomeItem[] }) {
  const barRef = useRef<HTMLDivElement>(null);
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
          duration: 500,
          delay: index * 70,
          // Literal form of --ease-out-expo; WAAPI takes no var() here.
          easing: "cubic-bezier(0.23, 1, 0.32, 1)",
          fill: "backwards",
        },
      ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, []);

  return (
    <section aria-labelledby="outcome-heading">
      <div className="flex items-baseline gap-3">
        <span className="font-data text-2xs text-muted-foreground">04</span>
        <h3 id="outcome-heading" className="text-base font-semibold">
          Outcome distribution
        </h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        One benchmark case can appear in more than one outcome category.
      </p>
      <div
        ref={barRef}
        className="mt-5 flex h-4 overflow-hidden rounded-sm bg-surface-subtle"
        aria-hidden="true"
      >
        {items
          .filter((item) => item.value > 0)
          .map((item) => (
            <span
              key={item.label}
              data-outcome-segment
              className={`${item.className} origin-left`}
              style={{ flexGrow: item.value }}
            />
          ))}
      </div>
      <div className="mt-2 grid grid-cols-12 gap-1" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <span
            key={index}
            className={`h-1 border-l border-border ${index % 3 === 0 ? "border-l-foreground" : ""}`}
          />
        ))}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-baseline justify-between gap-4 border-b border-border pb-2"
          >
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className="font-data text-sm font-medium">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
