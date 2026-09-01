"use client";

import { useId, useState } from "react";
import { LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const GENERIC_ERROR =
  "The batch could not be started. No exceptions were changed. Try again.";
const INACCESSIBLE_ERROR =
  "None of these exceptions are accessible in this tenant. Refresh the page and try again.";

// Only these authored messages may reach the operator: a dropped network
// request or a malformed response must not leak raw browser errors like
// "Failed to fetch" into the console.
class OperatorError extends Error {}

export function StartBatchButton({
  incidentIds,
  reasonId,
}: {
  incidentIds: string[];
  // Id of the element explaining why the control is disabled, so the
  // reason reaches screen readers as part of the button, not as a stray
  // paragraph beside it.
  reasonId?: string;
}) {
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
          throw new OperatorError(INACCESSIBLE_ERROR);
        throw new OperatorError(GENERIC_ERROR);
      }
      const result = (await response.json().catch(() => null)) as {
        batch_id?: string;
      } | null;
      if (!result?.batch_id) throw new OperatorError(GENERIC_ERROR);
      // Stay busy through the route change: re-enabling mid-navigation invites
      // a second POST of the same batch.
      router.push(`/batches/${result.batch_id}`);
    } catch (cause) {
      setError(cause instanceof OperatorError ? cause.message : GENERIC_ERROR);
      setLoading(false);
    }
  };
  const empty = incidentIds.length === 0;
  const errorId = useId();
  // The failure alert joins the disabled-state reason in the button's
  // description when present, so returning focus to the control reads its
  // own error instead of a stray paragraph beside it.
  const describedBy =
    [reasonId, error ? errorId : undefined].filter(Boolean).join(" ") ||
    undefined;
  // The empty-queue reason is stated on the Batches page beside the action
  // group, visible to everyone — a title tooltip would only duplicate it.
  return (
    <div className="max-sm:w-full">
      <Button
        onClick={start}
        disabled={loading || empty}
        aria-busy={loading || undefined}
        aria-describedby={describedBy}
        data-icon="inline-start"
        className="max-sm:w-full"
      >
        {loading ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <Play aria-hidden="true" />
        )}
        Start batch
      </Button>
      {/* The strong destructive ink: the base token lands under 4.5:1 at
          text-xs on the canvas, and this line is the failure read. */}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="mt-2 text-xs text-destructive-strong"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
