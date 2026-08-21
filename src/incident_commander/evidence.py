from __future__ import annotations

import json
import hashlib
import hmac
import os
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import MappingProxyType
from collections.abc import Mapping


class EvidenceError(ValueError):
    pass


class VerifiedEvidence:
    __slots__ = ("_bundle",)

    def __new__(cls, *args, **kwargs):
        raise EvidenceError("verified evidence must be produced by verify_bundle")

    @property
    def bundle(self):
        return self._bundle

    def __setattr__(self, name, value):
        raise AttributeError("verified evidence is immutable")


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise EvidenceError(f"timestamp must include a timezone: {value}")
    return parsed


def load_fixture(path, *, processor_secret=None):
    bundle = json.loads(Path(path).read_text(encoding="utf-8"))
    for item in bundle["evidence"]:
        item["occurred_at"] = _timestamp(item["occurred_at"])
        item["received_at"] = _timestamp(item["received_at"])
    _validate_bundle(bundle, processor_secret or os.environ.get("PROCESSOR_WEBHOOK_SECRET"))
    return bundle


def verify_bundle(bundle, processor_secret=None):
    candidate = deepcopy(bundle)
    for item in candidate["evidence"]:
        item["occurred_at"] = _timestamp(item["occurred_at"]) if isinstance(item["occurred_at"], str) else item["occurred_at"]
        item["received_at"] = _timestamp(item["received_at"]) if isinstance(item["received_at"], str) else item["received_at"]
    _validate_bundle(candidate, processor_secret or os.environ.get("PROCESSOR_WEBHOOK_SECRET"))
    verified = object.__new__(VerifiedEvidence)
    object.__setattr__(verified, "_bundle", _freeze(candidate))
    return verified


def _freeze(value):
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(item) for key, item in value.items()})
    if isinstance(value, list):
        return tuple(_freeze(item) for item in value)
    if isinstance(value, tuple):
        return tuple(_freeze(item) for item in value)
    return value


def _validate_bundle(bundle, processor_secret):
    evidence_ids = [item["evidence_id"] for item in bundle["evidence"]]
    if len(evidence_ids) != len(set(evidence_ids)):
        raise EvidenceError("evidence IDs must be unique")
    if not bundle["evidence"]:
        raise EvidenceError("incident fixture must contain evidence")

    if not processor_secret:
        raise EvidenceError("prototype processor-signature secret is not configured")
    now = datetime.now(timezone.utc)
    for item in bundle["evidence"]:
        payment_id = item["payload"].get("payment_id")
        if payment_id != bundle["payment_id"]:
            raise EvidenceError(
                f"{item['evidence_id']} belongs to {payment_id}, not {bundle['payment_id']}"
            )
        if item["received_at"] < item["occurred_at"]:
            raise EvidenceError(f"{item['evidence_id']} was received before it occurred")
        if item["received_at"] > now + timedelta(minutes=5):
            raise EvidenceError(f"{item['evidence_id']} is future-dated")
        if item["kind"] == "processor_webhook":
            if item.get("source") != "processor-webhook":
                raise EvidenceError(f"{item['evidence_id']} has untrusted processor provenance")
            signature = item.get("processor_signature")
            if not signature or not verify_processor_signature(item["payload"], signature, processor_secret):
                raise EvidenceError(f"{item['evidence_id']} failed prototype processor-signature verification")
            item["processor_verified"] = True

    _validate_event_history(bundle["evidence"])


def processor_signature(payload, secret):
    signed_payload = {key: value for key, value in payload.items() if key != "signature_verified"}
    message = json.dumps(signed_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_processor_signature(payload, signature, secret):
    return hmac.compare_digest(processor_signature(payload, secret), str(signature))


def _validate_event_history(evidence):
    requests = [item for item in evidence if item["kind"] == "payment_request"]
    if not requests:
        raise EvidenceError("payment request is required")
    request_time = min(item["occurred_at"] for item in requests)
    seen_events = {}
    processor_outcomes = set()
    for item in evidence:
        if item["kind"] == "processor_webhook":
            payload = item["payload"]
            if item["occurred_at"] < request_time:
                raise EvidenceError("processor webhook causally precedes payment request")
            event_id = payload.get("event_id")
            fingerprint = json.dumps(payload, sort_keys=True, separators=(",", ":"))
            if event_id in seen_events and seen_events[event_id] != fingerprint:
                raise EvidenceError("same processor event ID has conflicting payloads")
            seen_events[event_id] = fingerprint
            processor_outcomes.add(payload.get("event_type"))
        elif item["kind"] == "processor_timeout" and item["occurred_at"] < request_time:
            raise EvidenceError("processor timeout precedes payment request")
    if "payment.captured" in processor_outcomes and "payment.failed" in processor_outcomes:
        raise EvidenceError("contradictory processor outcomes cannot be accepted")
