import type { ProgressRecord } from "../db/repository";
import {
  recordEvent,
  recordIncidentClass,
  recordMetric,
  startSpan,
} from "../observability";

export const CLOSED_LOOP_STEPS = [
  "gather",
  "reconcile",
  "diagnose",
  "gate",
  "execute",
  "observe",
  "verify",
] as const;

export type ClosedLoopStep = (typeof CLOSED_LOOP_STEPS)[number];
export type ClosedLoopTerminalStep = "close" | "escalate";
export type BoundedFailureResponse =
  | "retry_safe_read"
  | "wait"
  | "switch_evidence_source"
  | "verify_state"
  | "stop"
  | "escalate";

type StepResult =
  | {
      status: "completed";
      details: unknown;
      nextStep?: ClosedLoopStep;
    }
  | {
      status: "retry";
      response: Extract<
        BoundedFailureResponse,
        "retry_safe_read" | "wait" | "switch_evidence_source" | "verify_state"
      >;
      details: unknown;
    }
  | {
      status: "terminal";
      terminal: ClosedLoopTerminalStep;
      details: unknown;
    };

export type ClosedLoopStepContext = {
  iteration: number;
  replay: boolean;
  progress?: ProgressRecord;
};

export type ClosedLoopStepDefinition = {
  name: ClosedLoopStep;
  run(context: ClosedLoopStepContext): Promise<StepResult>;
  failureResponse?(error: unknown): BoundedFailureResponse;
};

type ProgressStore = {
  progress(incidentId: string): Promise<ProgressRecord[]>;
  latestProgress(incidentId: string): Promise<ProgressRecord | undefined>;
  setProgress(
    incidentId: string,
    step: string,
    status: string,
    details: unknown,
  ): Promise<void>;
};

export type ClosedLoopRunResult = {
  terminal: ClosedLoopTerminalStep;
  iterations: number;
  resumedFrom?: string;
};

export type ClosedLoopControllerOptions = {
  maxIterations?: number;
  wait?(input: {
    step: ClosedLoopStep;
    iteration: number;
    delayMs: number;
  }): Promise<void>;
  onEscalate?(input: {
    step: ClosedLoopStep;
    response: BoundedFailureResponse;
    reason: string;
    iteration: number;
  }): Promise<unknown>;
};

