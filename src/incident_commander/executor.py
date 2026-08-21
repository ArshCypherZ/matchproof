from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

from .reconstruction import reconstruct
from .safety import evaluate


class AuthorizationError(ValueError):
    pass


class BoundedExecutor:
    def __init__(self, store, audit):
        self.store = store
        self.audit = audit

    def execute(self, decision, recommendation, incident_id, payment_id=None, *diagnostic_metadata):
        if isinstance(incident_id, dict):
            supplied_bundle = incident_id
            incident_id, payment_id = supplied_bundle.get("incident_id"), supplied_bundle.get("payment_id")
        action = recommendation.get("action")
        if action not in {"reconcile_internal_state", "escalate"}:
            raise AuthorizationError("executor rejects unsupported or money-moving actions")

        connection = self.store.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            bundle = self.store.incident(incident_id, connection)
            if not bundle or bundle["payment_id"] != payment_id:
                raise AuthorizationError("canonical incident evidence is unavailable")
            reconstruction = reconstruct(bundle)
            execution_key = (
                f"{action}:{bundle['incident_id']}:{bundle['payment_id']}:"
                f"{bundle['idempotency_key']}"
            )
            previous = connection.execute(
                "SELECT * FROM recoveries WHERE execution_key = ?", (execution_key,)
            ).fetchone()
            merchant_state = self.store.payment(payment_id, connection)
            if not merchant_state:
                raise AuthorizationError("durable payment state is unavailable")
            if previous:
                if merchant_state["state"] == previous["after_state"]:
                    outcome = {
                        "status": "already_completed",
                        "action": action,
                        "idempotency_key": execution_key,
                        "before_state": previous["before_state"],
                        "after_state": previous["after_state"],
                        "reason": "recovery already completed and durable state agrees",
                    }
                    self.store.audit("recovery_duplicate_suppressed", outcome, connection)
                    connection.commit()
                    return outcome
                self.store.audit("stale_recovery_reopened", {"execution_key": execution_key}, connection)
                connection.execute("DELETE FROM recoveries WHERE execution_key = ?", (execution_key,))
            authoritative = evaluate(recommendation, bundle, reconstruction, merchant_state)
            if decision != authoritative:
                raise AuthorizationError("caller decision contradicts executor authorization")
            if not authoritative["allowed"]:
                raise AuthorizationError(authoritative["reason"])

            before_state = merchant_state["state"]
            if action == "reconcile_internal_state":
                after_state = "captured_verified"
                changed = connection.execute(
                    """
                    UPDATE payments SET state = ?, updated_at = ?
                    WHERE payment_id = ? AND state = ?
                    """,
                    (after_state, _now(), bundle["payment_id"], before_state),
                ).rowcount
                if changed != 1:
                    raise AuthorizationError("durable state changed before reconciliation")
                status = "reconciled"
                reason = "durable merchant state reconciled from verified processor evidence"
            else:
                after_state = before_state
                status = "escalated"
                reason = "incident escalated without changing payment or financial state"

            outcome = {
                "status": status,
                "action": action,
                "idempotency_key": execution_key,
                "before_state": before_state,
                "after_state": after_state,
                "reason": reason,
            }
            connection.execute(
                """
                INSERT INTO recoveries
                    (execution_key, action, status, before_state, after_state, completed_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (execution_key, action, status, before_state, after_state, _now()),
            )
            self.store.audit("recovery_completed", outcome, connection)
            connection.commit()
            return outcome
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
