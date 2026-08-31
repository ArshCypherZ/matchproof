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
    <main id="main-content" tabIndex={-1} className="page-rail py-10 sm:py-14">
      <section className="max-w-2xl border-l-2 border-destructive pl-5">
        <AlertTriangle
          aria-hidden="true"
          className="mb-4 size-5 text-destructive"
        />
        <h1 className="text-2xl font-semibold">
          The application could not load this view
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          No payment or order changes were made. Try loading the page again.
        </p>
        <Button onClick={retry} className="mt-5" data-icon="inline-start">
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      </section>
    </main>
  );
}
