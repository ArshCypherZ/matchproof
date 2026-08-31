"use client";

import { useCallback, useEffect, useState } from "react";

const sections = [
  { id: "workbench-overview", label: "Overview" },
  { id: "workbench-evidence", label: "Evidence" },
  { id: "workbench-judgment", label: "Findings" },
  { id: "workbench-policy", label: "Decision" },
  { id: "workbench-verification", label: "Verification" },
  { id: "workbench-closure", label: "Closure" },
] as const;
type SectionId = (typeof sections)[number]["id"];

export function SectionRail() {
  const [active, setActive] = useState<SectionId>(sections[0].id);
  const [positions, setPositions] = useState<number[]>(() =>
    sections.map((_, index) => (index / (sections.length - 1)) * 100),
  );

  const measure = useCallback((elements: HTMLElement[]) => {
    const firstTop = elements[0].getBoundingClientRect().top + window.scrollY;
    const last = elements.at(-1)!;
    const lastBottom = last.getBoundingClientRect().bottom + window.scrollY;
    const span = Math.max(1, lastBottom - firstTop);
    setPositions(
      elements.map((element, index) => {
        if (index === 0) return 0;
        if (index === elements.length - 1) return 100;
        const bounds = element.getBoundingClientRect();
        const center = bounds.top + window.scrollY + bounds.height / 2;
        return Math.min(100, ((center - firstTop) / span) * 100);
      }),
    );
  }, []);

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;

    let frame = requestAnimationFrame(() => measure(elements));
    const queueMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => measure(elements));
    };
    const resizeObserver = new ResizeObserver(queueMeasure);
    elements.forEach((element) => resizeObserver.observe(element));
    window.addEventListener("resize", queueMeasure);

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (left, right) =>
              Math.abs(left.boundingClientRect.top) -
              Math.abs(right.boundingClientRect.top),
          );
        const next = visible[0]?.target.id;
        const section = sections.find((item) => item.id === next);
        if (section) setActive(section.id);
      },
      { rootMargin: "-18% 0px -66% 0px", threshold: [0, 0.01] },
    );
    elements.forEach((element) => observer.observe(element));

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      observer.disconnect();
      window.removeEventListener("resize", queueMeasure);
    };
  }, [measure]);

  const scrollTo = (id: string) => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document.getElementById(id)?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <nav
      aria-label="Workbench sections"
      className="fixed left-4 top-1/2 z-20 hidden h-[min(58vh,32rem)] min-h-80 w-28 -translate-y-1/2 xl:block"
    >
      <span
        aria-hidden="true"
        className="absolute bottom-0 left-1 top-0 w-px bg-border"
      />
      {sections.map((section, index) => {
        const current = active === section.id;
        return (
          <button
            key={section.id}
            type="button"
            onClick={() => scrollTo(section.id)}
            aria-current={current ? "location" : undefined}
            className="focus-ring group absolute left-0 flex -translate-y-1/2 items-center rounded-sm py-2.5 text-left"
            style={{ top: `${positions[index]}%` }}
          >
            <span
              aria-hidden="true"
              className={`block h-px w-4 origin-left transition-transform duration-150 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${current ? "scale-x-100 bg-primary" : "scale-x-50 bg-foreground group-hover:scale-x-100 group-focus-visible:scale-x-100"}`}
            />
            <span
              className={`ml-2 whitespace-nowrap font-data text-2xs uppercase tracking-[0.08em] transition-[transform,opacity] duration-150 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${current ? "translate-x-0 text-foreground opacity-100" : "-translate-x-1 text-muted-foreground opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"}`}
            >
              {section.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
