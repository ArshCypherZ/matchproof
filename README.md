# O2 — Financial AI Incident Commander

O2 reconstructs an ambiguous payment incident, adds an evidence-grounded AI
diagnosis, and lets deterministic controls authorize a bounded, auditable
merchant-state reconciliation.

Canonical implementation context:

- `docs/PROBLEM.md` defines the payment-to-order exception problem and evidence
  limits.
- `docs/SOLUTION.md` defines the selected controller, safety boundary, closed
  loop, and evaluation gates.

## Prerequisites

- Node.js 22+
- pnpm 11+

## Local PostgreSQL

The development database uses the official default `postgres:latest` image and
is exposed on host port `9998`:

```bash
docker compose up -d postgres
```

Set `DATABASE_URL=postgres://incident:incident@localhost:9998/incident_commander`.

## Offline fixture rehearsal

```bash
pnpm install
pnpm run demo -- --mode fixture
```

The run uses the checked-in timeout-after-mutation fixture, the local PostgreSQL
database, and the fixture diagnosis adapter. It runs offline and without
`GROQ_API_KEY`; the output is labeled `FIXTURE / REHEARSAL`.

## Fixture and live modes

- **Fixture:** deterministic local rehearsal, labeled `FIXTURE / REHEARSAL`.
- **Live:** Groq model path with configured credentials and network access; output
  includes provider, model, request, and usage provenance. A live error is reported
  as an error.

## Live Groq diagnosis

Create an ignored `.env` file (or export the variables) with:

```text
GROQ_API_KEY=your_key
GROQ_MODEL=openai/gpt-oss-20b
GROQ_REASONING_EFFORT=medium
GROQ_TIMEOUT_SECONDS=20
PROCESSOR_WEBHOOK_SECRET=test-prototype-secret
RAZORPAY_API_KEY=rzp_test_your_key_id
RAZORPAY_API_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_test_webhook_secret
```

Run:

```bash
pnpm run demo -- --mode live
```

## Razorpay Test-mode adapter

The maintained `razorpay` Node SDK (`2.9.8`) is used for authenticated
Test-mode order and payment operations. The adapter rejects live keys before a
network call and keeps amounts in paise:

```ts
import {
  createTestModeOrder,
  fetchTestModeOrder,
  fetchTestModeOrderPayments,
  fetchTestModePaymentStatus,
  verifyRazorpayWebhookSignature,
} from "./src/incident_commander/razorpay";

const order = await createTestModeOrder({ amount: 500, currency: "INR" });
const providerOrder = await fetchTestModeOrder(order.id);
const orderPayments = await fetchTestModeOrderPayments(order.id);
const payment = await fetchTestModePaymentStatus("pay_test_id");
```

Webhook handlers must pass the untouched request body and the
`X-Razorpay-Signature` header to `verifyRazorpayWebhookSignature`. Do not
parse and reserialize the body before verification. The SDK's official
HMAC-SHA256 implementation is used, and missing webhook secrets fail closed.

`pnpm run razorpay:verify` performs a read-only Test-mode connectivity check
using `RAZORPAY_API_KEY` and `RAZORPAY_API_SECRET` from `.env` or the process
environment. Creating orders and fetching payments are exposed as library
operations so an application can add its own approval, persistence, and
afterstate checks around each provider call.

## Webhook ingestion slice

The webhook endpoint contract is intentionally narrow:

- `POST /webhooks/razorpay`;
- raw request body plus `X-Razorpay-Signature` and `X-Razorpay-Event-Id` headers;
- `200 {"status":"accepted"}` for a newly verified event;
- `200 {"status":"duplicate"}` when the exact event was already stored;
- `400` for missing, forged, malformed, or invalid events;
- `409` when an event ID is reused with different signed evidence;
- `413` when the request exceeds the 1 MB body limit.

`RazorpayWebhookInbox` stores the verified raw body, signature, event type,
event ID, and receive timestamps durably. Signature verification happens
before JSON parsing and persistence. The inbox is not yet connected to order
reconciliation or fulfilment; those are separate policy-controlled steps.

Run the local webhook listener on port `9999`:

```bash
pnpm run razorpay:webhook-server
```

It listens on `0.0.0.0:9999` and stores events in the configured durable inbox.
Your ngrok forwarding target should be
`http://localhost:9999`, and the Razorpay webhook URL should end in
`/webhooks/razorpay`.

## Verification

```bash
pnpm test
pnpm run typecheck
pnpm run demo -- --mode fixture
```
