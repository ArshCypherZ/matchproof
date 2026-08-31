import {
  DiagnosisOutputSchema,
  parseDiagnosisOutput,
  type DiagnosisOutput,
  type IncidentBundle,
  type ReconciliationResult,
  type Reconstruction,
} from "../domain/schemas";
import { z } from "zod";
import type { RazorpayMcpProvenance } from "./razorpay-mcp";
import type { MerchantPlatformAdapter } from "../db/merchant-platform-adapter";

export type InvestigationContext = {
  bundle: IncidentBundle;
  reconstruction: Reconstruction;
  reconciliation: ReconciliationResult;
};

/**
 * Read surface the investigator may call. Tool names are compared as plain
 * strings so the allowlist check stays sound for any gateway implementation.
 */
export type InvestigationReadGateway = {
  tools: readonly string[];
  call(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<RazorpayMcpProvenance>;
};

const InvestigationStopReasonSchema = z.enum([
  "completed",
  "escalated",
  "no_next_read",
  "unsupported_read",
  "invalid_read_input",
  "read_failed",
  "diagnosis_failed",
  "unsafe_recommendation",
  "observation_rejected",
  "step_budget_exhausted",
]);
export type InvestigationStopReason = z.infer<
  typeof InvestigationStopReasonSchema
>;

const RazorpayMcpProvenanceSchema = z.object({
  tool: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  started_at: z.string().min(1),
  completed_at: z.string().min(1),
  result: z.enum(["success", "denied", "timeout", "rate_limited", "error"]),
  output: z.unknown().optional(),
  output_summary: z.string().optional(),
  error: z.string().optional(),
});

export const InvestigationTraceEntrySchema = z.object({
  step: z.number().int().positive(),
  diagnosis: DiagnosisOutputSchema,
  requested_read: z
    .object({
      tool: z.string().min(1),
      input: z.record(z.string(), z.unknown()),
    })
    .optional(),
  observation: RazorpayMcpProvenanceSchema.optional(),
  stop_reason: InvestigationStopReasonSchema.optional(),
});
export type InvestigationTraceEntry = z.infer<
  typeof InvestigationTraceEntrySchema
>;

export const InvestigationAgentStateSchema = z.object({
  version: z.literal(1),
  incident_id: z.string().min(1),
  status: z.enum(["running", "completed"]),
  trace: z.array(InvestigationTraceEntrySchema),
  final_output: DiagnosisOutputSchema.optional(),
  stop_reason: InvestigationStopReasonSchema.optional(),
  updated_at: z.string().min(1),
});
export type InvestigationAgentState = z.infer<
  typeof InvestigationAgentStateSchema
>;

export type InvestigationStateStore = {
  load(incidentId: string): Promise<InvestigationAgentState | undefined>;
  save(state: InvestigationAgentState): Promise<void>;
};

export type InvestigationDiagnosisAdapter = {
  diagnose(
    bundle: IncidentBundle,
    reconstruction: Reconstruction,
    reconciliation: ReconciliationResult,
    history?: readonly InvestigationTraceEntry[],
  ): Promise<DiagnosisOutput> | DiagnosisOutput;
};

export type InvestigationAgentResult = {
  output: DiagnosisOutput;
  trace: InvestigationTraceEntry[];
  stop_reason: InvestigationStopReason;
  resumed: boolean;
  context: InvestigationContext;
};

type ObservationReducer = (
  context: InvestigationContext,
  observation: RazorpayMcpProvenance,
) => Promise<InvestigationContext> | InvestigationContext;

const readInput = (
  tool: string,
  context: InvestigationContext,
): Record<string, unknown> | undefined => {
  if (tool === "fetch_payment")
    return { payment_id: context.bundle.payment_id };
  const orderId =
    context.reconciliation.provider_order_id ??
    context.reconciliation.target_order_id ??
    context.reconciliation.merchant_order_ids[0] ??
    context.bundle.evidence.find(
      (entry) => entry.kind === "merchant_order_state",
    )?.payload.order_id;
  if (tool === "fetch_order")
    return orderId ? { order_id: orderId } : undefined;
  if (tool === "fetch_merchant_order")
    return orderId ? { order_id: orderId } : undefined;
  return {
    payment_id: context.bundle.payment_id,
    ...(orderId ? { order_id: orderId } : {}),
  };
};

const fallbackOutput = (
  context: InvestigationContext,
  reason: string,
): DiagnosisOutput => {
  const evidenceIds = context.reconciliation.evidence_ids.filter((id) =>
    context.reconstruction.timeline.some((entry) => entry.evidence_id === id),
  );
  const fallbackEvidenceId = context.reconstruction.timeline[0]?.evidence_id;
  if (!evidenceIds.length && fallbackEvidenceId)
    evidenceIds.push(fallbackEvidenceId);
  if (!evidenceIds.length)
    throw new Error("investigation fallback requires canonical evidence");
  return DiagnosisOutputSchema.parse({
    diagnosis: {
      hypotheses: [
        {
          rank: 1,
          summary: "The bounded investigation could not verify closure.",
          reasoning: reason,
          uncertainty: "Further action requires accountable operator review.",
          confidence: 1,
          evidence_ids: evidenceIds,
        },
      ],
      recommendation: {
        action: "escalate",
        reasoning:
          "Stop autonomous investigation and preserve the evidence trail.",
        uncertainty: reason,
        evidence_ids: evidenceIds,
      },
      investigation: {
        missing_fact:
          context.reconciliation.ambiguity_reasons.join(", ") || reason,
        next_safe_read: {
          tool: "none",
          reason: "The bounded investigation has stopped.",
          expected_fact: "No uncited fact is asserted.",
          evidence_ids: evidenceIds,
        },
        runbook: {
          name: "evidence_complete_escalation",
          rationale: reason,
          stopping_condition:
            "An operator resolves the cited exception or supplies fresh evidence.",
        },
        operator_packet: {
          summary:
            "The agent stopped without authorizing a financial side effect.",
          decision_needed: reason,
          terminal_owner: "payment-operations",
          evidence_ids: evidenceIds,
        },
      },
    },
    provenance: {
      provider: "rule-based-investigation-fallback",
      requested_model: "none",
      returned_model: "none",
      request_id: `investigation-fallback:${context.bundle.incident_id}`,
      strict_schema: true,
      failure_reason: reason,
    },
  });
};

export class AgentInvestigator {
  private readonly maxSteps: number;
  private readonly now: () => Date;
  private readonly reduceObservation: ObservationReducer;

  constructor(
    private readonly options: {
      diagnosisAdapter: InvestigationDiagnosisAdapter;
      mcpGateway: InvestigationReadGateway;
      merchantOrderReader?: Pick<MerchantPlatformAdapter, "fetchOrderState">;
      stateStore: InvestigationStateStore;
      maxSteps?: number;
      now?: () => Date;
      applyObservation?: ObservationReducer;
    },
  ) {
    this.maxSteps = options.maxSteps ?? 3;
    if (!Number.isSafeInteger(this.maxSteps) || this.maxSteps < 1)
      throw new RangeError("maxSteps must be a positive integer");
    this.now = options.now ?? (() => new Date());
    this.reduceObservation = options.applyObservation ?? ((context) => context);
  }

  async investigate(
    bundle: IncidentBundle,
    reconstruction: Reconstruction,
    reconciliation: ReconciliationResult,
  ): Promise<InvestigationAgentResult> {
    const loaded = await this.options.stateStore.load(bundle.incident_id);
    if (loaded && loaded.incident_id !== bundle.incident_id)
      throw new Error("loaded investigation state belongs to another incident");
    if (loaded?.status === "completed" && loaded.final_output) {
      return {
        output: loaded.final_output,
        trace: loaded.trace,
        stop_reason: loaded.stop_reason ?? "completed",
        resumed: true,
        context: { bundle, reconstruction, reconciliation },
      };
    }

    const resumed = Boolean(loaded);
    const trace = [...(loaded?.trace ?? [])];
    let context = { bundle, reconstruction, reconciliation };
    let observationAdvanced = false;
    for (const entry of trace) {
      if (entry.observation?.result === "success") {
        const nextContext = await this.reduceObservation(
          context,
          entry.observation,
        );
        observationAdvanced ||= nextContext !== context;
        context = nextContext;
      }
    }

    while (trace.length < this.maxSteps) {
      let output: DiagnosisOutput;
      try {
        output = parseDiagnosisOutput(
          await this.options.diagnosisAdapter.diagnose(
            context.bundle,
            context.reconstruction,
            context.reconciliation,
            trace,
          ),
          new Set(
            context.reconstruction.timeline.map((entry) => entry.evidence_id),
          ),
        );
      } catch (error) {
        const reason = `Diagnosis failed: ${error instanceof Error ? error.message : String(error)}`;
        return this.finish(
          context,
          trace,
          fallbackOutput(context, reason),
          "diagnosis_failed",
          resumed,
        );
      }

      const step = trace.length + 1;
      if (!output.diagnosis.investigation) {
        const reason =
          "Diagnosis omitted the required evidence-complete investigation packet";
        trace.push({
          step,
          diagnosis: output,
          stop_reason: "diagnosis_failed",
        });
        return this.finish(
          context,
          trace,
          fallbackOutput(context, reason),
          "diagnosis_failed",
          resumed,
        );
      }
      const nextRead = output.diagnosis.investigation.next_safe_read;
      if (
        ![
          "reconcile_internal_state",
          "retry_safe_read",
          "no_action_required",
          "escalate",
        ].includes(output.diagnosis.recommendation.action)
      ) {
        const reason = `Recommendation ${output.diagnosis.recommendation.action} is outside the advisory action allowlist`;
        trace.push({
          step,
          diagnosis: output,
          stop_reason: "unsafe_recommendation",
        });
        return this.finish(
          context,
          trace,
          fallbackOutput(context, reason),
          "unsafe_recommendation",
          resumed,
        );
      }
      if (output.diagnosis.recommendation.action === "escalate") {
        trace.push({ step, diagnosis: output, stop_reason: "escalated" });
        return this.finish(context, trace, output, "escalated", resumed);
      }
      if (
        observationAdvanced &&
        context.reconciliation.rule_based_resolution &&
        output.diagnosis.recommendation.action ===
          context.reconciliation.resolution
      ) {
        trace.push({ step, diagnosis: output, stop_reason: "completed" });
        return this.finish(context, trace, output, "completed", resumed);
      }
      const tool: string = nextRead.tool;
      if (tool === "none") {
        if (output.diagnosis.recommendation.action === "retry_safe_read") {
          const reason =
            "Diagnosis requested a safe-read retry without selecting an allowlisted read";
          trace.push({
            step,
            diagnosis: output,
            stop_reason: "invalid_read_input",
          });
          return this.finish(
            context,
            trace,
            fallbackOutput(context, reason),
            "invalid_read_input",
            resumed,
          );
        }
        trace.push({ step, diagnosis: output, stop_reason: "no_next_read" });
        return this.finish(context, trace, output, "no_next_read", resumed);
      }
      const merchantReadAvailable =
        tool === "fetch_merchant_order" &&
        Boolean(this.options.merchantOrderReader);
      if (
        !this.options.mcpGateway.tools.includes(tool) &&
        !merchantReadAvailable
      ) {
        const reason = `Read tool ${tool} is outside the read-only allowlist`;
        trace.push({
          step,
          diagnosis: output,
          requested_read: { tool, input: {} },
          stop_reason: "unsupported_read",
        });
        return this.finish(
          context,
          trace,
          fallbackOutput(context, reason),
          "unsupported_read",
          resumed,
        );
      }

      const input = readInput(tool, context);
      if (!input) {
        const reason = `Read tool ${tool} has no canonical entity identifier`;
        trace.push({
          step,
          diagnosis: output,
          requested_read: { tool, input: {} },
          stop_reason: "invalid_read_input",
        });
        return this.finish(
          context,
          trace,
          fallbackOutput(context, reason),
          "invalid_read_input",
          resumed,
        );
      }
      const observation = merchantReadAvailable
        ? await this.merchantOrderObservation(input)
        : await this.options.mcpGateway.call(tool, input);
      const entry: InvestigationTraceEntry = {
        step,
        diagnosis: output,
        requested_read: { tool, input },
        observation,
      };
      trace.push(entry);
      if (observation.result !== "success") {
        entry.stop_reason = "read_failed";
        const reason = `Read tool ${tool} ended with ${observation.result}: ${observation.error ?? "no result"}`;
        return this.finish(
          context,
          trace,
          fallbackOutput(context, reason),
          "read_failed",
          resumed,
        );
      }
      try {
        const nextContext = await this.reduceObservation(context, observation);
        observationAdvanced ||= nextContext !== context;
        context = nextContext;
      } catch (error) {
        entry.stop_reason = "observation_rejected";
        const reason = `Read observation was rejected: ${error instanceof Error ? error.message : String(error)}`;
        return this.finish(
          context,
          trace,
          fallbackOutput(context, reason),
          "observation_rejected",
          resumed,
        );
      }
      await this.options.stateStore.save({
        version: 1,
        incident_id: bundle.incident_id,
        status: "running",
        trace,
        updated_at: this.now().toISOString(),
      });
    }

    const reason = `Investigation reached its ${this.maxSteps}-step read budget`;
    return this.finish(
      context,
      trace,
      fallbackOutput(context, reason),
      "step_budget_exhausted",
      resumed,
    );
  }

  private async finish(
    context: InvestigationContext,
    trace: InvestigationTraceEntry[],
    output: DiagnosisOutput,
    stopReason: InvestigationStopReason,
    resumed: boolean,
  ): Promise<InvestigationAgentResult> {
    const parsed = parseDiagnosisOutput(
      output,
      new Set(
        context.reconstruction.timeline.map((entry) => entry.evidence_id),
      ),
    );
    await this.options.stateStore.save({
      version: 1,
      incident_id: context.bundle.incident_id,
      status: "completed",
      trace,
      final_output: parsed,
      stop_reason: stopReason,
      updated_at: this.now().toISOString(),
    });
    return {
      output: parsed,
      trace,
      stop_reason: stopReason,
      resumed,
      context,
    };
  }

  private async merchantOrderObservation(
    input: Record<string, unknown>,
  ): Promise<RazorpayMcpProvenance> {
    const startedAt = this.now().toISOString();
    const orderId = input.order_id;
    if (typeof orderId !== "string")
      return {
        tool: "fetch_merchant_order",
        input,
        started_at: startedAt,
        completed_at: this.now().toISOString(),
        result: "error",
        error: "merchant order id is required",
      };
    try {
      const output =
        await this.options.merchantOrderReader!.fetchOrderState(orderId);
      return {
        tool: "fetch_merchant_order",
        input,
        started_at: startedAt,
        completed_at: this.now().toISOString(),
        result: "success",
        output,
        output_summary:
          output === null ? "null" : `merchant-order(${output.order_id})`,
      };
    } catch (error) {
      return {
        tool: "fetch_merchant_order",
        input,
        started_at: startedAt,
        completed_at: this.now().toISOString(),
        result: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
