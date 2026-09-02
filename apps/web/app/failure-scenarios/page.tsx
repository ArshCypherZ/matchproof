import type { Metadata } from "next";
import { ScenarioGrid } from "@/components/failure-scenarios/scenario-grid";
import { FAILURE_SCENARIOS } from "../../../../src/incident_commander/failure-scenarios";

export const metadata: Metadata = { title: "Failure scenarios" };

export default function FailureScenariosPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="border-b border-border pb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          Failure scenarios
        </h1>
        {/* Same header voice as every page (h1 3xl semibold, lede sm muted):
            the intro must stay clearly secondary to the h1 so it never
            competes with it, and the step h2s below must read as a level
            under the h1 but above the scenario titles in the grid. */}
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          How the controller responds when payment evidence is incomplete,
          conflicting, or unsafe to act on. Entries are grouped by the step
          where the failure happens, in the order the loop reaches them.
        </p>
      </div>
      <ScenarioGrid scenarios={FAILURE_SCENARIOS} />
    </main>
  );
}
