# Payment Operations Controller

Payment Operations Controller helps teams investigate payment and order
exceptions, verify supporting evidence, and resolve or escalate outstanding
cases.

## Requirements

- Node.js 22.13 or newer
- pnpm 11 or newer
- PostgreSQL

## Setup

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
```

Configure Razorpay Test Mode credentials in `.env` for provider checks.

## Run

```bash
pnpm run demo -- --mode fixture --state /tmp/payment-operations.sqlite3
pnpm run razorpay:webhook-server
```

The webhook endpoint is `POST /webhooks/razorpay`.

## Verify

```bash
pnpm test
pnpm run test:postgres
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run build
```
