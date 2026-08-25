import { describe, expect, it, beforeEach } from "vitest";
import {
  metricsSnapshot,
  redact,
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
});
