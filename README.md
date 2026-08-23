# O2 — Financial AI Incident Commander

O2 reconstructs an ambiguous payment incident, adds an evidence-grounded AI
diagnosis, and lets deterministic controls authorize a bounded, auditable
merchant-state reconciliation.

## Prerequisites

- Python 3.10+
- Run commands from the repository root with `PYTHONPATH=src`.

## Offline fixture rehearsal

```bash
PYTHONPATH=src python3 -m incident_commander.demo --mode fixture
```

The run uses the checked-in timeout-after-mutation fixture, a disposable local
SQLite state file, and the fixture diagnosis adapter. It runs offline and without
`GROQ_API_KEY`; the output is labeled `FIXTURE / REHEARSAL`.

## Fixture and live modes

- **Fixture:** deterministic local rehearsal, labeled `FIXTURE / REHEARSAL`.
- **Live:** Groq model path with configured credentials and network access; output
  includes provider, model, request, and usage provenance. A live error is reported
  as an error.

## Optional live Groq diagnosis

Create an ignored `.env` file (or export the variables) with:

```text
GROQ_API_KEY=your_key
GROQ_MODEL=openai/gpt-oss-20b
GROQ_REASONING_EFFORT=medium
GROQ_TIMEOUT_SECONDS=20
PROCESSOR_WEBHOOK_SECRET=test-prototype-secret
```

Run:

```bash
PYTHONPATH=src python3 -m incident_commander.demo --mode live
```

Live output includes the actual Groq provider, model, request ID, and usage
provenance. An unavailable Groq connection produces an actionable error.
