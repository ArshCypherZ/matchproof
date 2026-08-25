import fs from "node:fs";
import {
  DiagnosisOutputSchema,
  parseDiagnosisOutput,
  PolicyGateDecisionSchema,
  RecommendationSchema,
  RecoveryOutcomeSchema,
  VerifiedPaymentStateSchema,
  type DiagnosisOutput,
  type PolicyGateDecision,
  type ReconciliationResult,
  type Reconstruction,
  type RecoveryOutcome,
  type IncidentBundle,
} from "../domain/schemas";
import {
  IncidentStore,
  FixtureDiagnosisAdapter,
  LiveDiagnosisAdapter,
  verifyBundle,
  reconstruct,
  evaluateAndAudit,
  reconcile,
} from "./core";
import type { EvidenceGatherer } from "./evidence-gatherer";
import type { PolicyAuditLogger } from "./policy";
import { RecoveryExecutor } from "./recovery-executor";
import type { MerchantPlatformAdapter } from "../db/merchant-platform-adapter";
import {
  AfterstateVerifier,
  RazorpayProviderAfterstateAdapter,
  type AfterstateVerificationResult,
  type ProviderAfterstateAdapter,
} from "./afterstate-verifier";
import {
  ClosedLoopController,
  type ClosedLoopStepDefinition,
} from "./closed-loop-controller";

export type RunIncidentOptions = {
  resetState?: boolean;
  processorSecret?: string;
  diagnosisAdapter?: Pick<
    FixtureDiagnosisAdapter | LiveDiagnosisAdapter,
    "diagnose"
  > & { provider: string; model: string };
  diagnosisMode?: string;
  evidenceGatherer?: Pick<EvidenceGatherer, "gather">;
  merchantPlatformAdapter?: MerchantPlatformAdapter;
  providerAfterstateAdapter?: ProviderAfterstateAdapter;
  tenantId?: string;
  maxIterations?: number;
  mode?: "fixture" | "live";
};

export type IncidentRunResult = {
  bundle: IncidentBundle;
  reconstruction: Reconstruction;
  reconciliation: ReconciliationResult;
  diagnosis: DiagnosisOutput["diagnosis"];
  model_provenance: DiagnosisOutput["provenance"];
  diagnosis_mode: string;
  resumed_from?: string;
  gate_decisions: PolicyGateDecision[];
  outcome: RecoveryOutcome;
  afterstate_verification?: AfterstateVerificationResult;
  payment_state: NonNullable<Awaited<ReturnType<IncidentStore["payment"]>>>;
  audit_records: unknown[];
  state_path: string;
};

const escalationOutcome = (
  action: RecoveryOutcome["action"],
  key: string,
  beforeState: RecoveryOutcome["before_state"],
  reason: string,
  escalationReason: string,
) =>
  RecoveryOutcomeSchema.parse({
    status: "escalated",
    action,
    idempotency_key: key,
    before_state: beforeState,
    after_state: beforeState,
    reason,
    escalation_reason: escalationReason,
    terminal_owner: "payment-operations",
    policy_version: "deterministic-policy-v1",
    credential_scope: "merchant-state-reconciliation",
  });

const escalationDiagnosis = (
  bundle: IncidentBundle,
  reason: string,
): DiagnosisOutput => {
  const evidenceId = bundle.evidence[0]?.evidence_id;
  if (!evidenceId)
    throw new Error(
      "an escalation requires at least one canonical evidence item",
    );
  return DiagnosisOutputSchema.parse({
    diagnosis: {
      hypotheses: [
        {
          rank: 1,
          summary:
            "The closed loop could not produce a verified terminal state.",
          reasoning: reason,
          uncertainty: "Operator review is required before any further action.",
          confidence: 1,
          evidence_ids: [evidenceId],
        },
      ],
      recommendation: {
        action: "escalate",
        reasoning: "Create an accountable exception for payment operations.",
        uncertainty: reason,
        evidence_ids: [evidenceId],
      },
    },
    provenance: {
      provider: "deterministic-controller",
      requested_model: "none",
      returned_model: "none",
      request_id: `controller-escalation:${bundle.incident_id}`,
      strict_schema: true,
    },
  });
};

