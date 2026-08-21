from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .evidence import verify_bundle


class IncidentStore:
    def __init__(self, path, *, reset=False):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if reset:
            self.path.unlink(missing_ok=True)
        self._prepare()

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def ingest(self, bundle):
        verified = verify_bundle(bundle)
        canonical_json = json.dumps(_json_value(verified.bundle), sort_keys=True)
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            canonical = verify_bundle(json.loads(canonical_json)).bundle
            processor = next(
                item for item in canonical["evidence"]
                if item["kind"] == "processor_webhook"
                and item["payload"].get("event_type") == "payment.captured"
            )["payload"]
            connection.execute(
                """
                INSERT OR IGNORE INTO payments
                    (payment_id, state, amount_minor, currency, operation, operation_key,
                     updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    processor["payment_id"],
                    "capture_pending",
                    processor["amount_minor"],
                    processor["currency"],
                    "capture",
                    processor["idempotency_key"],
                    _now(),
                ),
            )
            connection.execute(
                "INSERT OR REPLACE INTO incidents (incident_id, payment_id, idempotency_key, bundle) VALUES (?, ?, ?, ?)",
                (canonical["incident_id"], canonical["payment_id"], canonical["idempotency_key"], canonical_json),
            )
            connection.commit()

    def save_evidence(self, bundle):
        raise ValueError("save_evidence cannot create canonical evidence; use ingest")

    def ingest_verified(self, verified):
        raise ValueError("verified Python objects have no durable financial authority")

    def incident(self, incident_id, connection=None):
        owns_connection = connection is None
        connection = connection or self.connect()
        try:
            row = connection.execute("SELECT * FROM incidents WHERE incident_id = ?", (incident_id,)).fetchone()
            if not row:
                return None
            value = json.loads(row["bundle"])
            from .evidence import _timestamp, verify_bundle
            for item in value["evidence"]:
                item["occurred_at"] = _timestamp(item["occurred_at"])
                item["received_at"] = _timestamp(item["received_at"])
            return verify_bundle(value).bundle
        finally:
            if owns_connection:
                connection.close()

    def payment(self, payment_id, connection=None):
        owns_connection = connection is None
        connection = connection or self.connect()
        try:
            row = connection.execute(
                "SELECT * FROM payments WHERE payment_id = ?", (payment_id,)
            ).fetchone()
            return dict(row) if row else None
        finally:
            if owns_connection:
                connection.close()

    def audit(self, event_type, payload, connection=None):
        owns_connection = connection is None
        connection = connection or self.connect()
        try:
            cursor = connection.execute(
                "INSERT INTO audit_events (recorded_at, event_type, payload) VALUES (?, ?, ?)",
                (_now(), event_type, json.dumps(_json_value(payload), sort_keys=True)),
            )
            return cursor.lastrowid
        finally:
            if owns_connection:
                connection.close()

    def audit_records(self):
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT sequence, recorded_at, event_type, payload FROM audit_events "
                "ORDER BY sequence"
            ).fetchall()
        return [
            {
                "sequence": row["sequence"],
                "recorded_at": row["recorded_at"],
                "event_type": row["event_type"],
                "payload": json.loads(row["payload"]),
            }
            for row in rows
        ]

    def _prepare(self):
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS payments (
                    payment_id TEXT PRIMARY KEY,
                    state TEXT NOT NULL,
                    amount_minor INTEGER NOT NULL,
                    currency TEXT NOT NULL,
                    operation TEXT NOT NULL,
                    operation_key TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS incidents (
                    incident_id TEXT PRIMARY KEY,
                    payment_id TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    bundle TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS recoveries (
                    execution_key TEXT PRIMARY KEY,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    before_state TEXT NOT NULL,
                    after_state TEXT NOT NULL,
                    completed_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS audit_events (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    recorded_at TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    payload TEXT NOT NULL
                );
                """
            )


def _now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_value(value):
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    from collections.abc import Mapping
    if isinstance(value, Mapping):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value
