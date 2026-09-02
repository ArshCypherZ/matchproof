"use client";

import { useId, useState } from "react";
import { Info } from "lucide-react";
import { SplitValue } from "@/components/shared/split-value";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* A KPI band. Tone is a quiet status dot on the label row — the value
   stays neutral ink so a wall of four bands never reads as a color field.
   "default" carries no dot: the metric is informational, not good or bad.
   The dot is color-only ink, so its meaning also rides the label as a
   visually-hidden word ("Resolution rate, healthy"): the band never
   depends on color alone, and a screen reader hears the same verdict a
   sighted operator sees. A placeholder value ("None yet") keeps the same
   KPI size as its peers so a row stays aligned, and drops to muted ink so
   it reads as a secondary state rather than a real number. */
const dotTone = {
  default: null,
  warning: "bg-warning",
  safe: "bg-success",
  destructive: "bg-destructive",
} as const;

const toneWord = {
  safe: "healthy",
  warning: "needs attention",
  destructive: "critical",
} as const;

/* A band is a cell in a KPI strip (advise 18): the parent grid owns the
   bg-surface container and the column ladder, and the hairline rules here
   divide siblings without stroking the card's edge. One ladder serves every
   strip on the page — one column below sm, two from sm, a single row at lg
   (three, four, or five cells). */
const cellDividers =
  "[&:nth-child(n+2)]:border-t sm:[&:nth-child(n+2)]:border-t-0 sm:[&:nth-child(n+3)]:border-t sm:[&:nth-child(even)]:border-l lg:[&:nth-child(n+3)]:border-t-0 lg:[&:not(:first-child)]:border-l";

export function MetricBand({
  value,
  label,
  hint,
  tone = "default",
  muted = false,
  className,
}: {
  value: string;
  label: string;
  /* Every band explains itself (advise 19) without a wall of note text:
     the explanation sits behind the info glyph beside the label as a real
     disclosure — focusable, expandable with keyboard, pointer, or touch —
     so the definition reaches every operator, not just hover. The hint
     renders in exactly one place (the expanded line); there is no sr-only
     twin and no title to double-announce it. */
  hint: string;
  tone?: "default" | "warning" | "safe" | "destructive";
  muted?: boolean;
  className?: string;
}) {
  const [hintOpen, setHintOpen] = useState(false);
  const hintId = useId();
  const dotClass = dotTone[tone];
  return (
    <article className={cn("px-4 py-4", cellDividers, className)}>
      <p
        className={`font-display font-medium tracking-tight tabular-nums [overflow-wrap:anywhere] text-4xl lg:text-5xl ${
          muted ? "text-muted-foreground" : ""
        }`}
      >
        {/* Fintech figures split whole from fraction (advise 25): the
            magnitude leads and the decimal tail renders smaller and
            quieter. Figures without a decimal tail — counts, durations,
            placeholders — render untouched. */}
        <SplitValue value={value} />
      </p>
      <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm font-medium">
        {dotClass ? (
          <span
            aria-hidden="true"
            className={`size-2 shrink-0 rounded-full ${dotClass}`}
          />
        ) : null}
        {label}
        {tone !== "default" ? (
          <span className="sr-only">, {toneWord[tone]}</span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-expanded={hintOpen}
          aria-controls={hintId}
          onClick={() => setHintOpen((open) => !open)}
          className="-my-1 text-muted-foreground"
        >
          <Info aria-hidden="true" className="size-3.5" />
          <span className="sr-only">
            {hintOpen ? "Hide" : "Show"} the definition of {label}
          </span>
        </Button>
      </p>
      {/* The hint node always exists (aria-controls must resolve even while
          collapsed); the hidden attribute removes it from the tree and the
          paint until the disclosure opens it. */}
      <p
        id={hintId}
        hidden={!hintOpen}
        className="mt-2 text-xs leading-5 text-muted-foreground"
      >
        {hint}
      </p>
    </article>
  );
}
