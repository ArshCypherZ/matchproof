# Matchproof

Fixes orders left unpaid after a successful Razorpay payment. It finds the
captured payment, updates the merchant order, checks both records agree, and
leaves the rest in a review queue with the evidence attached.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Local

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis
pnpm db:migrate
pnpm build
pnpm --dir apps/web start
```

## Other

```bash
pnpm razorpay:webhook-server
pnpm verify
pnpm evaluate:full
```
