"use client";
import { useEffect } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { BenchmarkResults } from "@/components/metrics/benchmark-results";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  /* Degrade to the benchmark-only page rather than a bare 500: the
     benchmark is static shipped data and survives any live-store failure,
     so the operator keeps the half of the page that still measures
     something. The live section's absence is the notice; retry re-runs
     the page. */
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="border-b border-border pb-8">
        <div className="min-w-0">
          <h1 className="font-display text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Metrics
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live exception outcomes and the offline benchmark that measures
            controller quality.
          </p>
        </div>
      </div>
      <div className="mt-10">
        <InlineNotice
          title="Live metrics unavailable"
          body="The live numbers could not be loaded. Nothing you have already done was changed. The offline benchmark below is unaffected."
          actionLabel="Try again"
          onAction={retry}
        />
      </div>
      <BenchmarkResults />
    </main>
  );
}
