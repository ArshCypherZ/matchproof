"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

type Evidence = {
  evidence_id: string;
  kind: string;
  occurred_at: string;
  received_at: string;
};

type Incident = {
  status: string;
  evidence: Evidence[];
  reconstruction: {
    current_state: string;
    ambiguity_reasons: string[];
  };
  reconciliation: {
    discrepancy: string | null;
    resolution: string;
    ambiguity_reasons: string[];
    evidence_ids: string[];
  };
};

// Machine words become a readable sentence: first letter up, underscores out.
function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

// The reconstruction's current_state is a machine enum. These are the
// operator sentences for every value the pipeline can emit; an unknown
// value falls back to its raw words — never a guessed fact.
const STATE_SENTENCES: Record<string, string> = {
  requested: "A payment request was issued.",
  ambiguous_after_timeout:
    "The provider response timed out, so the outcome is unknown.",
  created: "The merchant payment service recorded the payment as created.",
  pending: "The merchant payment service recorded the payment as pending.",
  authorized:
    "The merchant payment service recorded the payment as authorized.",
  capture_pending:
    "The merchant payment service recorded the capture as pending.",
  captured: "The merchant payment service recorded the payment as captured.",
  failed: "The merchant payment service recorded the payment as failed.",
  refunded: "The merchant payment service recorded the payment as refunded.",
  authorized_verified:
    "Razorpay records the payment as authorized, signature-verified.",
  captured_verified:
    "Razorpay records the payment as captured, signature-verified.",
  failed_verified:
    "Razorpay records the payment as failed, signature-verified.",
  refunded_verified:
    "Razorpay records the payment as refunded, signature-verified.",
  paid_verified: "Razorpay records the payment as paid, signature-verified.",
  attempted: "Razorpay records the order as attempted, not yet paid.",
  paid: "The merchant order is marked paid.",
  fulfilled: "The merchant order is fulfilled.",
  paid_pending: "The merchant order is still pending.",
  paid_missing: "No merchant order exists for this payment.",
  callback_missing: "The merchant callback never arrived.",
  callback_received: "The merchant callback was received.",
  unknown: "The current state is unknown.",
};

const WEBHOOK_DELIVERY_SENTENCES: Record<string, string> = {
  failed: "Razorpay webhook delivery failed.",
  rejected: "Razorpay webhook delivery was rejected.",
  timeout: "Razorpay webhook delivery timed out.",
  duplicate: "A duplicate Razorpay webhook was delivered.",
  delayed: "The Razorpay webhook arrived late.",
  reordered: "The Razorpay webhook arrived out of order.",
  disabled: "Razorpay webhook delivery was disabled.",
  received: "Razorpay webhook delivery was received.",
};

function stateSentence(state: string) {
  if (state.startsWith("webhook_")) {
    const sentence = WEBHOOK_DELIVERY_SENTENCES[state.slice("webhook_".length)];
    if (sentence) return sentence;
  }
  if (state.startsWith("settlement_"))
    return `Settlement recorded as ${state.slice("settlement_".length)}.`;
  return STATE_SENTENCES[state] ?? `${sentenceCase(state)}.`;
}

// The reconciliation's discrepancy names the exact mismatch. Same contract:
// known values get their sentence, unknown values keep their raw words.
const DISCREPANCY_SENTENCES: Record<string, string> = {
  provider_paid_merchant_pending:
    "Razorpay shows the payment paid, but the merchant order is still pending.",
  provider_paid_merchant_missing:
    "Razorpay shows the payment paid, but no merchant order exists for it.",
  one_payment_two_orders:
    "One Razorpay payment is linked to two merchant orders.",
  callback_missing: "The merchant callback never arrived.",
  webhook_delivery_failure: "Razorpay webhook delivery failed.",
  late_authorized:
    "The payment was authorized after the order stopped waiting for it.",
  capture_outcome_unknown:
    "Razorpay never returned a capture outcome, so the payment state is unknown.",
  settlement_mismatch: "The settlement record does not match the payment.",
  provider_failed_merchant_fulfilled:
    "Razorpay shows the payment failed, but the merchant order is already fulfilled.",
  amount_mismatch:
    "The amount differs between Razorpay and the merchant record.",
  currency_mismatch:
    "The currency differs between Razorpay and the merchant record.",
  payment_identity_mismatch:
    "The payment identity differs between Razorpay and the merchant record.",
  order_mapping_mismatch:
    "The payment and the order do not refer to each other.",
  multiple_payments_one_order:
    "More than one payment points at the same merchant order.",
  contradictory_provider_state:
    "Razorpay evidence contains contradictory outcomes.",
  invalid_chronology: "The evidence timestamps are out of order.",
  stale_evidence: "The freshest evidence is stale.",
  idempotency_mismatch: "The idempotency keys differ between the two systems.",
  unverified_provider: "The provider record arrived without a valid signature.",
};

