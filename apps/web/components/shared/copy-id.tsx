"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Copy affordance for long provider identifiers: copies on click, confirms
 * with a check for a beat, and falls back silently where the clipboard is
 * unavailable. The value stays visible beside it for reading.
 */
export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be blocked; the value is still readable.
    }
  };

  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate font-data" title={value}>
        {value}
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={copy}
        aria-label={`Copy ${value}`}
        title={`Copy ${value}`}
        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground"
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
