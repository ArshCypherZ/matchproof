import {
  Check,
  Circle,
  CircleDotDashed,
  CirclePause,
  OctagonAlert,
} from "lucide-react";
import { STEP_LABELS } from "@/components/shared/step-labels";

// Machine pipeline steps, shown with the operator-facing label that names
// what the operator can do at that stage. The step ids are the durable
// contract (progress records them); the labels are copy. Step labels live in
// shared/step-labels so the queue, the batch roster, and this rail always
// speak the same words.
const LOOP_STEPS = (Object.keys(STEP_LABELS) as string[])
  .filter((id) => id !== "escalate")
  .map((id) => ({ id, label: STEP_LABELS[id] ?? id }));

// Step statuses arrive from the pipeline as "completed", "running:3",
// "retrying:2", "failed:1", "blocked", or "pending".
export function LoopRail({
  currentStep,
  currentStatus,
  terminal,
}: {
  currentStep: string;
  currentStatus: string;
  terminal: boolean;
}) {
  const activeIndex = Math.max(
    0,
    LOOP_STEPS.findIndex(
      (step) =>
        step.id === (currentStep === "escalate" ? "close" : currentStep),
    ),
  );
  const running =
    currentStatus.startsWith("running:") ||
    currentStatus.startsWith("retrying:");
  return (
    <ol
      aria-label="Recovery progress"
      className="flex min-w-0 items-center gap-0 overflow-x-auto overscroll-x-contain snap-x border-y border-border px-1 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {LOOP_STEPS.map((step, index) => {
        const complete = terminal || index < activeIndex;
        const active = !terminal && index === activeIndex;
        // "failed:2" carries an iteration count; "blocked" is the gate
        // waiting on an operator decision — neither looks like a running step.
        const failed = active && currentStatus.startsWith("failed");
        const blocked = active && currentStatus === "blocked";
        const Icon = complete
          ? Check
          : failed
            ? OctagonAlert
            : blocked
              ? CirclePause
              : active
                ? CircleDotDashed
                : Circle;
        const label =
          step.id === "close" && currentStep === "escalate"
            ? "Escalated"
            : step.label;
        return (
          <li key={step.id} className="flex items-center last:pr-2 snap-start">
            <div
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap px-2 font-data text-2xs font-medium uppercase tracking-[0.08em] transition-colors duration-200 ${active ? "text-primary" : complete ? "text-ink-secondary" : "text-ink-tertiary"}`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full border transition-colors duration-200 motion-reduce:animate-none ${active && running ? "animate-wave-pulse border-primary bg-accent" : active ? "border-primary bg-accent" : complete ? "animate-in zoom-in-95 border-border bg-surface-subtle duration-200" : "border-border bg-surface"}`}
              >
                <Icon aria-hidden="true" className="size-3" />
              </span>
              {label}
            </div>
            {index < LOOP_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                style={{ animationDelay: `${index * 120}ms` }}
                data-filled={index < activeIndex || undefined}
                className={`loop-segment h-px w-4 bg-border motion-reduce:animate-none sm:w-7 ${running && index === activeIndex ? "animate-wave-pulse" : ""}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
