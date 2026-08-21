from __future__ import annotations

import hashlib
import json
import os
import socket
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Protocol, TypedDict


class DiagnosisError(ValueError):
    pass


class ModelCallError(RuntimeError):
    pass


class Hypothesis(TypedDict):
    rank: int
    summary: str
    reasoning: str
    uncertainty: str
    confidence: float
    evidence_ids: list[str]


class Recommendation(TypedDict):
    action: str
    reasoning: str
    uncertainty: str
    evidence_ids: list[str]


class Diagnosis(TypedDict):
    hypotheses: list[Hypothesis]
    recommendation: Recommendation


class DiagnosisAdapter(Protocol):
    provider: str
    model: str

    def diagnose(self, bundle: dict, reconstruction: dict) -> dict: ...


DIAGNOSIS_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "hypotheses": {
            "type": "array",
            "minItems": 1,
            "maxItems": 3,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "rank": {"type": "integer", "minimum": 1},
                    "summary": {"type": "string"},
                    "reasoning": {"type": "string"},
                    "uncertainty": {"type": "string"},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "evidence_ids": {
                        "type": "array",
                        "minItems": 1,
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "rank",
                    "summary",
                    "reasoning",
                    "uncertainty",
                    "confidence",
                    "evidence_ids",
                ],
            },
        },
        "recommendation": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["reconcile_internal_state", "escalate"],
                },
                "reasoning": {"type": "string"},
                "uncertainty": {"type": "string"},
                "evidence_ids": {
                    "type": "array",
                    "minItems": 1,
                    "items": {"type": "string"},
                },
            },
            "required": ["action", "reasoning", "uncertainty", "evidence_ids"],
        },
    },
    "required": ["hypotheses", "recommendation"],
}


