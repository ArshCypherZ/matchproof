"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorView({
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
      className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8"
    >
      <section className="max-w-2xl border-l-2 border-destructive pl-5">
        <AlertTriangle
          aria-hidden="true"
          className="mb-4 size-5 text-destructive"
        />
        <h1 className="text-2xl font-semibold">
          The application could not load this view
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          No incident action was performed. Retry the safe read to restore the
          current view.
        </p>
        <Button onClick={retry} className="mt-5" data-icon="inline-start">
          <RotateCcw aria-hidden="true" />
          Retry read
        </Button>
      </section>
    </main>
  );
}
