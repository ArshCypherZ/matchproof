from __future__ import annotations


class AuditTrail:
    def __init__(self, store):
        self.store = store

    def append(self, event_type, payload):
        sequence = self.store.audit(event_type, payload)
        return {"sequence": sequence, "event_type": event_type, "payload": payload}

    def records(self):
        return self.store.audit_records()
