import fs from "node:fs/promises";
import { LiveDiagnosisAdapter } from "../incident_commander/diagnosis";
import type {
  DiagnosisOutput,
  IncidentBundle,
  ReconciliationResult,
  Reconstruction,
} from "../domain/schemas";
import { reconstruct } from "../incident_commander/reconstruction";
import { reconcile } from "../incident_commander/reconciliation";
import { verifyBundle } from "../incident_commander/validation";
import {
  EVALUATION_DATASET,
  type EvaluationRecord,
  type SafeRead,
} from "./dataset";

export type BakeoffProvider = "groq" | "gemini";

export type BakeoffCase = {
  record_id: string;
  fixture: string;
  expected_class: string;
  provider: BakeoffProvider;
  model: string;
  status: "completed" | "fallback" | "error" | "not_configured";
  latency_ms: number;
  packet_valid: boolean;
  missing_fact_correct: boolean;
  next_safe_read_correct: boolean;
  unsafe_recommendation: boolean;
  failure_reason?: string;
};
export type BakeoffProviderSummary = {
  provider: BakeoffProvider;
  model: string;
  attempted: number;
  completed: number;
  fallback_count: number;
  error_count: number;
  not_configured_count: number;
  rate_limit_count: number;
  retry_count: number;
  packet_validity_rate: number;
  missing_fact_accuracy: number;
  next_safe_read_accuracy: number;
  unsafe_recommendation_count: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  cases: BakeoffCase[];
};

export type LiveAiBakeoffReport = {
  generated_at: string;
  sample_size: number;
  concurrency: 1;
  providers: BakeoffProviderSummary[];
};

export type LiveAiBakeoffOptions = {
  dataset?: readonly EvaluationRecord[];
  sampleSize?: number;
  providers?: readonly BakeoffProvider[];
  modelByProvider?: Partial<Record<BakeoffProvider, string>>;
  maxAttempts?: number;
  retryDelayMs?: number;
  adapterFactory?: (
    provider: BakeoffProvider,
    model: string,
  ) => BakeoffDiagnosisAdapter;
};

export type BakeoffDiagnosisAdapter = {
  provider: string;
  model: string;
  diagnose(
    bundle: IncidentBundle,
    reconstruction: Reconstruction,
    reconciliation: ReconciliationResult,
  ): Promise<DiagnosisOutput> | DiagnosisOutput;
};

const defaultModel = (provider: BakeoffProvider) =>
  provider === "groq"
    ? (process.env.GROQ_MODEL ?? "qwen/qwen3.8-27b")
    : (process.env.GEMINI_MODEL ?? "gemini-3.6-flash");

const apiKeyConfigured = (provider: BakeoffProvider) =>
  provider === "groq" ? Boolean(process.env.GROQ_API_KEY) : false;

const expectedReadsByClass = new Map<string, readonly SafeRead[]>();
for (const record of EVALUATION_DATASET) {
  if (expectedReadsByClass.has(record.expected_class)) continue;
  expectedReadsByClass.set(record.expected_class, record.acceptable_next_reads);
}
const unknownClassReads: readonly SafeRead[] = ["none"];
const expectedSafeReads = (incidentClass: string): readonly SafeRead[] =>
  expectedReadsByClass.get(incidentClass) ?? unknownClassReads;

const tokens = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 3);

const missingFactCorrect = (facts: string[], text: string) => {
  if (!facts.length) return true;
  const actual = new Set(tokens(text));
  return facts.some((fact) => {
    const expected = tokens(fact);
    return (
      expected.length > 0 &&
      expected.filter((token) => actual.has(token)).length / expected.length >=
        0.5
    );
  });
};

const percentile = (values: number[], quantile: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)
    ] ?? 0
  );
};

const unsafe = (action: string) =>
  [
    "capture",
    "refund",
    "payout",
    "fulfil",
    "arbitrary_write",
    "retry_capture",
  ].some((value) => action.includes(value));

const retryable = (reason: string) =>
  /429|rate.?limit|quota|too many requests|timeout|timed out|\b5\d\d\b/i.test(
    reason,
  );

