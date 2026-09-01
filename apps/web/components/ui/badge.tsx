import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* The one Badge. Status and classification chips everywhere compose this
   variant set: a small tonal fill with its paired text tone, never a
   stroke, never an inverted-ink block. Variants map to the semantic
   status slots (neutral / caution / success / danger / active). */
export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium [&>svg]:size-3.5 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "bg-surface-subtle text-ink-secondary",
        caution: "bg-warning-soft text-warning",
        success: "bg-success/10 text-success-strong",
        danger: "bg-destructive/10 text-destructive-strong",
        active: "bg-ring/10 text-ring-strong",
        provider: "bg-provider-soft text-provider-strong",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>["variant"]
>;

export function Badge({
  variant,
  className,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
