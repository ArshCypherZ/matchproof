"use client";

import Link from "next/link";
import { Activity, ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceBadge } from "@/components/shared/source-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import { LiveRefresh } from "@/components/shared/live-refresh";

type Incident = {
  incident_id: string;
  incident_class: string;
  status: string;
  current_step: string;
  source_kind: string;
};

export function BatchView({
  batchId,
  incidents,
  startedAt,
}: {
  batchId: string;
  incidents: Incident[];
  startedAt: string;
}) {
  const counts = incidents.reduce<Record<string, number>>((result, item) => {
    const key =
      item.status === "reconciled"
        ? "automatic"
        : item.status === "escalated"
          ? "ambiguous"
          : "pending";
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {});
  const terminal = (counts.automatic ?? 0) + (counts.ambiguous ?? 0);
  const classLabel = (value: string) => value.replaceAll("_", " ");
  return (
    <main
      id="main-content"
      className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8"
    >
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3">
            <SourceBadge source="fixture_rehearsal" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Batch {batchId.slice(0, 8)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live exception processing with a durable incident list.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <LiveRefresh
            endpoint={`/api/incidents/batch/${batchId}/progress`}
            label="Batch"
          />
          <Button
            variant="outline"
            size="icon"
            aria-label="Refresh batch"
            onClick={() => window.location.reload()}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 border-y border-border sm:grid-cols-5">
        <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
          <p className="font-data text-xl">{incidents.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Records</p>
        </div>
        <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
          <p className="font-data text-xl">{terminal}</p>
          <p className="mt-1 text-xs text-muted-foreground">Terminal</p>
        </div>
        <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
          <p className="font-data text-xl">{counts.pending ?? 0}</p>
          <p className="mt-1 text-xs text-muted-foreground">Pending</p>
        </div>
        <div className="border-b border-border px-4 py-3 sm:border-b-0 sm:border-r">
          <p className="font-data text-xl">{counts.ambiguous ?? 0}</p>
          <p className="mt-1 text-xs text-muted-foreground">Ambiguous</p>
        </div>
        <div className="px-4 py-3">
          <p className="font-data text-xl">
            {new Date(startedAt).toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Started</p>
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-lg border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <Activity aria-hidden="true" className="size-4 text-primary" />
            <h2 className="text-sm font-semibold">Exceptions</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {terminal} of {incidents.length} terminal
          </span>
        </div>
        <div className="divide-y divide-border">
          {incidents.length ? (
            incidents.map((item) => (
              <Link
                key={item.incident_id}
                href={`/incidents/${item.incident_id}`}
                className="focus-ring flex items-center justify-between gap-4 px-4 py-4 hover:bg-surface-subtle sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={item.status} />
                    <span className="text-sm font-medium capitalize">
                      {classLabel(item.incident_class)}
                    </span>
                  </div>
                  <p className="mt-1 truncate font-data text-xs text-muted-foreground">
                    {item.incident_id}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  <span className="hidden capitalize sm:inline">
                    {item.current_step}
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-4" />
                </div>
              </Link>
            ))
          ) : (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              No incidents were recorded for this batch.
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
