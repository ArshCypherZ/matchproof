# Payment Operations Controller

Payment Operations Controller helps teams investigate payment and order
exceptions, verify supporting evidence, and resolve or escalate outstanding
cases.

## Requirements

- Node.js 22.13 or newer
- pnpm 11 or newer
- PostgreSQL and Redis

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
```

Configure Razorpay Test Mode credentials in `.env` for provider checks.

Live diagnosis is optional. Set `GROQ_API_KEY`, `GROQ_MODEL`, and
`GROQ_TIMEOUT_SECONDS`, then pass `mode: "live"` to `runIncident`. Groq output
is advisory, schema-validated, citation-checked, and falls back to the
deterministic reconciliation recommendation on failure.

## Run

```bash
pnpm run demo -- --mode fixture --state /tmp/payment-operations.sqlite3
pnpm run razorpay:webhook-server
```

The webhook endpoint is `POST /webhooks/razorpay`.

When `REDIS_URL` is configured, webhook events and batch records are dispatched
to BullMQ. Workers can consume `incident-processing`, `evidence-gathering`, and
`batch-evaluation`; jobs retry with exponential backoff and exhausted jobs are
published to `dead-letter` for operator escalation.

## Verify

```bash
pnpm test
pnpm run test:postgres
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
```
