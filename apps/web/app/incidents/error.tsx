"use client";
import { InlineNotice } from "@/components/feedback/inline-notice";
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <InlineNotice
        title="Incident queue unavailable"
        body="The queue read failed. Existing actions were not changed."
        actionLabel="Retry queue"
        onAction={reset}
      />
    </main>
  );
}
