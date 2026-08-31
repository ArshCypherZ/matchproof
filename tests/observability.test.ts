import { describe, expect, it, beforeEach } from "vitest";
import {
  metricsSnapshot,
  redact,
  recordIncidentClass,
  recordMetric,
  resetMetrics,
} from "../src/observability";

describe("observability", () => {
  beforeEach(() => resetMetrics());

  it("redacts credential and personal-data fields recursively", () => {
    expect(
      redact({
        api_key: "secret",
        contact: "9999999999",
        nested: { password: "pw" },
        amount_minor: 100,
      }),
    ).toEqual({
      api_key: "[REDACTED]",
      contact: "[REDACTED]",
      nested: { password: "[REDACTED]" },
      amount_minor: 100,
    });
  });

  it("aggregates counters and latency averages", () => {
    recordMetric("incidents_processed");
    recordMetric("incidents_processed");
    recordMetric("provider_api_latency_ms", 10);
    recordMetric("provider_api_latency_ms", 30);
    expect(metricsSnapshot()).toEqual({
      incidents_processed: 2,
      provider_api_latency_ms: 20,
    });
  });

  it("preserves model token counts in structured telemetry", () => {
    expect(redact({ total_tokens: 42, api_key: "secret" })).toEqual({
      total_tokens: 42,
      api_key: "[REDACTED]",
    });
  });

  it("attributes terminal telemetry to the actual incident class", () => {
    recordIncidentClass("paid_pending", "escalate");
    expect(metricsSnapshot()).toEqual({
      "incidents_by_class.paid_pending": 1,
      "incidents_by_terminal.escalate": 1,
    });
  });
});
