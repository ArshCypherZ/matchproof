"use client";

import { motion, useReducedMotion } from "motion/react";
import { stepLabel } from "@/components/shared/step-labels";

type Scenario = {
  id: string;
  title: string;
  step: string;
  response: string;
  outcome: string;
};

const cardColors = [
  "var(--scenario-1)",
  "var(--scenario-2)",
  "var(--scenario-3)",
  "var(--scenario-4)",
  "var(--scenario-5)",
] as const;

const titleLabels: Record<string, string> = {
  mcp_denial: "Evidence connector denied",
  contradictory_afterstate: "Conflicting verification result",
};

// Eyebrows show the scenario id as a machine label; this one carries a word
// the copy keeps out of the interface, so it reads like its title.
const eyebrowLabels: Record<string, string> = {
  contradictory_afterstate: "conflicting verification",
};

const responseLabels: Record<string, string> = {
  retry_safe_read: "Retry the provider read",
  wait: "Wait and retry",
  switch_evidence_source: "Use another evidence source",
  stop: "Stop the current action",
  verify_state: "Verify the current state",
  escalate: "Escalate for review",
};

function outcomeLabel(scenario: Scenario) {
  if (scenario.id === "provider_timeout")
    return "Retry the read within the retry window, then escalate.";
  if (scenario.id === "reordered_webhook")
    return "Reconstruct the evidence by event time before classification.";
  if (scenario.id === "merchant_ack_loss")
    return "Pause execution and verify the current state without a second update.";
  if (scenario.id === "model_failure")
    return "Use the built-in diagnosis and record the model failure.";
  return scenario.outcome;
}

export function ScenarioGrid({
  scenarios,
}: {
  scenarios: readonly Scenario[];
}) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="mt-8 grid gap-5 sm:gap-6 lg:grid-cols-2">
      {scenarios.map((scenario, index) => {
        return (
          <motion.article
            key={scenario.id}
            className="scenario-card relative flex min-h-[24rem] flex-col overflow-hidden rounded-panel p-6 text-scenario-ink sm:min-h-[32rem] sm:p-8"
            style={{ backgroundColor: cardColors[index % cardColors.length] }}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.24,
              delay: reduceMotion ? 0 : Math.min(index, 8) * 0.04,
              ease: [0.23, 1, 0.32, 1],
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <p className="max-w-[70%] font-data text-2xs uppercase tracking-[0.08em]">
                {eyebrowLabels[scenario.id] ?? scenario.id.replaceAll("_", " ")}
              </p>
              <span className="shrink-0 font-data text-2xs uppercase tracking-[0.08em]">
                {stepLabel(scenario.step)}
              </span>
            </div>
            <h2 className="mt-7 max-w-[18ch] font-display text-[clamp(2rem,4.5vw,2.5rem)] font-medium leading-none text-balance">
              {titleLabels[scenario.id] ?? scenario.title}
            </h2>
            <div className="scenario-card__panel mt-auto rounded-[0.9375rem] border border-scenario-panel-edge bg-scenario-panel p-5 shadow-[var(--scenario-lift)] sm:p-6">
              <p className="font-data text-2xs uppercase tracking-[0.08em] text-scenario-ink-secondary">
                Controller response
              </p>
              <p className="mt-2 text-lg font-semibold leading-6">
                {responseLabels[scenario.response] ??
                  scenario.response.replaceAll("_", " ")}
              </p>
              <p className="mt-4 max-w-[58ch] text-sm leading-6 text-scenario-ink-secondary">
                {outcomeLabel(scenario)}
              </p>
            </div>
          </motion.article>
        );
      })}
    </div>
  );
}
