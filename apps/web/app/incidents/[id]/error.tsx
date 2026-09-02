"use client";
import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
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
        title="Exception unavailable"
        body="This exception could not be loaded. Nothing was changed."
        actionLabel="Try again"
        onAction={retry}
      />
      {/* Retry recovers a transient failure; if the record stays broken, the
          operator's work is still the queue — same words as the not-found
          state, so one recovery vocabulary across both dead ends. */}
      <Button
        render={<Link href="/incidents" />}
        variant="outline"
        className="mt-5"
        data-icon="inline-start"
      >
        <ArrowLeft aria-hidden="true" />
        Return to exceptions
      </Button>
    </main>
  );
}
