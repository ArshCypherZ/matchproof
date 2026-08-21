from __future__ import annotations


def evaluate(recommendation, bundle, reconstruction, merchant_state=None):
    action = recommendation.get("action")
    evidence_ids = recommendation.get("evidence_ids", [])
    canonical_ids = {item["evidence_id"] for item in reconstruction.get("timeline", [])}
    invalid_citations = sorted(set(evidence_ids) - canonical_ids)
    if invalid_citations or not evidence_ids:
        return {
            "action": action,
            "allowed": False,
            "reason": "blocked: recommendation cites non-canonical or missing evidence: " + str(invalid_citations or ["none"]),
            "evidence_ids": evidence_ids,
        }
    if recommendation.get("incident_id") not in (None, bundle.get("incident_id")):
        return {"action": action, "allowed": False, "reason": "blocked: recommendation incident binding differs", "evidence_ids": evidence_ids}
    if recommendation.get("payment_id") not in (None, bundle.get("payment_id")):
        return {"action": action, "allowed": False, "reason": "blocked: recommendation payment binding differs", "evidence_ids": evidence_ids}
    if action == "retry_capture":
        return {
            "action": action,
            "allowed": False,
            "reason": "blocked: retry_capture is never authorized by this recovery workflow",
            "evidence_ids": evidence_ids,
        }
    if action == "reconcile_internal_state":
        failures = reconciliation_failures(bundle, reconstruction, merchant_state)
        return {
            "action": action,
            "allowed": not failures,
            "reason": (
                "approved: all request, processor, internal, and reconstructed invariants agree"
                if not failures
                else "blocked: reconciliation invariants failed: " + "; ".join(failures)
            ),
            "evidence_ids": evidence_ids,
        }
    if action == "escalate":
        return {
            "action": action,
            "allowed": True,
            "reason": "approved: escalation changes no payment or financial state",
            "evidence_ids": evidence_ids,
        }
    return {
        "action": action,
        "allowed": False,
        "reason": "blocked: unsupported action fails closed",
        "evidence_ids": evidence_ids,
    }


def reconciliation_failures(bundle, reconstruction, merchant_state=None):
    if reconstruction.get("ambiguity_reasons"):
        return ["ambiguous financial history: " + ", ".join(reconstruction["ambiguity_reasons"])]
    request = _one(reconstruction["timeline"], "payment_request")
    timeout = _one(reconstruction["timeline"], "processor_timeout")
    webhook = _one(reconstruction["timeline"], "processor_webhook")
    internal = _one(reconstruction["timeline"], "internal_state")
    if not all((request, timeout, webhook, internal)):
        return ["required cross-source evidence is missing"]

    expected_payment = bundle["payment_id"]
    expected_key = bundle["idempotency_key"]
    request_payload = request["payload"]
    timeout_payload = timeout["payload"]
    webhook_payload = webhook["payload"]
    internal_payload = internal["payload"]
    failures = []

    for source, payload in (
        ("request", request_payload),
        ("timeout", timeout_payload),
        ("processor", webhook_payload),
        ("internal", internal_payload),
    ):
        if payload.get("payment_id") != expected_payment:
            failures.append(f"{source} payment ID differs")

    for source, payload in (("processor", webhook_payload), ("internal", internal_payload)):
        if payload.get("amount_minor") != request_payload.get("amount_minor"):
            failures.append(f"{source} amount differs")
        if payload.get("currency") != request_payload.get("currency"):
            failures.append(f"{source} currency differs")

    if request_payload.get("operation") != "capture":
        failures.append("request operation is not capture")
    if timeout_payload.get("operation") != "capture":
        failures.append("timeout operation is not capture")
    if internal_payload.get("operation") != "capture":
        failures.append("internal operation is not capture")
    if webhook_payload.get("operation") != "capture":
        failures.append("processor operation is not capture")
    if webhook_payload.get("event_type") != "payment.captured":
        failures.append("processor capture identity differs")

    operation_keys = {
        request_payload.get("idempotency_key"),
        timeout_payload.get("idempotency_key"),
        webhook_payload.get("idempotency_key"),
        internal_payload.get("last_operation_key"),
    }
    if operation_keys != {expected_key}:
        failures.append("operation/idempotency key differs")

    if not webhook.get("processor_verified"):
        failures.append("processor signature is not verified")
    if webhook_payload.get("payment_state") != "captured":
        failures.append("processor state is not captured")
    if internal_payload.get("payment_state") != "capture_pending":
        failures.append("internal evidence is not the expected pending state")
    if reconstruction.get("current_state") != "captured_verified":
        failures.append("reconstructed state is not captured_verified")

    if merchant_state is not None:
        if merchant_state.get("payment_id") != expected_payment:
            failures.append("durable payment ID differs")
        if merchant_state.get("amount_minor") != request_payload.get("amount_minor"):
            failures.append("durable amount differs")
        if merchant_state.get("currency") != request_payload.get("currency"):
            failures.append("durable currency differs")
        if merchant_state.get("operation") != "capture":
            failures.append("durable operation differs")
        if merchant_state.get("operation_key") != expected_key:
            failures.append("durable operation key differs")
        if merchant_state.get("state") != "capture_pending":
            failures.append("durable internal state is contradictory")

    return failures


def _one(timeline, kind):
    return next((item for item in timeline if item["kind"] == kind), None)
