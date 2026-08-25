import {
  DiagnosisOutputSchema,
  DiagnosisSchema,
  parseDiagnosisOutput,
  type IncidentBundle,
  type ReconciliationResult,
  type Reconstruction,
} from "../domain/schemas";
import Groq from "groq-sdk";
import type { ChatCompletionCreateParams } from "groq-sdk/resources/chat/completions";
import type { RazorpayMcpReadGateway } from "./razorpay-mcp";

type DiagnosisContext = {
  bundle: IncidentBundle;
  reconstruction: Reconstruction;
  reconciliation: ReconciliationResult;
};

export type GroqCompletion = {
  id: string;
  model: string;
  choices: { message: { content?: string | null } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};
export type GroqTransport = (request: {
  model: string;
  messages: ChatCompletionCreateParams["messages"];
  response_format: { type: "json_object" };
  temperature: number;
}) => Promise<GroqCompletion>;

const fallbackDiagnosis = (context: DiagnosisContext, reason: string) => {
  const evidenceIds = context.reconciliation.evidence_ids.length
    ? context.reconciliation.evidence_ids
    : [context.bundle.evidence[0]?.evidence_id].filter((id): id is string =>
        Boolean(id),
      );
  if (!evidenceIds.length)
    throw new Error("diagnosis requires canonical evidence");
  const action = context.reconciliation.deterministic_resolution
    ? context.reconciliation.resolution === "no_action_required"
      ? "no_action_required"
      : "reconcile_internal_state"
    : "escalate";
  return DiagnosisOutputSchema.parse({
    diagnosis: {
      hypotheses: [
        {
          rank: 1,
          summary:
            "The deterministic reconciliation result is the safe fallback diagnosis.",
          reasoning: context.reconciliation.discrepancies.join(", ") || reason,
          uncertainty: reason,
          confidence: context.reconciliation.deterministic_resolution ? 1 : 0,
          evidence_ids: evidenceIds,
        },
      ],
      recommendation: {
        action,
        reasoning: context.reconciliation.resolution,
        uncertainty: reason,
        evidence_ids: evidenceIds,
      },
    },
    provenance: {
      provider: "deterministic-fallback",
      requested_model: "none",
      returned_model: "none",
      request_id: `fallback:${context.bundle.incident_id}`,
      strict_schema: true,
      failure_reason: reason,
    },
  });
};

export class LiveDiagnosisAdapter {
  readonly provider = "groq";
  readonly model: string;
  readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly transport: GroqTransport;
  private readonly mcpGateway: RazorpayMcpReadGateway | undefined;

  constructor(
    options: {
      apiKey?: string;
      model?: string;
      timeoutMs?: number;
      transport?: GroqTransport;
      mcpGateway?: RazorpayMcpReadGateway;
    } = {},
  ) {
    this.apiKey = options.apiKey ?? process.env.GROQ_API_KEY ?? "";
    this.mcpGateway = options.mcpGateway;
    this.model =
      options.model ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-20b";
    this.timeoutMs =
      options.timeoutMs ??
      Number(process.env.GROQ_TIMEOUT_SECONDS ?? 20) * 1000;
    this.transport =
      options.transport ??
      (async (request) =>
        (await new Groq({
          apiKey: this.apiKey,
          timeout: this.timeoutMs,
          maxRetries: 0,
        }).chat.completions.create({
          ...request,
          stream: false,
        })) as GroqCompletion);
  }

  async diagnose(
    bundle: IncidentBundle,
    reconstruction: Reconstruction,
    reconciliation: ReconciliationResult,
  ) {
    const context = { bundle, reconstruction, reconciliation };
    if (!this.apiKey)
      return fallbackDiagnosis(context, "GROQ_API_KEY is not configured");
    const prompt = JSON.stringify({
      task: "Diagnose this payment-to-order exception. Return JSON matching the supplied diagnosis schema.",
      rules: [
        "Use supplied evidence IDs.",
        "Recommend a bounded advisory action; never authorize money movement or fulfilment.",
      ],
      output_contract: {
        hypotheses: [
          {
            rank: "positive integer",
            summary: "non-empty string",
            reasoning: "non-empty string",
            uncertainty: "non-empty string",
            confidence: "number from 0 to 1",
            evidence_ids: ["canonical evidence ID"],
          },
        ],
        recommendation: {
          action:
            "reconcile_internal_state | retry_safe_read | no_action_required | escalate",
          reasoning: "non-empty string",
          uncertainty: "non-empty string",
          evidence_ids: ["canonical evidence ID"],
        },
      },
      evidence_timeline: reconstruction.timeline,
      current_state: reconstruction.current_state,
      available_read_tools: this.mcpGateway?.tools ?? [],
      reconciliation,
    });
    try {
      const payload = await this.transport({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You are an advisory payment operations investigator.",
          },
          { role: "user", content: prompt },
        ],
      });
      const content = payload.choices[0]?.message.content;
      if (typeof content !== "string")
        throw new Error("Groq response did not contain JSON content");
      const parsed = DiagnosisSchema.parse(
        JSON.parse(content.replace(/^```json\s*|\s*```$/g, "")),
      );
      const output = DiagnosisOutputSchema.parse({
        diagnosis: parsed,
        provenance: {
          provider: this.provider,
          requested_model: this.model,
          returned_model: payload.model,
          request_id: payload.id,
          strict_schema: true,
          ...(payload.usage
            ? {
                token_usage: {
                  prompt_tokens: payload.usage.prompt_tokens,
                  completion_tokens: payload.usage.completion_tokens,
                  total_tokens: payload.usage.total_tokens,
                },
              }
            : {}),
        },
      });
      return parseDiagnosisOutput(
        output,
        new Set(reconstruction.timeline.map((entry) => entry.evidence_id)),
      );
    } catch (error) {
      return fallbackDiagnosis(
        context,
        error instanceof Error ? error.message : "Groq diagnosis failed",
      );
    }
  }
}

export class FixtureDiagnosisAdapter {
  provider = "fixture";
  model = "fixture-diagnosis-v1";
  diagnose(
    _bundle?: IncidentBundle,
    _reconstruction?: Reconstruction,
    _reconciliation?: ReconciliationResult,
  ) {
    return DiagnosisOutputSchema.parse({
      diagnosis: {
        hypotheses: [
          {
            rank: 1,
            summary:
              "The processor completed capture before the caller timed out.",
            reasoning:
              "The verified capture event occurred before the timeout response.",
            uncertainty: "The synchronous acknowledgement was lost.",
            confidence: 0.98,
            evidence_ids: ["EV-REQ-001", "EV-TIMEOUT-001", "EV-WEBHOOK-001"],
          },
        ],
        recommendation: {
          action: "reconcile_internal_state",
          reasoning:
            "Apply the verified capture to the merchant record without mutation.",
          uncertainty: "Escalate if deterministic invariants do not agree.",
          evidence_ids: ["EV-STATE-001", "EV-WEBHOOK-001"],
        },
      },
      provenance: {
        provider: this.provider,
        requested_model: this.model,
        returned_model: this.model,
        request_id: "fixture-call",
        strict_schema: true,
      },
    });
  }
}
