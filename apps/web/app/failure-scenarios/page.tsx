import type { Metadata } from "next";
import { FAILURE_SCENARIOS } from "../../../../src/incident_commander/failure-scenarios";

export const metadata: Metadata = { title: "Failure scenarios" };

export default function FailureScenariosPage() {
  return (
    <main id="main-content" className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="font-data text-xs uppercase tracking-widest text-muted-foreground">
        Bounded recovery rehearsal
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Failure scenarios
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
        Each scenario has an executable test and a fixed response owned by the
        controller. Financial and fulfilment mutations remain outside model
        authority.
      </p>
      <div className="mt-8 overflow-hidden border border-border">
        {FAILURE_SCENARIOS.map((scenario) => (
          <article
            key={scenario.id}
            className="grid gap-3 border-b border-border p-5 last:border-b-0 md:grid-cols-[14rem_8rem_1fr]"
          >
            <div>
              <h2 className="font-medium">{scenario.title}</h2>
              <p className="mt-1 font-data text-xs text-muted-foreground">
                {scenario.id}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Loop step</p>
              <p className="mt-1 font-data text-xs">{scenario.step}</p>
              <p className="mt-2 font-data text-xs text-provider">
                {scenario.response}
              </p>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {scenario.outcome}
            </p>
          </article>
        ))}
      </div>
    </main>
  );
}
