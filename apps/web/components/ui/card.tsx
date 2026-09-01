import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/* The one Card. Panels separate from the canvas by the tonal surface
   step (white on the #f6f6f3 canvas), never by a border stroke. The
   header row carries the one permitted hairline as a divider. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      data-slot="card"
      className={cn("overflow-hidden rounded-xl bg-surface", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-4 sm:px-5",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-body"
      className={cn("px-5 py-4", className)}
      {...props}
    />
  );
}
