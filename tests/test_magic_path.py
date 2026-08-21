from __future__ import annotations

import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from incident_commander.audit import AuditTrail
from incident_commander.diagnosis import InvalidEvidenceReference
from incident_commander.evidence import load_fixture
from incident_commander.reconstruction import reconstruct
from incident_commander.safety import evaluate
from incident_commander.workflow import run_incident


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "timeout_after_mutation.json"


class InvalidCitationAdapter:
    def diagnose(self, bundle, reconstruction):
        return {
            "hypotheses": [{
                "rank": 1,
                "summary": "Unsupported diagnosis",
                "confidence": 0.7,
                "evidence_ids": ["EV-NOT-SUPPLIED"],
            }],
            "remediations": [{
                "action": "escalate",
                "reason": "Escalate",
                "evidence_ids": ["EV-REQ-001"],
            }],
        }


class MagicPathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.bundle = load_fixture(FIXTURE)
        self.reconstruction = reconstruct(self.bundle)

    def test_duplicate_webhook_is_suppressed(self) -> None:
        webhook_events = [
            item
            for item in self.reconstruction["timeline"]
            if item["kind"] == "processor_webhook"
        ]
        self.assertEqual([item["evidence_id"] for item in webhook_events], ["EV-WEBHOOK-001"])
        self.assertEqual(self.reconstruction["duplicate_evidence_ids"], ["EV-WEBHOOK-002"])

    def test_late_event_is_ordered_by_occurrence_time(self) -> None:
        timeline_ids = [item["evidence_id"] for item in self.reconstruction["timeline"]]
        self.assertLess(
            timeline_ids.index("EV-WEBHOOK-001"),
            timeline_ids.index("EV-TIMEOUT-001"),
        )
        webhook = next(
            item for item in self.reconstruction["timeline"] if item["evidence_id"] == "EV-WEBHOOK-001"
        )
        timeout = next(
            item for item in self.reconstruction["timeline"] if item["evidence_id"] == "EV-TIMEOUT-001"
        )
        self.assertGreater(webhook["received_at"], timeout["received_at"])

    def test_timeout_after_mutation_has_ambiguous_intermediate_state(self) -> None:
        states = [item["state"] for item in self.reconstruction["observation_transitions"]]
        self.assertEqual(
            states,
            ["requested", "ambiguous_after_timeout", "captured_verified"],
        )

    def test_unsafe_retry_is_rejected(self) -> None:
        recommendation = {
            "action": "retry_capture",
            "reason": "Retry after timeout",
            "evidence_ids": ["EV-TIMEOUT-001"],
        }
        decision = evaluate(recommendation, self.bundle, self.reconstruction)
        self.assertFalse(decision["allowed"])
        self.assertIn("unsafe", decision["reason"])

    def test_reconciliation_requires_matching_invariants(self) -> None:
        recommendation = {
            "action": "reconcile_internal_state",
            "reason": "Reconcile from webhook",
            "evidence_ids": ["EV-WEBHOOK-001"],
        }
        self.assertTrue(evaluate(recommendation, self.bundle, self.reconstruction)["allowed"])

        mismatched_bundle = deepcopy(self.bundle)
        for item in mismatched_bundle["evidence"]:
            if item["evidence_id"].startswith("EV-WEBHOOK"):
                item["payload"]["amount_minor"] = 999
        decision = evaluate(recommendation, mismatched_bundle, reconstruct(mismatched_bundle))
        self.assertFalse(decision["allowed"])
        self.assertIn("amount differs", decision["reason"])

    def test_invalid_ai_evidence_reference_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.jsonl"
            with self.assertRaises(InvalidEvidenceReference):
                run_incident(
                    FIXTURE,
                    audit_path,
                    diagnosis_adapter=InvalidCitationAdapter(),
                )
            event_types = [item["event_type"] for item in AuditTrail(audit_path).records()]
            self.assertIn("diagnosis_rejected", event_types)

    def test_recovery_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.jsonl"
            first = run_incident(FIXTURE, audit_path)
            second = run_incident(FIXTURE, audit_path)
            self.assertEqual(first["outcome"]["status"], "reconciled")
            self.assertEqual(second["outcome"]["status"], "already_applied")
            completed = [
                item
                for item in AuditTrail(audit_path).records()
                if item["event_type"] == "recovery_completed"
            ]
            self.assertEqual(len(completed), 1)

    def test_complete_end_to_end_execution(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            audit_path = Path(directory) / "audit.jsonl"
            result = run_incident(FIXTURE, audit_path, reset_audit=True)
            self.assertEqual(result["reconstruction"]["current_state"], "captured_verified")
            self.assertEqual(
                [(decision["action"], decision["allowed"]) for decision in result["gate_decisions"]],
                [
                    ("retry_capture", False),
                    ("reconcile_internal_state", True),
                ],
            )
            self.assertEqual(result["outcome"]["status"], "reconciled")
            records = [json.loads(line) for line in audit_path.read_text().splitlines()]
            event_types = {item["event_type"] for item in records}
            self.assertTrue(
                {
                    "incident_ingested",
                    "evidence_assembled",
                    "timeline_reconstructed",
                    "diagnosis_validated",
                    "safety_gate_decision",
                    "recovery_completed",
                    "workflow_completed",
                }.issubset(event_types)
            )


if __name__ == "__main__":
    unittest.main()
