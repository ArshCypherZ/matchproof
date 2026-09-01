import type {
  BoundedFailureResponse,
  ClosedLoopStep,
} from "./closed-loop-controller";

// Operator-facing copy: `id`, `step`, and `response` are the machine contract
// (tests and the controller match on them); `title` and `outcome` are the one
// sentence the operator reads on /failure-scenarios, so they name things the
// way the console does — "exception", "provider", "webhook", "read" — and stay
// in third person because the controller is the actor.
export const FAILURE_SCENARIOS = [
  {
    id: "provider_timeout",
    title: "Provider API timeout",
    step: "gather",
    response: "retry_safe_read",
    outcome: "Retries the read up to the retry limit, then escalates.",
  },
  {
    id: "provider_rate_limit",
    title: "Provider rate limit",
    step: "gather",
    response: "wait",
    outcome: "Waits with exponential backoff, then retries the read.",
  },
  {
    id: "mcp_denial",
    title: "Evidence connector denied",
    step: "gather",
    response: "switch_evidence_source",
    outcome:
      "Continues with provider API evidence and records the evidence connector gap.",
  },
  {
    id: "webhook_absence",
    title: "Webhook absence",
    step: "gather",
    response: "switch_evidence_source",
    outcome: "Fetches the payment and order directly from the provider API.",
  },
  {
    id: "duplicate_webhook",
    title: "Duplicate webhook",
    step: "gather",
    response: "stop",
    outcome: "Suppresses the duplicate webhook and continues processing.",
  },
  {
    id: "reordered_webhook",
    title: "Reordered webhook",
    step: "reconcile",
    response: "stop",
    outcome:
      "Rebuilds the evidence in the order the events occurred, then classifies the exception.",
  },
  {
    id: "stale_read",
    title: "Stale provider read",
    step: "gather",
    response: "retry_safe_read",
    outcome:
      "Discards the stale read and fetches a fresh one from the provider.",
  },
  {
    id: "merchant_ack_loss",
    title: "Merchant acknowledgement loss",
    step: "execute",
    response: "verify_state",
    outcome:
      "Pauses execution and re-verifies the current state before making another change.",
  },
  {
    id: "model_failure",
    title: "Model failure",
    step: "diagnose",
    response: "switch_evidence_source",
    outcome:
      "Falls back to the rule-based diagnosis and records the model failure.",
  },
  {
    id: "research_failure",
    title: "Research failure",
    step: "diagnose",
    response: "switch_evidence_source",
    outcome:
      "Continues with the evidence already cited and records the research gap.",
  },
  {
    id: "contradictory_post_repair_state",
    title: "Conflicting verification result",
    step: "verify",
    response: "escalate",
    outcome:
      "Keeps the exception open and escalates the conflicting observations.",
  },
  {
    id: "system_restart",
    title: "System restart",
    step: "gather",
    response: "stop",
    outcome: "Resumes from the last saved completed step.",
  },
] as const satisfies readonly {
  id: string;
  title: string;
  step: ClosedLoopStep;
  response: BoundedFailureResponse;
  outcome: string;
}[];

export type FailureScenarioId = (typeof FAILURE_SCENARIOS)[number]["id"];

export function failureScenario(id: FailureScenarioId) {
  const scenario = FAILURE_SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`unknown failure scenario ${id}`);
  return scenario;
}
