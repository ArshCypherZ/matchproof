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
            // Hash-target clearance matches the sticky header's real height
            // (6.75rem on phones where the nav wraps, 4rem from sm up), the
            // same pair main#main-content gets in globals.css.
            className="scroll-mt-27 text-lg font-semibold sm:scroll-mt-16"
          >
            {stepLabel(step)}
          </h2>
          {/* Two columns only from lg: at sm the 4rem gutter leaves each
              column ~35ch, under the 45ch reading floor for the outcome
              sentences. One column below lg keeps every entry at the dd's
              max-w-prose cap; from lg up each column holds ~60ch. */}
          <dl className="mt-4 grid gap-x-16 gap-y-6 lg:grid-cols-2">
            {entries.map((scenario) => (
              // The id is a deep-link handle (e.g. an escalation reason can
              // reference /failure-scenarios#reordered_webhook); tabIndex -1
              // matches main#main-content so hash navigation moves keyboard
              // focus onto the entry, not just the scroll position. No
              // visible anchor affordance — the title is not a control.
              <div
                key={scenario.id}
                id={scenario.id}
                tabIndex={-1}
                className="min-w-0 scroll-mt-27 sm:scroll-mt-16"
              >
                {/* Title and outcome must not read as one voice:
                    the title is the operator's scan target — one step up
                    (base, medium, full ink), the same voice sub-headings
                    elsewhere in the console use — while the outcome sits one
                    step down (sm, regular, muted). The step h2 above stays a
                    step above both (lg, semibold), so the chain
                    page h1 → step → title → outcome is legible by size,
                    weight, and ink alone, no borders or accents needed. */}
                <dt className="text-balance text-base font-medium">
                  {scenario.title}
                </dt>
                <dd className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
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