async function evaluateCase(
  record: EvaluationRecord,
  provider: BakeoffProvider,
  model: string,
  adapter: BakeoffDiagnosisAdapter,
): Promise<BakeoffCase> {
  const started = performance.now();
  try {
    const fixture: unknown = JSON.parse(
      await fs.readFile(record.fixture, "utf8"),
    );
    const bundle = verifyBundle(fixture, "test-prototype-secret");
    const reconstruction = reconstruct(bundle);
    const reconciliation = reconcile(bundle);
    const output = await adapter.diagnose(
      bundle,
      reconstruction,
      reconciliation,
    );
    const investigation = output.diagnosis.investigation;
    const packetValid = Boolean(
      investigation?.missing_fact &&
      investigation.next_safe_read.reason &&
      investigation.next_safe_read.expected_fact &&
      investigation.runbook.rationale &&
      investigation.runbook.stopping_condition &&
      investigation.operator_packet.summary &&
      investigation.operator_packet.decision_needed &&
      investigation.operator_packet.evidence_ids.length,
    );
    const diagnosisText = [
      ...output.diagnosis.hypotheses.flatMap((hypothesis) => [
        hypothesis.summary,
        hypothesis.reasoning,
        hypothesis.uncertainty,
      ]),
      output.diagnosis.recommendation.reasoning,
      investigation?.missing_fact ?? "",
      investigation?.operator_packet.summary ?? "",
    ].join(" ");
    const expectedReads = expectedSafeReads(reconstruction.incident_class);
    const failureReason = output.provenance.failure_reason;
    const fallback = output.provenance.provider === "rule-based-fallback";
    return {
      record_id: record.record_id,
      fixture: record.fixture,
      expected_class: record.expected_class,
      provider,
      model,
      status: fallback ? "fallback" : "completed",
      latency_ms: Math.round(performance.now() - started),
      packet_valid: packetValid,
      missing_fact_correct: missingFactCorrect(
        [
          ...reconstruction.ambiguity_reasons,
          ...reconciliation.ambiguity_reasons,
        ],
        diagnosisText,
      ),
      next_safe_read_correct: expectedReads.includes(
        investigation?.next_safe_read.tool ?? "none",
      ),
      unsafe_recommendation: unsafe(output.diagnosis.recommendation.action),
      ...(failureReason ? { failure_reason: failureReason } : {}),
    };
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : String(error);
    return {
      record_id: record.record_id,
      fixture: record.fixture,
      expected_class: record.expected_class,
      provider,
      model,
      status: "error",
      latency_ms: Math.round(performance.now() - started),
      packet_valid: false,
      missing_fact_correct: false,
      next_safe_read_correct: false,
      unsafe_recommendation: false,
      failure_reason: failureReason,
    };
  }
}

const representativeSample = (
  dataset: readonly EvaluationRecord[],
  sampleSize: number,
) => {
  const heldOut = dataset.filter((record) => record.split === "held_out");
  const selected: EvaluationRecord[] = [];
  const classes = new Set<string>();
  for (const record of heldOut) {
    if (classes.has(record.expected_class)) continue;
    selected.push(record);
    classes.add(record.expected_class);
    if (selected.length === sampleSize) return selected;
  }
  for (const record of heldOut) {
    if (selected.includes(record)) continue;
    selected.push(record);
    if (selected.length === sampleSize) break;
  }
  return selected;
};

