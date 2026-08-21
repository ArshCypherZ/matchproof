from __future__ import annotations

from pathlib import Path

from .audit import AuditTrail
from .diagnosis import (
    FixtureDiagnosisAdapter,
    InvalidEvidenceReference,
    validate_diagnosis,
)
from .evidence import load_fixture
from .executor import BoundedExecutor
from .reconstruction import reconstruct
from .safety import evaluate


def run_incident(
    fixture_path,
    audit_path,
    *,
    diagnosis_adapter=None,
    reset_audit=False,
):
    audit = AuditTrail(audit_path, reset=reset_audit)
    bundle = load_fixture(fixture_path)
    audit.append("incident_ingested", bundle)

    reconstruction = reconstruct(bundle)
    audit.append(
        "evidence_assembled",
        {
            "supplied": len(bundle["evidence"]),
            "canonical": len(reconstruction["timeline"]),
            "duplicates_suppressed": reconstruction["duplicate_evidence_ids"],
        },
    )
    audit.append("timeline_reconstructed", reconstruction)

    adapter = diagnosis_adapter or FixtureDiagnosisAdapter()
    diagnosis = adapter.diagnose(bundle, reconstruction)
    try:
        validate_diagnosis(diagnosis, reconstruction)
    except InvalidEvidenceReference as exc:
        audit.append("diagnosis_rejected", {"reason": str(exc), "diagnosis": diagnosis})
        raise
    audit.append("diagnosis_validated", diagnosis)

    gate_decisions = []
    outcome = None
    executor = BoundedExecutor(audit)
    for recommendation in diagnosis["remediations"]:
        decision = evaluate(recommendation, bundle, reconstruction)
        gate_decisions.append(decision)
        audit.append("safety_gate_decision", decision)
        if decision["allowed"]:
            outcome = executor.execute(decision, bundle, reconstruction)
            break

    if outcome is None:
        raise RuntimeError("no bounded remediation or escalation was authorized")
    audit.append("workflow_completed", outcome)
    return {
        "bundle": bundle,
        "reconstruction": reconstruction,
        "diagnosis": diagnosis,
        "gate_decisions": gate_decisions,
        "outcome": outcome,
        "audit_path": Path(audit_path),
    }
