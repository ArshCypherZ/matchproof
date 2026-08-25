import { describe, expect, it } from "vitest";
import {
  addBatchJob,
  addEvidenceJob,
  addIncidentJob,
  addWebhookIncidentJob,
  QUEUE_NAMES,
} from "../src/queue";

function fakeQueue() {
  const jobs: unknown[] = [];
  return {
    jobs,
    add: async (...args: unknown[]) => {
      jobs.push(args);
      return args;
    },
  };
}

describe("BullMQ queue contracts", () => {
  it("uses stable incident and evidence job IDs for redelivery idempotency", async () => {
    const incident = fakeQueue();
    const evidence = fakeQueue();
    await addIncidentJob({ incidentProcessing: incident as never }, "inc_123", {
      eventId: "evt_1",
    });
    await addIncidentJob({ incidentProcessing: incident as never }, "inc_123");
    await addEvidenceJob(
      { evidenceGathering: evidence as never },
      "pay_1",
      "webhook:pay_1",
    );
    expect((incident.jobs[0] as unknown[])[2]).toMatchObject({
      jobId: "incident:inc_123",
      attempts: 5,
    });
    expect((incident.jobs[1] as unknown[])[2]).toMatchObject({
      jobId: "incident:inc_123",
    });
    expect((evidence.jobs[0] as unknown[])[2]).toMatchObject({
      jobId: "evidence:webhook:pay_1",
    });
    await addWebhookIncidentJob(
      { incidentProcessing: incident as never },
      "evt_1",
    );
    expect((incident.jobs[2] as unknown[])[2]).toMatchObject({
      jobId: "webhook:evt_1",
    });
  });

  it("defines all required queues and batch payloads", async () => {
    expect(QUEUE_NAMES).toEqual({
      incidentProcessing: "incident-processing",
      evidenceGathering: "evidence-gathering",
      batchEvaluation: "batch-evaluation",
      deadLetter: "dead-letter",
    });
    const batch = fakeQueue();
    await addBatchJob({ batchEvaluation: batch as never }, "batch_1", [
      "inc_1",
      "inc_2",
    ]);
    expect((batch.jobs[0] as unknown[])[0]).toBe("evaluate-batch");
    expect((batch.jobs[0] as unknown[])[1]).toMatchObject({
      batchId: "batch_1",
      incidentIds: ["inc_1", "inc_2"],
    });
  });
});
