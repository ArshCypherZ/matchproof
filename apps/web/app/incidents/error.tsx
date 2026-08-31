"use client";
import { useEffect } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";

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

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <InlineNotice
        title="Exception queue unavailable"
        body="The queue read failed. Existing actions were not changed."
        actionLabel="Retry queue"
        onAction={retry}
      />
    </main>
  );
}
