"use client";

import { useState } from "react";
import { FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/components/shared/format";

type Evidence = {
  evidence_id: string;
  kind: string;
  occurred_at: string;
  received_at: string;
  payload: unknown;
};

function sentenceCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

// Every sentence names the source and the outcome the payload carries, so a
// fact read alone still says who observed what. An unknown kind keeps its raw
// words rather than a guessed outcome.
function fact(item: Evidence) {
  const payload = item.payload as Record<string, unknown>;
  switch (item.kind) {
    case "payment_request":
      return "A payment request was issued.";
    case "processor_timeout":
      return `The ${String(payload.operation)} request to the provider timed out; its result is unknown.`;
    case "internal_state":
      return `Merchant payment state recorded as ${payload.payment_state}.`;
    case "processor_webhook":
      return `Razorpay webhook received with payment state ${payload.payment_state}.`;
    case "merchant_order_state":
      return `Merchant order state observed as ${payload.order_state}.`;
    case "callback_observation":
      return payload.callback_status === "missing"
        ? "The merchant callback never arrived."
        : "The merchant callback was received.";
    case "webhook_delivery": {
      const sentences: Record<string, string> = {
        failed: "Razorpay webhook delivery failed.",
        rejected: "Razorpay webhook delivery was rejected.",
        timeout: "Razorpay webhook delivery timed out.",
        duplicate: "A duplicate Razorpay webhook was delivered.",
        delayed: "The Razorpay webhook arrived late.",
        reordered: "The Razorpay webhook arrived out of order.",
        disabled: "Razorpay webhook delivery was disabled.",
        received: "Razorpay webhook delivery was received.",
      };
      return (
        sentences[String(payload.delivery_status)] ??
        `Razorpay webhook delivery status: ${payload.delivery_status}.`
      );
    }
    case "settlement_observation":
      return `Settlement recorded as ${payload.settlement_status}.`;
    case "provider_payment_fetch":
      return payload.result === "success"
        ? `Razorpay payment details fetched: ${payload.status}.`
        : `Razorpay payment fetch failed: ${payload.error_message}.`;
    case "provider_order_fetch":
      return payload.result === "success"
        ? `Razorpay order details fetched: ${payload.status}.`
        : `Razorpay order fetch failed: ${payload.error_message}.`;
    default:
      return `${sentenceCase(item.kind)}.`;
  }
}

export function EvidenceTimeline({ evidence }: { evidence: Evidence[] }) {
  const [receivedOrder, setReceivedOrder] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // A malformed timestamp must not poison the comparator into NaN (the sort
  // order goes undefined); it sorts to the front so the anomaly — a fact the
  // pipeline dated badly — is the first thing the operator sees.
  const stamp = (value: string) => {
    const time = Date.parse(value);
    return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
  };

  const sorted = [...evidence].sort(
    (left, right) =>
      stamp(receivedOrder ? left.received_at : left.occurred_at) -
      stamp(receivedOrder ? right.received_at : right.occurred_at),
  );
  return (
    <Card aria-labelledby="evidence-heading">
      <CardHeader className="justify-between">
        <div>
          <h2 id="evidence-heading" className="text-lg font-semibold">
            Evidence
          </h2>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            Chronological facts from Razorpay and merchant sources.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReceivedOrder((value) => !value)}
        >
          {receivedOrder ? "Sort by event time" : "Sort by arrival time"}
        </Button>
      </CardHeader>
      <div className="px-5 pb-5">
        {sorted.length ? (
          <ol className="mt-5 border-l border-border pl-4">
            {sorted.map((item) => {
              const expanded = open === item.evidence_id;
              // An unparseable timestamp renders as "Unavailable" below; it
              // must not also ship an invalid machine-readable dateTime.
              const stampText = receivedOrder
                ? item.received_at
                : item.occurred_at;
              const validStamp = Number.isFinite(Date.parse(stampText));
              // Provider Blue marks provider-sourced facts; merchant
              // observations carry ink, per the palette's meaning for each
              // source. A plain dot — the color is the whole mark.
              const fromProvider = item.kind !== "merchant_order_state";
              return (
                <li
                  key={item.evidence_id}
                  className="relative pb-6 pr-12 last:pb-0"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute -left-[21px] top-1 size-2.5 rounded-full ${fromProvider ? "bg-provider" : "bg-ink-tertiary"}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="absolute right-0 top-0"
                    onClick={() => setOpen(expanded ? null : item.evidence_id)}
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Hide" : "Show"} payload for ${item.evidence_id}`}
                    title={`${expanded ? "Hide" : "Show"} payload`}
                  >
                    <FileJson aria-hidden="true" />
                  </Button>
                  <time
                    dateTime={validStamp ? stampText : undefined}
                    className="font-data text-xs text-muted-foreground"
                  >
                    {formatDate(stampText)}
                  </time>
                  <p className="mt-1 max-w-prose text-sm font-medium">
                    {fact(item)}
                  </p>
                  <p
                    translate="no"
                    className="mt-1 font-data text-xs text-muted-foreground [overflow-wrap:anywhere]"
                  >
                    {item.evidence_id}
                  </p>
                  <div data-open={expanded} className="reveal -ml-4">
                    <div className="overflow-hidden">
                      <pre
                        tabIndex={0}
                        aria-label={`Payload for ${item.evidence_id}`}
                        className="mt-3 max-h-72 overflow-auto rounded-md bg-surface-subtle p-3 font-data text-xs leading-5 break-all whitespace-pre-wrap text-foreground"
                      >
                        {JSON.stringify(item.payload, null, 2)}
                      </pre>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-5 border-l border-border pl-4 text-sm text-muted-foreground">
            No evidence has been recorded for this exception yet.
          </p>
        )}
      </div>
    </Card>
  );
}
