from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .diagnosis import DiagnosisError, FixtureDiagnosisAdapter, ModelCallError, load_env
from .evidence import EvidenceError
from .workflow import run_incident


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FIXTURE = REPOSITORY_ROOT / "fixtures" / "timeout_after_mutation.json"
DEFAULT_STATE = REPOSITORY_ROOT / ".runtime" / "o2-incident.sqlite3"
DEFAULT_ENV = REPOSITORY_ROOT / ".env"
REHEARSAL_PROCESSOR_SECRET = "test-prototype-secret"


def main():
    parser = argparse.ArgumentParser(description="Run the O2 Financial AI Incident Commander")
    parser.add_argument(
        "--mode",
        choices=("fixture", "live"),
        default="fixture",
        help="diagnosis mode: fixture rehearsal (default, no network) or live Groq",
    )
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument(
        "--env",
        type=Path,
        default=DEFAULT_ENV,
        help="live-mode environment file (default: .env)",
    )
    parser.add_argument(
        "--keep-state",
        action="store_true",
        help="keep durable state to demonstrate recovery idempotency",
    )
    args = parser.parse_args()
    try:
        if args.mode == "fixture":
            result = run_incident(
                args.fixture,
                args.state,
                diagnosis_adapter=FixtureDiagnosisAdapter(),
                diagnosis_mode="fixture",
                processor_secret=REHEARSAL_PROCESSOR_SECRET,
                reset_state=not args.keep_state,
            )
        else:
            load_env(args.env)
            if not os.environ.get("GROQ_API_KEY"):
                parser.error(
                    "live mode unavailable: GROQ_API_KEY is missing. "
                    "Configure it in the selected --env file or use --mode fixture"
                )
            result = run_incident(
                args.fixture,
                args.state,
                diagnosis_mode="live",
                reset_state=not args.keep_state,
            )
    except (ModelCallError, DiagnosisError) as exc:
        parser.error(f"live mode unavailable: {exc}. Configure GROQ_API_KEY in .env or use --mode fixture")
    except EvidenceError as exc:
        parser.error(f"incident evidence rejected: {exc}")
    print(_render(result))


def _render(result):
    mode = result.get("diagnosis_mode", "unknown").upper()
    lines = [
        "O2 | Financial AI Incident Commander",
        f"DIAGNOSIS MODE: {mode} / {'REHEARSAL' if mode == 'FIXTURE' else 'GROQ MODEL'}",
        "",
        "INCIDENT",
        f"   payment={result['bundle']['payment_id']}",
        "   Capture timed out after the processor mutation; merchant state remained pending.",
        "",
        "EVIDENCE (received order)",
    ]
    duplicate_ids = set(result["reconstruction"]["duplicate_evidence_ids"])
    for item in sorted(result["bundle"]["evidence"], key=lambda value: value["received_at"]):
        marker = " [duplicate suppressed]" if item["evidence_id"] in duplicate_ids else ""
        lines.append(
            f"   {item['evidence_id']:<16} {item['kind']:<20} "
            f"received={_time(item['received_at'])}{marker}"
        )

    lines.extend(["", "TIMELINE (canonical event time)"])
    for item in result["reconstruction"]["timeline"]:
        late = " [late arrival]" if item["kind"] == "processor_webhook" else ""
        lines.append(
            f"   {_time(item['occurred_at'])}  {item['evidence_id']:<16} {item['kind']}{late}"
        )

    lines.append("   State reconstruction:")
    for transition in result["reconstruction"]["observation_transitions"]:
        lines.append(
            f"   {_time(transition['observed_at'])}  {transition['state']}: "
            f"{transition['reason']}"
        )

    provenance = result["model_provenance"]
    lines.extend(
        [
            "",
            "DIAGNOSIS (evidence-grounded, advisory)",
            f"   provider={provenance['provider']} model={provenance.get('returned_model', provenance.get('requested_model'))} "
            f"request_id={provenance.get('request_id', 'fixture-rehearsal')}",
        ]
    )
    if provenance.get("usage") is not None:
        lines.append(f"   usage={json.dumps(provenance['usage'], sort_keys=True)}")
    for hypothesis in result["diagnosis"]["hypotheses"]:
        citations = ", ".join(hypothesis["evidence_ids"])
        lines.append(
            f"   #{hypothesis['rank']} {hypothesis['confidence']:.0%} "
            f"{hypothesis['summary']} [{citations}]"
        )
        lines.append(f"      uncertainty: {hypothesis['uncertainty']}")

    lines.extend(["", "SAFETY DECISION (deterministic authority)"])
    for decision in result["gate_decisions"]:
        verdict = "APPROVED" if decision["allowed"] else "BLOCKED"
        lines.append(f"   {verdict:<8} {decision['action']}: {decision['reason']}")

    lines.extend(
        [
            "",
            "DURABLE OUTCOME",
            f"   {result['outcome']['status']}: {result['outcome']['before_state']} -> "
            f"{result['outcome']['after_state']}",
            f"   durable payment state={result['payment_state']['state']}",
            f"   amount_minor={result['payment_state']['amount_minor']} "
            f"currency={result['payment_state']['currency']}",
            f"   operation={result['payment_state']['operation']} "
            f"operation_key={result['payment_state']['operation_key']}",
            "   Recovery scope: merchant-side record reconciliation.",
            "",
            "AUDIT",
            f"   {result['state_path']}",
            f"   audit records={len(result['audit_records'])}",
            "   key events:",
        ]
    )
    important = {
        "incident_ingested",
        "timeline_reconstructed",
        "diagnosis_validated",
        "safety_gate_decision",
        "recovery_completed",
        "workflow_completed",
    }
    for record in result["audit_records"]:
        if record["event_type"] in important:
            lines.append(f"      {record['sequence']:>2} {record['event_type']}")
    lines.extend(
        [
            "",
            "TAKEAWAY",
            "   AI explains the incident. Deterministic controls authorize the safe action.",
            "   Recovery is bounded, durable, and auditable.",
        ]
    )
    return "\n".join(lines)


def _time(value):
    return str(value).replace("+00:00", "Z")


if __name__ == "__main__":
    main()
