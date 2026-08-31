import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const techBadgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-sm bg-foreground px-2 py-1 font-data text-2xs font-medium uppercase tracking-[0.12em] text-background [&>svg]:size-3.5 [&>svg]:shrink-0",
  {
    variants: {
      accent: {
        neutral: "[&>svg]:text-background",
        primary: "[&>svg]:text-on-ink-signature",
        provider: "[&>svg]:text-on-ink-provider",
        warning: "[&>svg]:text-on-ink-warning",
        destructive: "[&>svg]:text-on-ink-destructive",
      },
    },
    defaultVariants: {
      accent: "neutral",
    },
  },
);

export type TechBadgeAccent = NonNullable<
  VariantProps<typeof techBadgeVariants>["accent"]
>;

export function TechBadge({
  accent,
  className,
  ...props
}: ComponentProps<"span"> & VariantProps<typeof techBadgeVariants>) {
  return (
    <span className={cn(techBadgeVariants({ accent }), className)} {...props} />
  );
}
