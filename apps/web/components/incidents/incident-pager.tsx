"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { shortcutsInert, markRecordFocusStep } from "./queue-shortcuts";

// The operator's serial loop: work a record, then step to the next one in
// the queue with one key. The pager sits at the end of the workbench —
// where the operator is when the record is done — as a quiet full-width
// row over a hairline divider: Previous at one edge, Next at the other,
// matching the reading direction. The workbench above carries the visual
// weight; the pager is only the way out.
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
      // The step must carry focus to the new record's heading, not strand it
      // on the keyboard that just left the page.
      markRecordFocusStep();
      router.push(href);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [nextHref, previousHref, router]);

  if (!previousHref && !nextHref) return null;

  return (
    <nav
      aria-label="Adjacent exceptions in the queue"
      className="mt-10 flex items-center justify-between gap-4 border-t border-border pt-5 text-xs text-muted-foreground sm:pt-6"
    >
      {previousHref ? (
        <Link
          href={previousHref}
          onClick={markRecordFocusStep}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
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
      {/* The serial loop is a keyboard flow; teach it the way the queue
          teaches its own, in the same kbd idiom. Hidden where a keyboard is
          not the way in. */}
      <p className="hidden text-xs text-muted-foreground md:block">
        <kbd className="rounded-md bg-surface-subtle px-1 py-px font-data">
          p
        </kbd>{" "}
        <kbd className="rounded-md bg-surface-subtle px-1 py-px font-data">
          n
        </kbd>{" "}
        <span>step through exceptions</span>
      </p>
      {nextHref ? (
        <Link
          href={nextHref}
          onClick={markRecordFocusStep}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors duration-(--motion-duration-fast) ease-[var(--motion-ease-out)] hover:text-foreground pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center"
        >
          Next
          <ArrowRight aria-hidden="true" className="size-3" />
        </Link>
      ) : (
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-1 px-1.5 py-1 text-ink-tertiary"
        >
          Next
          <ArrowRight aria-hidden="true" className="size-3" />
        </span>
      )}
    </nav>
  );
}
