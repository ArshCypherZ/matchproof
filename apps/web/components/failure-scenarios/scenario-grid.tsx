import { STEP_LABELS, stepLabel } from "@/components/shared/step-labels";

type Scenario = {
  id: string;
  title: string;
  step: string;
  response: string;
  outcome: string;
};

// The step vocabulary in step-labels.ts reads in loop order, so its key order
// is the pipeline order. Groups read in it: failures at the same step sit
// together, in the order the controller's loop actually reaches them. An
// unknown step id sorts last rather than guessing a position.
const LOOP_ORDER = Object.keys(STEP_LABELS);

function loopRank(step: string) {
  const index = LOOP_ORDER.indexOf(step);
  return index === -1 ? LOOP_ORDER.length : index;
}

function groupsByStep(scenarios: readonly Scenario[]) {
  const groups = new Map<string, Scenario[]>();
  for (const scenario of [...scenarios].sort(
    (a, b) => loopRank(a.step) - loopRank(b.step),
  )) {
    const bucket = groups.get(scenario.step);
    if (bucket) bucket.push(scenario);
    else groups.set(scenario.step, [scenario]);
  }
  return [...groups.entries()];
}

export function ScenarioGrid({
  scenarios,
}: {
  scenarios: readonly Scenario[];
}) {
  return (
    <>
      {groupsByStep(scenarios).map(([step, entries], index) => (
        <section
          key={step}
          aria-labelledby={`failure-step-${step}`}
          // Section turns carry the same hairline divider the metrics page
          // uses between its sections; the first group follows the page
          // header's own divider, so it takes only the margin.
          className={
            index === 0 ? "mt-10" : "mt-10 border-t border-border pt-10"
          }
        >
          {/* One step label per group instead of the same words repeated on
              every entry: the step is the grouping key, not per-row data. */}
          <h2
            id={`failure-step-${step}`}
            // Same hash-target clearance main#main-content gets from the
            // sticky header, so a jump to a step group lands clear of it.
            className="scroll-mt-16 text-lg font-semibold"
          >
            {stepLabel(step)}
          </h2>
          <dl className="mt-4 grid gap-x-16 gap-y-6 sm:grid-cols-2">
            {entries.map((scenario) => (
              // The id is an invisible deep-link handle (e.g. an escalation
              // reason can reference /failure-scenarios#reordered-webhook);
              // no visible anchor affordance — the title is not a control.
              <div
                key={scenario.id}
                id={scenario.id}
                className="min-w-0 scroll-mt-16"
              >
                <dt className="text-balance text-sm font-medium">
                  {scenario.title}
                </dt>
                <dd className="mt-1 max-w-prose text-sm leading-6">
                  {scenario.outcome}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}
