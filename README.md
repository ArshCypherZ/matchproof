# O2 Financial AI Incident Commander

## Prerequisites

- Python 3.10+
- Run commands from the repository root with `PYTHONPATH=src`.

## Fixture rehearsal (no network)

```bash
PYTHONPATH=src python3 -m incident_commander.demo --mode fixture
```

This uses the checked-in timeout-after-mutation fixture, a local SQLite file under
`.runtime/`, and the fixture diagnosis adapter. It does not require `GROQ_API_KEY`
and does not call a model. The output is labeled `FIXTURE / REHEARSAL` and shows the
blocked `retry_capture`, approved bounded reconciliation, final `captured_verified`
state, and key audit events.

## Live Groq diagnosis

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

To verify the fail-closed missing-key behavior explicitly, point `--env` at an
empty file:

```bash
PYTHONPATH=src python3 -m incident_commander.demo --mode live --env /tmp/empty-o2.env
```

Live output includes the actual Groq provider, model, request ID, and usage
provenance. If Groq is unavailable, live mode reports an actionable error and
never falls back to fixture output.