class GroqDiagnosisAdapter:
    provider = "groq"
    endpoint = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key, model="openai/gpt-oss-20b", timeout=20, reasoning="medium"):
        if not api_key:
            raise ModelCallError("GROQ_API_KEY is missing; add it to the ignored .env file")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout
        self.reasoning = reasoning

    @classmethod
    def from_env(cls, env_path=None):
        if env_path:
            load_env(env_path)
        return cls(
            os.environ.get("GROQ_API_KEY"),
            model=os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b"),
            timeout=int(os.environ.get("GROQ_TIMEOUT_SECONDS", "20")),
            reasoning=os.environ.get("GROQ_REASONING_EFFORT", "medium"),
        )

    def diagnose(self, bundle, reconstruction):
        model_input = {
            "incident": _json_value(bundle),
            "deterministic_reconstruction": _json_value(reconstruction),
        }
        input_json = json.dumps(model_input, sort_keys=True, separators=(",", ":"))
        body = {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You diagnose one payment capture incident. Use supplied evidence. "
                        "Every hypothesis and recommendation must cite decisive evidence IDs. "
                        "The diagnosis is advisory: recommend bounded internal-state reconciliation or escalation; "
                        "never recommend a capture, refund, payout, or other money movement."
                    ),
                },
                {"role": "user", "content": input_json},
            ],
            "reasoning_effort": self.reasoning,
            "reasoning_format": "hidden",
            "temperature": 0,
            "max_completion_tokens": 2000,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "financial_incident_diagnosis",
                    "strict": True,
                    "schema": DIAGNOSIS_SCHEMA,
                },
            },
        }
        encoded = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=encoded,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "User-Agent": "financial-incident-commander/0.1",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except (socket.timeout, TimeoutError) as exc:
            raise ModelCallError(f"Groq diagnosis timed out after {self.timeout}s") from exc
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise ModelCallError(f"Groq diagnosis failed with HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise ModelCallError(f"Groq diagnosis request failed: {exc.reason}") from exc

        try:
            response_body = json.loads(raw)
            choice = response_body["choices"][0]
            diagnosis = json.loads(choice["message"]["content"])
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise DiagnosisError("Groq returned malformed diagnosis output") from exc

        provenance = {
            "provider": self.provider,
            "requested_model": self.model,
            "returned_model": response_body.get("model"),
            "request_id": response_body.get("id"),
            "created": response_body.get("created"),
            "system_fingerprint": response_body.get("system_fingerprint"),
            "finish_reason": choice.get("finish_reason"),
            "usage": response_body.get("usage"),
            "request_sha256": hashlib.sha256(encoded).hexdigest(),
            "input_sha256": hashlib.sha256(input_json.encode("utf-8")).hexdigest(),
            "result_sha256": hashlib.sha256(raw).hexdigest(),
            "strict_schema": True,
        }
        return {"diagnosis": diagnosis, "provenance": provenance}


class FixtureDiagnosisAdapter:
    provider = "fixture"
    model = "fixture-diagnosis-v1"

    def diagnose(self, bundle, reconstruction):
        diagnosis = {
            "hypotheses": [
                {
                    "rank": 1,
                    "summary": "The processor completed capture before the caller timed out.",
                    "reasoning": "The verified capture event occurred before the timeout response.",
                    "uncertainty": "The synchronous acknowledgement was lost.",
                    "confidence": 0.98,
                    "evidence_ids": ["EV-REQ-001", "EV-TIMEOUT-001", "EV-WEBHOOK-001"],
                },
                {
                    "rank": 2,
                    "summary": "The merchant record missed the late processor event.",
                    "reasoning": "The internal record remained pending after processor capture.",
                    "uncertainty": "No consumer acknowledgement record was supplied.",
                    "confidence": 0.94,
                    "evidence_ids": ["EV-STATE-001", "EV-WEBHOOK-001"],
                },
            ],
            "recommendation": {
                "action": "reconcile_internal_state",
                "reasoning": "Apply the verified capture to the merchant record without mutation.",
                "uncertainty": "Escalate if deterministic invariants do not agree.",
                "evidence_ids": ["EV-STATE-001", "EV-WEBHOOK-001"],
            },
        }
        return {
            "diagnosis": diagnosis,
            "provenance": {
                "provider": self.provider,
                "requested_model": self.model,
                "returned_model": self.model,
                "request_id": "fixture-call",
                "strict_schema": True,
            },
        }


def validate_diagnosis(diagnosis, bundle):
    if not isinstance(diagnosis, dict) or set(diagnosis) != {"hypotheses", "recommendation"}:
        raise DiagnosisError("diagnosis has an invalid shape")
    hypotheses = diagnosis["hypotheses"]
    if not isinstance(hypotheses, list) or not 1 <= len(hypotheses) <= 3:
        raise DiagnosisError("diagnosis must contain one to three hypotheses")

    valid_ids = {item["evidence_id"] for item in bundle["evidence"]}
    expected_ranks = list(range(1, len(hypotheses) + 1))
    if [item.get("rank") for item in hypotheses] != expected_ranks:
        raise DiagnosisError("hypotheses must be ranked consecutively from 1")
    for hypothesis in hypotheses:
        required = {"rank", "summary", "reasoning", "uncertainty", "confidence", "evidence_ids"}
        if not isinstance(hypothesis, dict) or set(hypothesis) != required:
            raise DiagnosisError("hypothesis has an invalid shape")
        _nonempty_text(hypothesis, "summary")
        _nonempty_text(hypothesis, "reasoning")
        _nonempty_text(hypothesis, "uncertainty")
        confidence = hypothesis["confidence"]
        if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
            raise DiagnosisError("hypothesis confidence must be numeric")
        if not 0 <= confidence <= 1:
            raise DiagnosisError("hypothesis confidence must be between 0 and 1")
        _validate_citations("hypothesis", hypothesis["evidence_ids"], valid_ids)

    recommendation = diagnosis["recommendation"]
    required = {"action", "reasoning", "uncertainty", "evidence_ids"}
    if not isinstance(recommendation, dict) or set(recommendation) != required:
        raise DiagnosisError("recommendation has an invalid shape")
    if recommendation["action"] not in {"reconcile_internal_state", "escalate"}:
        raise DiagnosisError("AI recommendation is not a bounded action")
    _nonempty_text(recommendation, "reasoning")
    _nonempty_text(recommendation, "uncertainty")
    _validate_citations("recommendation", recommendation["evidence_ids"], valid_ids)


def load_env(path):
    path = Path(path)
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _validate_citations(label, cited, valid):
    if not isinstance(cited, list) or not cited or not all(isinstance(item, str) for item in cited):
        raise DiagnosisError(f"{label} must cite evidence IDs")
    unknown = sorted(set(cited) - valid)
    if unknown:
        raise DiagnosisError(f"{label} cites invalid evidence IDs: {unknown}")


def _nonempty_text(value, key):
    if not isinstance(value.get(key), str) or not value[key].strip():
        raise DiagnosisError(f"{key} must be non-empty text")


def _json_value(value):
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {key: _json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    return value
