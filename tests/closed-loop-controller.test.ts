import { describe, expect, it } from "vitest";
import {
  ClosedLoopController,
  CLOSED_LOOP_STEPS,
  type ClosedLoopStepDefinition,
} from "../src/incident_commander/closed-loop-controller";
import type { ProgressRecord } from "../src/db/repository";

class MemoryProgressStore {
  records: ProgressRecord[] = [];
  private sequence = 0;

  async progress(incidentId: string) {
    return this.records.filter((record) => record.incident_id === incidentId);
  }

  async latestProgress(incidentId: string) {
    return [...(await this.progress(incidentId))].at(-1);
  }

  async setProgress(
    incidentId: string,
    step: string,
    status: string,
    details: unknown,
  ) {
    this.records.push({
      sequence: ++this.sequence,
      incident_id: incidentId,
      step,
      status,
      updated_at: new Date().toISOString(),
      details,
    });
  }
}

const definitions = (
  run: (step: string, iteration: number, replay: boolean) => Promise<unknown>,
): ClosedLoopStepDefinition[] =>
  CLOSED_LOOP_STEPS.map((name) => ({
    name,
    run: async ({ iteration, replay }) => {
      await run(name, iteration, replay);
      if (name === "verify")
        return {
          status: "terminal" as const,
          terminal: "close" as const,
          details: { name },
        };
      return { status: "completed" as const, details: { name } };
    },
  }));

describe("ClosedLoopController", () => {
  it("resumes completed steps and retries a bounded safe read", async () => {
    const store = new MemoryProgressStore();
    const calls: string[] = [];
    let gatherAttempts = 0;
    const steps = definitions(async (step, iteration, replay) => {
      calls.push(`${step}:${iteration}:${replay}`);
      if (step === "gather" && ++gatherAttempts === 1)
        throw new Error("provider read timed out");
    });
    const first = await new ClosedLoopController(store, {
      maxIterations: 2,
    }).run(
      "inc_controller_001",
      steps.map((step) =>
        step.name === "gather"
          ? { ...step, failureResponse: () => "retry_safe_read" as const }
          : step,
      ),
    );
    expect(first.terminal).toBe("close");
    expect(calls).toContain("gather:2:false");

    const beforeResume = calls.length;
    const resumed = await new ClosedLoopController(store).run(
      "inc_controller_001",
      steps,
    );
    expect(resumed.terminal).toBe("close");
    expect(resumed.resumedFrom).toBe("close");
    expect(calls.slice(beforeResume)).toEqual([
      "gather:1:true",
      "reconcile:1:true",
      "diagnose:1:true",
      "gate:1:true",
      "execute:1:true",
      "observe:1:true",
      "verify:1:true",
    ]);
  });

  it("creates an evidence-backed escalation at the retry bound", async () => {
    const store = new MemoryProgressStore();
    const steps = definitions(async (step) => {
      if (step === "observe") throw new Error("provider unavailable");
    }).map((step) =>
      step.name === "observe"
        ? { ...step, failureResponse: () => "retry_safe_read" as const }
        : step,
    );
    const result = await new ClosedLoopController(store, {
      maxIterations: 2,
    }).run("inc_controller_002", steps);
    expect(result.terminal).toBe("escalate");
    expect(result.iterations).toBe(2);
    expect(
      store.records.some(
        (record) => record.step === "escalate" && record.status === "completed",
      ),
    ).toBe(true);
  });

  it("processes a batch sequentially", async () => {
    const order: number[] = [];
    const result = await ClosedLoopController.runBatch(
      ["a", "b", "c"],
      async (value, index) => {
        order.push(index);
        return value.toUpperCase();
      },
    );
    expect(result).toEqual(["A", "B", "C"]);
    expect(order).toEqual([0, 1, 2]);
  });
});
