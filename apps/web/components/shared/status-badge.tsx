import {
  Check,
  CircleDashed,
  CircleOff,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import {
  TechBadge,
  type TechBadgeAccent,
} from "@/components/shared/tech-badge";

const statusConfig = {
  pending: {
    label: "Pending",
    accent: "warning",
    icon: Clock3,
  },
  reconciled: {
    label: "Verified",
    accent: "primary",
    icon: Check,
  },
  escalated: {
    label: "Escalated",
    accent: "destructive",
    icon: ShieldAlert,
  },
  ambiguous: {
    label: "Ambiguous",
    accent: "warning",
    icon: CircleOff,
  },
  active: {
    label: "Active",
    accent: "primary",
    icon: CircleDashed,
  },
} as const satisfies Record<
  string,
  { label: string; accent: TechBadgeAccent; icon: typeof Clock3 }
>;

export type StatusKind = keyof typeof statusConfig;

// An unknown status is shown as itself — never relabeled "Pending", which
// would claim a state the record does not have.
export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as StatusKind];
  const Icon = config?.icon ?? CircleDashed;
  const label = config?.label ?? status.replaceAll("_", " ");
  return (
    <TechBadge accent={config?.accent ?? "neutral"}>
      <Icon aria-hidden="true" />
      {label}
    </TechBadge>
  );
}
