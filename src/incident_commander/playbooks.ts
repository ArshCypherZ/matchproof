import {
  DiagnosisOutputSchema,
  type DiagnosisOutput,
  type IncidentBundle,
  type MissingFactCode,
  type ReconciliationResult,
  type Reconstruction,
} from "../domain/schemas";
import { recordMetric } from "../observability";
import type {
  InvestigationDiagnosisAdapter,
  InvestigationTraceEntry,
} from "./agent-investigator";

export type PlaybookReadTool =
  "fetch_payment" | "fetch_order" | "search_events" | "fetch_merchant_order";

/**
 * Tier 0: incident classes whose residual evidence gap has one known
 * rule-based read. `capture_timeout` needs a fresh provider payment fetch
 * to learn the outcome of the timed-out capture; `late_authorized` needs one
 * to learn the current authorization state and the order the payment belongs
 * to. Every other class either resolves by rule from the signed
 * evidence already in the bundle or is a Tier 1 residual.
 */
export const TIER0_READ_PLANS: Readonly<
  Partial<Record<Reconstruction["incident_class"], readonly PlaybookReadTool[]>>
> = {
  capture_timeout: ["fetch_payment"],
  late_authorized: ["fetch_payment"],
};

export const runbookForAction = (
  action:
    | "reconcile_internal_state"
    | "retry_safe_read"
    | "no_action_required"
    | "escalate",
) =>
  action === "reconcile_internal_state"
    ? "merchant_state_reconciliation"
    : action === "retry_safe_read"
      ? "safe_read_retry"
      : action === "no_action_required"
        ? "no_action"
        : "evidence_complete_escalation";

const EXPECTED_FACT: Record<PlaybookReadTool, string> = {
  fetch_payment:
    "The current provider payment status, captured flag, amount, and currency.",
  fetch_order: "The current provider order status and amount paid.",
  search_events: "The provider event delivery records for the payment.",
  fetch_merchant_order: "The durable merchant order state and identity.",
};

const MISSING_FACT: Partial<Record<Reconstruction["incident_class"], string>> =
  {
    capture_timeout: "The provider outcome of the timed-out capture request.",
    webhook_delivery_failure: "The provider webhook delivery outcome.",
    callback_missing_webhook_recovers:
      "The provider order and delivery evidence.",
    settlement_exception: "The provider settlement outcome.",
    paid_missing: "The unique merchant order identity for the payment.",
    one_payment_two_orders:
      "The unique merchant order mapping for the payment.",
  };

/**
 * Narrative fields produced by a Tier 1 cluster investigation and replayed to
 * every member of the same evidence fingerprint.
 */
export type PlaybookAdvisory = {
  hypothesis: string;
  missing_fact: string;
  missing_fact_codes?: readonly MissingFactCode[];
  expected_fact: string;
  rationale: string;
  uncertainty: string;
  confidence: number;
  stopping_condition: string;
  operator_summary: string;
  terminal_owner:
    | "controller"
    | "payment-operations"
    | "merchant-engineering"
    | "provider-support";
};

export type PlaybookDiagnosisOptions = {
  readPlan?: readonly PlaybookReadTool[];
  advisory?: PlaybookAdvisory;
  availableReadTools?: readonly string[];
};

const DEFAULT_READ_TOOLS: readonly string[] = [
  "fetch_payment",
  "fetch_order",
  "search_events",
  "fetch_merchant_order",
];

export const tier0Applies = (
  reconstruction: Reconstruction,
  reconciliation: ReconciliationResult,
) => {
  const orderIdentityEstablished = Boolean(
    reconciliation.target_order_id ??
    reconciliation.provider_order_id ??
    reconciliation.merchant_order_ids[0],
  );
  const ruleBasedClosure =
    reconciliation.rule_based_resolution &&
    (reconciliation.resolution !== "reconcile_internal_state" ||
      orderIdentityEstablished);
  return (
    ruleBasedClosure ||
    TIER0_READ_PLANS[reconstruction.incident_class] !== undefined
  );
};

