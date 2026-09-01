import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InlineNotice({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-4 rounded-xl bg-warning-soft px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex gap-3">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-warning"
        />
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-sm text-warning">{body}</p>
        </div>
      </div>
      {actionLabel && onAction ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onAction}
          data-icon="inline-start"
        >
          <RotateCcw aria-hidden="true" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
