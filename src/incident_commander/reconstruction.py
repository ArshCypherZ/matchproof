from __future__ import annotations

_TIMELINE_PRIORITY = {
    "payment_request": 0,
    "processor_webhook": 1,
    "processor_timeout": 2,
    "internal_state": 3,
}


def reconstruct(bundle):
    canonical, duplicates = _deduplicate(bundle["evidence"])
    timeline = sorted(
        canonical,
        key=lambda item: (
            item["occurred_at"],
            _TIMELINE_PRIORITY[item["kind"]],
            item["evidence_id"],
        ),
    )
    transitions = _observation_transitions(canonical)
    request = next(item for item in canonical if item["kind"] == "payment_request")

    return {
        "timeline": timeline,
        "observation_transitions": transitions,
        "duplicate_evidence_ids": duplicates,
        "current_state": transitions[-1]["state"],
        "impact_summary": {
            "payments_affected": 1,
            "payment_id": bundle["payment_id"],
            "amount_minor": request["payload"]["amount_minor"],
            "currency": request["payload"]["currency"],
            "duplicate_events_suppressed": len(duplicates),
            "money_movement_executed_by_recovery": False,
        },
    }


def _deduplicate(evidence):
    seen = set()
    canonical = []
    duplicates = []

    for item in sorted(
        evidence, key=lambda record: (record["received_at"], record["evidence_id"])
    ):
        if item["kind"] == "processor_webhook":
            identity = (item["kind"], item["payload"]["event_id"])
        else:
            identity = (item["kind"], item["evidence_id"])
        if identity in seen:
            duplicates.append(item["evidence_id"])
            continue
        seen.add(identity)
        canonical.append(item)

    return canonical, duplicates


def _observation_transitions(evidence):
    transitions = []
    state = None

    for item in sorted(
        evidence, key=lambda record: (record["received_at"], record["evidence_id"])
    ):
        next_state = state
        reason = ""
        if item["kind"] == "payment_request":
            next_state = "requested"
            reason = "capture request was issued"
        elif item["kind"] == "processor_timeout":
            next_state = "ambiguous_after_timeout"
            reason = "processor response timed out; mutation result is unknown"
        elif item["kind"] == "processor_webhook" and _is_verified_capture(item):
            next_state = "captured_verified"
            reason = "late verified processor event establishes capture success"

        if next_state is not None and next_state != state:
            transitions.append({
                "observed_at": item["received_at"],
                "state": next_state,
                "reason": reason,
                "evidence_ids": [item["evidence_id"]],
            })
            state = next_state

    if not transitions:
        raise ValueError("evidence did not produce an incident state")
    return transitions


def _is_verified_capture(item):
    payload = item["payload"]
    return (
        payload.get("event_type") == "payment.captured"
        and payload.get("payment_state") == "captured"
        and payload.get("signature_verified") is True
    )
