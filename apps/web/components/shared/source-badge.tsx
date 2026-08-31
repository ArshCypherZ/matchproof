import {
  Activity,
  Database,
  FlaskConical,
  Radio,
  ShieldAlert,
} from "lucide-react";
import { TechBadge } from "@/components/shared/tech-badge";

const labels = {
  razorpay_test: "Razorpay Test mode",
  fixture_rehearsal: "Simulated exceptions",
  synthetic_evaluation: "Offline benchmark",
  redacted_archetype: "Reference case",
  measured_live: "Live data",
} as const;

export type SourceKind = keyof typeof labels;

export function SourceBadge({ source }: { source: string }) {
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
    <TechBadge
      accent={
        source === "razorpay_test" || source === "measured_live"
          ? "provider"
          : "primary"
      }
    >
      <Icon aria-hidden="true" />
      {label}
    </TechBadge>
  );
}
