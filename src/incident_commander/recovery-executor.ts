import { createHash } from "node:crypto";
import {
  PolicyGateDecisionSchema,
  RecoveryOutcomeSchema,
  type PaymentState,
  type PolicyGateDecision,
  type RecoveryOutcome,
} from "../domain/schemas";
import type { MerchantPlatformAdapter } from "../db/merchant-platform-adapter";
import type { IncidentRepository } from "../db/repository";

export type RecoveryExecutionContext = {
  tenantId: string;
  incidentId: string;
  paymentId: string;
  orderId: string;
  beforeState: PaymentState;
  targetState: "paid";
};

export function recoveryExecutionKey(
  decision: PolicyGateDecision,
  context: RecoveryExecutionContext,
) {
  const canonical = JSON.stringify({
    action: decision.action,
    incident_id: context.incidentId,
    order_id: context.orderId,
    payment_id: context.paymentId,
    target_state: context.targetState,
    tenant_id: context.tenantId,
  });
  return `recovery:${createHash("sha256").update(canonical).digest("hex")}`;
}

export class RecoveryExecutor {
  constructor(
    private readonly repository: Pick<
      IncidentRepository,
      | "recovery"
      | "completeRecovery"
      | "recoveryAttempt"
      | "startRecoveryAttempt"
      | "completeRecoveryAttempt"
    >,
    private readonly merchant: MerchantPlatformAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(
    decision: PolicyGateDecision,
    context: RecoveryExecutionContext,
  ): Promise<RecoveryOutcome> {
    const parsed = PolicyGateDecisionSchema.parse(decision);
    if (!parsed.allowed)
      throw new Error("recovery execution requires an allowed policy decision");
    if (
      parsed.action !== "reconcile_internal_state" &&
      parsed.action !== "escalate"
    )
      throw new Error(`recovery action ${parsed.action} is not supported`);
    const key = recoveryExecutionKey(parsed, context);
    const prior = await this.repository.recovery(key);
    if (prior)
      return RecoveryOutcomeSchema.parse({
        status: "already_completed",
        action: prior.action,
        idempotency_key: key,
        before_state: prior.before_state,
        after_state: prior.after_state,
        reason: "recovery already completed and durable state agrees",
      });
    const attempt = await this.repository.recoveryAttempt(key);
    if (attempt?.status === "succeeded" || attempt?.status === "failed")
      return this.outcomeFromAttempt(key, parsed, attempt);
    const startedAt = this.now().toISOString();
    const claimed = await this.repository.startRecoveryAttempt({
      execution_key: key,
      action: parsed.action,
      status: "started",
      before_state: context.beforeState,
      started_at: startedAt,
    });
    if (!claimed) {
      const duplicate = await this.repository.recoveryAttempt(key);
      if (duplicate?.status === "succeeded" || duplicate?.status === "failed")
        return this.outcomeFromAttempt(key, parsed, duplicate);
      throw new Error("recovery execution is already in progress");
    }
    if (parsed.action === "escalate") {
      await this.repository.completeRecoveryAttempt(key, {
        status: "succeeded",
        after_state: context.beforeState,
        completed_at: this.now().toISOString(),
      });
      await this.repository.completeRecovery(key, {
        action: parsed.action,
        status: "escalated",
        before_state: context.beforeState,
        after_state: context.beforeState,
        completed_at: this.now().toISOString(),
      });
      return RecoveryOutcomeSchema.parse({
        status: "escalated",
        action: parsed.action,
        idempotency_key: key,
        before_state: context.beforeState,
        after_state: context.beforeState,
        reason: "merchant-state repair requires operator ownership",
        escalation_reason: parsed.reason,
        terminal_owner: "payment-operations",
        policy_version: "deterministic-policy-v1",
        credential_scope: "merchant-state-reconciliation",
      });
    }
    try {
      const result = await this.merchant.updateOrderState(
        context.orderId,
        context.targetState,
        key,
      );
      await this.repository.completeRecoveryAttempt(key, {
        status: "succeeded",
        after_state: context.targetState,
        completed_at: this.now().toISOString(),
      });
      await this.repository.completeRecovery(key, {
        action: parsed.action,
        status: "reconciled",
        before_state: context.beforeState,
        after_state: context.targetState,
        completed_at: this.now().toISOString(),
      });
      return RecoveryOutcomeSchema.parse({
        status: "reconciled",
        action: parsed.action,
        idempotency_key: key,
        before_state: context.beforeState,
        after_state:
          result.observation.state === context.targetState
            ? context.targetState
            : context.beforeState,
        reason: "merchant state updated through the authorized adapter",
      });
    } catch (error) {
      await this.repository.completeRecoveryAttempt(key, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completed_at: this.now().toISOString(),
      });
      throw error;
    }
  }

  private outcomeFromAttempt(
    key: string,
    decision: PolicyGateDecision,
    attempt: NonNullable<
      Awaited<ReturnType<IncidentRepository["recoveryAttempt"]>>
    >,
  ) {
    if (attempt.status === "failed")
      throw new Error(attempt.error ?? "recovery attempt failed");
    return RecoveryOutcomeSchema.parse({
      status: decision.action === "escalate" ? "escalated" : "reconciled",
      action: decision.action,
      idempotency_key: key,
      before_state: attempt.before_state,
      after_state: attempt.after_state ?? attempt.before_state,
      reason: "recovery attempt already completed durably",
      ...(decision.action === "escalate"
        ? {
            escalation_reason: decision.reason,
            terminal_owner: "payment-operations",
            policy_version: "deterministic-policy-v1",
            credential_scope: "merchant-state-reconciliation",
          }
        : {}),
    });
  }
}