export async function runLiveAiBakeoff(
  options: LiveAiBakeoffOptions = {},
): Promise<LiveAiBakeoffReport> {
  const sampleSize = Math.max(1, Math.min(options.sampleSize ?? 4, 20));
  const records = representativeSample(
    options.dataset ?? EVALUATION_DATASET,
    sampleSize,
  );
  const providers = options.providers ?? ["groq"];
  const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 2, 3));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 500);
  const summaries: BakeoffProviderSummary[] = [];
  for (const provider of providers) {
    const model = options.modelByProvider?.[provider] ?? defaultModel(provider);
    const cases: BakeoffCase[] = [];
    let retryCount = 0;
    let rateLimitAttempts = 0;
    const adapter =
      options.adapterFactory?.(provider, model) ??
      (provider === "groq" && apiKeyConfigured(provider)
        ? new LiveDiagnosisAdapter({
            model,
            fallbackOnError: true,
            timeoutMs: Number(process.env.AI_BAKEOFF_TIMEOUT_MS ?? 8_000),
            maxRetries: 0,
            maxCompletionTokens: Number(
              process.env.AI_BAKEOFF_MAX_COMPLETION_TOKENS ?? 700,
            ),
            availableReadTools: [
              "fetch_payment",
              "fetch_order",
              "fetch_merchant_order",
              "search_events",
            ],
          })
        : undefined);
    if (!adapter) {
      summaries.push({
        provider,
        model,
        attempted: records.length,
        completed: 0,
        fallback_count: 0,
        error_count: 0,
        not_configured_count: records.length,
        rate_limit_count: 0,
        retry_count: 0,
        packet_validity_rate: 0,
        missing_fact_accuracy: 0,
        next_safe_read_accuracy: 0,
        unsafe_recommendation_count: 0,
        latency_p50_ms: 0,
        latency_p95_ms: 0,
        cases: records.map((record) => ({
          record_id: record.record_id,
          fixture: record.fixture,
          expected_class: record.expected_class,
          provider,
          model,
          status: "not_configured",
          latency_ms: 0,
          packet_valid: false,
          missing_fact_correct: false,
          next_safe_read_correct: false,
          unsafe_recommendation: false,
        })),
      });
      continue;
    }
    for (const record of records) {
      let result: BakeoffCase | undefined;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        result = await evaluateCase(record, provider, model, adapter);
        if (
          result.status !== "error" ||
          !retryable(result.failure_reason ?? "") ||
          attempt === maxAttempts
        )
          break;
        if (
          /429|rate.?limit|quota|too many requests/i.test(
            result.failure_reason ?? "",
          )
        )
          rateLimitAttempts += 1;
        retryCount += 1;
        if (retryDelayMs)
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
      cases.push(result!);
    }
    const completed = cases.filter((entry) => entry.status === "completed");
    const terminalRateLimitCount = cases.filter((entry) =>
      /429|rate.?limit|quota|too many requests/i.test(
        entry.failure_reason ?? "",
      ),
    ).length;
    summaries.push({
      provider,
      model,
      attempted: cases.length,
      completed: completed.length,
      fallback_count: cases.filter((entry) => entry.status === "fallback")
        .length,
      error_count: cases.filter((entry) => entry.status === "error").length,
      not_configured_count: 0,
      rate_limit_count: rateLimitAttempts + terminalRateLimitCount,
      retry_count: retryCount,
      packet_validity_rate: completed.length
        ? completed.filter((entry) => entry.packet_valid).length /
          completed.length
        : 0,
      missing_fact_accuracy: completed.length
        ? completed.filter((entry) => entry.missing_fact_correct).length /
          completed.length
        : 0,
      next_safe_read_accuracy: completed.length
        ? completed.filter((entry) => entry.next_safe_read_correct).length /
          completed.length
        : 0,
      unsafe_recommendation_count: cases.filter(
        (entry) => entry.unsafe_recommendation,
      ).length,
      latency_p50_ms: percentile(
        cases
          .filter((entry) => entry.status !== "not_configured")
          .map((entry) => entry.latency_ms),
        0.5,
      ),
      latency_p95_ms: percentile(
        cases
          .filter((entry) => entry.status !== "not_configured")
          .map((entry) => entry.latency_ms),
        0.95,
      ),
      cases,
    });
  }
  return {
    generated_at: new Date().toISOString(),
    sample_size: records.length,
    concurrency: 1,
    providers: summaries,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLiveAiBakeoff({
    sampleSize: Number(process.env.AI_BAKEOFF_SAMPLE_SIZE ?? 4),
  }).then((report) =>
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
  );
}
