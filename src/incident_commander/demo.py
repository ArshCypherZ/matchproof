from __future__ import annotations

import argparse
from pathlib import Path

from .workflow import run_incident


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = REPOSITORY_ROOT / "fixtures" / "timeout_after_mutation.json"
DEFAULT_AUDIT = REPOSITORY_ROOT / ".runtime" / "mp001-audit.jsonl"


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the MP-001 financial incident magic path")
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument(
        "--keep-audit",
        action="store_true",
        help="append to the existing audit trail to demonstrate recovery idempotency",
    )
    args = parser.parse_args()
    result = run_incident(
        args.fixture,
        args.audit,
        reset_audit=not args.keep_audit,
    )
    print(_render(result))


def _render(result):
    lines = [
        "MP-001 | timeout after capture mutation",
        "",
        "1. Evidence received",
    ]
    duplicate_ids = set(result["reconstruction"]["duplicate_evidence_ids"])
    for item in sorted(result["bundle"]["evidence"], key=lambda evidence: evidence["received_at"]):
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
            f"   {_time(transition['observed_at'])}  {transition['state']}: {transition['reason']}"
        )

    lines.extend(["", "4. Evidence-backed diagnosis"])
    for hypothesis in result["diagnosis"]["hypotheses"]:
        citations = ", ".join(hypothesis["evidence_ids"])
        lines.append(
            f"   #{hypothesis['rank']} {hypothesis['confidence']:.0%} "
            f"{hypothesis['summary']} [{citations}]"
        )

    lines.extend(["", "5. Deterministic safety gate"])
    for decision in result["gate_decisions"]:
        verdict = "APPROVED" if decision["allowed"] else "BLOCKED"
        lines.append(f"   {verdict:<8} {decision['action']}: {decision['reason']}")

    lines.extend(
        [
            "",
            "6. Bounded outcome",
            f"   {result['outcome']['status']}: {result['outcome']['before_state']} -> "
            f"{result['outcome']['after_state']}",
            "   No financial API was called; the merchant-side record was reconciled.",
            "",
            "7. Audit trail",
            f"   {result['audit_path']}",
        ]
    )
    return "\n".join(lines)


def _time(value: object) -> str:
    return str(value).replace("+00:00", "Z")


if __name__ == "__main__":
    main()
