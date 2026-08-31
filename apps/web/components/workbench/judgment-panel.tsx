"use client";

import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { AlertTriangle, BookOpenCheck, Plus } from "lucide-react";
import { TechBadge } from "@/components/shared/tech-badge";

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

type Chapter = {
  id: string;
  index: string;
  title: string;
  content: ReactNode;
};

export function JudgmentPanel({ incident }: { incident: Incident }) {
  const [open, setOpen] = useState(
    () => new Set(["reconstruction", "hypothesis"]),
  );
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const hypothesis = incident.reconciliation.discrepancy
    ? sentenceCase(incident.reconciliation.discrepancy)
    : "Provider and merchant state currently agree";
  const missing = incident.reconciliation.ambiguity_reasons;
  const evidence = new Map(
    incident.evidence.map((item) => [item.evidence_id, item]),
  );
  const runbook =
    incident.reconciliation.resolution === "reconcile_internal_state"
      ? "Update the uniquely mapped merchant order after approval."
      : incident.reconciliation.resolution === "no_action_required"
        ? "Record that no merchant-side action is required."
        : "Create an accountable escalation with the current evidence bundle.";
  const chapters: Chapter[] = [
    {
      id: "reconstruction",
      index: "01",
      title: "What happened",
      content: (
        <p className="text-sm leading-6">
          {sentenceCase(incident.reconstruction.current_state)}.
        </p>
      ),
    },
    {
      id: "hypothesis",
      index: "02",
      title: "Likely cause",
      content: (
        <>
          <p className="text-sm leading-6">{hypothesis}.</p>
          {missing.length ? (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">
                Missing or conflicting evidence
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {missing.map((item) => (
                  <li key={item}>
                    <span
                      title={item}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-warning bg-warning-soft px-2 py-1 font-data text-2xs uppercase tracking-[0.08em] text-warning"
                    >
                      <AlertTriangle aria-hidden="true" className="size-3.5" />
                      {item.replaceAll("_", " ")}
                    </span>
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
                <span
                  key={evidenceId}
                  title={detail}
                  className="rounded-sm border border-border bg-surface-subtle px-2 py-1 font-data text-2xs text-muted-foreground"
                >
                  {evidenceId}
                </span>
              );
            })}
          </div>
        </>
      ),
    },
    {
      id: "runbook",
      index: "03",
      title: "Selected runbook",
      content: (
        <>
          <p className="text-sm leading-6">{runbook}</p>
          <p className="mt-3 text-xs text-muted-foreground">
            No external sources were used for this assessment.
          </p>
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
    <section
      aria-labelledby="judgment-heading"
      className="scroll-mt-24 overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-4">
        <BookOpenCheck
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
        <h2 id="judgment-heading" className="text-lg font-semibold">
          Review findings
        </h2>
        {/* The chip states what the record still needs from the operator, so
            it follows the record's status and never reads "review" on a
            record that was already closed or escalated. */}
        <TechBadge
          accent={
            incident.status === "escalated"
              ? "destructive"
              : incident.status === "reconciled"
                ? "primary"
                : "warning"
          }
          className="shrink-0"
        >
          {incident.status === "escalated"
            ? "Escalated"
            : incident.status === "reconciled"
              ? "Verified"
              : "Review required"}
        </TechBadge>
      </div>
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
              className={`transition-colors duration-150 ease-[var(--ease-out-expo)] motion-reduce:transition-none ${
                spotlight === chapter.id
                  ? "bg-card text-foreground"
                  : `bg-transparent ${dimmed ? "text-ink-secondary" : "text-foreground"}`
              }`}
            >
              <h3>
                <button
                  type="button"
                  onClick={() => toggle(chapter.id)}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  className="focus-ring flex w-full items-center gap-3 rounded-sm py-4 text-left"
                >
                  <span className="font-data text-2xs text-muted-foreground">
                    {chapter.index}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-semibold">
                    {chapter.title}
                  </span>
                  <motion.span
                    animate={{ rotate: expanded ? 45 : 0 }}
                    // Literal form of --ease-out-expo; motion resolves easing
                    // before styles are computed, so a CSS var cannot feed it.
                    transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                  >
                    <Plus aria-hidden="true" className="size-4" />
                  </motion.span>
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
    </section>
  );
}
