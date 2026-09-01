import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// A bad id or another tenant's exception lands here. The generic app-wide
// record page names no record type; this one says what is missing and where
// the operator's work actually is — the queue, unchanged.
export default function NotFound() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <h1 className="text-2xl font-semibold">Exception not found</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        This exception is not in this tenant&apos;s queue. It may belong to
        another tenant, or the link is stale. The queue and every other record
        are unchanged.
      </p>
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
