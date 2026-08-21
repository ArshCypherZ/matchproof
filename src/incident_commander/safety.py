from __future__ import annotations

def evaluate(recommendation, bundle, reconstruction):
    action = recommendation["action"]
    if action == "retry_capture":
        return {
            "action": action,
            "allowed": False,
            "reason": (
                "blocked: a timeout does not prove failure, and a verified capture event makes "
                "another financial mutation unsafe"
            ),
            "evidence_ids": recommendation["evidence_ids"],
        }

    if action == "reconcile_internal_state":
        failures = _reconciliation_failures(bundle, reconstruction)
        return {
            "action": action,
            "allowed": not failures,
            "reason": (
                "approved: verified processor capture matches the original request"
                if not failures
                else "blocked: reconciliation invariants failed: " + "; ".join(failures)
            ),
            "evidence_ids": recommendation["evidence_ids"],
        }

    return {
        "action": "escalate",
        "allowed": True,
        "reason": "approved: escalation changes no financial state",
        "evidence_ids": recommendation["evidence_ids"],
    }


def _reconciliation_failures(bundle, reconstruction):
    request = next(
        item for item in reconstruction["timeline"] if item["kind"] == "payment_request"
    )
    webhook = next(
        (
            item
            for item in reconstruction["timeline"]
            if item["kind"] == "processor_webhook"
        ),
        None,
    )
    if webhook is None:
        return ["verified processor webhook is missing"]

    checks = {
        "reconstructed state is not captured_verified": (
            reconstruction["current_state"] == "captured_verified"
        ),
        "webhook signature is not verified": webhook["payload"].get("signature_verified") is True,
        "payment ID differs": webhook["payload"].get("payment_id") == bundle["payment_id"],
        "amount differs": webhook["payload"].get("amount_minor") == request["payload"].get("amount_minor"),
        "currency differs": webhook["payload"].get("currency") == request["payload"].get("currency"),
        "idempotency key differs": (
            webhook["payload"].get("idempotency_key") == bundle["idempotency_key"]
            and request["payload"].get("idempotency_key") == bundle["idempotency_key"]
        ),
    }
    return [message for message, passed in checks.items() if not passed]
