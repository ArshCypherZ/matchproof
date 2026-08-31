import type { Metadata } from "next";
import { ScenarioGrid } from "@/components/failure-scenarios/scenario-grid";
import { FAILURE_SCENARIOS } from "../../../../src/incident_commander/failure-scenarios";

export const metadata: Metadata = { title: "Failure scenarios" };

export default function FailureScenariosPage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail overflow-hidden py-10 sm:py-14"
    >
      <div className="border-b border-border pb-8">
        <p className="font-data text-xs uppercase tracking-[0.12em] text-muted-foreground">
          Recovery safeguards
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
          Failure scenarios
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
          How the controller responds when payment evidence is incomplete,
          conflicting, or unsafe to act on.
        </p>
      </div>
      <ScenarioGrid scenarios={FAILURE_SCENARIOS} />
    </main>
  );
}
