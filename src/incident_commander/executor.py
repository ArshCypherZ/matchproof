from __future__ import annotations

from .audit import AuditTrail
class BoundedExecutor:
    def __init__(self, audit):
        self.audit = audit

    def execute(self, decision, bundle, reconstruction):
        if not decision["allowed"]:
            raise ValueError("a blocked action cannot be executed")
        if decision["action"] not in {"reconcile_internal_state", "escalate"}:
            raise ValueError("executor accepts bounded non-money-moving actions")

        execution_key = (
            f"{decision['action']}:{bundle['incident_id']}:{bundle['payment_id']}:"
            f"{bundle['idempotency_key']}"
        )
        previous = self.audit.completed_recovery(execution_key)
        if previous is not None:
            outcome = {
                "status": "already_applied",
                "action": decision["action"],
                "idempotency_key": execution_key,
                "before_state": previous["before_state"],
                "after_state": previous["after_state"],
                "reason": "idempotency key already has a completed recovery",
            }
            self.audit.append("recovery_duplicate_suppressed", outcome)
            return outcome

        if decision["action"] == "reconcile_internal_state":
            outcome = {
                "status": "reconciled",
                "action": decision["action"],
                "idempotency_key": execution_key,
                "before_state": "capture_pending",
                "after_state": reconstruction["current_state"],
                "reason": "merchant record reconciled from verified processor evidence",
            }
        else:
            outcome = {
                "status": "escalated",
                "action": decision["action"],
                "idempotency_key": execution_key,
                "before_state": reconstruction["current_state"],
                "after_state": reconstruction["current_state"],
                "reason": "incident escalated without changing financial state",
            }

        self.audit.append("recovery_completed", outcome)
        return outcome
