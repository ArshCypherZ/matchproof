"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { shortcutsInert } from "./queue-shortcuts";

// The operator's serial loop: work a record, then step to the next one in
// the queue with one key. The pager itself stays a hairline affordance — the
// workbench carries enough visual weight already.
export function IncidentPager({
  previousHref,
  nextHref,
}: {
  previousHref: string | null;
  nextHref: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!previousHref && !nextHref) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (shortcutsInert(event)) return;
      const back = event.key === "p" || event.key === "[";
      const forward = event.key === "n" || event.key === "]";
      if (!back && !forward) return;
      const href = forward ? nextHref : previousHref;
      if (!href) return;
      event.preventDefault();
      router.push(href);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [nextHref, previousHref, router]);

  if (!previousHref && !nextHref) return null;

  return (
    <nav
      aria-label="Adjacent exceptions in the queue"
      className="flex shrink-0 items-center font-data text-2xs uppercase tracking-[0.08em] text-muted-foreground"
    >
      {previousHref ? (
        <Link
          href={previousHref}
          className="focus-ring inline-flex items-center gap-1 rounded-sm px-1.5 py-1 transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3" />
          Previous
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1 px-1.5 py-1 text-ink-tertiary"
        >
          <ArrowLeft aria-hidden="true" className="size-3" />
          Previous
        </span>
      )}
      <span aria-hidden="true" className="mx-1 h-3 w-px bg-border" />
      {nextHref ? (
        <Link
          href={nextHref}
          className="focus-ring inline-flex items-center gap-1 rounded-sm px-1.5 py-1 transition-colors hover:text-foreground"
        >
          Next exception
          <ArrowRight aria-hidden="true" className="size-3" />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1 px-1.5 py-1 text-ink-tertiary"
        >
          Next exception
          <ArrowRight aria-hidden="true" className="size-3" />
        </span>
      )}
    </nav>
  );
}
