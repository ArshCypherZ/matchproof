"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, FileJson, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/components/shared/format";

type Evidence = {
  evidence_id: string;
  kind: string;
  occurred_at: string;
  received_at: string;
  source?: string;
  payload: unknown;
};

function fact(item: Evidence) {
  const payload = item.payload as Record<string, unknown>;
  if (item.kind === "processor_webhook")
    return `Provider webhook received${payload.payment_state ? ` with payment state ${payload.payment_state}` : ""}.`;
  if (item.kind === "merchant_order_state")
    return `Merchant order state observed${payload.order_state ? ` as ${payload.order_state}` : ""}.`;
  if (item.kind.includes("fetch"))
    return "Authoritative provider object fetched.";
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
          <h2 id="evidence-heading" className="text-base font-semibold">
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
        >
          {receivedOrder ? "Occurred order" : "Received order"}
        </Button>
      </div>
      <ol className="mt-5 border-l border-border pl-4">
        {sorted.map((item) => {
          const expanded = open === item.evidence_id;
          return (
            <li key={item.evidence_id} className="relative pb-6 last:pb-0">
              <span
                aria-hidden="true"
                className="absolute -left-[21px] top-1 grid size-3 place-items-center rounded-full border border-provider bg-provider-soft"
              >
                <ShieldCheck className="size-2 text-provider" />
              </span>
              <time
                dateTime={receivedOrder ? item.received_at : item.occurred_at}
                className="font-data text-xs text-muted-foreground"
              >
                {formatDate(
                  receivedOrder ? item.received_at : item.occurred_at,
                )}
              </time>
              <p className="mt-1 text-sm font-medium">{fact(item)}</p>
              <p className="mt-1 font-data text-xs text-muted-foreground">
                {item.evidence_id}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => setOpen(expanded ? null : item.evidence_id)}
                aria-expanded={expanded}
                data-icon="inline-start"
              >
                <FileJson aria-hidden="true" />
                Payload{" "}
                {expanded ? (
                  <ChevronUp aria-hidden="true" />
                ) : (
                  <ChevronDown aria-hidden="true" />
                )}
              </Button>
              {expanded ? (
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-surface-subtle p-3 font-data text-xs leading-5 text-foreground">
                  {JSON.stringify(item.payload, null, 2)}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
