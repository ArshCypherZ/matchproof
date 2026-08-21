from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


class EvidenceError(ValueError):
    pass


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise EvidenceError(f"timestamp must include a timezone: {value}")
    return parsed


def load_fixture(path):
    bundle = json.loads(Path(path).read_text(encoding="utf-8"))
    for item in bundle["evidence"]:
        item["occurred_at"] = _timestamp(item["occurred_at"])
        item["received_at"] = _timestamp(item["received_at"])
    _validate_bundle(bundle)
    return bundle


def _validate_bundle(bundle):
    evidence_ids = [item["evidence_id"] for item in bundle["evidence"]]
    if len(evidence_ids) != len(set(evidence_ids)):
        raise EvidenceError("evidence IDs must be unique")
    if not bundle["evidence"]:
        raise EvidenceError("incident fixture must contain evidence")

    for item in bundle["evidence"]:
        payment_id = item["payload"].get("payment_id")
        if payment_id != bundle["payment_id"]:
            raise EvidenceError(
                f"{item['evidence_id']} belongs to {payment_id}, not {bundle['payment_id']}"
            )
        if item["received_at"] < item["occurred_at"]:
            raise EvidenceError(f"{item['evidence_id']} was received before it occurred")
