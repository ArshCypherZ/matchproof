import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
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

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const headerList = await headers();
  const { tenantId } = requestContext(headerList);
  const [batches, incidents] = await Promise.all([
    listBatchDtos(tenantId),
    listIncidentDtos(tenantId),
  ]);
  const incidentStatus = new Map(
    incidents.map((incident) => [incident.incident_id, incident.status]),
  );
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="workspace-rail py-10 sm:py-14"
    >
      <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3">
            <SourceBadge source="fixture_rehearsal" />
          </div>
          <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
            Batches
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground sm:text-base">
            Track batch progress and review exceptions that still need action.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            render={<Link href="/incidents" />}
            variant="outline"
            data-icon="inline-end"
          >
            Choose exceptions <ArrowRight aria-hidden="true" />
          </Button>
          <StartBatchButton
            incidentIds={incidents
              .filter((item) => item.status === "pending")
              .map((item) => item.incident_id)}
          />
        </div>
      </div>
      <section className="mt-10 overflow-hidden border border-border bg-surface">
        <div className="flex items-baseline gap-3 border-b border-border px-4 py-4 sm:px-5">
          <span className="font-data text-2xs text-muted-foreground">
            Batch history
          </span>
          <h2 className="text-sm font-semibold">Recent batches</h2>
        </div>
        {batches.length ? (
          <div className="divide-y divide-border">
            {batches.map((batch, index) => {
              const counts = batch.incident_ids.reduce(
                (result, incidentId) => {
                  const status = incidentStatus.get(incidentId) ?? "pending";
                  const key =
                    status === "reconciled"
                      ? "reconciled"
                      : status === "escalated"
                        ? "escalated"
                        : status === "ambiguous"
                          ? "ambiguous"
                          : "pending";
                  result[key] += 1;
                  return result;
                },
                { pending: 0, reconciled: 0, escalated: 0, ambiguous: 0 },
              );
              return (
                <Link
                  key={batch.batch_id}
                  href={`/batches/${batch.batch_id}`}
                  className="focus-ring animate-in fade-in slide-in-from-bottom-2 flex items-center justify-between gap-4 px-4 py-5 duration-500 hover:bg-surface-subtle sm:px-5"
                  style={{
                    animationDelay: `${Math.min(index, 8) * 45}ms`,
                    animationFillMode: "both",
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center bg-accent text-accent-foreground">
                      <Layers3 aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-data text-sm">
                        {batch.batch_id}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-data">
                          {batch.incident_ids.length}
                        </span>{" "}
                        records started
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <div
                      role="img"
                      aria-label={`${counts.pending} pending, ${counts.reconciled} verified, ${counts.escalated} escalated, ${counts.ambiguous} ambiguous`}
                      className="grid w-28 grid-cols-12 gap-0.5"
                    >
                      {batch.incident_ids.slice(0, 12).map((incidentId) => {
                        const status = incidentStatus.get(incidentId);
                        const tone =
                          status === "reconciled"
                            ? "bg-primary"
                            : status === "escalated"
                              ? "bg-destructive"
                              : "bg-warning";
                        return (
                          <span key={incidentId} className={`h-2 ${tone}`} />
                        );
                      })}
                    </div>
                    <ArrowRight
                      aria-hidden="true"
                      className="size-4 text-muted-foreground"
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="m-4 grid gap-6 border border-border bg-surface-raised p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-8">
            <div>
              <p className="font-data text-2xs uppercase tracking-[0.12em]">
                No batches yet
              </p>
              <p className="mt-4 max-w-md font-display text-3xl font-medium leading-tight tracking-tight">
                Select pending exceptions to start the first batch.
              </p>
            </div>
            <Button render={<Link href="/incidents" />} data-icon="inline-end">
              Choose exceptions <ArrowRight aria-hidden="true" />
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