export async function runIncident(
  fixture: string,
  state: string,
  opts: RunIncidentOptions = {},
): Promise<IncidentRunResult> {
  const raw: unknown = JSON.parse(fs.readFileSync(fixture, "utf8"));
  const secret = opts.processorSecret ?? "test-prototype-secret";
  const initialBundle = verifyBundle(raw, secret);
  if (opts.mode === "live" && !opts.evidenceGatherer)
    throw new Error("live mode requires a provider evidence gatherer");
  const store = new IncidentStore(
    state,
    opts.resetState ?? false,
    secret,
    opts.tenantId ?? "default-merchant",
  );
  await store.initialize();
  await store.ingest(initialBundle);

  let bundle = initialBundle;
  let reconstruction: Reconstruction | undefined;
  let reconciliation: ReconciliationResult | undefined;
  let model: DiagnosisOutput | undefined;
  let recommendation:
    DiagnosisOutput["diagnosis"]["recommendation"] | undefined;
  let gateDecisions: PolicyGateDecision[] = [];
  let decision: PolicyGateDecision | undefined;
  let outcome: RecoveryOutcome | undefined;
  let afterstateVerification: AfterstateVerificationResult | undefined;
  let paymentAfter:
    NonNullable<Awaited<ReturnType<IncidentStore["payment"]>>> | undefined;
  let orderId: string | undefined;
  let executionKey: string | undefined;
  let executionBeforeState: RecoveryOutcome["before_state"] | undefined;
  let controllerFailureReason: string | undefined;

  const savedIncident = async () => {
    const saved = await store.incident(initialBundle.incident_id);
    if (!saved)
      throw new Error(
        `incident ${initialBundle.incident_id} was not persisted`,
      );
    return saved;
  };
  const auditPolicy: PolicyAuditLogger = (event) =>
    store.audit(event.event_type, event.payload).then(() => undefined);

  const steps: ClosedLoopStepDefinition[] = [
    {
      name: "gather",
      failureResponse: () => "retry_safe_read",
      async run({ replay }) {
        bundle = await savedIncident();
        if (!replay) {
          orderId = bundle.evidence.find(
            (entry) => entry.kind === "merchant_order_state",
          )?.payload.order_id;
          const gathered = opts.evidenceGatherer
            ? await opts.evidenceGatherer.gather({
                paymentId: bundle.payment_id,
                ...(orderId ? { orderId } : {}),
                idempotencyKey: bundle.idempotency_key,
              })
            : [];
          const gatheredById = new Map(
            gathered.map((entry) => [entry.evidence_id, entry]),
          );
          bundle = verifyBundle(
            {
              ...bundle,
              evidence: bundle.evidence
                .filter((entry) => !gatheredById.has(entry.evidence_id))
                .concat(gathered),
            },
            secret,
          );
          await store.updateIncident(bundle);
          return {
            status: "completed" as const,
            details: {
              evidence_count: bundle.evidence.length,
              provider_evidence_count: gathered.length,
            },
          };
        }
        return {
          status: "completed" as const,
          details: { evidence_count: bundle.evidence.length, replayed: true },
        };
      },
    },
    {
      name: "reconcile",
      async run() {
        bundle = await savedIncident();
        reconstruction = reconstruct(bundle);
        reconciliation = reconcile(bundle);
        return {
          status: "completed" as const,
          details: { current_state: reconstruction.current_state },
        };
      },
    },
    {
      name: "diagnose",
      async run({ replay, progress }) {
        if (!reconstruction || !reconciliation)
          throw new Error("reconciliation must complete before diagnosis");
        const canonicalIds = new Set(
          reconstruction.timeline.map((entry) => entry.evidence_id),
        );
        model = replay
          ? parseDiagnosisOutput(progress?.details, canonicalIds)
          : parseDiagnosisOutput(
              await (
                opts.diagnosisAdapter ??
                (opts.mode === "live"
                  ? new LiveDiagnosisAdapter()
                  : new FixtureDiagnosisAdapter())
              ).diagnose(bundle, reconstruction, reconciliation),
              canonicalIds,
            );
        recommendation = model.diagnosis.recommendation;
        return {
          status: "completed" as const,
          details: model,
        };
      },
    },
    {
      name: "gate",
      async run({ replay, progress }) {
        if (!model || !reconstruction || !reconciliation)
          throw new Error("diagnosis must complete before policy evaluation");
        if (replay) {
          const details = progress?.details as
            { decisions?: unknown; recommendation?: unknown } | undefined;
          gateDecisions = PolicyGateDecisionSchema.array().parse(
            details?.decisions,
          );
          decision = gateDecisions.at(-1);
          recommendation = RecommendationSchema.parse(details?.recommendation);
          if (!decision) throw new Error("durable policy decision is missing");
          return {
            status: "completed" as const,
            details: progress?.details,
          };
        }
        const payment = await store.payment(bundle.payment_id);
        decision = await evaluateAndAudit(
          model.diagnosis.recommendation,
          bundle,
          reconstruction,
          payment,
          reconciliation,
          auditPolicy,
        );
        gateDecisions = [decision];
        recommendation = model.diagnosis.recommendation;
        if (!decision.allowed) {
          recommendation = {
            action: "escalate",
            reasoning: "Required reconciliation invariants did not hold.",
            uncertainty: decision.reason,
            evidence_ids: model.diagnosis.recommendation.evidence_ids,
          };
          decision = await evaluateAndAudit(
            recommendation,
            bundle,
            reconstruction,
            payment,
            reconciliation,
            auditPolicy,
          );
          gateDecisions.push(decision);
        }
        if (decision.allowed && recommendation.action === "retry_safe_read")
          return {
            status: "completed" as const,
            nextStep: "gather" as const,
            details: {
              decisions: gateDecisions,
              recommendation,
              response: "retry_safe_read",
            },
          };
        return {
          status: "completed" as const,
          details: { decisions: gateDecisions, recommendation },
        };
      },
    },
    {
      name: "execute",
      failureResponse: () => "verify_state",
      async run() {
        if (!decision || !recommendation || !reconstruction)
          throw new Error("policy gate must complete before execution");
        const payment = await store.payment(bundle.payment_id);
        if (!payment)
          throw new Error(`payment ${bundle.payment_id} was not persisted`);
        const key = `${recommendation.action}:${bundle.incident_id}:${bundle.payment_id}:${bundle.idempotency_key}`;
        executionKey = key;
        executionBeforeState = payment.state;
        const existing = await store.recovery(key);
        if (existing && payment.state === existing.after_state)
          outcome = RecoveryOutcomeSchema.parse({
            status: "already_completed",
            action: recommendation.action,
            idempotency_key: key,
            before_state: existing.before_state,
            after_state: existing.after_state,
            reason: "recovery already completed and durable state agrees",
          });
        else if (
          opts.merchantPlatformAdapter &&
          recommendation.action === "reconcile_internal_state"
        ) {
          orderId ??= initialBundle.evidence.find(
            (entry) => entry.kind === "merchant_order_state",
          )?.payload.order_id;
          if (!orderId)
            throw new Error(
              "merchant order evidence is required for adapter recovery",
            );
          outcome = await new RecoveryExecutor(
            store,
            opts.merchantPlatformAdapter,
          ).execute(decision, {
            tenantId: opts.tenantId ?? "default",
            incidentId: bundle.incident_id,
            paymentId: bundle.payment_id,
            orderId,
            beforeState: payment.state,
            targetState: "paid",
          });
          await store.audit("recovery_completed", outcome);
        } else {
          const after =
            recommendation.action === "reconcile_internal_state"
              ? VerifiedPaymentStateSchema.parse(reconstruction.current_state)
              : payment.state;
          if (recommendation.action === "reconcile_internal_state")
            await store.updatePayment(bundle.payment_id, after);
          const status =
            recommendation.action === "escalate" ? "escalated" : "reconciled";
          await store.completeRecovery(key, {
            action: recommendation.action,
            status,
            before_state: payment.state,
            after_state: after,
            completed_at: new Date().toISOString(),
          });
          await store.audit("recovery_completed", {
            status,
            before_state: payment.state,
            after_state: after,
          });
          outcome =
            status === "escalated"
              ? escalationOutcome(
                  recommendation.action,
                  key,
                  payment.state,
                  "merchant-state repair requires operator ownership",
                  decision.reason,
                )
              : RecoveryOutcomeSchema.parse({
                  status: "reconciled",
                  action: recommendation.action,
                  idempotency_key: key,
                  before_state: payment.state,
                  after_state: after,
                  reason:
                    recommendation.action === "no_action_required"
                      ? "deterministic reconciliation proved no action is required"
                      : "durable merchant state reconciled from verified processor evidence",
                });
        }
        return {
          status: "completed" as const,
          details: { action: recommendation.action },
        };
      },
    },
    {
      name: "observe",
      failureResponse: () => "retry_safe_read",
      async run() {
        if (
          !opts.merchantPlatformAdapter ||
          recommendation?.action !== "reconcile_internal_state" ||
          !executionKey
        )
          return {
            status: "completed" as const,
            details: { afterstate_status: "not_required" },
          };
        if (!orderId)
          throw new Error(
            "merchant order evidence is required for afterstate verification",
          );
        const payment = await store.payment(bundle.payment_id);
        if (!payment)
          throw new Error(`payment ${bundle.payment_id} was not persisted`);
        afterstateVerification = await new AfterstateVerifier(
          store,
          opts.providerAfterstateAdapter ??
            new RazorpayProviderAfterstateAdapter(),
          opts.merchantPlatformAdapter,
        ).verify({
          executionKey,
          paymentId: bundle.payment_id,
          orderId,
          amountMinor: payment.amount_minor,
          currency: payment.currency,
        });
        await store.audit("afterstate_observed", afterstateVerification);
        if (afterstateVerification.status === "held")
          return {
            status: "retry" as const,
            response: "retry_safe_read" as const,
            details: { reasons: afterstateVerification.reasons },
          };
        if (!outcome && afterstateVerification.status === "verified") {
          const beforeState = executionBeforeState ?? payment.state;
          outcome = RecoveryOutcomeSchema.parse({
            status: "reconciled",
            action: "reconcile_internal_state",
            idempotency_key: executionKey,
            before_state: beforeState,
            after_state: "paid",
            reason:
              "fresh afterstate verified the merchant repair after execution acknowledgement was lost",
          });
          await store.completeRecovery(executionKey, {
            action: "reconcile_internal_state",
            status: "reconciled",
            before_state: beforeState,
            after_state: "paid",
            completed_at: new Date().toISOString(),
          });
        }
        if (!outcome && afterstateVerification.status === "escalated")
          outcome = escalationOutcome(
            "reconcile_internal_state",
            executionKey,
            executionBeforeState ?? payment.state,
            "fresh afterstate did not satisfy the recovery invariant",
            afterstateVerification.reasons.join("; "),
          );
        return {
          status: "completed" as const,
          details: { afterstate_status: afterstateVerification.status },
        };
      },
    },
    {
      name: "verify",
      async run() {
        if (!outcome)
          throw new Error("execution must complete before verification");
        paymentAfter = await store.payment(bundle.payment_id);
        if (!paymentAfter)
          throw new Error(
            `payment ${bundle.payment_id} disappeared after recovery`,
          );
        const details = {
          payment_state: paymentAfter.state,
          afterstate_status: afterstateVerification?.status ?? "not_required",
        };
        if (
          (outcome.status === "reconciled" ||
            outcome.status === "already_completed") &&
          afterstateVerification &&
          afterstateVerification.status !== "verified"
        )
          outcome = escalationOutcome(
            recommendation?.action ?? "escalate",
            outcome.idempotency_key,
            outcome.before_state,
            afterstateVerification.status === "held"
              ? "fresh afterstate could not be obtained"
              : "fresh afterstate did not satisfy the recovery invariant",
            afterstateVerification.reasons.join("; "),
          );
        const terminal =
          outcome.status === "reconciled" ||
          (outcome.status === "already_completed" &&
            (!opts.merchantPlatformAdapter ||
              afterstateVerification?.status === "verified"))
            ? ("close" as const)
            : ("escalate" as const);
        return {
          status: "terminal" as const,
          terminal,
          details: { ...details, outcome: outcome.status },
        };
      },
    },
  ];

  const controller = new ClosedLoopController(store, {
    ...(opts.maxIterations === undefined
      ? {}
      : { maxIterations: opts.maxIterations }),
    onEscalate: async ({ reason }) => {
      controllerFailureReason = reason;
      const payment = await store.payment(bundle.payment_id);
      if (payment) {
        const key = `escalate:${bundle.incident_id}:${bundle.payment_id}:${bundle.idempotency_key}`;
        outcome = escalationOutcome(
          "escalate",
          key,
          payment.state,
          "closed-loop execution failed safely",
          reason,
        );
        await store.completeRecovery(key, {
          action: "escalate",
          status: "escalated",
          before_state: payment.state,
          after_state: payment.state,
          completed_at: new Date().toISOString(),
        });
        await store.audit("recovery_escalated", outcome);
      }
      return { reason, terminal_owner: "payment-operations" };
    },
  });
  const loop = await controller.run(initialBundle.incident_id, steps);
  const saved = await savedIncident();
  reconstruction ??= reconstruct(saved);
  reconciliation ??= reconcile(saved);
  model ??= escalationDiagnosis(
    saved,
    controllerFailureReason ?? "terminal evidence was not produced",
  );
  if (!outcome) {
    const payment = await store.payment(saved.payment_id);
    if (!payment)
      throw new Error(`payment ${saved.payment_id} was not persisted`);
    const key = `escalate:${saved.incident_id}:${saved.payment_id}:${saved.idempotency_key}`;
    outcome = escalationOutcome(
      "escalate",
      key,
      payment.state,
      "closed-loop execution ended without an outcome",
      "terminal evidence was not produced",
    );
  }
  paymentAfter ??= await store.payment(saved.payment_id);
  if (!paymentAfter)
    throw new Error(`payment ${saved.payment_id} was not persisted`);
  const auditRecords = await store.auditRecords();
  await store.close();
  return {
    bundle: saved,
    reconstruction,
    reconciliation,
    diagnosis: model.diagnosis,
    model_provenance: model.provenance,
    diagnosis_mode: opts.diagnosisMode || opts.mode || "fixture",
    ...(loop.resumedFrom ? { resumed_from: loop.resumedFrom } : {}),
    gate_decisions: gateDecisions,
    outcome,
    ...(afterstateVerification
      ? { afterstate_verification: afterstateVerification }
      : {}),
    payment_state: { ...paymentAfter, state: outcome.after_state },
    audit_records: auditRecords,
    state_path: state,
  };
}

export async function runIncidentBatch(
  incidents: readonly {
    fixture: string;
    state: string;
    options?: RunIncidentOptions;
  }[],
) {
  return ClosedLoopController.runBatch(incidents, (incident) =>
    runIncident(incident.fixture, incident.state, incident.options),
  );
}
