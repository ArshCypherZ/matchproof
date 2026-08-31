// Machine pipeline steps, rendered with the operator-facing label that names
// what the operator can do at that stage. Step ids are the durable contract
// (progress records them); labels are copy. The workbench loop rail and the
// queue speak the same words, so a step reads the same in every surface.
export const STEP_LABELS: Record<string, string> = {
  detect: "Found",
  gather: "Evidence in",
  reconcile: "Checked",
  diagnose: "Diagnosed",
  gate: "Needs decision",
  execute: "Applying",
  observe: "Observing",
  verify: "Verifying",
  close: "Closed",
  escalate: "Escalated",
};

// An unknown step id is shown as itself — never a guessed label.
export function stepLabel(step: string) {
  return STEP_LABELS[step] ?? step;
}
