"use client";

import { useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function StartBatchButton({ incidentIds }: { incidentIds: string[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const start = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/incidents/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incident_ids: incidentIds }),
      });
      if (!response.ok) throw new Error("Batch could not be started");
      const result = (await response.json()) as { batch_id: string };
      router.push(`/batches/${result.batch_id}`);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button
      onClick={start}
      disabled={loading || !incidentIds.length}
      data-icon="inline-start"
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="animate-spin" />
      ) : (
        <Play aria-hidden="true" />
      )}
      Start fixture batch
    </Button>
  );
}
