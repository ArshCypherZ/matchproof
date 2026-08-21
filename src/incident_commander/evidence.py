from __future__ import annotations

import json
import hashlib
import hmac
import os
import re
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import MappingProxyType
from collections.abc import Mapping


class EvidenceError(ValueError):
    pass


MAX_AMOUNT_MINOR = 100_000_000_000
SUPPORTED_CURRENCIES = {"INR"}
ALLOWED_OPERATIONS = {"capture"}
_PAYMENT_ID = re.compile(r"^pay_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")
_OPERATION_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")
_EVENT_ID = re.compile(r"^evt_[A-Za-z0-9][A-Za-z0-9_-]{2,63}$")
_SOURCES = {
    "payment_request": "merchant-payment-service",
    "processor_timeout": "merchant-payment-service",
    "internal_state": "merchant-order-store",
    "processor_webhook": "processor-webhook",
}
_PROCESSOR_STATES = {
    "payment.captured": "captured",
    "payment.failed": "failed",
    "payment.refunded": "refunded",
}


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
    if not isinstance(value, str):
        raise EvidenceError("timestamp must be text")
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
    _validate_text(bundle.get("payment_id"), "payment_id", _PAYMENT_ID)
    _validate_text(bundle.get("idempotency_key"), "idempotency_key", _OPERATION_KEY)
    now = datetime.now(timezone.utc)

    for item in bundle["evidence"]:
        if item.get("kind") == "processor_webhook":
            if item.get("source") != "processor-webhook":
                raise EvidenceError(f"{item['evidence_id']} has untrusted processor provenance")
            signature = item.get("processor_signature")
            if not signature or not verify_processor_signature(item["payload"], signature, processor_secret):
                raise EvidenceError(f"{item['evidence_id']} failed prototype processor-signature verification")

    for item in bundle["evidence"]:
        kind = item.get("kind")
        if kind not in _SOURCES:
            raise EvidenceError(f"unsupported evidence kind: {kind}")
        if item.get("source") != _SOURCES[kind]:
            raise EvidenceError(f"{item.get('evidence_id')} has invalid source/provenance")
        _validate_text(item.get("evidence_id"), "evidence_id")
        payment_id = item["payload"].get("payment_id")
        if payment_id != bundle["payment_id"]:
            raise EvidenceError(
                f"{item['evidence_id']} belongs to {payment_id}, not {bundle['payment_id']}"
            )
        if item["received_at"] < item["occurred_at"]:
            raise EvidenceError(f"{item['evidence_id']} was received before it occurred")
        if item["received_at"] > now + timedelta(minutes=5):
            raise EvidenceError(f"{item['evidence_id']} is future-dated")
        _validate_financial_payload(item, bundle)
        if kind == "processor_webhook":
            item["processor_verified"] = True

    _validate_event_history(bundle["evidence"])


def _validate_financial_payload(item, bundle):
    kind = item["kind"]
    payload = item["payload"]
    _validate_text(payload.get("payment_id"), f"{kind}.payment_id", _PAYMENT_ID)
    if kind in {"payment_request", "internal_state", "processor_webhook"}:
        _validate_amount(payload.get("amount_minor"), f"{kind}.amount_minor")
        _validate_currency(payload.get("currency"), f"{kind}.currency")
    if kind in {"payment_request", "processor_timeout", "internal_state", "processor_webhook"}:
        _validate_operation(payload.get("operation"), f"{kind}.operation")
    key_name = "last_operation_key" if kind == "internal_state" else "idempotency_key"
    _validate_text(payload.get(key_name), f"{kind}.{key_name}", _OPERATION_KEY)
    if payload[key_name] != bundle["idempotency_key"]:
        raise EvidenceError(f"{kind} operation identity conflicts with incident")
    if kind == "processor_webhook":
        _validate_text(payload.get("event_id"), "processor_webhook.event_id", _EVENT_ID)
        event_type = payload.get("event_type")
        if event_type not in _PROCESSOR_STATES:
            raise EvidenceError("processor event type is unsupported")
        if payload.get("payment_state") != _PROCESSOR_STATES[event_type]:
            raise EvidenceError("processor event identity conflicts with outcome state")
    elif kind == "internal_state" and payload.get("payment_state") != "capture_pending":
        raise EvidenceError("internal payment state is invalid for ingestion")


def _validate_amount(value, field):
    if isinstance(value, bool) or not isinstance(value, int):
        raise EvidenceError(f"{field} must be an integer, not bool or text")
    if not 1 <= value <= MAX_AMOUNT_MINOR:
        raise EvidenceError(f"{field} must be between 1 and {MAX_AMOUNT_MINOR}")


def _validate_currency(value, field):
    if not isinstance(value, str) or value not in SUPPORTED_CURRENCIES:
        raise EvidenceError(f"{field} must be a supported three-letter currency")


def _validate_operation(value, field):
    if not isinstance(value, str) or value not in ALLOWED_OPERATIONS:
        raise EvidenceError(f"{field} is not an allowed operation")


def _validate_text(value, field, pattern=None):
    if not isinstance(value, str) or not value or (pattern and not pattern.fullmatch(value)):
        raise EvidenceError(f"{field} has invalid type or format")


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
    request_payload = requests[0]["payload"]
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
        payload = item["payload"]
        if payload.get("payment_id") != request_payload.get("payment_id"):
            raise EvidenceError("financial payment identity conflicts across evidence")
        if item["kind"] in {"processor_webhook", "internal_state"}:
            if payload.get("amount_minor") != request_payload.get("amount_minor"):
                raise EvidenceError("financial amount conflicts across evidence")
            if payload.get("currency") != request_payload.get("currency"):
                raise EvidenceError("financial currency conflicts across evidence")
        if payload.get("operation") != request_payload.get("operation"):
            raise EvidenceError("financial operation conflicts across evidence")
    if "payment.captured" in processor_outcomes and "payment.failed" in processor_outcomes:
        raise EvidenceError("contradictory processor outcomes cannot be accepted")
