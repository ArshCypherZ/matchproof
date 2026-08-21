from __future__ import annotations

import json
import os
import socket
import tempfile
import threading
import sqlite3
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from incident_commander.audit import AuditTrail
from incident_commander.diagnosis import DiagnosisError, FixtureDiagnosisAdapter, GroqDiagnosisAdapter, ModelCallError
from incident_commander import demo
from incident_commander.evidence import EvidenceError, VerifiedEvidence, _validate_bundle, load_fixture, processor_signature, verify_bundle
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


class SuppressedCitationAdapter(InvalidCitationAdapter):
    def diagnose(self, bundle, reconstruction):
        result = FixtureDiagnosisAdapter().diagnose(bundle, reconstruction)
        result["diagnosis"]["hypotheses"][0]["evidence_ids"] = ["EV-WEBHOOK-002"]
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


def load_fixture_from_bundle(bundle):
    _validate_bundle(bundle, "test-prototype-secret")
    return bundle


def run_incident_from_bundle(bundle, state_path):
    fixture = Path(str(state_path) + ".json")
    value = deepcopy(bundle)
    for item in value["evidence"]:
        item.pop("processor_verified", None)
        item["occurred_at"] = item["occurred_at"].isoformat().replace("+00:00", "Z")
        item["received_at"] = item["received_at"].isoformat().replace("+00:00", "Z")
    fixture.write_text(json.dumps(value), encoding="utf-8")
    return run_incident(fixture, state_path, diagnosis_adapter=FixtureDiagnosisAdapter())


