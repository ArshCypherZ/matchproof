from __future__ import annotations

from typing import Protocol, TypedDict


class InvalidEvidenceReference(ValueError):
    pass


class Hypothesis(TypedDict):
    rank: int
    summary: str
    confidence: float
    evidence_ids: list[str]


class Remediation(TypedDict):
    action: str
    reason: str
    evidence_ids: list[str]


class Diagnosis(TypedDict):
    hypotheses: list[Hypothesis]
    remediations: list[Remediation]


class DiagnosisAdapter(Protocol):
    def diagnose(self, bundle: dict, reconstruction: dict) -> Diagnosis: ...


class FixtureDiagnosisAdapter:
    def diagnose(self, bundle, reconstruction):
        return {
            "hypotheses": [
                {
                    "rank": 1,
                    "summary": (
                        "The processor completed the capture, but the caller timed out before "
                        "receiving the synchronous acknowledgement."
                    ),
                    "confidence": 0.98,
                    "evidence_ids": ["EV-REQ-001", "EV-TIMEOUT-001", "EV-WEBHOOK-001"],
                },
                {
                    "rank": 2,
                    "summary": (
                        "The merchant record stayed pending because the late processor event had "
                        "not yet been applied."
                    ),
                    "confidence": 0.94,
                    "evidence_ids": ["EV-STATE-001", "EV-WEBHOOK-001"],
                },
            ],
            "remediations": [
                {
                    "action": "retry_capture",
                    "reason": "Retry the capture to force the merchant workflow to a terminal state.",
                    "evidence_ids": ["EV-TIMEOUT-001", "EV-STATE-001"],
                },
                {
                    "action": "reconcile_internal_state",
                    "reason": (
                        "Apply the verified captured event to the merchant record without issuing "
                        "another processor mutation."
                    ),
                    "evidence_ids": ["EV-STATE-001", "EV-WEBHOOK-001"],
                },
            ],
        }


def validate_diagnosis(diagnosis, reconstruction):
    if not isinstance(diagnosis, dict):
        raise InvalidEvidenceReference("diagnosis must be an object")
    if set(diagnosis) != {"hypotheses", "remediations"}:
        raise InvalidEvidenceReference("diagnosis has an invalid shape")
    canonical_ids = {item["evidence_id"] for item in reconstruction["timeline"]}
    if not diagnosis["hypotheses"]:
        raise InvalidEvidenceReference("diagnosis must include at least one hypothesis")
    if not diagnosis["remediations"]:
        raise InvalidEvidenceReference("diagnosis must include at least one remediation")

    for hypothesis in diagnosis["hypotheses"]:
        if set(hypothesis) != {"rank", "summary", "confidence", "evidence_ids"}:
            raise InvalidEvidenceReference("hypothesis has an invalid shape")
        _validate_citations(
            f"hypothesis {hypothesis['rank']}", hypothesis["evidence_ids"], canonical_ids
        )
        if not 0.0 <= hypothesis["confidence"] <= 1.0:
            raise InvalidEvidenceReference(
                f"hypothesis {hypothesis['rank']} confidence must be between 0 and 1"
            )
    for recommendation in diagnosis["remediations"]:
        if set(recommendation) != {"action", "reason", "evidence_ids"}:
            raise InvalidEvidenceReference("remediation has an invalid shape")
        if recommendation["action"] not in {
            "retry_capture",
            "reconcile_internal_state",
            "escalate",
        }:
            raise InvalidEvidenceReference(
                f"unsupported remediation action: {recommendation['action']}"
            )
        _validate_citations(
            f"remediation {recommendation['action']}",
            recommendation["evidence_ids"],
            canonical_ids,
        )


def _validate_citations(label, cited, valid):
    if not cited:
        raise InvalidEvidenceReference(f"{label} has no evidence citations")
    unknown = sorted(set(cited) - valid)
    if unknown:
        raise InvalidEvidenceReference(f"{label} cites invalid evidence IDs: {unknown}")