const canonicalEvidenceIds = (
  reconstruction: Reconstruction,
  reconciliation: ReconciliationResult,
) => {
  const canonical = new Set(
    reconstruction.timeline.map((entry) => entry.evidence_id),
  );
  const evidenceIds = reconciliation.evidence_ids.filter((id) =>
    canonical.has(id),
  );
  const fallback = reconstruction.timeline[0]?.evidence_id;
  if (!evidenceIds.length && fallback) evidenceIds.push(fallback);
  if (!evidenceIds.length)
    throw new Error("playbook diagnosis requires canonical evidence");
  return evidenceIds;
};

const attemptedReads = (history: readonly InvestigationTraceEntry[]) =>
  new Set(
    history.flatMap((entry) =>
      entry.requested_read ? [entry.requested_read.tool] : [],
    ),
  );

/**
 * Tier 0 diagnosis adapter: closes every incident whose class has a known
 * rule-based path without any model call. When constructed with a cluster
 * `readPlan` and `advisory` it replays a Tier 1 cluster investigation for the
 * remaining members of a residual cluster, re-citing member-canonical evidence.
 */
export class PlaybookDiagnosisAdapter implements InvestigationDiagnosisAdapter {
  readonly provider: string;
  readonly model: string;
  private readonly readPlan: readonly PlaybookReadTool[];
  private readonly advisory: PlaybookAdvisory | undefined;
  private readonly availableReadTools: readonly string[];

  constructor(options: PlaybookDiagnosisOptions = {}) {
    this.readPlan = options.readPlan ?? [];
    this.advisory = options.advisory;
    this.availableReadTools = options.availableReadTools ?? DEFAULT_READ_TOOLS;
    this.provider = options.advisory ? "cluster-replay" : "rule-based-playbook";
    this.model = options.advisory ? "cluster-replay-v1" : "tier0-playbook-v1";
  }