class MagicPathTests(unittest.TestCase):
    def setUp(self):
        os.environ["PROCESSOR_WEBHOOK_SECRET"] = "test-prototype-secret"
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

    def test_suppressed_evidence_cannot_be_cited(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(DiagnosisError):
                run_incident(FIXTURE, Path(directory) / "incident.sqlite3", diagnosis_adapter=SuppressedCitationAdapter())

    def test_processor_signature_boundary_rejects_attacks(self):
        webhook = next(item for item in self.bundle["evidence"] if item["kind"] == "processor_webhook")
        self.assertTrue(webhook["processor_verified"])
        for mutate in (
            lambda item: item.__setitem__("processor_signature", "forged"),
            lambda item: item["payload"].__setitem__("amount_minor", 1),
        ):
            changed = deepcopy(self.bundle)
            target = next(item for item in changed["evidence"] if item["kind"] == "processor_webhook")
            mutate(target)
            with self.assertRaises(EvidenceError):
                load_fixture_from_bundle(changed)
        spoofed = deepcopy(self.bundle)
        target = next(item for item in spoofed["evidence"] if item["kind"] == "processor_webhook")
        target["payload"]["signature_verified"] = True
        self.assertTrue(load_fixture_from_bundle(spoofed))

    def test_valid_processor_signature_is_accepted(self):
        self.assertEqual(processor_signature(next(item for item in self.bundle["evidence"] if item["kind"] == "processor_webhook")["payload"], "test-prototype-secret"), next(item for item in self.bundle["evidence"] if item["kind"] == "processor_webhook")["processor_signature"])

    def test_direct_save_evidence_rejects_caller_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            forged = deepcopy(self.bundle)
            webhook = next(item for item in forged["evidence"] if item["kind"] == "processor_webhook")
            webhook["processor_verified"] = True
            webhook["source"] = "attacker"
            webhook["payload"]["signature_verified"] = True
            with self.assertRaises(ValueError):
                store.save_evidence(forged)
            self.assertIsNone(store.incident(forged["incident_id"]))

    def test_forged_verified_evidence_cannot_mutate_payment(self):
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            forged = deepcopy(self.bundle)
            internal = next(item for item in forged["evidence"] if item["kind"] == "internal_state")
            internal["payload"]["payment_state"] = "captured_verified"
            internal["payload"]["amount_minor"] = 1
            with self.assertRaises(ImportError):
                exec("from incident_commander.evidence import _VERIFICATION_MARKER", {})
            with self.assertRaises(EvidenceError):
                VerifiedEvidence(forged, object())
            with self.assertRaises(ValueError):
                store.ingest_verified(forged)
            self.assertIsNone(store.payment(self.bundle["payment_id"]))

    def test_verified_evidence_is_deeply_immutable(self):
        verified = verify_bundle(self.bundle)
        bundle = verified.bundle
        internal = next(item for item in bundle["evidence"] if item["kind"] == "internal_state")
        webhook = next(item for item in bundle["evidence"] if item["kind"] == "processor_webhook")
        attacks = [
            lambda: bundle.__setitem__("payment_id", "pay_attacker"),
            lambda: internal["payload"].__setitem__("payment_state", "captured_verified"),
            lambda: internal["payload"].__setitem__("amount_minor", 2),
            lambda: webhook.__setitem__("processor_verified", False),
            lambda: webhook.__setitem__("source", "attacker"),
        ]
        for attack in attacks:
            with self.assertRaises((AttributeError, TypeError)):
                attack()
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            store.ingest(self.bundle)
            payment = store.payment(self.bundle["payment_id"])
            self.assertEqual(payment["state"], "capture_pending")
            self.assertEqual(payment["amount_minor"], 125000)

    def test_ingest_verified_cannot_be_called_with_forged_authority(self):
        class Forged:
            pass
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            forged_object = Forged()
            forged_object.bundle = self.bundle
            for forged in (forged_object, self.bundle, object.__new__(VerifiedEvidence)):
                with self.assertRaises((ValueError, AttributeError)):
                    store.ingest_verified(forged)
            self.assertIsNone(store.payment(self.bundle["payment_id"]))

    def test_nested_verified_payload_cannot_be_mutated(self):
        verified = verify_bundle(self.bundle)
        payload = verified.bundle["evidence"][2]["payload"]
        with self.assertRaises(TypeError):
            payload["amount_minor"] = 3
        with self.assertRaises(TypeError):
            verified.bundle["evidence"][2] = {"payload": {"amount_minor": 3}}
        self.assertEqual(payload["amount_minor"], 125000)

    def _assert_invalid_ingestion(self, mutate):
        changed = deepcopy(self.bundle)
        webhook = next(item for item in changed["evidence"] if item["kind"] == "processor_webhook")
        mutate(webhook["payload"])
        webhook["processor_signature"] = processor_signature(webhook["payload"], "test-prototype-secret")
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            with self.assertRaises(EvidenceError):
                store.ingest(changed)
            self.assertIsNone(store.payment(self.bundle["payment_id"]))
            with store.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM recoveries").fetchone()[0], 0)
            with store.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM recoveries").fetchone()[0], 0)

    def test_rejects_boolean_amount_minor(self):
        self._assert_invalid_ingestion(lambda payload: payload.__setitem__("amount_minor", True))

    def test_rejects_string_amount_minor(self):
        self._assert_invalid_ingestion(lambda payload: payload.__setitem__("amount_minor", "1"))

    def test_rejects_negative_amount_minor(self):
        self._assert_invalid_ingestion(lambda payload: payload.__setitem__("amount_minor", -1))

    def test_rejects_invalid_currency(self):
        self._assert_invalid_ingestion(lambda payload: payload.__setitem__("currency", "usd"))

    def test_rejects_invalid_operation(self):
        changed = deepcopy(self.bundle)
        request = next(item for item in changed["evidence"] if item["kind"] == "payment_request")
        request["payload"]["operation"] = "refund"
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            with self.assertRaises(EvidenceError):
                store.ingest(changed)
            self.assertIsNone(store.payment(self.bundle["payment_id"]))
            with store.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM recoveries").fetchone()[0], 0)

    def _assert_processor_operation_rejected(self, operation_marker):
        changed = deepcopy(self.bundle)
        for webhook in (item for item in changed["evidence"] if item["kind"] == "processor_webhook"):
            if operation_marker is None:
                webhook["payload"].pop("operation", None)
            else:
                webhook["payload"]["operation"] = operation_marker
            webhook["processor_signature"] = processor_signature(webhook["payload"], "test-prototype-secret")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incident.sqlite3"
            store = IncidentStore(path)
            with self.assertRaises(EvidenceError):
                store.ingest(changed)
            payment = store.payment(self.bundle["payment_id"])
            self.assertIsNone(payment)
            with store.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM recoveries").fetchone()[0], 0)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM audit_events WHERE event_type = 'recovery_completed'").fetchone()[0], 0)

    def test_rejects_processor_operation_refund(self):
        self._assert_processor_operation_rejected("refund")

    def test_rejects_processor_operation_missing(self):
        self._assert_processor_operation_rejected(None)

    def test_rejects_processor_operation_unsupported(self):
        self._assert_processor_operation_rejected("payout")

    def test_rejects_conflicting_processor_operation(self):
        self._assert_processor_operation_rejected("refund")

    def test_authenticated_contradictory_operation_cannot_reconcile(self):
        changed = deepcopy(self.bundle)
        for webhook in (item for item in changed["evidence"] if item["kind"] == "processor_webhook"):
            webhook["payload"]["operation"] = "refund"
            webhook["processor_signature"] = processor_signature(webhook["payload"], "test-prototype-secret")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incident.sqlite3"
            fixture = Path(directory) / "attack.json"
            value = deepcopy(changed)
            for item in value["evidence"]:
                item.pop("processor_verified", None)
                item["occurred_at"] = item["occurred_at"].isoformat().replace("+00:00", "Z")
                item["received_at"] = item["received_at"].isoformat().replace("+00:00", "Z")
            fixture.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaises(EvidenceError):
                run_incident(fixture, path, diagnosis_adapter=FixtureDiagnosisAdapter())
            store = IncidentStore(path)
            self.assertIsNone(store.payment(self.bundle["payment_id"]))
            with store.connect() as connection:
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM recoveries").fetchone()[0], 0)
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM audit_events WHERE event_type = 'recovery_completed'").fetchone()[0], 0)

    def test_rejects_invalid_payment_id(self):
        self._assert_invalid_ingestion(lambda payload: payload.__setitem__("payment_id", "123"))

    def test_rejects_invalid_idempotency_identity(self):
        self._assert_invalid_ingestion(lambda payload: payload.__setitem__("idempotency_key", "?"))

    def test_rejects_conflicting_financial_identity(self):
        changed = deepcopy(self.bundle)
        request = next(item for item in changed["evidence"] if item["kind"] == "payment_request")
        request["payload"]["amount_minor"] = 7
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            with self.assertRaises(EvidenceError):
                store.ingest(changed)
            self.assertIsNone(store.payment(self.bundle["payment_id"]))

    def test_authenticated_but_semantically_invalid_payload_cannot_persist(self):
        for invalid in (True, "1", -1):
            with self.subTest(amount=invalid):
                changed = deepcopy(self.bundle)
                webhook = next(item for item in changed["evidence"] if item["kind"] == "processor_webhook")
                webhook["payload"]["amount_minor"] = invalid
                webhook["processor_signature"] = processor_signature(webhook["payload"], "test-prototype-secret")
                with tempfile.TemporaryDirectory() as directory:
                    store = IncidentStore(Path(directory) / "incident.sqlite3")
                    with self.assertRaises(EvidenceError):
                        store.ingest(changed)
                    self.assertIsNone(store.payment(self.bundle["payment_id"]))
                    with store.connect() as connection:
                        self.assertEqual(connection.execute("SELECT COUNT(*) FROM recoveries").fetchone()[0], 0)

    def test_registry_injection_cannot_mutate_payment(self):
        import incident_commander.evidence as evidence_module
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            store.ingest(self.bundle)
            forged = object.__new__(VerifiedEvidence)
            attacker = deepcopy(self.bundle)
            internal = next(item for item in attacker["evidence"] if item["kind"] == "internal_state")["payload"]
            internal["payment_state"] = "captured_verified"
            internal["amount_minor"] = 9
            object.__setattr__(forged, "_bundle", attacker)
            registry = getattr(evidence_module, "_VERIFIED_OBJECTS", set())
            registry.add(forged)
            with self.assertRaises(ValueError):
                store.ingest_verified(forged)
            payment = store.payment(self.bundle["payment_id"])
            self.assertEqual(payment["state"], "capture_pending")
            self.assertEqual(payment["amount_minor"], 125000)

    def test_low_level_verified_object_mutation_cannot_mutate_payment(self):
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            store.ingest(self.bundle)
            verified = verify_bundle(self.bundle)
            attacker = deepcopy(self.bundle)
            internal = next(item for item in attacker["evidence"] if item["kind"] == "internal_state")["payload"]
            internal["payment_state"] = "captured_verified"
            internal["amount_minor"] = 7
            object.__setattr__(verified, "_bundle", attacker)
            with self.assertRaises(ValueError):
                store.ingest_verified(verified)
            payment = store.payment(self.bundle["payment_id"])
            self.assertEqual(payment["state"], "capture_pending")
            self.assertEqual(payment["amount_minor"], 125000)

    def test_private_bundle_replacement_cannot_mutate_payment(self):
        self.test_low_level_verified_object_mutation_cannot_mutate_payment()

    def test_object_identity_cannot_authorize_durable_write(self):
        with tempfile.TemporaryDirectory() as directory:
            store = IncidentStore(Path(directory) / "incident.sqlite3")
            store.ingest(self.bundle)
            verified = verify_bundle(self.bundle)
            with self.assertRaises(ValueError):
                store.ingest_verified(verified)
            payment = store.payment(self.bundle["payment_id"])
            self.assertEqual((payment["state"], payment["amount_minor"]), ("capture_pending", 125000))

    def test_executor_rejects_fake_suppressed_and_cross_incident_citations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incident.sqlite3"
            store = IncidentStore(path)
            store.ingest(self.bundle)
            executor = BoundedExecutor(store, AuditTrail(store))
            for citation in (["EV-FAKE-999"], ["EV-WEBHOOK-002"], ["EV-OTHER-001"]):
                recommendation = self.recommendation()
                recommendation["evidence_ids"] = citation
                forged_decision = {"action": "reconcile_internal_state", "allowed": True, "reason": "forged", "evidence_ids": citation}
                with self.assertRaises(AuthorizationError):
                    executor.execute(forged_decision, recommendation, self.bundle["incident_id"], self.bundle["payment_id"])
            self.assertEqual(store.payment(self.bundle["payment_id"])["state"], "capture_pending")

    def test_persisted_verification_is_recomputed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incident.sqlite3"
            store = IncidentStore(path)
            store.ingest(self.bundle)
            with store.connect() as connection:
                row = connection.execute("SELECT bundle FROM incidents WHERE incident_id = ?", (self.bundle["incident_id"],)).fetchone()
                value = json.loads(row[0])
                next(item for item in value["evidence"] if item["kind"] == "processor_webhook")["processor_verified"] = False
                connection.execute("UPDATE incidents SET bundle = ? WHERE incident_id = ?", (json.dumps(value), self.bundle["incident_id"]))
            self.assertTrue(next(item for item in store.incident(self.bundle["incident_id"])["evidence"] if item["kind"] == "processor_webhook")["processor_verified"])

    def test_ambiguous_histories_escalate_without_mutation(self):
        cases = []
        multiple_timeout = deepcopy(self.bundle)
        timeout = deepcopy(next(item for item in multiple_timeout["evidence"] if item["kind"] == "processor_timeout"))
        timeout["evidence_id"] = "EV-TIMEOUT-002"
        timeout["received_at"] = timeout["occurred_at"] = timeout["occurred_at"].replace(second=6)
        multiple_timeout["evidence"].append(timeout)
        cases.append(multiple_timeout)
        captures = deepcopy(self.bundle)
        capture = deepcopy(next(item for item in captures["evidence"] if item["kind"] == "processor_webhook"))
        capture["evidence_id"] = "EV-WEBHOOK-003"
        capture["payload"]["event_id"] = "evt_capture_002"
        capture["processor_signature"] = processor_signature(capture["payload"], "test-prototype-secret")
        captures["evidence"].append(capture)
        cases.append(captures)
        for changed in cases:
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "incident.sqlite3"
                result = run_incident_from_bundle(changed, path)
                self.assertEqual(result["outcome"]["status"], "escalated")
                self.assertEqual(result["payment_state"]["state"], "capture_pending")

    def test_post_commit_reporting_failure_is_not_financial_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incident.sqlite3"
            with patch("incident_commander.workflow.AuditTrail.append", side_effect=lambda event, payload: (_ for _ in ()).throw(RuntimeError("reporting unavailable")) if event == "workflow_completed" else 1):
                result = run_incident(FIXTURE, path, diagnosis_adapter=FixtureDiagnosisAdapter())
            self.assertEqual(result["outcome"]["status"], "committed_with_reporting_error")
            self.assertEqual(IncidentStore(path).payment(self.bundle["payment_id"])["state"], "captured_verified")
            replay = run_incident(FIXTURE, path, diagnosis_adapter=FixtureDiagnosisAdapter())
            self.assertEqual(replay["outcome"]["status"], "already_completed")

    def test_chronology_and_conflicting_history_fail_closed(self):
        cases = []
        before_request = deepcopy(self.bundle)
        for item in before_request["evidence"]:
            if item["kind"] == "processor_webhook":
                item["occurred_at"] = before_request["evidence"][0]["occurred_at"].replace(hour=9)
                item["processor_signature"] = processor_signature(item["payload"], "test-prototype-secret")
        cases.append(before_request)
        conflict = deepcopy(self.bundle)
        failed = deepcopy(next(item for item in conflict["evidence"] if item["kind"] == "processor_webhook"))
        failed["evidence_id"] = "EV-WEBHOOK-003"
        failed["payload"]["event_id"] = "evt_failed"
        failed["payload"]["event_type"] = "payment.failed"
        failed["processor_signature"] = processor_signature(failed["payload"], "test-prototype-secret")
        conflict["evidence"].append(failed)
        cases.append(conflict)
        for changed in cases:
            with self.assertRaises(EvidenceError):
                load_fixture_from_bundle(changed)

    def test_stale_recovery_record_is_repaired(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incident.sqlite3"
            store = IncidentStore(path)
            store.ingest(self.bundle)
            key = "reconcile_internal_state:inc_timeout_after_capture_001:pay_demo_001:capture-order-demo-001"
            with store.connect() as connection:
                connection.execute("INSERT INTO recoveries VALUES (?, ?, ?, ?, ?, ?)", (key, "reconcile_internal_state", "reconciled", "capture_pending", "captured_verified", "now"))
            result = run_incident(FIXTURE, path, diagnosis_adapter=FixtureDiagnosisAdapter())
            self.assertEqual(result["outcome"]["status"], "reconciled")

    def test_audit_failure_rolls_back_recovery_and_restart_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "incident.sqlite3"
            store = IncidentStore(path)
            store.ingest(self.bundle)
            executor = BoundedExecutor(store, AuditTrail(store))
            recommendation = self.recommendation()
            decision = evaluate(recommendation, self.bundle, self.reconstruction)
            original = store.audit
            def corrupt(event_type, payload, connection=None):
                if event_type == "recovery_completed":
                    raise ValueError("corrupt audit input")
                return original(event_type, payload, connection)
            store.audit = corrupt
            with self.assertRaises(ValueError):
                executor.execute(decision, recommendation, self.bundle["incident_id"], self.bundle["payment_id"])
            self.assertEqual(store.payment("pay_demo_001")["state"], "capture_pending")
            result = run_incident(FIXTURE, path, diagnosis_adapter=FixtureDiagnosisAdapter())
            self.assertEqual(result["outcome"]["status"], "reconciled")

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
            store.ingest(self.bundle)
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
            store.ingest(self.bundle)
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
            store.ingest(self.bundle)
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

    def test_fixture_mode_runs_without_groq_and_completes_magic_path(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"GROQ_API_KEY": ""}, clear=False):
            state = Path(directory) / "fixture.sqlite3"
            result = run_incident(
                FIXTURE,
                state,
                diagnosis_adapter=FixtureDiagnosisAdapter(),
                diagnosis_mode="fixture",
                processor_secret="test-prototype-secret",
                reset_state=True,
            )
            rendered = demo._render(result)
            self.assertIn("DIAGNOSIS MODE: FIXTURE / REHEARSAL", rendered)
            self.assertIn("BLOCKED  retry_capture", rendered)
            self.assertIn("APPROVED reconcile_internal_state", rendered)
            self.assertIn("durable payment state=captured_verified", rendered)
            self.assertIn("recovery_completed", rendered)
            self.assertEqual(IncidentStore(state).payment(self.bundle["payment_id"])["state"], "captured_verified")

    def test_fixture_mode_does_not_attempt_model_network_access(self):
        with tempfile.TemporaryDirectory() as directory, patch("urllib.request.urlopen") as network:
            run_incident(
                FIXTURE,
                Path(directory) / "fixture.sqlite3",
                diagnosis_adapter=FixtureDiagnosisAdapter(),
                diagnosis_mode="fixture",
                processor_secret="test-prototype-secret",
            )
            network.assert_not_called()

    def test_fixture_cli_selects_rehearsal_adapter_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "fixture-cli.sqlite3"
            argv = ["demo", "--mode", "fixture", "--state", str(state)]
            with patch.dict(os.environ, {}, clear=True), patch(
                "urllib.request.urlopen"
            ) as network, patch("sys.argv", argv), patch("builtins.print") as output:
                demo.main()
            network.assert_not_called()
            rendered = output.call_args.args[0]
            self.assertIn("DIAGNOSIS MODE: FIXTURE / REHEARSAL", rendered)
            self.assertEqual(
                IncidentStore(state, processor_secret="test-prototype-secret")
                .payment(self.bundle["payment_id"])["state"],
                "captured_verified",
            )

    def test_live_mode_remains_available_and_records_provenance(self):
        diagnosis = FixtureDiagnosisAdapter().diagnose(self.bundle, self.reconstruction)["diagnosis"]
        body = {
            "id": "chatcmpl-live-test",
            "model": "openai/gpt-oss-20b",
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps(diagnosis)}}],
            "usage": {"total_tokens": 10},
        }
        with tempfile.TemporaryDirectory() as directory, patch("urllib.request.urlopen", return_value=FakeResponse(body)):
            result = run_incident(
                FIXTURE,
                Path(directory) / "live.sqlite3",
                diagnosis_adapter=GroqDiagnosisAdapter("test-key"),
                diagnosis_mode="live",
                processor_secret="test-prototype-secret",
            )
            self.assertEqual(result["diagnosis_mode"], "live")
            self.assertEqual(result["model_provenance"]["request_id"], "chatcmpl-live-test")
            rendered = demo._render(result)
            self.assertIn("DIAGNOSIS MODE: LIVE / GROQ MODEL", rendered)
            self.assertIn("provider=groq model=openai/gpt-oss-20b request_id=chatcmpl-live-test", rendered)
            self.assertIn('usage={"total_tokens": 10}', rendered)

    def test_live_cli_missing_key_is_clear_and_never_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            empty_env = Path(directory) / "empty.env"
            empty_env.touch()
            with patch.dict(os.environ, {}, clear=True), patch(
                "sys.argv", ["demo", "--mode", "live", "--env", str(empty_env)]
            ):
                with self.assertRaises(SystemExit), patch("sys.stderr") as stderr:
                    demo.main()
            message = "".join(call.args[0] for call in stderr.write.call_args_list)
            self.assertIn("live mode unavailable", message)
            self.assertNotIn("FIXTURE / REHEARSAL", message)

    def test_judge_facing_cli_has_no_stale_mp001_branding(self):
        self.assertNotIn("mp001", str(demo.DEFAULT_STATE).lower())
        with patch("sys.argv", ["demo", "--help"]):
            with self.assertRaises(SystemExit), patch("sys.stdout") as stdout:
                demo.main()
        help_text = "".join(call.args[0] for call in stdout.write.call_args_list)
        self.assertIn("O2 Financial AI Incident Commander", help_text)
        self.assertNotIn("MP-001", help_text)


if __name__ == "__main__":
    unittest.main()