type Chapter = {
  id: string;
  title: string;
  content: ReactNode;
};

export function JudgmentPanel({ incident }: { incident: Incident }) {
  const [open, setOpen] = useState(
    () => new Set(["reconstruction", "hypothesis"]),
  );
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const hypothesis = incident.reconciliation.discrepancy
    ? (DISCREPANCY_SENTENCES[incident.reconciliation.discrepancy] ??
      `${sentenceCase(incident.reconciliation.discrepancy)}.`)
    : "Razorpay and merchant state currently agree.";
  const missing = incident.reconciliation.ambiguity_reasons;
  const evidence = new Map(
    incident.evidence.map((item) => [item.evidence_id, item]),
  );
  const chapters: Chapter[] = [
    {
      id: "reconstruction",
      title: "What happened",
      content: (
        <p className="max-w-prose text-sm leading-6">
          {stateSentence(incident.reconstruction.current_state)}
        </p>
      ),
    },
    {
      id: "hypothesis",
      title: "What’s wrong",
      content: (
        <>
          <p className="max-w-prose text-sm leading-6">{hypothesis}</p>
          {missing.length ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">
                Missing or conflicting evidence
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {missing.map((item) => (
                  <li key={item}>
                    <Badge variant="caution" title={item} className="font-data">
                      <AlertTriangle aria-hidden="true" />
                      {item.replaceAll("_", " ")}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {incident.reconciliation.evidence_ids.map((evidenceId) => {
              const item = evidence.get(evidenceId);
              const detail = item
                ? `${item.kind.replaceAll("_", " ")} / ${item.occurred_at}`
                : "Evidence reference";
              return (
                <Badge
                  key={evidenceId}
                  title={detail}
                  translate="no"
                  className="font-data"
                >
                  {evidenceId}
                </Badge>
              );
            })}
          </div>
        </>
      ),
    },
  ];

  const toggle = (id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card aria-labelledby="judgment-heading">
      <CardHeader>
        <h2 id="judgment-heading" className="text-lg font-semibold">
          Review findings
        </h2>
      </CardHeader>
      <div className="divide-y divide-border px-5">
        {chapters.map((chapter) => {
          const expanded = open.has(chapter.id);
          const dimmed = spotlight && spotlight !== chapter.id;
          const panelId = `judgment-${chapter.id}`;
          return (
            <article
              key={chapter.id}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") setSpotlight(chapter.id);
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== "touch") setSpotlight(null);
              }}
              onFocusCapture={() => setSpotlight(chapter.id)}
              onBlurCapture={() => setSpotlight(null)}
              className={`transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] motion-reduce:transition-none ${
                spotlight === chapter.id
                  ? "bg-surface-subtle text-foreground"
                  : `bg-transparent ${dimmed ? "text-ink-secondary" : "text-foreground"}`
              }`}
            >
              <h3>
                <button
                  type="button"
                  onClick={() => toggle(chapter.id)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  className="focus-ring flex w-full items-center gap-3 rounded-md py-4 text-left"
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    {chapter.title}
                  </span>
                  {/* CSS transition (not a JS animation) so the global
                      reduced-motion policy reaches it. */}
                  <Plus
                    aria-hidden="true"
                    className={`size-4 transition-transform duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] motion-reduce:transition-none ${expanded ? "rotate-45" : ""}`}
                  />
                </button>
              </h3>
              <div id={panelId} data-open={expanded} className="reveal">
                <div className="overflow-hidden pb-5 pl-7 pr-2">
                  {chapter.content}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </Card>
  );
}
