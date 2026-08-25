"use client";

import { useState, type ReactNode } from "react";

const tabs = ["evidence", "judgment", "control"] as const;
type Tab = (typeof tabs)[number];

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
  return (
    <>
      <div
        role="tablist"
        aria-label="Incident workbench sections"
        className="mt-5 grid grid-cols-3 border-b border-border md:hidden"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active === tab}
            aria-controls={`workbench-${tab}`}
            onClick={() => setActive(tab)}
            className={`focus-ring border-b-2 px-2 py-3 text-xs font-medium capitalize ${active === tab ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <div
          id="workbench-evidence"
          role="tabpanel"
          className={`${active === "evidence" ? "block" : "hidden"} min-w-0 md:block`}
        >
          {evidence}
        </div>
        <div
          className={`${active === "evidence" ? "hidden" : "block"} min-w-0 md:block`}
        >
          <div
            id="workbench-judgment"
            role="tabpanel"
            className={`${active === "judgment" ? "block" : "hidden"} md:block`}
          >
            {judgment}
          </div>
          <div
            id="workbench-control"
            role="tabpanel"
            className={`${active === "control" ? "block" : "hidden"} md:mt-8 md:block md:border-t md:border-border md:pt-8`}
          >
            {control}
          </div>
        </div>
      </div>
    </>
  );
}