  diagnose(
    bundle: IncidentBundle,
    reconstruction: Reconstruction,
    reconciliation: ReconciliationResult,
    history: readonly InvestigationTraceEntry[] = [],
  ): DiagnosisOutput {
    const evidenceIds = canonicalEvidenceIds(reconstruction, reconciliation);
    const advisory = this.advisory;
    // A merchant repair needs a target order. When the bundle does not
    // establish one, the class read plan runs first: the provider payment
    // fetch is what discloses the order linkage.
    const orderIdentityEstablished = Boolean(
      reconciliation.target_order_id ??
      reconciliation.provider_order_id ??
      reconciliation.merchant_order_ids[0],
    );
    const closing =
      reconciliation.rule_based_resolution &&
      reconciliation.resolution !== "escalate" &&
      (reconciliation.resolution !== "reconcile_internal_state" ||
        orderIdentityEstablished);
    const plannedRead = closing
      ? undefined
      : this.nextRead(reconstruction, history);
    const action = closing
      ? reconciliation.resolution === "no_action_required"
        ? "no_action_required"
        : "reconcile_internal_state"
      : plannedRead
        ? "retry_safe_read"
        : "escalate";
    const tool = plannedRead ?? "none";
    const missingFact =
      advisory?.missing_fact ??
      MISSING_FACT[reconstruction.incident_class] ??
      (reconciliation.ambiguity_reasons.join(", ") ||
        "No additional rule-based fact is required.");
    const rationale =
      advisory?.rationale ??
      (closing
        ? reconciliation.resolution
        : action === "escalate"
          ? "No rule-based playbook closes this incident; it is a Tier 1 residual."
          : "The incident class has a known rule-based evidence read.");
    const narrative = {
      hypothesis:
        advisory?.hypothesis ??
        (closing
          ? "Rule-based reconciliation already resolves this incident."
          : `The ${reconstruction.incident_class} evidence gap has a known rule-based read.`),
      missing_fact: missingFact || "No additional fact is required.",
      expected_fact:
        advisory?.expected_fact ??
        (plannedRead ? EXPECTED_FACT[plannedRead] : undefined) ??
        "No additional fact is asserted.",
      rationale,
      uncertainty:
        advisory?.uncertainty ??
        (closing
          ? "Rule-based invariants are complete for this repair."
          : "Escalate when the bounded read does not resolve the residual."),
      confidence: advisory?.confidence ?? 1,
      stopping_condition:
        advisory?.stopping_condition ??
        "Stop when rule-based invariants verify closure or escalation is assigned.",
      operator_summary:
        advisory?.operator_summary ??
        (closing
          ? `Closed by the ${reconstruction.incident_class} rule-based playbook.`
          : `${reconstruction.incident_class} remains a Tier 1 residual.`),
      terminal_owner:
        advisory?.terminal_owner ??
        (action === "escalate" ? "payment-operations" : "controller"),
    };
    if (action !== "escalate" && !advisory)
      recordMetric("tier0_playbook_closures");
    return DiagnosisOutputSchema.parse({
      diagnosis: {
        hypotheses: [
          {
            rank: 1,
            summary: narrative.hypothesis,
            reasoning: narrative.rationale,
            uncertainty: narrative.uncertainty,
            confidence: narrative.confidence,
            evidence_ids: evidenceIds,
          },
        ],
        recommendation: {
          action,
          reasoning: narrative.rationale,
          uncertainty: narrative.uncertainty,
          evidence_ids: evidenceIds,
        },
        investigation: {
          missing_fact: narrative.missing_fact,
          ...(advisory?.missing_fact_codes?.length
            ? { missing_fact_codes: [...advisory.missing_fact_codes] }
            : {}),
          next_safe_read: {
            tool,
            reason:
              tool === "none"
                ? "No additional read-only source is required."
                : narrative.rationale,
            expected_fact: narrative.expected_fact,
            evidence_ids: evidenceIds,
          },
          runbook: {
            name: runbookForAction(action),
            rationale: narrative.rationale,
            stopping_condition: narrative.stopping_condition,
          },
          operator_packet: {
            summary: narrative.operator_summary,
            decision_needed:
              action === "escalate"
                ? "Review the cited exception and assign the next owner."
                : "No discretionary financial decision is requested.",
            terminal_owner: narrative.terminal_owner,
            evidence_ids: evidenceIds,
          },
        },
      },
      provenance: {
        provider: this.provider,
        requested_model: this.model,
        returned_model: this.model,
        request_id: `${this.provider}:${bundle.incident_id}`,
        strict_schema: true,
      },
    });
  }

  private nextRead(
    reconstruction: Reconstruction,
    history: readonly InvestigationTraceEntry[],
  ): PlaybookReadTool | undefined {
    const plan = this.readPlan.length
      ? this.readPlan
      : (TIER0_READ_PLANS[reconstruction.incident_class] ?? []);
    const attempted = attemptedReads(history);
    return plan.find(
      (tool) => !attempted.has(tool) && this.availableReadTools.includes(tool),
    );
  }
}

/**
 * Live-mode default: run the Tier 0 playbook first and delegate only true
 * residuals (no rule-based path for the class) to the model adapter.
 */
export class TieredDiagnosisAdapter implements InvestigationDiagnosisAdapter {
  readonly provider: string;
  readonly model: string;

  constructor(
    private readonly options: {
      model: InvestigationDiagnosisAdapter & {
        provider: string;
        model: string;
      };
    },
  ) {
    this.provider = options.model.provider;
    this.model = options.model.model;
  }

  diagnose(
    bundle: IncidentBundle,
    reconstruction: Reconstruction,
    reconciliation: ReconciliationResult,
    history?: readonly InvestigationTraceEntry[],
  ) {
    if (tier0Applies(reconstruction, reconciliation))
      return new PlaybookDiagnosisAdapter().diagnose(
        bundle,
        reconstruction,
        reconciliation,
        history,
      );
    return this.options.model.diagnose(
      bundle,
      reconstruction,
      reconciliation,
      history,
    );
  }
}