const completed = (status: string) =>
  status === "completed" || status.startsWith("completed:");

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export class ClosedLoopController {
  private readonly maxIterations: number;

  constructor(
    private readonly store: ProgressStore,
    private readonly options: ClosedLoopControllerOptions = {},
  ) {
    this.maxIterations = options.maxIterations ?? 3;
    if (!Number.isSafeInteger(this.maxIterations) || this.maxIterations < 1)
      throw new RangeError("maxIterations must be a positive integer");
  }

  async run(
    incidentId: string,
    definitions: ClosedLoopStepDefinition[],
  ): Promise<ClosedLoopRunResult> {
    const byName = new Map(
      definitions.map((definition) => [definition.name, definition]),
    );
    for (const step of CLOSED_LOOP_STEPS)
      if (!byName.has(step))
        throw new Error(`closed loop step ${step} is missing`);

    const existing = await this.store.progress(incidentId);
    recordMetric("incidents_processed");
    const latest = await this.store.latestProgress(incidentId);
    const completedProgress = new Map<ClosedLoopStep, ProgressRecord>();
    for (const record of existing)
      if (
        CLOSED_LOOP_STEPS.includes(record.step as ClosedLoopStep) &&
        completed(record.status)
      )
        completedProgress.set(record.step as ClosedLoopStep, record);

    let iteration = 1;
    let cursor = 0;
    const forced = new Set<ClosedLoopStep>();
    while (cursor < CLOSED_LOOP_STEPS.length) {
      const step = CLOSED_LOOP_STEPS[cursor];
      if (!step) throw new Error("closed loop cursor is invalid");
      const definition = byName.get(step);
      if (!definition) throw new Error(`closed loop step ${step} is missing`);
      const prior = completedProgress.get(step);
      const replay = prior !== undefined && !forced.has(step);
      if (!replay)
        await this.store.setProgress(incidentId, step, `running:${iteration}`, {
          iteration,
        });

      let result: StepResult;
      const span = startSpan(`incident.${step}`, {
        "incident.id": incidentId,
        "incident.step": step,
      });
      const startedAt = Date.now();
      try {
        result = await definition.run({
          iteration,
          replay,
          ...(prior ? { progress: prior } : {}),
        });
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({ code: 2 });
        span.end();
        recordEvent("incident_escalated", {
          incident_id: incidentId,
          step,
          error: errorMessage(error),
        });
        const response = definition.failureResponse?.(error) ?? "escalate";
        const reason = errorMessage(error);
        await this.store.setProgress(incidentId, step, `failed:${iteration}`, {
          iteration,
          response,
          reason,
        });
        if (response === "verify_state") {
          const observe = CLOSED_LOOP_STEPS.indexOf("observe");
          forced.add("observe");
          cursor = observe;
          continue;
        }
        if (response === "wait" && this.retryAllowed(response, iteration))
          await this.wait(step, iteration);
        if (this.retryAllowed(response, iteration)) {
          await this.store.setProgress(
            incidentId,
            step,
            `retrying:${iteration}`,
            { iteration, response, reason },
          );
          iteration += 1;
          forced.add(step);
          continue;
        }
        return this.escalate(
          incidentId,
          step,
          response,
          reason,
          iteration,
          latest?.step,
        );
      }

      span.end();
      if (step === "gather")
        recordMetric("evidence_gather_latency_ms", Date.now() - startedAt);

      if (result.status === "retry") {
        await this.store.setProgress(
          incidentId,
          step,
          `retrying:${iteration}`,
          { iteration, response: result.response, details: result.details },
        );
        if (result.response === "verify_state") {
          const observe = CLOSED_LOOP_STEPS.indexOf("observe");
          forced.add("observe");
          cursor = observe;
          continue;
        }
        if (
          result.response === "wait" &&
          this.retryAllowed(result.response, iteration)
        )
          await this.wait(step, iteration);
        if (!this.retryAllowed(result.response, iteration))
          return this.escalate(
            incidentId,
            step,
            "escalate",
            `bounded retry limit reached after ${iteration} iterations`,
            iteration,
            latest?.step,
          );
        iteration += 1;
        forced.add(step);
        continue;
      }

      if (!replay) {
        const status = completedProgress.has(step)
          ? `completed:${iteration}`
          : "completed";
        await this.store.setProgress(incidentId, step, status, result.details);
        completedProgress.set(step, {
          sequence: 0,
          incident_id: incidentId,
          step,
          status,
          updated_at: new Date().toISOString(),
          details: result.details,
        });
      }
      forced.delete(step);

      if (result.status === "terminal") {
        await this.store.setProgress(
          incidentId,
          result.terminal,
          "completed",
          result.details,
        );
        recordIncidentClass("unknown", result.terminal);
        recordEvent(
          result.terminal === "close"
            ? "incident_closed"
            : "incident_escalated",
          { incident_id: incidentId, terminal: result.terminal },
        );
        return {
          terminal: result.terminal,
          iterations: iteration,
          ...(latest?.step ? { resumedFrom: latest.step } : {}),
        };
      }

      if (result.nextStep) {
        const next = CLOSED_LOOP_STEPS.indexOf(result.nextStep);
        if (next < 0)
          throw new Error(`unknown closed loop step ${result.nextStep}`);
        if (next <= cursor) {
          if (iteration >= this.maxIterations)
            return this.escalate(
              incidentId,
              step,
              "escalate",
              `bounded loop limit reached after ${iteration} iterations`,
              iteration,
              latest?.step,
            );
          iteration += 1;
          for (let index = next; index <= cursor; index += 1) {
            const forcedStep = CLOSED_LOOP_STEPS[index];
            if (forcedStep) forced.add(forcedStep);
          }
        }
        cursor = next;
      } else cursor += 1;
    }
    throw new Error("closed loop ended without a verified terminal state");
  }

  static async runBatch<Input, Output>(
    inputs: readonly Input[],
    process: (input: Input, index: number) => Promise<Output>,
  ): Promise<Output[]> {
    const results: Output[] = [];
    for (const [index, input] of inputs.entries())
      results.push(await process(input, index));
    return results;
  }

  private retryAllowed(response: BoundedFailureResponse, iteration: number) {
    return (
      iteration < this.maxIterations &&
      response !== "stop" &&
      response !== "escalate"
    );
  }

  private async wait(step: ClosedLoopStep, iteration: number) {
    const delayMs = Math.min(1_000 * 2 ** (iteration - 1), 30_000);
    if (this.options.wait)
      await this.options.wait({ step, iteration, delayMs });
    else await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private async escalate(
    incidentId: string,
    step: ClosedLoopStep,
    response: BoundedFailureResponse,
    reason: string,
    iteration: number,
    resumedFrom?: string,
  ): Promise<ClosedLoopRunResult> {
    const details = (await this.options.onEscalate?.({
      step,
      response,
      reason,
      iteration,
    })) ?? {
      step,
      response,
      reason,
      iteration,
    };
    await this.store.setProgress(incidentId, "escalate", "completed", details);
    return {
      terminal: "escalate",
      iterations: iteration,
      ...(resumedFrom ? { resumedFrom } : {}),
    };
  }
}
