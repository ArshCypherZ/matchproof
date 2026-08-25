import { Database, FlaskConical, Radio, ShieldAlert } from "lucide-react";

const labels = {
  razorpay_test: "Razorpay Test mode",
  fixture_rehearsal: "Fixture rehearsal",
  synthetic_evaluation: "Synthetic evaluation",
  redacted_archetype: "Redacted archetype",
} as const;

export type SourceKind = keyof typeof labels;

export function SourceBadge({ source }: { source: SourceKind | string }) {
  const label = labels[source as SourceKind] ?? source;
  const Icon =
    source === "razorpay_test"
      ? Radio
      : source === "synthetic_evaluation"
        ? FlaskConical
        : source === "redacted_archetype"
          ? ShieldAlert
          : Database;
  return (
    <span className="inline-flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs text-muted-foreground">
      <Icon
        aria-hidden="true"
        className={
          source === "razorpay_test"
            ? "size-3.5 text-provider"
            : "size-3.5 text-primary"
        }
      />
      {label}
    </span>
  );
}
