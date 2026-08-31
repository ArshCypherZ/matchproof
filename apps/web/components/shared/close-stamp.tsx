import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const tones = {
  ink: "text-foreground",
  signature: "text-stamp",
} as const;

/**
 * An inked ledger stamp for a terminal state. Decorative by design — the
 * status badge beside it carries the accessible label. `pressed` plays the
 * one-time press-in when the terminal state was observed live; a page that
 * loads already closed renders the stamp at rest.
 */
export function CloseStamp({
  label,
  tone = "signature",
  pressed = false,
  angle = -3,
  className,
}: {
  label: string;
  tone?: keyof typeof tones;
  pressed?: boolean;
  angle?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "close-stamp",
        tones[tone],
        pressed && "animate-stamp-press motion-reduce:animate-none",
        className,
      )}
      style={{ "--stamp-angle": `${angle}deg` } as CSSProperties}
    >
      {label}
    </span>
  );
}
