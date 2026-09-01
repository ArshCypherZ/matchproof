import {
  Check,
  CircleDashed,
  CircleOff,
  Clock3,
  ShieldAlert,
} from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

const statusConfig = {
  pending: {
    label: "Pending",
    variant: "caution" as BadgeVariant,
    icon: Clock3,
  },
  reconciled: {
    label: "Verified",
    variant: "success" as BadgeVariant,
    icon: Check,
  },
  escalated: {
    label: "Escalated",
    variant: "danger" as BadgeVariant,
    icon: ShieldAlert,
  },
  ambiguous: {
    label: "Ambiguous",
    variant: "caution" as BadgeVariant,
    icon: CircleOff,
  },
  active: {
    label: "Active",
    variant: "active" as BadgeVariant,
    icon: CircleDashed,
  },
} as const satisfies Record<
  string,
  { label: string; variant: BadgeVariant; icon: typeof Clock3 }
>;

export type StatusKind = keyof typeof statusConfig;

// An unknown status is shown as itself — never relabeled "Pending", which
// would claim a state the record does not have.
export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as StatusKind];
  const Icon = config?.icon ?? CircleDashed;
  const label = config?.label ?? status.replaceAll("_", " ");
  return (
    <Badge variant={config?.variant ?? "neutral"}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}
