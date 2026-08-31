import { context, trace, type Span, type Tracer } from "@opentelemetry/api";

export type ObservabilityEvent =
  | "evidence_ingested"
  | "webhook_received"
  | "policy_decision"
  | "execution_attempt"
  | "afterstate_result"
  | "incident_closed"
  | "incident_escalated"
  | "model_call_started"
  | "model_call_completed"
  | "model_contract_violation"
  | "model_fallback";

type StaticMetricName =
  | "incidents_processed"
  | "evidence_gather_latency_ms"
  | "provider_api_latency_ms"
  | "model_call_latency_ms"
  | "model_calls"
  | "model_attempts"
  | "model_fallbacks"
  | "model_prompt_tokens"
  | "model_completion_tokens"
  | "model_total_tokens"
  | "model_failures"
  | "model_contract_corrections"
  | "model_state_action_corrections"
  | "model_investigation_fallbacks"
  | "tier0_playbook_closures"
  | "cluster_investigations"
  | "cluster_replayed_records"
  | "incident_closure_latency_ms";

/** Key families whose suffix is produced at runtime. */
type DynamicMetricName =
  | `model_fallback_reason.${"citation_validation" | "schema_validation" | "timeout" | "other"}`
  | `incidents_by_class.${string}`
  | `incidents_by_terminal.${string}`;

type MetricName = StaticMetricName | DynamicMetricName;

const counters = new Map<string, number>();
const timings = new Map<string, { total: number; count: number }>();
const safeId = (value: unknown) =>
  typeof value === "string"
    ? value.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 128)
    : undefined;

export function redact(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (
      typeof value === "string" &&
      /(secret|authorization|api[_-]?key|password)/i.test(value)
    )
      return "[REDACTED]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redact);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] =
      /(secret|authorization|api[_-]?key|password|raw_body|email|contact|vpa)/i.test(
        key,
      )
        ? "[REDACTED]"
        : redact(item);
  }
  return result;
}

export function recordEvent(
  event: ObservabilityEvent,
  attributes: Record<string, unknown> = {},
) {
  try {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...(redact(attributes) as Record<string, unknown>),
      }),
    );
  } catch {
    /* observability is append-only */
  }
}

export function recordMetric(name: MetricName, value = 1) {
  if (name.endsWith("_latency_ms")) {
    const current = timings.get(name) ?? { total: 0, count: 0 };
    current.total += value;
    current.count += 1;
    timings.set(name, current);
  } else counters.set(name, (counters.get(name) ?? 0) + value);
}

export function recordFallbackReason(reason: string) {
  const category = /canonical|evidence[_ ]?id|citation/i.test(reason)
    ? "citation_validation"
    : /json|schema|validate|invalid[_ ]?(type|enum|value)/i.test(reason)
      ? "schema_validation"
      : /timeout|timed out|etimedout/i.test(reason)
        ? "timeout"
        : "other";
  const key: DynamicMetricName = `model_fallback_reason.${category}`;
  counters.set(key, (counters.get(key) ?? 0) + 1);
}

export function recordIncidentClass(incidentClass: string, terminal: string) {
  const safeClass = safeId(incidentClass) ?? "unknown";
  const safeTerminal = safeId(terminal) ?? "unknown";
  const classKey: DynamicMetricName = `incidents_by_class.${safeClass}`;
  const terminalKey: DynamicMetricName = `incidents_by_terminal.${safeTerminal}`;
  counters.set(classKey, (counters.get(classKey) ?? 0) + 1);
  counters.set(terminalKey, (counters.get(terminalKey) ?? 0) + 1);
}

export function metricsSnapshot() {
  const metrics: Record<string, number> = Object.fromEntries(counters);
  for (const [name, value] of timings)
    metrics[name] = value.count ? value.total / value.count : 0;
  return metrics;
}

export function resetMetrics() {
  counters.clear();
  timings.clear();
}

export function startSpan(
  name: string,
  attributes: Record<string, string> = {},
) {
  const tracer: Tracer = trace.getTracer("matchproof");
  const span = tracer.startSpan(name, undefined, context.active());
  for (const [key, value] of Object.entries(attributes))
    span.setAttribute(key, value);
  return span;
}

export async function withSpan<T>(
  name: string,
  run: (span: Span) => Promise<T>,
  attributes?: Record<string, string>,
) {
  const span = startSpan(name, attributes);
  const started = performance.now();
  try {
    return await run(span);
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ code: 2 });
    throw error;
  } finally {
    span.end(performance.timeOrigin + started);
  }
}
