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
        body="The exceptions could not be loaded. Nothing you have already done was changed."
        actionLabel="Try again"
        onAction={retry}
      />
    </main>
  );
}
