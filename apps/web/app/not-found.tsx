import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 lg:px-8"
    >
      <h1 className="text-2xl font-semibold">Record not found</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        The record is unavailable in this tenant or source. Existing filters and
        data remain unchanged.
      </p>
      <Button
        render={<Link href="/incidents" />}
        variant="outline"
        className="mt-5"
        data-icon="inline-start"
      >
        <ArrowLeft aria-hidden="true" />
        Return to incidents
      </Button>
    </main>
  );
}
