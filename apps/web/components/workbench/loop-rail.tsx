"use client";

import { useEffect, useRef } from "react";
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
  progress,
}: {
  currentStep: string;
  currentStatus: string;
  progress: { step: string; status: string }[];
}) {
  const listRef = useRef<HTMLOListElement>(null);

  // The rail scrolls on a phone, but its whole point is the step the record
  // is on — which sits far right for late-stage records. Land the visitor
  // there on mount (a terminal record has no current step, so its end is
  // the news); later refreshes never yank the scroller back while the
  // operator reads. Only the rail moves — the page must not jump.
  useEffect(() => {
    const rail = listRef.current;
    if (!rail) return;
    const focusStep =
      rail.querySelector<HTMLElement>('[aria-current="step"]') ??
      rail.lastElementChild;
    if (!(focusStep instanceof HTMLElement)) return;
    const railRect = rail.getBoundingClientRect();
    const stepRect = focusStep.getBoundingClientRect();
    rail.scrollLeft +=
      stepRect.left + stepRect.width / 2 - (railRect.left + railRect.width / 2);
  }, []);

  // A step is complete only when the pipeline recorded it as completed. A
  // blanket "terminal" mark would claim repairs that never ran — an
  // escalated exception skipped them, and the rail must show that gap.
  const statusByStep = new Map(progress.map((row) => [row.step, row.status]));
  const escalated =
    statusByStep.get("escalate") === "completed" || currentStep === "escalate";
  const terminal = escalated || statusByStep.get("close") === "completed";
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
      ref={listRef}
      aria-label="Recovery progress"
      // The rail scrolls horizontally and hides its scrollbar, so a keyboard
      // operator needs the region itself focusable to reach late-stage steps
      // — same treatment as the evidence payload block.
      tabIndex={0}
      className="focus-ring flex min-w-0 items-center gap-0 overflow-x-auto overscroll-x-contain snap-x border-y border-border px-1 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {LOOP_STEPS.map((step, index) => {
        const complete =
          statusByStep.get(step.id) === "completed" ||
          (step.id === "close" && terminal);
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
          step.id === "close" && escalated ? "Escalated" : step.label;
        // The step's state is otherwise color and icon shape alone; say it
        // in words for a screen reader. Quiet steps keep just their name.
        const spokenStatus = failed
          ? "failed"
          : blocked
            ? "waiting on a decision"
            : currentStatus.startsWith("running")
              ? "running"
              : currentStatus.startsWith("retrying")
                ? "retrying"
                : currentStatus;
        return (
          <li key={step.id} className="flex items-center last:pr-2 snap-start">
            <div
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-1.5 whitespace-nowrap px-2 text-xs font-medium transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] ${active ? "text-primary" : complete ? "text-ink-secondary" : "text-ink-tertiary"}`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] motion-reduce:animate-none ${active ? (running ? "animate-wave-pulse bg-accent text-primary" : "bg-accent text-primary") : complete ? "bg-surface-subtle text-ink-secondary" : "bg-surface text-ink-tertiary"}`}
              >
                <Icon aria-hidden="true" className="size-3" />
              </span>
              {label}
              {complete || active ? (
                <span className="sr-only">
                  {complete ? ", complete" : `, ${spokenStatus}`}
                </span>
              ) : null}
            </div>
            {index < LOOP_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                style={{ animationDelay: `${index * 120}ms` }}
                data-filled={complete || index < activeIndex || undefined}
                className={`loop-segment h-px w-4 bg-border motion-reduce:animate-none sm:w-7 ${running && index === activeIndex ? "animate-wave-pulse" : ""}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
