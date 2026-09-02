import type { ReactNode } from "react";

/* The count-beside-the-title every list page carries: one figure with its
   noun, boxed on a tonal surface so it reads as a unit instead of a stray
   number floating beside the heading. The label is children so a page can
   carry its qualifier ("exceptions shown", "· updated through …"). */
export function CountChip({
  value,
  children,
}: {
  value: number;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-baseline gap-2 rounded-md bg-surface px-3 py-1.5">
      <span className="font-display text-xl font-medium leading-none tabular-nums">
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{children}</span>
    </span>
  );
}
