"use client";

import { useState } from "react";
import { FileJson, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/components/shared/format";

type Evidence = {
  evidence_id: string;
  kind: string;
  occurred_at: string;
  received_at: string;
  payload: unknown;
};

function fact(item: Evidence) {
  const payload = item.payload as Record<string, unknown>;
  if (item.kind === "processor_webhook")
    return `Provider webhook received${payload.payment_state ? ` with payment state ${payload.payment_state}` : ""}.`;
  if (item.kind === "merchant_order_state")
    return `Merchant order state observed${payload.order_state ? ` as ${payload.order_state}` : ""}.`;
  if (item.kind.includes("fetch")) return "Razorpay payment details fetched.";
  return item.kind
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function EvidenceTimeline({ evidence }: { evidence: Evidence[] }) {
  const [receivedOrder, setReceivedOrder] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const sorted = [...evidence].sort(
    (left, right) =>
      Date.parse(receivedOrder ? left.received_at : left.occurred_at) -
      Date.parse(receivedOrder ? right.received_at : right.occurred_at),
  );
  return (
    <section aria-labelledby="evidence-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="evidence-heading" className="text-lg font-semibold">
            Evidence
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Chronological facts from provider and merchant sources.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReceivedOrder((value) => !value)}
          aria-pressed={receivedOrder}
        >
          {receivedOrder ? "Event time" : "Arrival time"}
        </Button>
      </div>
      {sorted.length ? (
        <ol className="mt-5 border-l border-border pl-4">
          {sorted.map((item, index) => {
            const expanded = open === item.evidence_id;
            // Provider Blue marks provider-sourced facts; merchant observations
            // carry ink, per the palette's meaning for each source.
            const fromProvider = item.kind !== "merchant_order_state";
            return (
              <li
                key={item.evidence_id}
                style={{ animationDelay: `${Math.min(index, 10) * 40}ms` }}
                className="animate-enter-rise relative pb-6 pr-12 last:pb-0 motion-reduce:animate-none"
              >
                <span
                  aria-hidden="true"
                  className={`absolute -left-[21px] top-1 grid size-3 place-items-center rounded-full border ${fromProvider ? "border-provider bg-provider-soft" : "border-border bg-surface-subtle"}`}
                >
                  <ShieldCheck
                    className={`size-2 ${fromProvider ? "text-provider" : "text-ink-secondary"}`}
                  />
                </span>
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
                  dateTime={receivedOrder ? item.received_at : item.occurred_at}
                  className="font-data text-xs text-muted-foreground"
                >
                  {formatDate(
                    receivedOrder ? item.received_at : item.occurred_at,
                  )}
                </time>
                <p className="mt-1 text-sm font-medium">{fact(item)}</p>
                <p className="mt-1 font-data text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {item.evidence_id}
                </p>
                <div data-open={expanded} className="reveal -ml-4">
                  <div className="overflow-hidden">
                    <pre
                      tabIndex={0}
                      aria-label={`Payload for ${item.evidence_id}`}
                      className="mt-3 max-h-72 overflow-auto rounded-r-md border border-l-0 border-border bg-surface-subtle p-3 font-data text-xs leading-5 break-all whitespace-pre-wrap text-foreground"
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
    </section>
  );
}
