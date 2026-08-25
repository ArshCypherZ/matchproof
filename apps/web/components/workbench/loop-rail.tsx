import { Check, Circle, CircleDotDashed, OctagonAlert } from "lucide-react";

const steps = [
  "detect",
  "gather",
  "reconcile",
  "diagnose",
  "gate",
  "execute",
  "observe",
  "verify",
  "close",
];

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
    steps.indexOf(currentStep === "escalate" ? "close" : currentStep),
  );
  return (
    <ol
      aria-label="Controller loop"
      className="flex min-w-0 items-center gap-0 overflow-x-auto border-y border-border px-1 py-3"
    >
      {steps.map((step, index) => {
        const complete = terminal || index < activeIndex;
        const active = !terminal && index === activeIndex;
        const Icon = complete
          ? Check
          : active && currentStatus === "failed"
            ? OctagonAlert
            : active
              ? CircleDotDashed
              : Circle;
        return (
          <li key={step} className="flex items-center last:pr-2">
            <div
              className={`flex items-center gap-1.5 whitespace-nowrap px-2 text-xs font-medium capitalize ${active ? "text-primary" : complete ? "text-ink-secondary" : "text-ink-tertiary"}`}
            >
              <span
                className={`grid size-5 place-items-center rounded-full border ${active ? "border-primary bg-accent" : complete ? "border-border bg-surface-subtle" : "border-border bg-surface"}`}
              >
                <Icon aria-hidden="true" className="size-3" />
              </span>
              {step === "close" && currentStep === "escalate"
                ? "Escalated"
                : step}
            </div>
            {index < steps.length - 1 ? (
              <span
                aria-hidden="true"
                className={`h-px w-4 sm:w-7 ${index < activeIndex ? "bg-primary" : "bg-border"}`}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
