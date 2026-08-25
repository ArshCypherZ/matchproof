import type {
  BoundedFailureResponse,
  ClosedLoopStep,
} from "./closed-loop-controller";

export const FAILURE_SCENARIOS = [
  {
    id: "provider_timeout",
    title: "Provider API timeout",
    step: "gather",
    response: "retry_safe_read",
    outcome: "Retry the read within the bounded loop, then escalate.",
  },
  {
    id: "provider_rate_limit",
    title: "Provider rate limit",
    step: "gather",
    response: "wait",
    outcome: "Wait with exponential backoff, then retry the read.",
  },
  {
    id: "mcp_denial",
    title: "MCP denial",
    step: "gather",
    response: "switch_evidence_source",
    outcome: "Continue with official API evidence and record the MCP gap.",
  },
  {
    id: "webhook_absence",
    title: "Webhook absence",
    step: "gather",
    response: "switch_evidence_source",
    outcome: "Actively fetch the provider payment and order.",
  },
  {
    id: "duplicate_webhook",
    title: "Duplicate webhook",
    step: "gather",
    response: "stop",
    outcome: "Suppress the duplicate inbox event and continue processing.",
  },
  {
    id: "reordered_webhook",
    title: "Reordered webhook",
    step: "reconcile",
    response: "stop",
    outcome: "Reconstruct evidence by occurred_at before classification.",
  },
  {
    id: "stale_read",
    title: "Stale provider read",
    step: "gather",
    response: "retry_safe_read",
    outcome: "Reject the stale observation and obtain a fresh provider read.",
  },
  {
    id: "merchant_ack_loss",
    title: "Merchant acknowledgement loss",
    step: "execute",
    response: "verify_state",
    outcome: "Hold execution and verify afterstate without another write.",
  },
  {
    id: "model_failure",
    title: "Model failure",
    step: "diagnose",
    response: "switch_evidence_source",
    outcome: "Use the deterministic diagnosis and retain failure provenance.",
  },
  {
    id: "research_failure",
    title: "Research failure",
    step: "diagnose",
    response: "switch_evidence_source",
    outcome:
      "Continue with cited available evidence and record the research gap.",
  },
  {
    id: "contradictory_afterstate",
    title: "Contradictory afterstate",
    step: "verify",
    response: "escalate",
    outcome: "Keep closure open and escalate the conflicting observations.",
  },
  {
    id: "system_restart",
    title: "System restart",
    step: "gather",
    response: "stop",
    outcome: "Resume after the latest durable completed progress step.",
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
