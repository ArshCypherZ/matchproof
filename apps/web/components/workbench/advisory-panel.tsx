"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

export type Advisory = {
  action: string;
  reasoning: string;
  uncertainty: string | null;
  hypotheses: { rank: number; summary: string; reasoning: string }[];
  missing_fact: string | null;
  next_read: {
    tool: string;
    reason: string;
    expected_fact: string;
  } | null;
  stopping_condition: string | null;
  decision_needed: string | null;
  owner: string | null;
  provider: string | null;
  model: string | null;
  reads: { tool: string; result: string }[];
};

// Machine words become readable labels; an unknown value keeps its raw
// words, never a guessed label.
const ACTION_LABELS: Record<string, string> = {
  reconcile_internal_state: "Align the merchant order",
  retry_safe_read: "Read the evidence again",
  no_action_required: "No action needed",
  escalate: "Hand the case to a person",
  retry_capture: "Retry the capture",
};

const OWNER_LABELS: Record<string, string> = {
  controller: "Controller",
  "payment-operations": "Payment operations",
  "merchant-engineering": "Merchant engineering",
  "provider-support": "Provider support",
};

const READ_LABELS: Record<string, string> = {
  fetch_payment: "fetch payment",
  fetch_order: "fetch order",
  search_events: "search events",
  fetch_merchant_order: "fetch merchant order",
};

const RESULT_LABELS: Record<string, string> = {
  success: "ok",
  denied: "denied",
  timeout: "timeout",
  rate_limited: "rate limited",
  error: "error",
};

function label(map: Record<string, string>, value: string) {
  return map[value] ?? value.replaceAll("_", " ");
}

/* The model sometimes echoes machine identifiers from its prompt
   (settlement_status, search_events) into otherwise readable prose. The
   console's one convention applies to its output too: underscores out. */
function text(value: string) {
  return value.replaceAll("_", " ");
}

/* One anatomy for every supporting fact in the card: a muted label line
   (optionally carrying one machine-value chip) and one body-value line
   below it. Nothing in the card is small-bold-inline or mixed-size. */
function FactRow({
  label: rowLabel,
  value,
  chip,
}: {
  label: string;
  value: string;
  chip?: string;
}) {
  return (
    <div>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {rowLabel}
        {chip ? (
          <Badge translate="no" className="font-data">
            {chip}
          </Badge>
        ) : null}
      </p>
      <p className="mt-1 max-w-prose text-sm leading-6">{value}</p>
    </div>
  );
}

type Chapter = {
  id: string;
  title: string;
  content: ReactNode;
};

export function AdvisoryPanel({ advisory }: { advisory: Advisory }) {
  const [open, setOpen] = useState(
    () => new Set(["recommendation", "missing"]),
  );
  const chapters: Chapter[] = [
    {
      id: "recommendation",
      title: "What it suggests",
      content: (
        <div className="space-y-4">
          <div>
            <Badge>{label(ACTION_LABELS, advisory.action)}</Badge>
          </div>
          <p className="max-w-prose text-sm leading-6">{text(advisory.reasoning)}</p>
          {advisory.uncertainty ? (
            <FactRow label="Uncertainty" value={text(advisory.uncertainty)} />
          ) : null}
        </div>
      ),
    },
    {
      id: "missing",
      title: "What is missing",
      content: (
        <div className="space-y-4">
          {advisory.missing_fact ? (
            <p className="max-w-prose text-sm leading-6">
              {text(advisory.missing_fact)}
            </p>
          ) : null}
          {/* The read's own reason restates the recommendation's reasoning,
              so the card shows what the read should reveal, not the same
              paragraph twice. */}
          {advisory.next_read ? (
            <FactRow
              label="What to check next"
              value={text(advisory.next_read.expected_fact)}
              chip={
                advisory.next_read.tool !== "none"
                  ? label(READ_LABELS, advisory.next_read.tool)
                  : undefined
              }
            />
          ) : null}
          {advisory.decision_needed ? (
            <FactRow
              label="Decision needed"
              value={text(advisory.decision_needed)}
            />
          ) : null}
          {advisory.stopping_condition ? (
            <FactRow
              label="Stops when"
              value={text(advisory.stopping_condition)}
            />
          ) : null}
        </div>
      ),
    },
  ];
  if (advisory.hypotheses.length)
    chapters.push({
      id: "hypotheses",
      title: "Ranked hypotheses",
      content: (
        <div className="space-y-4">
          {advisory.hypotheses.map((hypothesis) => (
            <div key={hypothesis.rank}>
              <p className="text-sm font-medium">
                {advisory.hypotheses.length > 1 ? (
                  <span
                    className="mr-2 font-data text-xs text-muted-foreground"
                    aria-hidden="true"
                  >
                    {hypothesis.rank}
                  </span>
                ) : null}
                {text(hypothesis.summary)}
              </p>
              <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">
                {text(hypothesis.reasoning)}
              </p>
            </div>
          ))}
        </div>
      ),
    });

  const toggle = (id: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card aria-labelledby="advisory-heading">
      <CardHeader className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="advisory-heading" className="text-lg font-semibold">
            AI review
          </h2>
          <p className="mt-1 max-w-prose text-xs text-muted-foreground">
            What the model concluded from the evidence. It advises; the policy
            decides.
          </p>
        </div>
        {/* The card stays visually quiet on purpose: the advisory carries
            no authority, so it earns no state color — the same neutrality
            the tier-0 findings card keeps. The model name is the one
            machine fact, in the data voice. */}
        {advisory.model ? (
          <Badge translate="no" className="shrink-0 font-data">
            {advisory.model}
          </Badge>
        ) : null}
      </CardHeader>
      <div className="divide-y divide-border px-5">
        {chapters.map((chapter) => {
          const expanded = open.has(chapter.id);
          const panelId = `advisory-${chapter.id}`;
          return (
            <article key={chapter.id}>
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
      <dl className="grid gap-4 border-t border-border px-5 py-5 text-sm sm:grid-cols-2">
        {advisory.owner ? (
          <div>
            <dt className="text-xs text-muted-foreground">Owner</dt>
            <dd className="mt-1">{label(OWNER_LABELS, advisory.owner)}</dd>
          </div>
        ) : null}
        {advisory.reads.length ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">
              What the model read
            </dt>
            <dd className="mt-2 flex flex-wrap gap-2">
              {advisory.reads.map((read, index) => (
                <Badge
                  key={`${read.tool}-${index}`}
                  className="font-data"
                >
                  {label(READ_LABELS, read.tool)} ·{" "}
                  {label(RESULT_LABELS, read.result)}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
    </Card>
  );
}
