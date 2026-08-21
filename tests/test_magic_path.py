from __future__ import annotations

import json
import socket
import tempfile
import threading
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from incident_commander.audit import AuditTrail
from incident_commander.diagnosis import DiagnosisError, FixtureDiagnosisAdapter, GroqDiagnosisAdapter, ModelCallError
from incident_commander.evidence import load_fixture
from incident_commander.executor import AuthorizationError, BoundedExecutor
from incident_commander.reconstruction import reconstruct
from incident_commander.safety import evaluate
from incident_commander.store import IncidentStore
from incident_commander.workflow import run_incident


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "timeout_after_mutation.json"


class InvalidCitationAdapter:
    provider = "test"
    model = "invalid-citation"

    def diagnose(self, bundle, reconstruction):
        result = FixtureDiagnosisAdapter().diagnose(bundle, reconstruction)
        result["diagnosis"]["hypotheses"][0]["evidence_ids"] = ["EV-NOT-SUPPLIED"]
        return result


class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.body


class MagicPathTests(unittest.TestCase):
    def setUp(self):
        self.bundle = load_fixture(FIXTURE)
        self.reconstruction = reconstruct(self.bundle)

    def recommendation(self, action="reconcile_internal_state"):
        return {
            "action": action,
            "reasoning": "test",
            "uncertainty": "test",
            "evidence_ids": ["EV-STATE-001", "EV-WEBHOOK-001"],
        }

    def test_duplicate_webhook_is_suppressed(self):
        webhooks = [item for item in self.reconstruction["timeline"] if item["kind"] == "processor_webhook"]
        self.assertEqual([item["evidence_id"] for item in webhooks], ["EV-WEBHOOK-001"])
        self.assertEqual(self.reconstruction["duplicate_evidence_ids"], ["EV-WEBHOOK-002"])

    def test_late_event_is_ordered_by_occurrence_time(self):
        timeline = self.reconstruction["timeline"]
        ids = [item["evidence_id"] for item in timeline]
        self.assertLess(ids.index("EV-WEBHOOK-001"), ids.index("EV-TIMEOUT-001"))
        webhook = next(item for item in timeline if item["evidence_id"] == "EV-WEBHOOK-001")
        timeout = next(item for item in timeline if item["evidence_id"] == "EV-TIMEOUT-001")
        self.assertGreater(webhook["received_at"], timeout["received_at"])

    def test_timeout_after_mutation_has_ambiguous_intermediate_state(self):
        states = [item["state"] for item in self.reconstruction["observation_transitions"]]
        self.assertEqual(states, ["requested", "ambiguous_after_timeout", "captured_verified"])

    def test_unsafe_retry_is_rejected(self):
        decision = evaluate(self.recommendation("retry_capture"), self.bundle, self.reconstruction)
        self.assertFalse(decision["allowed"])
        self.assertIn("never authorized", decision["reason"])

    def test_unknown_action_fails_closed(self):
        decision = evaluate(self.recommendation("refund_payment"), self.bundle, self.reconstruction)
        self.assertFalse(decision["allowed"])
        self.assertIn("unsupported", decision["reason"])

    def test_cross_evidence_mismatches_fail_closed(self):
        cases = [
            ("processor_webhook", "amount_minor", 999, "processor amount differs"),
            ("processor_webhook", "currency", "USD", "processor currency differs"),
            ("processor_webhook", "payment_id", "pay_wrong", "processor payment ID differs"),
            ("internal_state", "last_operation_key", "wrong-key", "operation/idempotency key differs"),
            ("internal_state", "payment_state", "captured", "internal evidence is not the expected pending state"),
        ]
        for kind, field, value, expected in cases:
            with self.subTest(field=field):
                changed = deepcopy(self.bundle)
                for item in changed["evidence"]:
                    if item["kind"] == kind:
                        item["payload"][field] = value
                decision = evaluate(self.recommendation(), changed, reconstruct(changed))
                self.assertFalse(decision["allowed"])
                self.assertIn(expected, decision["reason"])

    def test_invalid_ai_evidence_reference_is_rejected_and_audited(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "incident.sqlite3"
            with self.assertRaises(DiagnosisError):
                run_incident(FIXTURE, state_path, diagnosis_adapter=InvalidCitationAdapter())
            events = [item["event_type"] for item in IncidentStore(state_path).audit_records()]
            self.assertIn("model_call_completed", events)
            self.assertIn("model_call_failed", events)
            self.assertNotIn("recovery_completed", events)

    def test_groq_adapter_uses_strict_schema_and_records_provenance(self):
        diagnosis = FixtureDiagnosisAdapter().diagnose(self.bundle, self.reconstruction)["diagnosis"]
        body = {
            "id": "chatcmpl-real-shape",
            "model": "openai/gpt-oss-20b",
            "created": 123,
            "system_fingerprint": "fp_test",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(diagnosis)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        }
        adapter = GroqDiagnosisAdapter("test-key")
        with patch("urllib.request.urlopen", return_value=FakeResponse(body)) as mocked:
            result = adapter.diagnose(self.bundle, self.reconstruction)
        request_body = json.loads(mocked.call_args.args[0].data)
        self.assertTrue(request_body["response_format"]["json_schema"]["strict"])
        self.assertEqual(result["provenance"]["provider"], "groq")
        self.assertEqual(result["provenance"]["request_id"], "chatcmpl-real-shape")
        self.assertIn("request_sha256", result["provenance"])

    def test_groq_timeout_is_clean_model_failure(self):
        adapter = GroqDiagnosisAdapter("test-key", timeout=1)
        with patch("urllib.request.urlopen", side_effect=socket.timeout):
            with self.assertRaisesRegex(ModelCallError, "timed out"):
                adapter.diagnose(self.bundle, self.reconstruction)

    def test_forged_retry_authorization_is_rejected_by_executor(self):
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            store.seed_payment(self.bundle)
            executor = BoundedExecutor(store, AuditTrail(store))
            forged = {"action": "retry_capture", "allowed": True, "reason": "forged", "evidence_ids": []}
            with self.assertRaises(AuthorizationError):
                executor.execute(forged, self.recommendation("retry_capture"), self.bundle, self.reconstruction)
            self.assertEqual(store.payment(self.bundle["payment_id"])["state"], "capture_pending")

    def test_forged_reconciliation_authorization_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            changed = deepcopy(self.bundle)
            for item in changed["evidence"]:
                if item["kind"] == "processor_webhook":
                    item["payload"]["currency"] = "USD"
            reconstruction = reconstruct(changed)
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            store.seed_payment(changed)
            executor = BoundedExecutor(store, AuditTrail(store))
            forged = {"action": "reconcile_internal_state", "allowed": True, "reason": "forged", "evidence_ids": self.recommendation()["evidence_ids"]}
            with self.assertRaisesRegex(AuthorizationError, "contradicts"):
                executor.execute(forged, self.recommendation(), changed, reconstruction)

    def test_reconciliation_mutates_durable_payment_state(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "incident.sqlite3"
            result = run_incident(FIXTURE, state_path, diagnosis_adapter=FixtureDiagnosisAdapter(), reset_state=True)
            payment = IncidentStore(state_path).payment(self.bundle["payment_id"])
            self.assertEqual(result["outcome"]["before_state"], "capture_pending")
            self.assertEqual(result["outcome"]["after_state"], "captured_verified")
            self.assertEqual(payment["state"], "captured_verified")

    def test_concurrent_recovery_has_one_logical_completion(self):
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            store.seed_payment(self.bundle)
            recommendation = self.recommendation()
            decision = evaluate(recommendation, self.bundle, self.reconstruction)
            barrier = threading.Barrier(3)
            outcomes = []
            failures = []

            def recover():
                try:
                    barrier.wait()
                    executor = BoundedExecutor(store, AuditTrail(store))
                    outcomes.append(executor.execute(decision, recommendation, self.bundle, self.reconstruction))
                except Exception as exc:
                    failures.append(exc)

            workers = [threading.Thread(target=recover) for _ in range(3)]
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join()

            self.assertEqual(failures, [])
            self.assertEqual([item["status"] for item in outcomes].count("reconciled"), 1)
            self.assertEqual([item["status"] for item in outcomes].count("already_completed"), 2)
            records = store.audit_records()
            self.assertEqual(len([item for item in records if item["event_type"] == "recovery_completed"]), 1)
            self.assertEqual([item["sequence"] for item in records], list(range(1, len(records) + 1)))

    def test_recovery_is_idempotent_across_workflow_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "incident.sqlite3"
            first = run_incident(FIXTURE, state_path, diagnosis_adapter=FixtureDiagnosisAdapter())
            second = run_incident(FIXTURE, state_path, diagnosis_adapter=FixtureDiagnosisAdapter())
            self.assertEqual(first["outcome"]["status"], "reconciled")
            self.assertEqual(second["outcome"]["status"], "already_completed")
            records = IncidentStore(state_path).audit_records()
            self.assertEqual(len([item for item in records if item["event_type"] == "recovery_completed"]), 1)

    def test_complete_end_to_end_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            result = run_incident(FIXTURE, Path(directory) / "incident.sqlite3", diagnosis_adapter=FixtureDiagnosisAdapter(), reset_state=True)
            self.assertEqual(result["reconstruction"]["current_state"], "captured_verified")
            self.assertEqual(
                [(item["action"], item["allowed"]) for item in result["gate_decisions"]],
                [("retry_capture", False), ("reconcile_internal_state", True)],
            )
            self.assertEqual(result["outcome"]["status"], "reconciled")
            event_types = {item["event_type"] for item in result["audit_records"]}
            self.assertTrue({
                "incident_ingested", "evidence_assembled", "timeline_reconstructed",
                "model_call_started", "model_call_completed", "diagnosis_validated",
                "safety_gate_decision", "recovery_completed", "workflow_completed",
            }.issubset(event_types))


if __name__ == "__main__":
    unittest.main()
