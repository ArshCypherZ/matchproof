from __future__ import annotations

import argparse
from pathlib import Path

from .workflow import run_incident


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = REPOSITORY_ROOT / "fixtures" / "timeout_after_mutation.json"
DEFAULT_STATE = REPOSITORY_ROOT / ".runtime" / "mp001.sqlite3"
DEFAULT_ENV = REPOSITORY_ROOT / ".env"


def main():
    parser = argparse.ArgumentParser(description="Run the MP-001 financial incident magic path")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument(
        "--keep-state",
        action="store_true",
        help="keep durable state to demonstrate recovery idempotency",
    )
    args = parser.parse_args()
    result = run_incident(
        args.fixture,
        args.state,
        reset_state=not args.keep_state,
        env_path=DEFAULT_ENV,
    )
    print(_render(result))


def _render(result):
    lines = ["MP-001 | timeout after capture mutation", "", "1. Evidence received"]
    duplicate_ids = set(result["reconstruction"]["duplicate_evidence_ids"])
    for item in sorted(result["bundle"]["evidence"], key=lambda value: value["received_at"]):
        marker = " [duplicate suppressed]" if item["evidence_id"] in duplicate_ids else ""
        lines.append(
            f"   {item['evidence_id']:<16} {item['kind']:<20} "
            f"received={_time(item['received_at'])}{marker}"
        )

    lines.extend(["", "2. Canonical timeline (event time, not arrival time)"])
    for item in result["reconstruction"]["timeline"]:
        late = " [late arrival]" if item["kind"] == "processor_webhook" else ""
        lines.append(
            f"   {_time(item['occurred_at'])}  {item['evidence_id']:<16} {item['kind']}{late}"
        )

    lines.extend(["", "3. Deterministic state reconstruction"])
    for transition in result["reconstruction"]["observation_transitions"]:
        lines.append(
            f"   {_time(transition['observed_at'])}  {transition['state']}: "
            f"{transition['reason']}"
        )

    provenance = result["model_provenance"]
    lines.extend(
        [
            "",
            "4. Real evidence-backed diagnosis",
            f"   provider={provenance['provider']} model={provenance['returned_model']} "
            f"request_id={provenance['request_id']}",
        ]
    )
    for hypothesis in result["diagnosis"]["hypotheses"]:
        citations = ", ".join(hypothesis["evidence_ids"])
        lines.append(
            f"   #{hypothesis['rank']} {hypothesis['confidence']:.0%} "
            f"{hypothesis['summary']} [{citations}]"
        )
        lines.append(f"      uncertainty: {hypothesis['uncertainty']}")

    lines.extend(["", "5. Deterministic safety gate"])
    for decision in result["gate_decisions"]:
        verdict = "APPROVED" if decision["allowed"] else "BLOCKED"
        lines.append(f"   {verdict:<8} {decision['action']}: {decision['reason']}")

    lines.extend(
        [
            "",
            "6. Bounded durable outcome",
            f"   {result['outcome']['status']}: {result['outcome']['before_state']} -> "
            f"{result['outcome']['after_state']}",
            f"   durable payment state={result['payment_state']['state']}",
            "   No financial API was called; the merchant-side record was reconciled.",
            "",
            "7. Durable state and audit trail",
            f"   {result['state_path']}",
            f"   audit records={len(result['audit_records'])}",
        ]
    )
    return "\n".join(lines)


def _time(value):
    return str(value).replace("+00:00", "Z")


if __name__ == "__main__":
    main()
