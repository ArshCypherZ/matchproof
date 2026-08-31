"use client";

import { useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function StartBatchButton({ incidentIds }: { incidentIds: string[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/incidents/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_ids: incidentIds }),
      });
      if (!response.ok) {
        if (response.status === 404)
          throw new Error(
            "None of the selected exceptions are accessible in this tenant. Refresh the queue and pick again.",
          );
        throw new Error(
          "The batch could not be started. No records were changed. Try again.",
        );
      }
      const result = (await response.json()) as { batch_id: string };
      // Stay busy through the route change: re-enabling mid-navigation invites
      // a second POST of the same batch.
      router.push(`/batches/${result.batch_id}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The batch could not be started. No records were changed. Try again.",
      );
      setLoading(false);
    }
  };
  const empty = incidentIds.length === 0;
  return (
    <div>
      <Button
        onClick={start}
        disabled={loading || empty}
        title={empty ? "No pending exceptions to batch" : undefined}
        data-icon="inline-start"
      >
        {loading ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Play aria-hidden="true" />
        )}
        Start batch
      </Button>
      {empty ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing is pending. Every exception is verified or escalated.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
