import {
  Check,
  CircleDashed,
  CircleOff,
  Clock3,
  ShieldAlert,
} from "lucide-react";

const statusConfig = {
  pending: {
    label: "Pending",
    className: "border-warning/40 bg-warning-soft text-warning",
    icon: Clock3,
  },
  reconciled: {
    label: "Verified",
    className: "border-primary/30 bg-accent text-accent-foreground",
    icon: Check,
  },
  escalated: {
    label: "Escalated",
    className: "border-destructive/30 bg-danger-soft text-destructive",
    icon: ShieldAlert,
  },
  ambiguous: {
    label: "Ambiguous",
    className: "border-warning/40 bg-warning-soft text-warning",
    icon: CircleOff,
  },
  active: {
    label: "Active",
    className: "border-primary/30 bg-accent text-accent-foreground",
    icon: CircleDashed,
  },
} as const;

export type StatusKind = keyof typeof statusConfig;

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status as StatusKind] ?? statusConfig.pending;
  const Icon = config.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-medium ${config.className}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {config.label}
    </span>
  );
}
