import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Layers3 } from "lucide-react";
import {
  requestContext,
  listBatchDtos,
  listIncidentDtos,
} from "@/lib/incidents";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "@/components/shared/source-badge";
import { StartBatchButton } from "@/components/batches/start-batch-button";

export const metadata: Metadata = { title: "Batches" };

export default async function BatchesPage() {
  const { tenantId } = requestContext(new Request("http://o2.local"));
  const [batches, incidents] = await Promise.all([
    listBatchDtos(tenantId),
    listIncidentDtos(tenantId),
  ]);
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3">
            <SourceBadge source="fixture_rehearsal" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Batches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review durable runs and their unresolved exception list.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            render={<Link href="/incidents" />}
            variant="outline"
            data-icon="inline-end"
          >
            Choose incidents <ArrowRight aria-hidden="true" />
          </Button>
          <StartBatchButton
            incidentIds={incidents
              .filter((item) => item.status === "pending")
              .map((item) => item.incident_id)}
          />
        </div>
      </div>
      <section className="mt-6 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold">Recent runs</h2>
        </div>
        {batches.length ? (
          <div className="divide-y divide-border">
            {batches.map((batch) => (
              <Link
                key={batch.batch_id}
                href={`/batches/${batch.batch_id}`}
                className="focus-ring flex items-center justify-between gap-4 px-4 py-4 hover:bg-surface-subtle sm:px-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                    <Layers3 aria-hidden="true" className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-data text-sm">{batch.batch_id}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {batch.incident_ids.length} records started
                    </p>
                  </div>
                </div>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </Link>
            ))}
          </div>
        ) : (
          <div className="px-5 py-14 text-center">
            <p className="text-sm font-medium">No batch runs recorded</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a fixture batch from the current pending incidents.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
