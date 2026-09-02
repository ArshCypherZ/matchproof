"use client";

import { useEffect, useRef } from "react";
import {
  Check,
  Circle,
  CircleDotDashed,
  CirclePause,
  Minus,
  OctagonAlert,
  ShieldAlert,
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

  // A step is complete only when the pipeline recorded it as completed —
  // including the close step: an escalated exception stopped there, and the
  // rail must show that gap instead of a blanket "terminal" mark that would
  // claim repairs that never ran.
  const statusByStep = new Map(progress.map((row) => [row.step, row.status]));
  const escalated =
    statusByStep.get("escalate") === "completed" || currentStep === "escalate";
  const closed = statusByStep.get("close") === "completed";
  const terminal = escalated || closed;
  // An unknown step id (the pipeline evolved past this rail, or the record
  // predates it) must not claim the record is back at its first step — no
  // step is active, and the rail states only what progress recorded.
  const activeIndex = LOOP_STEPS.findIndex(
    (step) => step.id === (currentStep === "escalate" ? "close" : currentStep),
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
          (step.id === "close" && closed);
        const active = !terminal && index === activeIndex;
        // "failed:2" carries an iteration count; "blocked" is the gate
        // waiting on an operator decision — neither looks like a running step.
        const failed = active && currentStatus.startsWith("failed");
        const blocked = active && currentStatus === "blocked";
        // An escalated record stopped at the close step — the step did not
        // complete, and a success tone there would claim a repair that never
        // closed. It reads as the escalation it is, in the same danger slot
        // the escalated status badge uses.
        const escalatedHere = escalated && step.id === "close";
        // On a terminal record, a step with no completed progress row must
        // not read as "pending": the loop is over, and the pipeline records
        // only some steps on webhook-driven records (a row can even sit at
        // "pending" forever). It reads as what it is — not recorded — in a
        // bare dash, quieter than a future step's filled circle.
        const notRecorded = terminal && !complete && !escalatedHere;
        const Icon = escalatedHere
          ? ShieldAlert
          : complete
            ? Check
            : notRecorded
              ? Minus
              : failed
                ? OctagonAlert
                : blocked
                  ? CirclePause
                  : active
                    ? CircleDotDashed
                    : Circle;
        const label =
          step.id === "close" && escalated ? "Escalated" : step.label;
        // Step tone follows the state, in the same semantic slots the badges
        // use (success / warning / destructive / accent) so one color means
        // one thing across the console. Only the icon chip and — for the
        // states that need the operator's eye — the label carry the tone;
        // future steps stay neutral ink. Icon shapes differ per state, so
        // the color is never the only signal.
        const tone = escalatedHere
          ? {
              chip: "bg-destructive/10 text-destructive-strong",
              label: "text-destructive-strong",
            }
          : failed
            ? {
                chip: "bg-destructive/10 text-destructive-strong",
                label: "text-destructive-strong",
              }
            : blocked
              ? { chip: "bg-warning-soft text-warning", label: "text-warning" }
              : active
                ? { chip: "bg-accent text-primary", label: "text-primary" }
                : complete
                  ? {
                      chip: "bg-success/10 text-success-strong",
                      label: "text-ink-secondary",
                    }
                  : notRecorded
                    ? {
                        chip: "bg-transparent text-ink-tertiary",
                        label: "text-ink-tertiary",
                      }
                    : {
                        chip: "bg-surface text-ink-tertiary",
                        label: "text-ink-tertiary",
                      };
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
              className={`flex items-center gap-1.5 whitespace-nowrap px-2 text-xs font-medium transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] ${tone.label}`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] motion-reduce:animate-none ${active && running ? "animate-wave-pulse " : ""}${tone.chip}`}
              >
                <Icon aria-hidden="true" className="size-3" />
              </span>
              {label}
              {complete || active || escalatedHere || notRecorded ? (
                <span className="sr-only">
                  {escalatedHere
                    ? ", escalated"
                    : complete
                      ? ", complete"
                      : notRecorded
                        ? ", not recorded"
                        : `, ${spokenStatus}`}
                </span>
              ) : null}
            </div>
            {index < LOOP_STEPS.length - 1 ? (
              <span
                aria-hidden="true"
                style={{ animationDelay: `${index * 120}ms` }}
                data-filled={
                  // On a terminal record the connector tells the recorded
                  // story only: it fills between two recorded steps, or into
                  // the escalation mark that ended the loop — never across a
                  // step the pipeline never wrote down.
                  terminal
                    ? (complete &&
                        (statusByStep.get(LOOP_STEPS[index + 1]!.id) ===
                          "completed" ||
                          (LOOP_STEPS[index + 1]!.id === "close" &&
                            escalated))) ||
                      undefined
                    : complete || index < activeIndex || undefined
                }
                className={`loop-segment h-px w-4 bg-border motion-reduce:animate-none sm:w-7 ${running && index === activeIndex ? "animate-wave-pulse" : ""}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
