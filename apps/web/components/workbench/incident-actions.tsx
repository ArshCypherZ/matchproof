"use client";

import { useRef, useState } from "react";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function IncidentActions({
  incidentId,
  canApprove,
  targetOrderId,
  targetState,
  idempotencyKey,
}: {
  incidentId: string;
  canApprove: boolean;
  targetOrderId: string | null;
  targetState: string | null;
  idempotencyKey: string;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<"approve" | "escalate" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutate = async (action: "approve" | "escalate") => {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/incidents/${incidentId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason:
            action === "approve"
              ? "merchant-side repair approval"
              : "manual evidence review required",
        }),
      });
      if (!response.ok) throw new Error("Action could not be recorded");
      dialog.current?.close();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Action could not be recorded",
      );
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        variant="outline"
        onClick={() => mutate("escalate")}
        disabled={pending !== null}
        data-icon="inline-start"
      >
        {pending === "escalate" ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <ShieldAlert aria-hidden="true" />
        )}
        Escalate
      </Button>
      {canApprove ? (
        <Button
          onClick={() => dialog.current?.showModal()}
          disabled={pending !== null}
        >
          Approve merchant repair
        </Button>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="basis-full text-right text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
      <dialog
        ref={dialog}
        aria-labelledby="approval-title"
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-border bg-surface-raised p-0 text-foreground shadow-xl backdrop:bg-black/45"
      >
        <div className="border-b border-border px-5 py-4">
          <h2 id="approval-title" className="text-base font-semibold">
            Approve merchant repair
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            This approval authorizes one bounded merchant-side transition.
          </p>
        </div>
        <dl className="grid gap-4 px-5 py-5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Transition</dt>
            <dd className="mt-1 font-data text-xs">
              {targetOrderId ?? "No unique order"} to {targetState ?? "unknown"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Scope</dt>
            <dd className="mt-1">Merchant order state</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Idempotency key</dt>
            <dd className="mt-1 break-all font-data text-xs">
              {idempotencyKey}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">
              Expected invariant
            </dt>
            <dd className="mt-1">
              Provider and merchant identity, amount, currency, order, and state
              agree after a fresh observation.
            </dd>
          </div>
        </dl>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button
            variant="outline"
            onClick={() => dialog.current?.close()}
            disabled={pending !== null}
          >
            Cancel
          </Button>
          <Button
            onClick={() => mutate("approve")}
            disabled={pending !== null}
            data-icon="inline-start"
          >
            {pending === "approve" ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : null}
            Confirm approval
          </Button>
        </div>
      </dialog>
    </div>
  );
}
