"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const tabs = ["evidence", "judgment", "control"] as const;
type Tab = (typeof tabs)[number];
const tabLabels: Record<Tab, string> = {
  evidence: "Evidence",
  judgment: "Findings",
  control: "Decision",
};

export function WorkbenchSections({
  evidence,
  judgment,
  control,
}: {
  evidence: ReactNode;
  judgment: ReactNode;
  control: ReactNode;
}) {
  const [active, setActive] = useState<Tab>("evidence");
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>());

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const hashTab = tabs.find(
        (tab) => window.location.hash === `#workbench-${tab}`,
      );
      if (!hashTab) return;
      setActive(hashTab);
      // The browser's own hash scroll ran against a panel that was still
      // display:none in the served HTML, so it went nowhere; carry the
      // visitor to the section the link promised (scroll-mt clears the
      // sticky header).
      document
        .getElementById(`workbench-${hashTab}`)
        ?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const selectTab = (tab: Tab) => {
    setActive(tab);
    window.history.replaceState(null, "", `#workbench-${tab}`);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: Tab) => {
    const current = tabs.indexOf(tab);
    const nextIndex =
      event.key === "ArrowRight"
        ? (current + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (current - 1 + tabs.length) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    selectTab(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Exception workbench sections"
        className="mt-6 grid grid-cols-3 border-b border-border md:hidden"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`workbench-${tab}-tab`}
            aria-selected={active === tab}
            aria-controls={`workbench-${tab}`}
            tabIndex={active === tab ? 0 : -1}
            ref={(node) => {
              if (node) tabRefs.current.set(tab, node);
              else tabRefs.current.delete(tab);
            }}
            onClick={() => selectTab(tab)}
            onKeyDown={(event) => handleKeyDown(event, tab)}
            className={`focus-ring px-2 py-3 text-xs font-medium transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] pointer-coarse:min-h-11 ${active === tab ? "bg-surface-subtle text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>
      {/* The tab strip exists below md only, so the panels carry no
          role="tabpanel" — at md and up the referenced tabs are display-none
          and the panels would advertise tab semantics with no tablist. Each
          panel's section heading is its accessible name at every size. */}
      {/* One card cadence everywhere: the three cards separate by the same
          32px gutter in both axes (the columns' own gap), so the grid reads
          as one consistent frame whether a section is dense or nearly empty
          — no card changes anatomy because its data is short or missing. */}
      <div className="mt-5 grid min-w-0 gap-8 md:mt-8 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <div
          id="workbench-evidence"
          className={`${active === "evidence" ? "block" : "hidden"} min-w-0 scroll-mt-24 md:block`}
        >
          {evidence}
        </div>
        <div
          className={`${active === "evidence" ? "hidden" : "grid"} min-w-0 gap-8 md:grid`}
        >
          <div
            id="workbench-judgment"
            className={`${active === "judgment" ? "block" : "hidden"} scroll-mt-24 md:block`}
          >
            {judgment}
          </div>
          <div
            id="workbench-control"
            className={`${active === "control" ? "block" : "hidden"} scroll-mt-24 md:block`}
          >
            {control}
          </div>
        </div>
      </div>
    </>
  );
}
