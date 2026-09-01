import {
  Activity,
  Database,
  FlaskConical,
  Radio,
  ShieldAlert,
} from "lucide-react";

const labels = {
  razorpay_test: "Razorpay Test mode",
  synthetic_evaluation: "Offline benchmark",
  redacted_archetype: "Reference case",
  measured_live: "Live data",
} as const;

export type SourceKind = keyof typeof labels;

// Records from the internal rehearsal pipeline carry no provenance badge:
// they are this app's own records, and labeling them adds no operator
// value. Only external sources (the provider, live data) are labeled.
const UNLABELED_SOURCES = new Set(["fixture_rehearsal"]);

// Provenance is a property of the record, not a control: the badge renders
// as a static label with no fill, so it never reads as clickable.
export function SourceBadge({ source }: { source: string }) {
  if (UNLABELED_SOURCES.has(source)) return null;
  const label = labels[source as SourceKind] ?? source;
  const Icon =
    source === "razorpay_test"
      ? Radio
      : source === "measured_live"
        ? Activity
        : source === "synthetic_evaluation"
          ? FlaskConical
          : source === "redacted_archetype"
            ? ShieldAlert
            : Database;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground [&>svg]:size-3.5 [&>svg]:shrink-0">
      <Icon aria-hidden="true" />
      {label}
    </span>
  );
}
