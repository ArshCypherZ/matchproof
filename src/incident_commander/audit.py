from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
class AuditTrail:
    def __init__(self, path, *, reset=False):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if reset:
            self.path.unlink(missing_ok=True)

    def append(self, event_type, payload):
        record = {
            "sequence": len(self.records()) + 1,
            "recorded_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "event_type": event_type,
            "payload": _json_value(payload),
        }
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
        return record

    def records(self):
        if not self.path.exists():
            return []
        return [
            json.loads(line)
            for line in self.path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def completed_recovery(self, idempotency_key):
        for record in self.records():
            if record["event_type"] != "recovery_completed":
                continue
            if record["payload"]["idempotency_key"] == idempotency_key:
                return record["payload"]
        return None


def _json_value(value):
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value
