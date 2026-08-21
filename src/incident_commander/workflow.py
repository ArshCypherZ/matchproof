from __future__ import annotations

from pathlib import Path

from .audit import AuditTrail
from .diagnosis import DiagnosisError, FixtureDiagnosisAdapter, GroqDiagnosisAdapter, ModelCallError, load_env, validate_diagnosis
from .evidence import EvidenceError, load_fixture
from .executor import BoundedExecutor
from .reconstruction import reconstruct
from .safety import evaluate
from .store import IncidentStore


def run_incident(
    fixture_path,
    state_path,
    *,
    diagnosis_adapter=None,
    reset_state=False,
    env_path=None,
    processor_secret=None,
    diagnosis_mode=None,
):
    if env_path:
        load_env(env_path)
    store = IncidentStore(state_path, reset=reset_state, processor_secret=processor_secret)
    audit = AuditTrail(store)
    try:
        bundle = load_fixture(fixture_path, processor_secret=processor_secret)
    except EvidenceError as exc:
        audit.append("evidence_rejected", {"reason": str(exc), "mechanism": "prototype_hmac_sha256"})
        raise
    store.ingest(bundle)
    bundle = store.incident(bundle["incident_id"])
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

    adapter = diagnosis_adapter or GroqDiagnosisAdapter.from_env(env_path)
    audit.append("model_call_started", {"provider": adapter.provider, "model": adapter.model})
    try:
        model_result = adapter.diagnose(bundle, reconstruction)
        diagnosis = model_result["diagnosis"]
        audit.append("model_call_completed", model_result["provenance"])
        validate_diagnosis(diagnosis, reconstruction)
    except (DiagnosisError, ModelCallError) as exc:
        audit.append(
            "model_call_failed",
            {
                "provider": adapter.provider,
                "model": adapter.model,
                "error_type": type(exc).__name__,
                "reason": str(exc),
            },
        )
        raise
    audit.append("diagnosis_validated", diagnosis)

    unsafe_retry = {
        "action": "retry_capture",
        "reasoning": "Naive retry after timeout",
        "uncertainty": "The timeout does not prove the processor mutation failed.",
        "evidence_ids": ["EV-TIMEOUT-001", "EV-WEBHOOK-001"],
    }
    gate_decisions = [evaluate(unsafe_retry, bundle, reconstruction)]
    audit.append("safety_gate_decision", gate_decisions[0])

    recommendation = diagnosis["recommendation"]
    decision = evaluate(recommendation, bundle, reconstruction)
    gate_decisions.append(decision)
    audit.append("safety_gate_decision", decision)
    if not decision["allowed"]:
        recommendation = {
            "action": "escalate",
            "reasoning": "Required reconciliation invariants did not hold.",
            "uncertainty": decision["reason"],
            "evidence_ids": recommendation["evidence_ids"],
        }
        decision = evaluate(recommendation, bundle, reconstruction)
        gate_decisions.append(decision)
        audit.append("safety_gate_decision", decision)

    executor = BoundedExecutor(store, audit)
    outcome = executor.execute(decision, recommendation, bundle["incident_id"], bundle["payment_id"])
    try:
        audit.append("workflow_completed", outcome)
    except Exception as exc:
        outcome = dict(outcome)
        outcome["status"] = "committed_with_reporting_error" if outcome["status"] in {"reconciled", "already_completed"} else outcome["status"]
        outcome["reporting_status"] = "error"
        outcome["reporting_error"] = str(exc)
    return {
        "bundle": bundle,
        "reconstruction": reconstruction,
        "diagnosis": diagnosis,
        "model_provenance": model_result["provenance"],
        "diagnosis_mode": diagnosis_mode or ("fixture" if adapter.provider == "fixture" else "live"),
        "gate_decisions": gate_decisions,
        "outcome": outcome,
        "payment_state": store.payment(bundle["payment_id"]),
        "state_path": Path(state_path),
        "audit_records": audit.records(),
    }
