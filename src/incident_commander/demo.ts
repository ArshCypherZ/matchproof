import { runIncident } from "./workflow";
import path from "node:path";
const root = path.resolve(__dirname, "../..");
const defaultFixtureState = path.join(
  root,
  ".runtime",
  "o2-incident-store.sqlite3",
);
async function main() {
  const args = process.argv;
  const state = args.includes("--state")
    ? (args[args.indexOf("--state") + 1] ?? defaultFixtureState)
    : defaultFixtureState;
  const result = await runIncident(
    path.join(root, "fixtures/timeout_after_mutation.json"),
    state,
    { resetState: !args.includes("--keep-state"), diagnosisMode: "fixture" },
  );
  if (!result.gate_decisions.length)
    throw new Error("expected safety decision was not produced");
  const decisions = result.gate_decisions
    .map(
      (decision) =>
        `   ${decision.allowed ? "APPROVED" : "BLOCKED"}  ${decision.action}: ${decision.reason}`,
    )
    .join("\n");
  console.log(
    `O2 | Financial AI Incident Commander\nDIAGNOSIS MODE: FIXTURE / REHEARSAL\n\nINCIDENT\n   payment=${result.bundle.payment_id}\n\nSAFETY DECISION (deterministic authority)\n${decisions}\n\nDURABLE OUTCOME\n   ${result.outcome.status}: ${result.outcome.before_state} -> ${result.outcome.after_state}\n   durable payment state=${result.payment_state.state}\n   amount_minor=${result.payment_state.amount_minor} currency=${result.payment_state.currency}\n   operation=${result.payment_state.operation} operation_key=${result.payment_state.operation_key}`,
  );
}

if (require.main === module) void main();
